// 數字格式：金額之負數或減少數以括號表示，例如 (1,234)；百分比、倍數、比率、天數等非金額數字以負號表示，例如 -3.00%
export function paren(v: number, body: (abs: number) => string): string {
  return v < 0 ? `(${body(-v)})` : body(v);
}
// 金額（四捨五入至整數，千分位）
export const fmtAmt = (v: number) => {
  const r = Math.round(v);
  return paren(r, (a) => a.toLocaleString('zh-TW'));
};
// 非金額數字（保留小數，千分位，負號表示）
export const fmtNum = (v: number, maxFrac = 6) => v.toLocaleString('zh-TW', { maximumFractionDigits: maxFrac });
// 金額或比率混用之參數：絕對值 1,000 以上視為金額（括號），以下視為比率（負號）
export const fmtParam = (v: number) => (Math.abs(v) >= 1000 ? fmtAmt(v) : fmtNum(v));

// Excel 數字格式（正數;負數;零）
export const XL = {
  amount: '#,##0;(#,##0);"-"',
  amountK: '#,##0,;(#,##0,);"-"',
  pct: '0.00%',
  ratio: '#,##0.####', // 參數之比率；金額參數於匯出時改用金額格式
  times: '0.00"倍"',
  int: '0',
  dec: '#,##0.##',
};
