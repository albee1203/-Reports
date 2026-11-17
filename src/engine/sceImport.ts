// 基期權益變動表匯入（矩陣格式：欄＝權益組成，列＝變動項目）
import { parseAmount } from './importer';
import { fmtAmt } from './format';

export type Comp = 'cap' | 'cs' | 'adv' | 're' | 'oe' | 'ot' | 'total';
export type Move = 'open' | 'inc' | 'ni' | 'oci' | 'div' | 'approp' | 'oth' | 'close' | 'skip';

export const COMP_LABEL: Record<Comp, string> = { cap: '股本', cs: '資本公積', adv: '預收股本', re: '保留盈餘', oe: '其他權益', ot: '庫藏股票', total: '權益總額' };

// 欄標題 → 權益組成（保留盈餘之細項歸入保留盈餘）
const COL_RULES: [RegExp, Comp][] = [
  [/權益總額|權益合計|^合計$|^總計$/, 'total'],
  [/預收股本|預收股款/, 'adv'],
  [/庫藏/, 'ot'],
  [/股本|普通股|資本額/, 'cap'],
  [/資本公積/, 'cs'],
  [/法定盈餘公積|特別盈餘公積|未分配盈餘|保留盈餘|累積虧損|待彌補虧損/, 're'],
  [/其他權益|國外營運|未實現|換算|重估|其他綜合損益/, 'oe'],
];
// 列標題 → 變動項目（較特定者在前）
const ROW_RULES: [RegExp, Move][] = [
  [/期初|年初|上年度?餘額/, 'open'],
  [/期末|年底|年末|本年度?餘額/, 'close'],
  [/綜合損益總額/, 'skip'],
  [/提列.*(法定|特別)盈餘公積|(法定|特別)盈餘公積.*提列|迴轉特別盈餘公積|盈餘指撥/, 'approp'],
  [/現金股利|股利/, 'div'],
  [/本期淨利|本期淨損|本期損益|本年度淨利|本年度損益|本期淨（損）利|本期淨利（損）/, 'ni'],
  [/其他綜合損益/, 'oci'],
  [/現金增資|發行新股|增資/, 'inc'],
  [/其他/, 'oth'],
];

export const matchComp = (h: string): Comp | null => { const t = h.replace(/[\s　]/g, ''); for (const [re, c] of COL_RULES) if (re.test(t)) return c; return null; };
export const matchMove = (l: string): Move | null => { const t = l.replace(/[\s　]/g, ''); if (!t) return null; for (const [re, m] of ROW_RULES) if (re.test(t)) return m; return 'oth'; };

// (變動, 組成) → 計算圖基期列代碼
export function targetId(m: Move, c: Comp): string | null {
  if (c === 'total' || m === 'skip' || m === 'close') return null;
  if (m === 'open') return `sce:${c}_open`;
  if (m === 'approp') return c === 're' ? null : `sce:${c}_oth`;
  const map: Partial<Record<Move, Partial<Record<Comp, string>>>> = {
    inc: { cap: 'sce:cap_inc', cs: 'sce:cs_inc', adv: 'sce:adv_chg' },
    ni: { re: 'sce:re_ni' },
    oci: { oe: 'sce:oe_oci' },
    div: { re: 'sce:re_div' },
  };
  return map[m]?.[c] ?? (c === 'ot' ? 'sce:ot_chg' : `sce:${c}_oth`);
}

export interface SceParse {
  values: Record<string, number>; // sce 列代碼 → 金額
  close: Partial<Record<Comp, number>>; // 原表期末（核對用）
  columns: { col: number; header: string; comp: Comp | null }[];
  rows: { row: number; label: string; move: Move | null }[];
  approp: number; // 保留盈餘內部移轉合計（應為 0）
  issues: string[];
}

export function findHeaderRow(rows: string[][]): number {
  let best = 0, bestN = 0;
  rows.slice(0, 20).forEach((r, i) => { const nn = r.filter((x) => x && matchComp(String(x))).length; if (nn > bestN) { bestN = nn; best = i; } });
  return best;
}

