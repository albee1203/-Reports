import { describe, it, expect } from 'vitest';
import { buildLines, parseAmount, guessLayout, applyImport, newRawImport, guessUnit } from '../src/engine/importer';
import { emptyYear } from '../src/engine/project';

const rows = [
  ['範例公司', ''], ['資產負債表', ''], ['會計項目', '2025年12月31日'],
  ['現金及約當現金', '35,000'], ['應收帳款淨額', '48,000'], ['存貨', '30,000'], ['流動資產合計', '113,000'],
  ['機器設備', '50,000'], ['累計折舊－機器設備', '(30,000)'], ['非流動資產合計', '20,000'],
  ['資產總計', '133,000'], ['應付帳款', '25,000'], ['應付帳款', '1'], ['短期借款', 'abc'],
  ['股本', '100,000'], ['保留盈餘', '△2,000'], ['負債及權益總計', '123,000'], ['神秘科目', '5'],
];

describe('importer', () => {
  it('辨識表頭金額單位', () => {
    expect(guessUnit([['單位：新台幣千元']])).toBe(1000);
    expect(guessUnit([['單位：仟元']])).toBe(1000);
    expect(guessUnit([['Unit', '單位：千美元']])).toBe(1000);
    expect(guessUnit([['單位：百萬日圓']])).toBe(1_000_000);
    expect(guessUnit([['單位：新台幣元']])).toBe(1);
    expect(guessUnit([['資產負債表']])).toBeNull();
  });
  it('parses amounts', () => {
    expect(parseAmount('(1,234)').value).toBe(-1234);
    expect(parseAmount('△500').value).toBe(-500);
    expect(parseAmount('１２３').value).toBe(123);
    expect(parseAmount('x1').error).toBeTruthy();
    expect(parseAmount('-10000000').value).toBe(-10_000_000);
    expect(parseAmount('-1,234.5').value).toBe(-1234.5);
    expect(parseAmount('－500').value).toBe(-500);
    expect(parseAmount('500-').value).toBe(-500);
    expect(parseAmount('◎500').error).toBeTruthy();
  });
  it('maps, flags and reconciles', () => {
    const lay = guessLayout(rows);
    expect(lay).toMatchObject({ headerRow: 2, labelCol: 0, amountCol: 1 });
    const cfg = { fileName: 't.csv', sheet: 'CSV', stmt: 'BS' as const, year: 2025, currency: 'TWD', unitMultiplier: 1000, signConvention: 'presentation' as const, ...lay };
    const raw = newRawImport(cfg, rows);
    const lines = buildLines(rows, cfg, raw.id);
    const y = emptyYear(2025);
    applyImport(y, raw, lines);
    const by = (l: string) => y.lines.filter((x) => x.label === l);
    expect(by('累計折舊－機器設備')[0].account).toBe('ppe_accdep');
    expect(by('累計折舊－機器設備')[0].amount).toBe(30_000_000);
    expect(by('流動資產合計')[0].kind).toBe('subtotal');
    expect(by('流動資產合計')[0].issues.length).toBe(0);
    expect(by('非流動資產合計')[0].issues.length).toBe(0);
    expect(by('應付帳款')[1].issues.some((i) => i.includes('重複'))).toBe(true);
    expect(by('短期借款')[0].issues.some((i) => i.includes('格式'))).toBe(true);
    expect(by('神秘科目')[0].issues).toContain('未對應科目');
    expect(by('負債及權益總計')[0].issues.some((i) => i.includes('不符'))).toBe(true);
    expect(y.accounts.cash).toBe(35_000_000);
    expect(y.accounts.re).toBe(-2_000_000);
  });
});

