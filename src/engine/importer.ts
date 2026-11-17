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

export function normalizeSign(amount: number, acc: AccountDef | undefined, conv: 'presentation' | 'debitPositive'): { value: number; issue?: string } {
  if (!acc) return { value: amount };
  let v = amount;
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
  for (let i = cfg.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const label = String(row[cfg.labelCol] ?? '').trim();
    const raw = String(row[cfg.amountCol] ?? '').trim();
    if (!label && !raw) continue;
    if (!label) { lines.push({ importId, rowIndex: i, label: '（無科目名稱）', rawAmount: raw, amount: null, account: null, kind: 'ignore', issues: ['無科目名稱，已略過'], confirmed: false }); continue; }
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
      const r = normalizeSign(amount, findAccount(account, custom), cfg.signConvention);
      amount = r.value;
      if (r.issue) issues.push(r.issue);
    }
    if (raw === '' ) issues.push('金額空白');
    lines.push({ importId, rowIndex: i, label, rawAmount: raw, amount, account, kind: 'detail', issues, confirmed: false });
  }
  return lines;
}

// 重新對應某列後重新計算符號與問題
export function remapLine(l: MappedLine, account: string | null, imp: RawImport | undefined, custom: AccountDef[] = []) {
  l.account = account;
  const pa = parseAmount(l.rawAmount);
  const issues = l.issues.filter((x) => x.startsWith('科目名稱重複') || x.startsWith('金額格式錯誤'));
  let amount = pa.value === null ? null : pa.value * (imp?.unitMultiplier ?? 1);
  if (account && amount !== null) {
    const r = normalizeSign(amount, findAccount(account, custom), imp?.signConvention ?? 'presentation');
    amount = r.value; if (r.issue) issues.push(r.issue);
  }
  if (!account && l.kind === 'detail') issues.push('未對應科目');
  l.amount = amount;
  l.issues = issues;
}

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

export function applyImport(y: YearData, raw: RawImport, lines: MappedLine[], custom: AccountDef[] = []) {
  y.lines = [...y.lines.filter((l) => l.importId !== raw.id), ...lines];
  if (!y.importIds.includes(raw.id)) y.importIds.push(raw.id);
  reconcileSubtotals(y, custom);
}

export function newRawImport(cfg: MapConfig, rows: string[][]): RawImport {
  return { id: uid(), fileName: cfg.fileName, sheet: cfg.sheet, stmt: cfg.stmt, year: cfg.year, currency: cfg.currency, unitMultiplier: cfg.unitMultiplier, signConvention: cfg.signConvention, labelCol: cfg.labelCol, amountCol: cfg.amountCol, headerRow: cfg.headerRow, rows, importedAt: new Date().toISOString() };
}

// 猜測標題列、科目欄、金額欄
export function guessLayout(rows: string[][]): { headerRow: number; labelCol: number; amountCol: number } {
  let headerRow = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if ((rows[i] ?? []).some((c) => /科目|項目|會計項目|名稱/.test(c))) { headerRow = i; break; }
  }
  const sample = rows.slice(headerRow + 1, headerRow + 40);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let labelCol = 0, amountCol = 1, bestText = -1, bestNum = -1;
  for (let c = 0; c < width; c++) {
    const text = sample.filter((r) => r[c] && /[一-鿿]/.test(r[c])).length;
    const num = sample.filter((r) => r[c] && parseAmount(r[c]).value !== null && !parseAmount(r[c]).error).length;
    if (text > bestText) { bestText = text; labelCol = c; }
    if (num > bestNum && c !== labelCol) { bestNum = num; amountCol = c; }
  }
  return { headerRow, labelCol, amountCol };
}
