// 基期／比較年度財報匯入：解析、科目對應、異常標示、原表小計核對
import { AccountDef, allAccounts, detectSubtotal, findAccount, suggestAccount, norm } from './coa';
import { MappedLine, RawImport, YearData, recomputeYearAccounts, uid, Num } from './project';

export interface SheetData { name: string; rows: string[][] }

export async function readFile(name: string, buf: ArrayBuffer): Promise<SheetData[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const Papa = (await import('papaparse')).default;
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) {
      try { text = new TextDecoder('big5').decode(buf); } catch { /* 瀏覽器不支援 big5 時保留 UTF-8 */ }
    }
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
    return [{ name: 'CSV', rows: res.data.map((r) => r.map((x) => String(x ?? ''))) }];
  }
  if (lower.endsWith('.pdf')) {
    const { readPdf } = await import('../pdfBrowser');
    return readPdf(buf);
  }
  if (lower.endsWith('.xls')) throw new Error('不支援舊版 .xls，請另存為 .xlsx 或 .csv 後再匯入');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      const arr: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn - 1] = cellText(cell.value); });
      rows[rn - 1] = Array.from(arr, (x) => x ?? '');
    });
    out.push({ name: ws.name, rows: Array.from(rows, (r) => r ?? []) });
  });
  return out;
}

function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if ('formula' in v) return '';
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
  }
  return String(v);
}

// 解析金額：支援千分位、括號負數、△/▲ 負號、全形數字；空白回傳 null
export function parseAmount(raw: string): { value: number | null; error?: string } {
  let s = (raw ?? '').trim();
  if (!s || s === '-' || s === '－' || s === '—') return { value: s ? 0 : null };
  s = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/，/g, ',').replace(/．/g, '.').replace(/[＄$元NT\s　]/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s) || /^（.*）$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[△▲\-－−]/.test(s)) { neg = !neg; s = s.slice(1); } // 「-」須跳脫，否則成為字元範圍
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, error: `金額格式錯誤：「${raw}」` };
  const v = Number(s);
  return { value: neg ? -v : v };
}

export interface MapConfig {
  fileName: string; sheet: string; stmt: 'BS' | 'IS' | 'TB'; year: number; currency: string;
  unitMultiplier: number; signConvention: 'presentation' | 'debitPositive';
  labelCol: number; amountCol: number; headerRow: number;
}

const EXPENSE_SECTIONS = ['COGS', 'OPEX', 'TAX'];
const CREDIT_SECTIONS = ['CL', 'NCL', 'EQ', 'REV', 'NONOP', 'OCI'];

export function normalizeSign(amount: number, acc: AccountDef | undefined, conv: 'presentation' | 'debitPositive', expenseNegative = false): { value: number; issue?: string } {
  if (!acc) return { value: amount };
  let v = amount;
  // 損益表以負數（括號）表示費用之慣例：費用取絕對值，正數費用提示確認
  if (expenseNegative && conv === 'presentation' && (EXPENSE_SECTIONS.includes(acc.section) || acc.code === 'fin_cost')) {
    return v <= 0 ? { value: -v } : { value: v, issue: '此表費用以負數表示，本列為正數，請確認是否為迴轉或利益' };
  }
  if (conv === 'debitPositive') {
    const creditNormal = acc.contra ? ['CA', 'NCA'].includes(acc.section) : CREDIT_SECTIONS.includes(acc.section) && !(acc.code === 'fin_cost');
    if (creditNormal) v = -v;
  }
  if (acc.contra) return { value: Math.abs(v) };
  if (v < 0 && EXPENSE_SECTIONS.includes(acc.section)) return { value: Math.abs(v), issue: '費用金額為負數，已以絕對值認列，請確認借貸符號' };
  if (v < 0 && acc.code === 'fin_cost') return { value: Math.abs(v), issue: '財務成本為負數，已以絕對值認列，請確認借貸符號' };
  if (v < 0 && !acc.canBeNegative) return { value: v, issue: '借貸符號異常：此科目通常為正數餘額' };
  return { value: v };
}