describe('小計列自動辨識', () => {
  const run = (rows: string[][], stmt: 'BS' | 'IS' = 'BS') => {
    const cfg = { fileName: 't', sheet: 's', stmt, year: 2025, currency: 'TWD', unitMultiplier: 1, signConvention: 'presentation' as const, headerRow: 0, labelCol: 0, amountCol: 1 };
    const raw = newRawImport(cfg, rows);
    const y = emptyYear(2025);
    applyImport(y, raw, buildLines(rows, cfg, raw.id));
    return y;
  };
  it('保留盈餘列（其下為法定、特別、未分配）不重複計入', () => {
    const y = run([['會計項目', '金額'], ['股本', '200,000'], ['保留盈餘', '66,120'], ['法定盈餘公積', '20,000'], ['特別盈餘公積', '1,120'], ['未分配盈餘', '45,000'], ['其他權益', '2,000'], ['權益總計', '268,120']]);
    expect(y.accounts.re).toBe(66_120);
    expect(y.lines.find((l) => l.label === '保留盈餘')!.kind).toBe('subtotal');
    expect(y.lines.find((l) => l.label === '權益總計')!.issues).toEqual([]);
  });
  it('應收帳款減備抵損失（明細有未對應者）：保留淨額', () => {
    const y = run([['會計項目', '金額'], ['現金', '5,000'], ['應收帳款', '45,000'], ['減：備抵損失', '(1,000)'], ['應收帳款淨額', '44,000'], ['存貨', '3,000'], ['流動資產合計', '52,000']]);
    expect(y.accounts.ar).toBe(44_000);
    expect(y.lines.filter((l) => l.kind === 'detail' && !l.account)).toEqual([]);
    expect(y.lines.find((l) => l.label === '流動資產合計')!.issues).toEqual([]);
  });
  it('不動產、廠房及設備＝成本－累計折舊：保留成本與累計折舊', () => {
    const y = run([['會計項目', '金額'], ['房屋及建築', '50,000'], ['累計折舊－房屋及建築', '(15,000)'], ['不動產、廠房及設備淨額', '35,000'], ['無形資產', '1,000'], ['非流動資產合計', '36,000']]);
    expect(y.accounts.ppe_cost).toBe(50_000);
    expect(y.accounts.ppe_accdep).toBe(15_000);
    expect(y.accounts.ppe_net).toBeUndefined();
    expect(y.lines.find((l) => l.label === '非流動資產合計')!.issues).toEqual([]);
  });
  it('其他綜合損益僅一項時，「本期其他綜合損益」合計列不重複計入', () => {
    const y = run([['項目', '金額'], ['營業收入', '1,000'], ['營業成本', '(600)'], ['本期稅後淨利', '400'], ['本期其他綜合損益', ''], ['國外營運機構財務報表換算之兌換差額', '(791,178)'], ['本期其他綜合損益', '(791,178)'], ['本期綜合損益總額', '(790,778)']], 'IS');
    expect(y.accounts.oci).toBe(-791_178);
    expect(y.lines.find((l) => l.label === '本期綜合損益總額')!.issues).toEqual([]);
  });
  it('僅列營業費用總額、採權益法認列之投資損益', () => {
    const y = run([['項目', '金額'], ['營業收入', '517,503'], ['營業成本', '(368,950)'], ['營業毛利', '148,553'], ['營業費用(附註三)', '(106,030)'], ['營業利益', '42,523'], ['採權益法認列之投資損益(附註五(四))', '8,575']], 'IS');
    expect(y.accounts.opex_total).toBe(106_030);
    expect(y.accounts.other_gl).toBe(8_575);
    expect(y.lines.filter((l) => l.kind !== 'ignore' && l.issues.length)).toEqual([]);
  });
});

import { duplicateImports, removeImportsFromYear } from '../src/engine/importer';
describe('防止重複匯入', () => {
  it('同年度再次匯入損益表時取代先前匯入，金額不加倍', () => {
    const rows = [['項目', '金額'], ['營業收入', '517,503'], ['營業成本', '(368,950)'], ['營業毛利', '148,553'], ['其他營業外收益及費損', '93'], ['營業外收益及費損合計', '93']];
    const y = emptyYear(2025);
    const imports: any[] = [];
    for (const name of ['a.pdf', 'b.pdf']) {
      const cfg = { fileName: name, sheet: '綜合損益表（第 6 頁）', stmt: 'IS' as const, year: 2025, currency: 'TWD', unitMultiplier: 1, signConvention: 'presentation' as const, headerRow: 0, labelCol: 0, amountCol: 1 };
      const raw = newRawImport(cfg, rows);
      const dup = duplicateImports(imports, y, cfg);
      if (name === 'b.pdf') expect(dup.length).toBe(1);
      removeImportsFromYear(y, dup.map((d) => d.id));
      imports.push(raw);
      applyImport(y, raw, buildLines(rows, cfg, raw.id));
    }
    expect(y.accounts.revenue).toBe(517_503);
    expect(y.accounts.other_gl).toBe(93);
    expect(y.lines.filter((l) => l.issues.length)).toEqual([]);
  });
});