export function parseSce(rows: string[][], headerRow: number, labelCol: number, unitMultiplier = 1, colOverride: Record<number, Comp | null> = {}, rowOverride: Record<number, Move | null> = {}): SceParse {
  const hdr = rows[headerRow] ?? [];
  const columns = hdr.map((h, col) => ({ col, header: String(h ?? ''), comp: col in colOverride ? colOverride[col] : col === labelCol ? null : matchComp(String(h ?? '')) })).filter((x) => x.col !== labelCol && (x.header || x.comp));
  // 同時有保留盈餘細項欄（法定、特別、未分配）時，「保留盈餘合計」欄僅供核對，避免重複計入
  const hasReDetail = columns.some((c) => c.comp === 're' && /法定|特別|未分配/.test(c.header));
  for (const c of columns) if (hasReDetail && c.comp === 're' && !(c.col in colOverride) && !/法定|特別|未分配/.test(c.header)) c.comp = null;
  const values: Record<string, number> = {};
  const close: Partial<Record<Comp, number>> = {};
  const issues: string[] = [];
  const outRows: SceParse['rows'] = [];
  let approp = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const label = String(r[labelCol] ?? '').trim();
    const hasNum = columns.some((c) => String(r[c.col] ?? '').trim());
    if (!hasNum) continue; // 無金額之列（標題、說明文字）略過
    const move = i in rowOverride ? rowOverride[i] : matchMove(label);
    outRows.push({ row: i, label, move });
    if (!move) continue;
    for (const c of columns) {
      if (!c.comp) continue;
      const raw = String(r[c.col] ?? '').trim();
      if (!raw) continue;
      const pa = parseAmount(raw);
      if (pa.error || pa.value === null) { issues.push(`第 ${i + 1} 列「${label}」${c.header}：${pa.error ?? '金額空白'}`); continue; }
      const v = pa.value * unitMultiplier;
      if (move === 'close') { close[c.comp] = (close[c.comp] ?? 0) + v; continue; }
      if (move === 'approp' && c.comp === 're') { approp += v; continue; }
      const id = targetId(move, c.comp);
      if (id) values[id] = (values[id] ?? 0) + v;
    }
  }
  if (Math.abs(approp) >= 1) issues.push(`盈餘公積提列於保留盈餘各欄合計應為 0，目前為 ${fmtAmt(approp)}，差額已不計入`);
  return { values, close, columns, rows: outRows, approp, issues };
}

// 依匯入之組成列計算權益總額列（與預估年度公式相同口徑）
export function sceTotals(v: Record<string, number>, keys: string[]): Record<string, number> {
  const g = (id: string) => v[id] ?? 0;
  return {
    'sce:t_open': keys.reduce((t, k) => t + g(`sce:${k}_open`), 0),
    'sce:t_ci': g('sce:re_ni') + g('sce:oe_oci'),
    'sce:t_owner': g('sce:cap_inc') + g('sce:cs_inc') + g('sce:adv_chg') + g('sce:re_div'),
    ...(keys.includes('ot') ? { 'sce:t_other': g('sce:ot_chg') } : {}),
    'sce:t_oth': keys.reduce((t, k) => t + g(`sce:${k}_oth`), 0),
  };
}

// 範本列與欄（下載範本及說明用）
export const TEMPLATE_ROWS: [string, Move][] = [
  ['期初餘額', 'open'],
  ['提列法定盈餘公積', 'approp'],
  ['提列特別盈餘公積', 'approp'],
  ['現金股利', 'div'],
  ['本期淨利（淨損）', 'ni'],
  ['本期其他綜合損益', 'oci'],
  ['本期綜合損益總額', 'skip'],
  ['現金增資', 'inc'],
  ['其他', 'oth'],
  ['期末餘額', 'close'],
];
export const TEMPLATE_COLS: [string, Comp][] = [
  ['股本', 'cap'], ['資本公積', 'cs'], ['預收股本', 'adv'],
  ['法定盈餘公積', 're'], ['特別盈餘公積', 're'], ['未分配盈餘', 're'],
  ['其他權益', 'oe'], ['庫藏股票', 'ot'], ['權益總額', 'total'],
];
