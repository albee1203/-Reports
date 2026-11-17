import { describe, it, expect } from 'vitest';
import { fmtVal } from '../src/ui/ctx';
import { fmtAmt, fmtNum, XL } from '../src/engine/format';
import { parseAmount } from '../src/engine/importer';

describe('金額負數以括號、其他數字以負號表示', () => {
  it('各種格式', () => {
    expect(fmtVal(-1234567, 'amount', 'yuan')).toBe('(1,234,567)');
    expect(fmtVal(-1234567, 'amount', 'thousand')).toBe('(1,235)');
    expect(fmtVal(-0.03, 'pct', 'yuan')).toBe('-3.00%');
    expect(fmtVal(0.03, 'pct', 'yuan')).toBe('3.00%');
    expect(fmtVal(-1.5, 'times', 'yuan')).toBe('-1.50 倍');
    expect(fmtVal(-0.25, 'ratio', 'yuan')).toBe('-0.25');
    expect(fmtVal(-2500, 'ratio', 'yuan')).toBe('(2,500)');
    expect(fmtVal(-12, 'days', 'yuan')).toBe('-12');
    expect(fmtAmt(-5000)).toBe('(5,000)');
    expect(fmtNum(-0.01)).toBe('-0.01');
    expect(XL.amount.split(';')[1]).toBe('(#,##0)');
    expect(XL.amountK.split(';')[1]).toBe('(#,##0,)');
    expect(XL.pct).toBe('0.00%');
  });
  it('輸入可使用括號表示負數', () => {
    expect(parseAmount('(1,234)').value).toBe(-1234);
    expect(parseAmount('（3.5）').value).toBe(-3.5);
  });
});

import { currencyUnit } from '../src/engine/format';
describe('幣別單位', () => {
  it('新台幣與其他幣別', () => {
    expect(currencyUnit('TWD', 'yuan')).toBe('新台幣元');
    expect(currencyUnit('TWD', 'thousand')).toBe('新台幣千元');
    expect(currencyUnit('usd', 'thousand')).toBe('千美元');
    expect(currencyUnit('JPY', 'yuan')).toBe('日圓');
    expect(currencyUnit('XYZ', 'thousand')).toBe('千XYZ');
  });
});