export function buildLines(rows: string[][], cfg: MapConfig, importId: string, custom: AccountDef[] = []): MappedLine[] {
  const lines: MappedLine[] = [];
  const seen = new Map<string, number>();
  const stmt = cfg.stmt === 'TB' ? null : cfg.stmt;
  const expenseNegative = detectExpenseNegative(rows, cfg, custom);
  for (let i = cfg.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const label = String(row[cfg.labelCol] ?? '').trim();
    const raw = String(row[cfg.amountCol] ?? '').trim();
    if (!label && !raw) continue;
    // 無金額之列（分類標題，如「流動資產」「營業費用」）：略過，不列為問題
    if (label && !raw) { lines.push({ importId, rowIndex: i, label, rawAmount: '', amount: null, account: null, kind: 'ignore', issues: [], confirmed: true }); continue; }
    // 金額欄為中文（如表頭「114年12月31日 金額」）：表頭或標題列，略過
    if (/[\u4e00-\u9fff]/.test(raw.replace(/元/g, ''))) { lines.push({ importId, rowIndex: i, label, rawAmount: raw, amount: null, account: null, kind: 'ignore', issues: [], confirmed: true }); continue; }
    // 無科目名稱：有金額者提示；否則（如簽名線「— —」）直接略過
    if (!label) { const has = /\d/.test(raw); lines.push({ importId, rowIndex: i, label: '（無科目名稱）', rawAmount: raw, amount: null, account: null, kind: 'ignore', issues: has ? ['無科目名稱，已略過'] : [], confirmed: !has }); continue; }
    const issues: string[] = [];
    const pa = parseAmount(raw);
    if (pa.error) issues.push(pa.error);
    const sub = detectSubtotal(label);
    const key = norm(label);
    if (seen.has(key)) issues.push(`科目名稱重複（第 ${seen.get(key)! + 1} 列已出現），請確認是否重複計入`);
    else seen.set(key, i);
    if (sub) {
      lines.push({ importId, rowIndex: i, label, rawAmount: raw, amount: pa.value === null ? null : pa.value * cfg.unitMultiplier, account: null, kind: sub === 'EPS' ? 'ignore' : 'subtotal', subtotalCheck: sub === 'EPS' || sub === 'OTHER' ? null : sub, issues, confirmed: false });
      continue;
    }
    const account = suggestAccount(label, stmt, custom);
    let amount = pa.value === null ? null : pa.value * cfg.unitMultiplier;
    if (!account) issues.push('未對應科目');
    if (amount !== null && account) {
      const r = normalizeSign(amount, findAccount(account, custom), cfg.signConvention, expenseNegative);
      amount = r.value;
      if (r.issue) issues.push(r.issue);
    }
    lines.push({ importId, rowIndex: i, label, rawAmount: raw, amount, account, kind: 'detail', issues, confirmed: false });
  }
  markGroupSubtotals(lines, custom);
  return lines;
}

