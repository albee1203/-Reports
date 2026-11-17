// 數字格式：負數或減少數一律以括號表示，例如 (1,234)、(3.00%)
export function paren(v: number, body: (abs: number) => string): string {
  return v < 0 ? `(${body(-v)})` : body(v);
}
// 金額（四捨五入至整數，千分位）
export const fmtAmt = (v: number) => {
  const r = Math.round(v);
  return paren(r, (a) => a.toLocaleString('zh-TW'));
};
// 一般數字（保留小數，千分位）
export const fmtNum = (v: number, maxFrac = 6) => paren(v, (a) => a.toLocaleString('zh-TW', { maximumFractionDigits: maxFrac }));

// Excel 數字格式（正數;負數;零）
export const XL = {
  amount: '#,##0;(#,##0);"-"',
  amountK: '#,##0,;(#,##0,);"-"',
  pct: '0.00%;(0.00%);0.00%',
  ratio: '#,##0.####;(#,##0.####);0',
  times: '0.00"倍";(0.00"倍");0.00"倍"',
  int: '0;(0);0',
  dec: '#,##0.##;(#,##0.##);0',
};
