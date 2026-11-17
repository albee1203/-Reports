// 計算圖 → .xlsx（公式可在 Excel 重算）
import ExcelJS from 'exceljs';
import { Graph, EvalResult, exprToExcel, colLetter, exprToText, Row } from '../engine/graph';
import { SH, STATEMENT_SHEETS, isZeroRow } from '../engine/model';
import { Project, Scenario, defaultPeriodText } from '../engine/project';
import { reportStatus, Issue } from '../engine/checks';

export type ExportMode = 'internal' | 'bank';

export const ID_HEADER = '列代碼';
export const FIRST_DATA_COL = 3; // A=項目, B=說明, C 起為資料欄（0-based index 2）
export const HEADER_ROWS = 4;

const FILL = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const STY = {
  actual: FILL('FFEFEFEF'),
  input: FILL('FFFFF6CC'),
  override: FILL('FFFFD8A8'),
  missing: FILL('FFFFC7CE'),
  header: FILL('FF1F3864'),
  forecastHead: FILL('FFDDEBF7'),
  actualHead: FILL('FFE2E2E2'),
};

export function amountFormat(unit: 'yuan' | 'thousand') {
  return unit === 'thousand' ? '#,##0,;(#,##0,);"-"' : '#,##0;(#,##0);"-"';
}

export interface ExportOptions {
  mode: ExportMode;
  project: Project;
  scenario: Scenario;
  graph: Graph;
  ev: EvalResult;
  issues: Issue[];
  omitCachedResults?: boolean; // 測試用：讓試算表軟體自行重算
}

