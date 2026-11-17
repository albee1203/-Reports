// 讀回使用者在 Excel 修改之假設與覆寫，產生差異清單供確認後套用
import ExcelJS from 'exceljs';
import { Graph, Value, EvalResult } from '../engine/graph';
import { Project, Scenario } from '../engine/project';
import { ID_HEADER, HEADER_ROWS } from './excel';

export type ChangeKind = 'input' | 'override' | 'restore' | 'conflict';
export interface ExcelChange {
  kind: ChangeKind;
  sheet: string;
  rowId: string;
  label: string;
  col: number; // 計算圖欄索引
  year: number;
  oldValue: Value;
  newValue: Value;
  path?: string; // input 之專案路徑
  forecastIndex?: number; // override 用
  note?: string;
}

export interface ReadBackResult {
  changes: ExcelChange[];
  warnings: string[];
}

const isFormula = (v: any) => v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);
function plain(v: any): Value {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || typeof v === 'string') return typeof v === 'string' ? v.trim() || null : v;
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t: any) => t.text).join('').trim() || null;
  if (typeof v === 'object' && 'result' in v) return plain(v.result);
  return null;
}
const same = (a: Value, b: Value) => {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  return a === b;
};

export async function readBack(buf: ArrayBuffer, p: Project, sc: Scenario, g: Graph, ev: EvalResult): Promise<ReadBackResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const warnings: string[] = [];
  const changes: ExcelChange[] = [];
  // 專案代碼核對
  const cover = wb.getWorksheet('封面及說明');
  let code = '';
  cover?.eachRow((row) => { if (row.getCell(1).value === '專案代碼') code = String(plain(row.getCell(2).value) ?? ''); });
  if (!code) warnings.push('找不到專案代碼，可能不是本 App 匯出之檔案；以下比對依工作表與列代碼進行。');
  else {
    const [pid, sid] = code.split('／');
    if (pid !== p.id) warnings.push('此檔案匯出自其他專案，請確認是否套用至目前專案。');
    else if (sid !== sc.id) warnings.push(`此檔案匯出自其他情境（目前情境：${sc.name}），套用時將寫入目前情境。`);
  }
  const cb = g.columns.findIndex((c) => c.type === 'base');
  const sheets = new Set(g.rows.map((r) => r.sheet));
  let matchedSheets = 0;
  for (const name of sheets) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    // 找列代碼欄與年度欄
    const hdr = ws.getRow(HEADER_ROWS);
    let idCol = -1;
    const yearCol = new Map<number, number>(); // excel 欄 → graph 欄
    hdr.eachCell((cell, cn) => {
      const v = plain(cell.value);
      if (v === ID_HEADER) idCol = cn;
      const m = typeof v === 'string' ? v.match(/^(\d{4}) 年度$/) : null;
      if (m) {
        const gi = g.columns.findIndex((c) => c.year === +m[1]);
        if (gi >= 0) yearCol.set(cn, gi);
      }
    });
    if (idCol < 0) { warnings.push(`工作表「${name}」缺少列代碼欄，略過。`); continue; }
    if (yearCol.size !== g.columns.length) warnings.push(`工作表「${name}」之年度欄與目前專案不一致（例如預估年數已變更），僅比對相同年度。`);
    matchedSheets++;
    ws.eachRow((xr, rn) => {
      if (rn <= HEADER_ROWS) return;
      const id = plain(xr.getCell(idCol).value);
      if (typeof id !== 'string') return;
      const row = g.byId.get(id);
      if (!row || row.sheet !== name) return;
      for (const [cn, gi] of yearCol) {
        const cell = row.cells[gi];
        if (!cell) continue;
        const xv = xr.getCell(cn).value;
        const base = { sheet: name, rowId: id, label: row.label, col: gi, year: g.columns[gi].year };
        if (cell.kind === 'input') {
          if (isFormula(xv)) { changes.push({ ...base, kind: 'conflict', oldValue: cell.value ?? null, newValue: plain(xv), note: '假設儲存格被改為公式，App 僅接受數值' }); continue; }
          const nv = plain(xv);
          if (!same(cell.value ?? null, nv)) {
            if (cell.options && nv !== null && !cell.options.includes(String(nv))) { changes.push({ ...base, kind: 'conflict', oldValue: cell.value ?? null, newValue: nv, note: `選項須為：${cell.options.join('、')}` }); continue; }
            if (!cell.options && nv !== null && typeof nv !== 'number') { changes.push({ ...base, kind: 'conflict', oldValue: cell.value ?? null, newValue: nv, note: '須為數值' }); continue; }
            changes.push({ ...base, kind: 'input', oldValue: cell.value ?? null, newValue: nv, path: cell.inputPath });
          }
        } else if (cell.kind === 'formula') {
          if (isFormula(xv) || xv === null || xv === undefined) continue;
          const nv = plain(xv);
          if (typeof nv !== 'number') continue;
          if (same(ev.num(id, gi), nv) || Math.abs(ev.num(id, gi) - nv) < 0.005) continue; // 僅貼上數值、金額未變
          if (row.overridable && g.columns[gi].type === 'forecast') changes.push({ ...base, kind: 'override', oldValue: null, newValue: nv, forecastIndex: gi - cb - 1, note: '公式儲存格改為數值，將以手動覆寫處理（保留原公式）' });
          else changes.push({ ...base, kind: 'conflict', oldValue: null, newValue: nv, note: '此為彙總或連動數，無法直接覆寫；請於來源科目修改，合計將依明細重算' });
        } else if (cell.kind === 'override') {
          if (isFormula(xv)) changes.push({ ...base, kind: 'restore', oldValue: cell.value ?? null, newValue: null, forecastIndex: gi - cb - 1, note: '覆寫值改回公式' });
          else {
            const nv = plain(xv);
            if (typeof nv === 'number' && !same(cell.value ?? null, nv)) changes.push({ ...base, kind: 'override', oldValue: cell.value ?? null, newValue: nv, forecastIndex: gi - cb - 1 });
          }
        }
      }
    });
  }
  if (!matchedSheets) warnings.push('未找到可比對之工作表。');
  return { changes, warnings };
}
