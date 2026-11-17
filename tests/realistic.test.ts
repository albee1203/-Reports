import { describe, it, expect } from 'vitest';
import { BS_ROWS, IS_ROWS } from './realistic';
import { guessLayout, buildLines, newRawImport, applyImport } from '../src/engine/importer';
import { emptyYear } from '../src/engine/project';

const run = (rows: string[][], stmt: 'BS' | 'IS', which: 'base' | 'comp' = 'base') => {
  const lay = guessLayout(rows);
  const amountCol = which === 'base' ? lay.amountCol : lay.compCol!;
  const cfg = { fileName: 'r.xlsx', sheet: 's', stmt, year: 2025, currency: 'TWD', unitMultiplier: 1000, signConvention: 'presentation' as const, headerRow: lay.headerRow, labelCol: lay.labelCol, amountCol };
  const raw = newRawImport(cfg, rows);
  const y = emptyYear(2025);
  applyImport(y, raw, buildLines(rows, cfg, raw.id));
  return { lay, y };
};
const problems = (y: any) => y.lines.filter((l: any) => l.kind !== 'ignore' && (l.issues.length || (l.kind === 'detail' && !l.account))).map((l: any) => `${l.label}：${l.issues.join('；')}`);

describe('會計師查核報告版式匯入', () => {
  it('版面辨識：代碼欄、% 欄、兩個年度', () => {
    for (const rows of [BS_ROWS, IS_ROWS]) {
      expect(guessLayout(rows)).toMatchObject({ headerRow: 4, labelCol: 1, amountCol: 3, compCol: 5, year: 2025, compYear: 2024 });
    }
  });
  it('資產負債表：兩年度皆無問題、資產＝負債＋權益', () => {
    for (const w of ['base', 'comp'] as const) {
      const { y } = run(BS_ROWS, 'BS', w);
      expect(problems(y)).toEqual([]);
      const a = y.accounts;
      const assets = ['cash', 'notes_rec', 'ar', 'other_rec', 'inventory', 'prepay', 'ppe_net', 'rou_asset', 'intangible', 'dta', 'other_nca'].reduce((t, k) => t + (a[k] ?? 0), 0);
      const le = ['st_loan', 'contract_liab', 'ap', 'other_pay', 'tax_pay', 'other_cl', 'ltd_cur', 'ltd', 'other_ncl', 'capital', 'cap_surplus', 're'].reduce((t, k) => t + (a[k] ?? 0), 0);
      expect(assets).toBe(le);
      expect(a.ar).toBe(w === 'base' ? 48_000_000 : 43_000_000); // 應收帳款＋關係人
    }
  });
  it('綜合損益表：費用括號慣例自動辨識、無問題', () => {
    const { y } = run(IS_ROWS, 'IS');
    expect(problems(y)).toEqual([]);
    expect(y.accounts.cogs).toBe(225_000_000);
    expect(y.accounts.other_gl).toBe(-300_000);
    expect(y.accounts.fin_cost).toBe(2_500_000);
    const c = run(IS_ROWS, 'IS', 'comp').y;
    expect(problems(c)).toEqual([]);
    expect(c.accounts.other_gl).toBe(200_000);
  });
});