// 小計列：金額等於緊接其下（或其上）2 列以上明細之加總（減項以負數計）者，
// 如「保留盈餘」＝法定盈餘公積＋特別盈餘公積＋未分配盈餘、「股本」＝普通股股本＋…，僅供核對，避免重複計入
export function markGroupSubtotals(lines: MappedLine[], custom: AccountDef[] = []) {
  const signed = (l: MappedLine) => (l.amount ?? 0) * (l.account && findAccount(l.account, custom)?.contra ? -1 : 1);
  const isDet = (l?: MappedLine) => !!l && l.kind === 'detail' && l.amount !== null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!isDet(L) || !L.amount) continue;
    const target = signed(L);
    for (const dir of [1, -1]) {
      let sum = 0, k = 0, hit = false;
      for (let j = i + dir; j >= 0 && j < lines.length; j += dir) {
        const M = lines[j];
        if (M.kind === 'ignore' && !M.rawAmount) break; // 遇到分類標題即停止
        if (!isDet(M)) break;
        sum += signed(M); k++;
        // 2 列以上明細之加總；或僅 1 項明細（合計列在其正下方、同一科目、同金額，如「本期其他綜合損益」）
        if ((k >= 2 || (dir < 0 && M.account && M.account === L.account)) && Math.abs(sum - target) < 1) { hit = true; break; }
        if (k > 12) break;
      }
      if (hit) {
        const comps = Array.from({ length: k }, (_, n) => lines[i + dir * (n + 1)]);
        if (comps.every((c) => c.account)) {
          // 明細皆已對應：保留明細，合計列僅供核對
          L.kind = 'subtotal'; L.subtotalCheck = null; L.account = null;
          L.issues = L.issues.filter((x) => !x.startsWith('未對應') && !x.startsWith('借貸符號'));
          L.note = `金額等於${dir > 0 ? '下' : '上'}方 ${k} 列明細之合計，判定為小計列（僅供核對，不計入）`;
        } else {
          // 明細有未對應者（如「備抵損失」）：保留合計（淨額），明細略過
          for (const c of comps) { c.kind = 'ignore'; c.issues = []; c.confirmed = true; c.note = `已由「${L.label}」合計列示，不重複計入`; }
          L.note = `為${dir > 0 ? '下' : '上'}方 ${k} 列明細之合計（淨額），以本列計入`;
        }
        break;
      }
    }
  }
}

// 重新對應某列後重新計算符號與問題
export function remapLine(l: MappedLine, account: string | null, imp: RawImport | undefined, custom: AccountDef[] = []) {
  l.account = account;
  const pa = parseAmount(l.rawAmount);
  const issues = l.issues.filter((x) => x.startsWith('科目名稱重複') || x.startsWith('金額格式錯誤'));
  let amount = pa.value === null ? null : pa.value * (imp?.unitMultiplier ?? 1);
  if (account && amount !== null) {
    const r = normalizeSign(amount, findAccount(account, custom), imp?.signConvention ?? 'presentation', imp ? detectExpenseNegative(imp.rows, imp, custom) : false);
    amount = r.value; if (r.issue) issues.push(r.issue);
  }
  if (!account && l.kind === 'detail') issues.push('未對應科目');
  l.amount = amount;
  l.issues = issues;
}

// 手動輸入核對用之小計：各段之後顯示（依原報表常見順序）
export const SECTION_CHECKS: Partial<Record<string, string[]>> = {
  CA: ['CA'], NCA: ['NCA', 'ASSETS'], CL: ['CL'], NCL: ['NCL', 'LIAB'], EQ: ['EQ', 'LE'],
  COGS: ['GP'], OPEX: ['OPEX', 'OPINC'], NONOP: ['NONOP', 'PBT'], TAX: ['NI'], OCI: ['CI'],
};
export const CHECK_LABEL: Record<string, string> = {
  CA: '流動資產合計', NCA: '非流動資產合計', ASSETS: '資產總計', CL: '流動負債合計', NCL: '非流動負債合計', LIAB: '負債總計',
  EQ: '權益總計', LE: '負債及權益總計', GP: '營業毛利', OPEX: '營業費用合計', OPINC: '營業利益（損失）',
  NONOP: '營業外收入及支出合計', PBT: '稅前淨利（淨損）', NI: '本期淨利（淨損）', CI: '本期綜合損益總額',
};