export function fileName(p: Project, mode: ExportMode, ext = 'xlsx') {
  const s = p.settings;
  const safe = (x: string) => x.replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(s.companyName)}_${s.baseYear + 1}-${s.baseYear + s.years}_財務預估_${mode === 'bank' ? '銀行版' : '內部版'}.${ext}`;
}

export async function buildWorkbook(o: ExportOptions): Promise<ExcelJS.Workbook> {
  const { project: p, graph: g, ev, mode, scenario } = o;
  const st = p.settings;
  const wb = new ExcelJS.Workbook();
  wb.creator = '五年財務預估 App';
  wb.created = new Date();
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true }; // 開啟時重算
  const status = reportStatus(o.issues, mode);
  const unitText = st.unit === 'thousand' ? '新台幣千元' : '新台幣元';
  const amtFmt = amountFormat(st.unit);

  // 列位置
  const sheetsOrder = [SH.cover, SH.assump, SH.base, SH.raw, SH.rev, SH.wc, SH.oth, SH.fa, ...(o.project.faAssets?.length ? [SH.fad] : []), SH.loan, SH.taxeq, SH.is, SH.bs, SH.sce, SH.cf, SH.ratio, SH.ck, ...(mode === 'bank' ? [SH.notes] : [])];
  const pos = new Map<string, { sheet: string; row: number }>();
  const rowsBySheet = new Map<string, Row[]>();
  for (const r of g.rows) {
    if (!rowsBySheet.has(r.sheet)) rowsBySheet.set(r.sheet, []);
    rowsBySheet.get(r.sheet)!.push(r);
  }
  for (const [sheet, rs] of rowsBySheet) rs.forEach((r, i) => pos.set(r.id, { sheet, row: HEADER_ROWS + 1 + i }));
  const addr = (row: string, col: number) => {
    const p_ = pos.get(row);
    if (!p_) throw new Error(`Excel 位置未定義：${row}`);
    return { sheet: p_.sheet, ref: `${colLetter(FIRST_DATA_COL - 1 + col)}${p_.row}` };
  };

  const isText = (row: string, col: number) => {
    const r = g.byId.get(row);
    const cell = r?.cells[col];
    return !!cell && cell.kind === 'na';
  };
  const xf = (e: any, sheet: string) => exprToExcel(e, sheet, addr, isText);
  const labelOf = (r: Row) => (mode === 'bank' && p.bank.labels[r.id]) || r.label;
  const titleOf = (sheet: string) => (mode === 'bank' && p.bank.titles[sheet]) || sheet;

  for (const name of sheetsOrder) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROWS }] });
    if (name === SH.cover) { writeCover(ws, o, status, unitText); continue; }
    if (name === SH.raw) { writeRaw(ws, p); continue; }
    if (name === SH.notes) { writeNotes(ws, p); continue; }
    const rs = rowsBySheet.get(name) ?? [];
    const isStmt = STATEMENT_SHEETS.includes(name as any);
    ws.getColumn(1).width = 44;
    ws.getColumn(2).width = isStmt ? 4 : 34;
    g.columns.forEach((col, ci) => {
      const wc = ws.getColumn(FIRST_DATA_COL + ci);
      wc.width = 16;
      if (col.type === 'comparative' && !isStmt && name !== SH.base && name !== SH.ck && name !== SH.ratio) wc.hidden = true;
    });
    // 表頭
    ws.getCell('A1').value = st.companyName;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = titleOf(name) + (isStmt ? (mode === 'bank' ? '' : `（情境：${scenario.name}）`) : '');
    ws.getCell('A2').font = { bold: true, size: 12 };
    ws.getCell('A3').value = `${periodText(p, name, mode)}　單位：${unitText}${isStmt && status !== '已完成檢查' ? `　【${status}】` : ''}`;
    g.columns.forEach((col, ci) => {
      const c = ws.getCell(HEADER_ROWS - 1, FIRST_DATA_COL + ci);
      c.value = col.type === 'forecast' ? '預估' : col.type === 'base' ? '實際（基期）' : '實際（比較）';
      c.alignment = { horizontal: 'center' };
      c.fill = col.type === 'forecast' ? STY.forecastHead : STY.actualHead;
      const h = ws.getCell(HEADER_ROWS, FIRST_DATA_COL + ci);
      h.value = `${col.label} 年度`;
      h.font = { bold: true };
      h.alignment = { horizontal: 'center' };
      h.fill = c.fill;
    });
    ws.getCell(HEADER_ROWS, 1).value = '項目';
    ws.getCell(HEADER_ROWS, 2).value = isStmt ? '' : '說明／方法';
    // 隱藏「列代碼」欄：讀回 Excel 修改時用以對應 App 之列
    const idCol = FIRST_DATA_COL + g.columns.length;
    ws.getCell(HEADER_ROWS, idCol).value = ID_HEADER;
    ws.getColumn(idCol).hidden = true;
    ws.getRow(HEADER_ROWS).font = { bold: true };

    rs.forEach((r) => {
      const rn = pos.get(r.id)!.row;
      ws.getRow(rn).getCell(idCol).value = r.id;
      const xr = ws.getRow(rn);
      xr.getCell(1).value = (r.indent ? '　'.repeat(r.indent) : '') + labelOf(r);
      if (!isStmt && r.desc) xr.getCell(2).value = r.desc;
      if (r.style === 'header') xr.getCell(1).font = { bold: true };
      if (r.style === 'subtotal' || r.style === 'total') xr.font = { bold: true };
      if (r.hidden && name === SH.base) xr.hidden = true;
      // 銀行版：正式報表隱藏全部年度皆為零之科目列（公式保留，取消隱藏即可檢視）
      if (mode === 'bank' && (isStmt || name === SH.ratio) && isZeroRow(r, ev, g.columns.length)) xr.hidden = true;
      const numFmt = r.format === 'amount' ? amtFmt : r.format === 'pct' ? '0.00%' : r.format === 'ratio' ? '#,##0.####' : r.format === 'times' ? '0.00"倍"' : r.format === 'days' || r.format === 'month' || r.format === 'years' ? '0' : undefined;
      r.cells.forEach((cell, ci) => {
        if (!cell) return;
        const xc = xr.getCell(FIRST_DATA_COL + ci);
        if (numFmt) xc.numFmt = numFmt;
        const cached = ev.value(r.id, ci);
        switch (cell.kind) {
          case 'na':
            if (isStmt || name === SH.base || name === SH.ratio) { xc.value = cell.note ?? '未提供'; xc.alignment = { horizontal: 'right' }; xc.font = { italic: true, color: { argb: 'FF808080' } }; }
            break;
          case 'actual':
            xc.value = cell.value as any;
            xc.fill = STY.actual;
            break;
          case 'input': {
            const v = cell.value;
            xc.value = v === null || v === undefined ? null : (v as any);
            const missing = cell.required && (v === null || v === undefined || v === '');
            xc.fill = missing ? STY.missing : STY.input;
            xc.font = { color: { argb: 'FF0000FF' } };
            if (missing) xc.note = '未完成：必要假設';
            if (cell.options) xc.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${cell.options.join(',')}"`] };
            break;
          }
          case 'override': {
            xc.value = cell.value as any;
            xc.fill = STY.override;
            xc.note = `手動覆寫。原公式：=${cell.expr ? xf(cell.expr, name) : ''}\n${cell.expr ? exprToText(cell.expr, g) : ''}`;
            break;
          }
          case 'formula': {
            const f = xf(cell.expr!, name);
            xc.value = (o.omitCachedResults || cached === null ? { formula: f } : { formula: f, result: cached as any }) as any;
            if (ev.incomplete(r.id, ci)) xc.font = { color: { argb: 'FFC00000' }, italic: true };
            break;
          }
        }
      });
    });
    if (isStmt) {
      const last = HEADER_ROWS + rs.length;
      ws.pageSetup = { paperSize: 9, orientation: g.columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:${colLetter(FIRST_DATA_COL - 1 + g.columns.length - 1)}${last + 4}`, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0, footer: 0 } };
      const sig = ws.getRow(last + 3);
      sig.getCell(1).value = '負責人：＿＿＿＿＿＿＿＿';
      sig.getCell(FIRST_DATA_COL + Math.max(0, g.columns.length - 3)).value = '財務主管：＿＿＿＿＿＿＿＿';
      ws.getRow(last + 1).getCell(1).value = `註：「預估」欄位為依假設推估之預估數，非實際數。${st.unit === 'thousand' ? '金額以新台幣千元表達，因四捨五入，合計數與明細加總可能有尾差。' : ''}`;
      ws.getRow(last + 1).getCell(1).font = { italic: true, size: 9 };
    }
    if (name === SH.ck) {
      ws.pageSetup = { ...ws.pageSetup, printArea: undefined } as any;
      ws.state = 'visible';
    }
  }
  return wb;
}

function periodText(p: Project, sheet: string, mode: ExportMode) {
  const custom = mode === 'bank' ? p.bank.periodText[sheet] : undefined;
  return custom || defaultPeriodText(p, sheet);
}

function writeCover(ws: ExcelJS.Worksheet, o: ExportOptions, status: string, unitText: string) {
  const p = o.project, s = p.settings;
  ws.getColumn(1).width = 28; ws.getColumn(2).width = 80;
  const lines: [string, string][] = [
    ['公司名稱', s.companyName],
    ['統一編號', s.taxId || '—'],
    ['專案代碼', `${p.id}／${o.scenario.id}`],
    ['匯出模式', o.mode === 'bank' ? '銀行送件版' : '內部預估版'],
    ['情境', o.scenario.name],
    ['基期年度（實際）', String(s.baseYear)],
    ['預估年度', `${s.baseYear + 1}–${s.baseYear + s.years}（${s.years} 年）`],
    ['幣別／顯示單位', `${s.currency}／${unitText}（底層以元計算，千元僅為顯示格式）`],
    ['報表狀態', status],
    ['匯出時間', new Date().toLocaleString('zh-TW')],
    ['', ''],
    ['顏色圖例', '灰底＝歷史實際數；藍字黃底＝使用者假設輸入；黑字＝公式自動計算；橘底＝手動覆寫（註解保留原公式）；紅底＝未完成之必要假設'],
    ['計息慣例', '借款月初生效，當年度計息月數＝13−月份；月份留白時採「假設及計算依據」之預設月份'],
    ['計算限制', '所得稅為簡化當期估算，未計算遞延所得稅（基期遞延所得稅餘額維持不變）；新增資產折舊採直線法；租賃、外幣及關係人交易未自動處理。'],
    ['聲明', '本檔案為依假設編製之財務預估，非經會計師查核或核閱之財務報表，亦不表示完整遵循企業會計準則公報。'],
    ['', ''],
    ['適用準則版本', ''],
    ...s.standards.map((x) => [`${x.year} 年度`, `${x.version}${x.effectiveDate ? `（適用日期：${x.effectiveDate}）` : ''}`] as [string, string]),
  ];
  ws.getCell('A1').value = `${s.companyName}　財務預估`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  lines.forEach(([a, b], i) => {
    const row = ws.getRow(3 + i);
    row.getCell(1).value = a; row.getCell(1).font = { bold: true };
    row.getCell(2).value = b; row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });
  if (o.issues.length) {
    const start = 5 + lines.length;
    ws.getCell(`A${start}`).value = '待處理事項';
    ws.getCell(`A${start}`).font = { bold: true };
    o.issues.slice(0, 200).forEach((x, i) => {
      const row = ws.getRow(start + 1 + i);
      row.getCell(1).value = `${{ error: '錯誤', incomplete: '未完成', warning: '待確認', info: '提示' }[x.level]}${x.year ? `／${x.year}` : ''}`;
      row.getCell(2).value = `${x.item}：${x.message}`;
      row.getCell(2).alignment = { wrapText: true };
    });
  }
}

function writeRaw(ws: ExcelJS.Worksheet, p: Project) {
  ws.getCell('A1').value = '原始匯入資料（保留原樣，未經調整）';
  ws.getCell('A1').font = { bold: true };
  let r = 3;
  if (!p.imports.length) ws.getCell('A3').value = '無匯入資料（基期以手動輸入建檔）';
  for (const im of p.imports) {
    ws.getCell(`A${r}`).value = `檔案：${im.fileName}／工作表：${im.sheet}／報表：${im.stmt}／年度：${im.year}／幣別：${im.currency}／單位倍數：${im.unitMultiplier}`;
    ws.getCell(`A${r}`).font = { bold: true };
    r++;
    for (const row of im.rows) { ws.getRow(r).values = row.map((x) => x ?? ''); r++; }
    r += 2;
  }
  ws.getColumn(1).width = 40;
}

function writeNotes(ws: ExcelJS.Worksheet, p: Project) {
  ws.getColumn(1).width = 100;
  ws.getCell('A1').value = `${p.settings.companyName}　財務報表附註`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  let r = 3;
  for (const nt of p.bank.notes) {
    ws.getCell(`A${r}`).value = nt.title; ws.getCell(`A${r}`).font = { bold: true }; r++;
    for (const para of (nt.body || '（待補）').split(/\n/)) { ws.getCell(`A${r}`).value = para; ws.getCell(`A${r}`).alignment = { wrapText: true }; r++; }
    r++;
  }
}

export async function workbookBuffer(o: ExportOptions): Promise<ArrayBuffer> {
  const wb = await buildWorkbook(o);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
