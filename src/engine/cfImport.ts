// 基期現金流量表實際數匯入：原表科目 → 計算圖現金流量表列
import { norm } from './coa';
import { Row } from './graph';

// 依序比對（較特定者在前）
const RULES: [RegExp, string][] = [
  [/營業活動之淨現金|營業活動淨現金|營業活動之現金流入|營業活動之現金流出/, 'cf:op'],
  [/投資活動之淨現金|投資活動淨現金/, 'cf:inv'],
  [/籌資活動之淨現金|籌資活動淨現金|融資活動之淨現金/, 'cf:fin'],
  [/營運產生之現金|營運產生|營運所得/, 'cf:gen'],
  [/本期現金及約當現金增加|本期現金及約當現金減少|本期現金增加|本期現金減少|現金及約當現金淨(增加|減少|變動)/, 'cf:net'],
  [/期初現金/, 'cf:open'],
  [/期末現金/, 'cf:close'],
  [/稅前/, 'cf:pbt'],
  [/折舊/, 'cf:dep'],
  [/減損/, 'cf:imp'],
  [/處分.*(不動產|固定資產|設備).*(利益|損失|損益)/, 'cf:gain'],
  [/取得.*(不動產|固定資產|設備)|購置.*(不動產|固定資產|設備)|資本支出/, 'cf:capex'],
  [/處分.*(不動產|固定資產|設備)/, 'cf:disp'],
  [/收取之利息|收取利息/, 'cf:intrec'],
  [/支付之利息|支付利息/, 'cf:intpaid'],
  [/利息費用|財務成本/, 'cf:intexp'],
  [/利息收入/, 'cf:intinc'],
  [/支付之所得稅|支付所得稅|所得稅支付|所得稅退還/, 'cf:taxpaid'],
  [/應收帳款/, 'cf:d_ar'],
  [/存貨/, 'cf:d_inv'],
  [/應付帳款/, 'cf:d_ap'],
  [/舉借|借款增加|新增借款/, 'cf:draw'],
  [/償還|借款減少/, 'cf:repay'],
  [/現金增資|發行新股/, 'cf:capinc'],
  [/股利/, 'cf:divpaid'],
];

export const CF_TOTAL_ROWS = new Set(['cf:op', 'cf:inv', 'cf:fin', 'cf:gen', 'cf:net', 'cf:open', 'cf:close']);

export function matchCfRow(label: string, rows: Row[]): string | null {
  const l = label.replace(/[\s　]/g, '');
  const ids = new Set(rows.map((r) => r.id));
  for (const [re, id] of RULES) if (re.test(l) && ids.has(id)) return id;
  // 其他科目變動：比對列名稱中之科目名稱
  const nl = norm(l);
  let best: { id: string; len: number } | null = null;
  for (const r of rows) {
    if (!r.id.startsWith('cf:o:')) continue;
    const name = norm(r.label.replace(/（增加）減少|增加（減少）/, ''));
    if (name && nl.includes(name) && (!best || name.length > best.len)) best = { id: r.id, len: name.length };
  }
  return best?.id ?? null;
}