// 原表小計核對
export function subtotalValue(check: string, acc: Record<string, Num>, custom: AccountDef[] = []): number | null {
  const all = allAccounts(custom);
  const sec = (s: string) => all.filter((a) => a.section === s).reduce((t, a) => t + (a.contra ? -1 : 1) * (acc[a.code] ?? 0), 0);
  const v = (c: string) => acc[c] ?? 0;
  switch (check) {
    case 'CA': return sec('CA');
    case 'NCA': return sec('NCA');
    case 'ASSETS': return sec('CA') + sec('NCA');
    case 'CL': return sec('CL');
    case 'NCL': return sec('NCL');
    case 'LIAB': return sec('CL') + sec('NCL');
    case 'EQ': return sec('EQ');
    case 'LE': return sec('CL') + sec('NCL') + sec('EQ');
    case 'GP': return v('revenue') - v('cogs');
    case 'OPEX': return sec('OPEX');
    case 'OPINC': return v('revenue') - v('cogs') - sec('OPEX');
    case 'NONOP': return sec('NONOP') - 2 * v('fin_cost');
    case 'PBT': return v('revenue') - v('cogs') - sec('OPEX') + sec('NONOP') - 2 * v('fin_cost');
    case 'NI': return v('revenue') - v('cogs') - sec('OPEX') + sec('NONOP') - 2 * v('fin_cost') - v('tax_exp');
    case 'CI': return v('revenue') - v('cogs') - sec('OPEX') + sec('NONOP') - 2 * v('fin_cost') - v('tax_exp') + v('oci');
  }
  return null;
}

export function reconcileSubtotals(y: YearData, custom: AccountDef[] = []) {
  recomputeYearAccounts(y);
  for (const l of y.lines) {
    if (l.kind !== 'subtotal' || !l.subtotalCheck || l.amount === null) continue;
    l.issues = l.issues.filter((x) => !x.startsWith('原表'));
    const calc = subtotalValue(l.subtotalCheck, y.accounts, custom);
    if (calc === null) continue;
    const reported = Math.abs(l.amount);
    const diff = Math.abs(calc) - reported;
    if (Math.abs(diff) >= 1) l.issues.push(`原表合計 ${fmt(l.amount)} 與明細合計 ${fmt(calc)} 不符，差額 ${fmt(Math.abs(calc) - reported)}（合計列僅供核對，不計入）`);
  }
}

import { fmtAmt as fmt } from './format';

// 同一年度已匯入之同類報表（或同一檔案之同一工作表）：重複匯入會使金額加倍
export function duplicateImports(imports: RawImport[], y: YearData, cfg: { fileName: string; sheet: string; stmt: string }): RawImport[] {
  return imports.filter((im) => y.importIds.includes(im.id) && ((im.fileName === cfg.fileName && im.sheet === cfg.sheet) || (cfg.stmt !== 'TB' && im.stmt === cfg.stmt)));
}

export function removeImportsFromYear(y: YearData, ids: string[], custom: AccountDef[] = []) {
  y.lines = y.lines.filter((l) => !ids.includes(l.importId));
  y.importIds = y.importIds.filter((x) => !ids.includes(x));
  reconcileSubtotals(y, custom);
}

export function applyImport(y: YearData, raw: RawImport, lines: MappedLine[], custom: AccountDef[] = []) {
  y.lines = [...y.lines.filter((l) => l.importId !== raw.id), ...lines];
  if (!y.importIds.includes(raw.id)) y.importIds.push(raw.id);
  reconcileSubtotals(y, custom);
}

export function newRawImport(cfg: MapConfig, rows: string[][]): RawImport {
  return { id: uid(), fileName: cfg.fileName, sheet: cfg.sheet, stmt: cfg.stmt, year: cfg.year, currency: cfg.currency, unitMultiplier: cfg.unitMultiplier, signConvention: cfg.signConvention, labelCol: cfg.labelCol, amountCol: cfg.amountCol, headerRow: cfg.headerRow, rows, importedAt: new Date().toISOString() };
}

