import { describe, it, expect } from 'vitest';
import { buildLines, parseAmount, guessLayout, applyImport, newRawImport } from '../src/engine/importer';
import { emptyYear } from '../src/engine/project';

const rows = [
  ['範例公司', ''], ['資產負債表', ''], ['會計項目', '2025年12月31日'],
  ['現金及約當現金', '35,000'], ['應收帳款淨額', '48,000'], ['存貨', '30,000'], ['流動資產合計', '113,000'],
  ['機器設備', '50,000'], ['累計折舊－機器設備', '(30,000)'], ['非流動資產合計', '20,000'],
  ['資產總計', '133,000'], ['應付帳款', '25,000'], ['應付帳款', '1'], ['短期借款', 'abc'],
  ['股本', '100,000'], ['保留盈餘', '△2,000'], ['負債及權益總計', '123,000'], ['神秘科目', '5'],
];

describe('importer', () => {
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
    expect(lay).toEqual({ headerRow: 2, labelCol: 0, amountCol: 1 });
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