// 偵測損益表是否以負數（括號）表示費用：已對應之費用科目多數為負數
export function detectExpenseNegative(rows: string[][], cfg: { headerRow: number; labelCol: number; amountCol: number; stmt: string }, custom: AccountDef[] = []): boolean {
  if (cfg.stmt === 'BS') return false;
  let neg = 0, pos = 0;
  for (let i = cfg.headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const label = String(r[cfg.labelCol] ?? '');
    if (!label || detectSubtotal(label)) continue;
    const code = suggestAccount(label, cfg.stmt === 'TB' ? null : 'IS', custom);
    const acc = code ? findAccount(code, custom) : undefined;
    if (!acc || !(['COGS', 'OPEX', 'TAX'].includes(acc.section) || acc.code === 'fin_cost')) continue;
    const v = parseAmount(String(r[cfg.amountCol] ?? '')).value;
    if (v === null || v === 0) continue;
    if (v < 0) neg++; else pos++;
  }
  return neg > pos;
}

// 由表頭文字辨識金額單位（「單位：新台幣千元」等）
export function guessUnit(rows: string[][]): number | null {
  const text = rows.slice(0, 8).flat().join(' ');
  const cur = '(元|美元|日圓|日元|人民幣|港幣|港元|歐元|英鎊)';
  if (new RegExp(`百萬${cur}`).test(text)) return 1_000_000;
  if (new RegExp(`[千仟]${cur}`).test(text)) return 1000;
  if (/單位[：:]\s*(新台幣)?元/.test(text)) return 1;
  return null;
}

// 由欄標題辨識年度：「114年」（民國）或「2025」
export function yearFromHeader(h: string): number | null {
  const t = String(h ?? '');
  const m = t.match(/(\d{3,4})\s*年/) ?? t.match(/\b(20\d{2}|19\d{2})\b/);
  if (!m) return null;
  const y = +m[1];
  return y < 1911 ? y + 1911 : y;
}

// 猜測標題列、科目欄、金額欄（並辨識第二個年度金額欄，供同時匯入前期比較）
export function guessLayout(rows: string[][]): { headerRow: number; labelCol: number; amountCol: number; compCol?: number; year?: number; compYear?: number } {
  let headerRow = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] ?? [];
    if (r.some((c) => /科目|項目|名稱|代碼|金額/.test(c))) { headerRow = i; break; }
  }
  const hdr = rows[headerRow] ?? [];
  const sample = rows.slice(headerRow + 1, headerRow + 60);
  const width = Math.max(0, hdr.length, ...sample.map((r) => r.length));
  let labelCol = 0, bestText = -1;
  const numScore: { c: number; score: number }[] = [];
  for (let c = 0; c < width; c++) {
    const cells = sample.map((r) => String(r[c] ?? '').trim()).filter(Boolean);
    const text = cells.filter((x) => /[一-鿿]/.test(x)).length;
    if (text > bestText) { bestText = text; labelCol = c; }
    const nums = cells.map((x) => parseAmount(x)).filter((p) => p.value !== null && !p.error).map((p) => Math.abs(p.value!));
    const h = String(hdr[c] ?? '');
    const codeLike = /代碼|編號/.test(h) || cells.filter((x) => /^\d{4}$|X/.test(x)).length > cells.length / 2;
    const pctLike = /^[%％]$|比率|百分比/.test(h.trim()) || (nums.length > 0 && nums.filter((v) => v <= 100).length / nums.length > 0.8);
    if (!nums.length || codeLike || pctLike) continue;
    numScore.push({ c, score: nums.length + (/金額|年|\d{4}/.test(h) ? 5 : 0) });
  }
  const cand = numScore.filter((x) => x.c !== labelCol).sort((a, b) => b.score - a.score || a.c - b.c);
  const byPos = cand.slice(0, 2).sort((a, b) => a.c - b.c);
  const amountCol = byPos[0]?.c ?? (labelCol + 1);
  const compCol = byPos[1] && byPos[1].score >= byPos[0].score * 0.6 ? byPos[1].c : undefined;
  const year = yearFromHeader(hdr[amountCol] ?? '') ?? undefined;
  const compYear = compCol !== undefined ? yearFromHeader(hdr[compCol] ?? '') ?? undefined : undefined;
  return { headerRow, labelCol, amountCol, ...(compCol !== undefined ? { compCol } : {}), ...(year ? { year } : {}), ...(compYear ? { compYear } : {}) };
}
