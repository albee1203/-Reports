// 勾稽、資料完整性與現金警示
import { Graph, EvalResult } from './graph';
import { ModelInfo, STATEMENT_SHEETS, SH } from './model';
import { M, Project, Scenario, yearAmount } from './project';
import { findAccount } from './coa';

export type IssueLevel = 'error' | 'incomplete' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  category: '勾稽' | '輸入檢查' | '未完成' | '匯入' | '假設' | '異常餘額' | '現金警示' | '概估' | '銀行送件' | '進階項目';
  year?: number;
  item: string;
  message: string;
  rowId?: string;
  page?: string; // UI 導覽
  ackKey?: string; // 可由使用者確認之項目
}

export interface CashAlert { year: number; cash: number; threshold: number; below: number; gap: number }

import { fmtAmt as fmt, fmtNum } from './format';

export function cashAlerts(g: Graph, ev: EvalResult, info: ModelInfo, threshold: number): CashAlert[] {
  return info.fcols.map((c) => {
    const cash = ev.num('bs:cash', c);
    return { year: g.columns[c].year, cash, threshold, below: Math.max(0, threshold - cash), gap: Math.max(0, -cash) };
  }).filter((a) => a.cash < threshold);
}

export function collectIssues(p: Project, sc: Scenario, g: Graph, ev: EvalResult, info: ModelInfo, mode: 'internal' | 'bank' = 'internal'): Issue[] {
  const out: Issue[] = [];
  const yr = (c: number) => g.columns[c].year;
  const acked = (k: string) => !!p.bank.acks[k];

  // --- 匯入問題 ---
  for (const y of [p.base, ...p.comparatives]) {
    for (const l of y.lines) {
      if (l.kind === 'ignore' || l.confirmed) continue;
      for (const m of l.issues) out.push({ level: 'warning', category: '匯入', year: y.year, item: `「${l.label}」`, message: m, page: 'base' });
    }
    if (y === p.base && yearAmount(y, 'revenue') === null) out.push({ level: 'incomplete', category: '未完成', year: y.year, item: '基期營業收入', message: '未提供基期營業收入，無法推估營收', page: 'base' });
  }

  // --- 勾稽 ---
  const ckDefs: [string, string, string][] = [
    ['ck:bs', '資產負債平衡', '資產總計不等於負債及權益總計'],
    ['ck:cash', '現金勾稽', '現金流量表期末現金與資產負債表不一致'],
    ['ck:eq', '權益勾稽', '權益變動表期末權益與資產負債表不一致'],
    ['ck:open', '期初銜接', '期初現金與前一年度期末現金不一致'],
    ['ck:ni', '損益與權益', '本期淨利未完整轉入保留盈餘'],
    ['ck:ppe', '固定資產', '固定資產排程淨額與資產負債表不一致'],
    ['ck:loan', '借款', '借款排程合計與資產負債表借款不一致'],
    ['ck:excess', '還款', '還款金額超過期初餘額加新增借款'],
  ];
  for (const [id, item, msg] of ckDefs) {
    const row = g.byId.get(id);
    if (!row) continue;
    row.cells.forEach((cell, c) => {
      if (!cell) return;
      const v = ev.num(id, c);
      if (Math.abs(v) >= 0.5) {
        let cause = msg;
        if (c === info.cb && id === 'ck:bs') cause = '基期資產負債表本身不平衡（請檢查科目對應、借貸符號或漏列科目）';
        if (c === info.cb && id === 'ck:ppe') cause = '固定資產各類別基期淨額合計與資產負債表不一致，請至「固定資產」補齊類別餘額';
        if (c === info.cb && id === 'ck:loan') cause = '各筆借款基期餘額合計與資產負債表借款不一致，請至「融資」調整';
        if (c > info.cb && id === 'ck:bs' && Math.abs(ev.num('ck:bs', info.cb)) >= 0.5) cause = '延續基期不平衡差額';
        out.push({ level: 'error', category: '勾稽', year: yr(c), item, message: `${cause}，差額 ${fmt(v)}`, rowId: id, page: 'checks' });
      }
    });
  }

  // --- 基期權益變動表：期初＋變動＝期末 ---
  if (Object.keys(p.base.sceActual).length) {
    for (const k of ['cap', 'cs', 'adv', 're', 'oe', 'ot']) {
      const close = g.byId.get(`sce:${k}_close`);
      if (!close) continue;
      const parts = g.rows.filter((r) => r.sheet === SH.sce && r.id.startsWith(`sce:${k}_`) && r.id !== `sce:${k}_close`);
      const sum = parts.reduce((t, r) => t + ev.num(r.id, info.cb), 0);
      const diff = sum - ev.num(close.id, info.cb);
      if (Math.abs(diff) >= 0.5) out.push({ level: 'warning', category: '勾稽', year: g.columns[info.cb].year, item: `基期權益變動表－${g.byId.get(`sce:h_${k}`)?.label ?? k}`, message: `期初餘額加本期變動與期末餘額（資產負債表）不一致，差額 ${fmt(diff)}`, page: 'base' });
    }
  }

  // --- 未完成假設 ---
  const stmtRows = g.rows.filter((r) => STATEMENT_SHEETS.includes(r.sheet as any));
  const seen = new Set<string>();
  for (const r of g.rows) {
    r.cells.forEach((cell, c) => {
      if (!cell || cell.kind !== 'input' || !cell.required) return;
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') return;
      const key = `${r.id}@${c}`;
      if (seen.has(key)) return;
      seen.add(key);
      const affected = stmtRows.filter((sr) => sr.cells.some((_, cc) => ev.missingSources(sr.id, cc).includes(key))).map((sr) => `${sr.sheet}／${sr.label}`);
      const year = g.columns[c].type === 'base' ? undefined : yr(c);
      out.push({
        level: 'incomplete', category: '未完成', year, item: r.label,
        message: affected.length ? `必要假設未輸入；受影響科目：${[...new Set(affected)].slice(0, 6).join('、')}${affected.length > 6 ? ' 等' : ''}` : '必要假設未輸入',
        rowId: r.id, page: pageOf(r.sheet),
      });
    });
  }

  // --- 輸入合理性檢查 ---
  out.push(...inputSanity(g));

  // --- 預設方法待確認 ---
  for (const [code, o] of Object.entries(sc.a.others)) {
    const a = findAccount(code, p.customAccounts);
    if (!a || o.confirmed) continue;
    out.push({ level: 'warning', category: '假設', item: a.name, message: `預估方法尚未確認（目前：${o.method[0] ?? '未選擇'}）`, page: 'assumptions' });
  }
  if (sc.a.ap.basis.some((b) => b === M.AP_COGS)) out.push({ level: 'info', category: '概估', item: '應付帳款', message: '以銷貨成本替代進貨額計算，屬概估' });
  const nbvBase = ev.num('bs:ppe', info.cb);
  if (Math.abs(nbvBase) > 0 && !p.faNature && !(p.faAssets ?? []).length) out.push({ level: 'warning', category: '假設', item: '固定資產餘額性質', message: '尚未確認基期固定資產餘額為「成本／累計折舊」或「僅淨額」', page: 'fixed' });
  for (const cl of info.faClasses) {
    const b = p.faBase[cl.key];
    if (cl.depreciable && b.existingMethod === M.EXDEP_EST && !(p.faAssets ?? []).some((x) => x.cls === cl.key)) out.push({ level: 'info', category: '概估', item: `${cl.name}既有資產折舊`, message: `以可折舊淨額 ${fmt(b.depreciableNbv ?? 0)}、殘值 ${fmt(b.residual ?? 0)}、剩餘耐用 ${b.remainingLife ?? '—'} 年估算` });
  }
  if (sc.a.depIncluded.some((d) => d === M.DEP_EX)) out.push({ level: 'info', category: '假設', item: '折舊拆分', message: '部分年度毛利率／費用率設定為「未含折舊」，報表毛利率將低於輸入毛利率' });
  if (sc.a.equity.oci.some((v) => (v ?? 0) !== 0) && !p.settings.ociAccount) out.push({ level: 'error', category: '假設', item: '其他綜合損益', message: '已輸入其他綜合損益但未指定對應資產負債科目，資產負債表將不平衡', page: 'settings' });

  // --- 異常餘額 ---
  const neg = (id: string, label: string) => {
    if (!g.byId.has(id)) return;
    for (const c of info.fcols) { const v = ev.num(id, c); if (v < -0.5) out.push({ level: 'warning', category: '異常餘額', year: yr(c), item: label, message: `預估餘額為負數 ${fmt(v)}`, rowId: id }); }
  };
  neg('w:ar', '應收帳款'); neg('w:inv', '存貨'); neg('w:ap', '應付帳款'); neg('l:short', '短期借款'); neg('l:long_total', '長期借款'); neg('e:div_pay', '應付股利'); neg('f:equip_pay', '應付設備款');
  for (const cl of info.faClasses) neg(`f:${cl.key}:nbv`, `${cl.name}帳面淨額`);
  for (const a of info.otherBS) if (!a.canBeNegative) neg(`o:${a.code}`, a.name);
  for (const c of info.fcols) if (ev.num('t:net', c) < -0.5) out.push({ level: 'info', category: '異常餘額', year: yr(c), item: '所得稅', message: `暫繳超過當年度稅額，預付 ${fmt(-ev.num('t:net', c))} 列為本期所得稅資產` });
  for (const c of info.fcols) {
    const gp = ev.num('is:gp', c);
    if (gp < 0) out.push({ level: 'warning', category: '異常餘額', year: yr(c), item: '營業毛利', message: '預估毛利為負數' });
  }

  // --- 現金警示 ---
  for (const a of cashAlerts(g, ev, info, p.settings.cashThreshold)) {
    out.push({ level: 'warning', category: '現金警示', year: a.year, item: '年末現金', message: `預估年末現金 ${fmt(a.cash)}，低於門檻 ${fmt(a.threshold)}，差額 ${fmt(a.below)}${a.gap > 0 ? `；資金缺口 ${fmt(a.gap)}` : ''}（僅提示，未自動新增借款）`, page: 'checks' });
  }

  // --- 遞延所得稅與進階項目 ---
  const has = (code: string) => { const v = yearAmount(p.base, code); return v !== null && v !== 0; };
  if (has('dta') || has('dtl')) out.push({ level: mode === 'bank' ? 'warning' : 'info', category: '進階項目', item: '遞延所得稅', message: '第一版不自動計算遞延所得稅，基期餘額維持不變；銀行版請依適用情況補入後續調整', ackKey: 'ack:deferredTax' });
  if ((has('rou_asset') || has('lease_liab') || has('lease_liab_cur')) && !p.settings.advanced.lease) out.push({ level: 'warning', category: '進階項目', item: '租賃', message: '基期有租賃相關餘額，但租賃設定未開啟；請於「其他科目」選擇預估方式或開啟租賃設定', page: 'settings', ackKey: 'ack:lease' });
  if (p.settings.advanced.fx) out.push({ level: 'info', category: '進階項目', item: '外幣', message: '外幣交易第一版不自動計算兌換損益，請於「其他利益及損失」手動輸入' });
  if (p.settings.advanced.related) out.push({ level: 'info', category: '進階項目', item: '關係人交易', message: '請於附註補充關係人交易說明' });
  out.push({ level: 'info', category: '概估', item: '所得稅', message: '採簡化當期所得稅估算（稅率×課稅所得），未計算遞延所得稅及未分配盈餘加徵' });

  // --- 銀行送件 ---
  if (mode === 'bank') {
    const notes = p.bank.notes;
    if (!notes.some((n) => n.body.trim())) out.push({ level: 'incomplete', category: '銀行送件', item: '附註', message: '尚未編輯任何附註內容', page: 'bank' });
    const policy = notes.find((n) => /會計政策/.test(n.title));
    if (!policy || !policy.body.trim()) out.push({ level: 'incomplete', category: '銀行送件', item: '重大會計政策', message: '重大會計政策說明尚未補入', page: 'bank' });
    if (!p.comparatives.length) out.push({ level: 'warning', category: '銀行送件', item: '比較資訊', message: '尚未補匯前一年度實際財報，報表無前期比較欄位', page: 'base', ackKey: 'ack:noComparative' });
    if (!Object.keys(p.base.cfActual).length) out.push({ level: 'warning', category: '銀行送件', item: '基期現金流量表', message: '基期現金流量表實際數未提供，報表顯示「未提供」', page: 'base', ackKey: 'ack:noBaseCF' });
    if (!Object.keys(p.base.sceActual).length) out.push({ level: 'warning', category: '銀行送件', item: '基期權益變動表', message: '基期權益變動表實際數未提供，報表顯示「未提供」', page: 'base', ackKey: 'ack:noBaseSCE' });
    if (!p.settings.standards.every((s) => s.version.trim() && !/請填入/.test(s.version))) out.push({ level: 'warning', category: '銀行送件', item: '準則版本', message: '各報導年度採用之準則版本尚未確認', page: 'settings' });
    if (!acked('ack:review')) out.push({ level: 'warning', category: '銀行送件', item: '會計處理及必要調整', message: '尚未確認已複核會計處理及必要調整', page: 'bank', ackKey: 'ack:review' });
  }
  return out.map((i) => (i.ackKey && acked(i.ackKey) ? { ...i, level: 'info' as const, message: i.message + '（已確認）' } : i));
}

function pageOf(sheet: string) {
  if (sheet === SH.fa) return 'fixed';
  if (sheet === SH.loan) return 'loans';
  return 'assumptions';
}

export function reportStatus(issues: Issue[], _mode: 'internal' | 'bank'): '草稿' | '待確認' | '已完成檢查' {
  if (issues.some((i) => i.level === 'error' || i.level === 'incomplete')) return '草稿';
  if (issues.some((i) => i.level === 'warning')) return '待確認';
  return '已完成檢查';
}

// 輸入值範圍檢查：月份必須為 1–12 之整數；其他超出常見範圍者提示確認
export function inputSanity(g: Graph): Issue[] {
  const out: Issue[] = [];
  const rules: { test: (id: string) => boolean; check: (v: number) => string | null; level?: IssueLevel }[] = [
    { test: (id) => g.byId.get(id)?.format === 'month' && !/:acm$/.test(id), check: (v) => (Number.isInteger(v) && v >= 1 && v <= 12 ? null : '月份須為 1 至 12 之整數'), level: 'error' },
    { test: (id) => /:acm$/.test(id), check: (v) => (v >= 0 && v <= 12 ? null : '年末應付利息月數須介於 0 至 12'), level: 'error' },
    { test: (id) => id === 'a:gm', check: (v) => (v > 0 && v < 1 ? null : '毛利率通常介於 0% 至 100%') },
    { test: (id) => id === 'a:growth', check: (v) => (v >= -0.5 && v <= 1 ? null : '成長率超過 ±50%／100%，請確認') },
    { test: (id) => id.startsWith('a:opex:'), check: (v) => (v >= 0 && v <= 0.5 ? null : '費用率為負數或超過 50%，請確認') },
    { test: (id) => ['a:depShare', 'a:div_pct', 'a:tax_prov'].includes(id) || /:res$/.test(id), check: (v) => (v >= 0 && v <= 1 ? null : '比例須介於 0% 至 100%'), level: 'error' },
    { test: (id) => id === 'a:tax_rate', check: (v) => (v >= 0 && v <= 0.5 ? null : '稅率為負數或超過 50%，請確認') },
    { test: (id) => /^l:.*:rate$/.test(id), check: (v) => (v >= 0 && v <= 0.2 ? null : '利率為負數或超過 20%，請確認') },
    { test: (id) => g.byId.get(id)?.format === 'years', check: (v) => (v > 0 && v <= 60 ? null : '年限須大於 0（通常不超過 60 年）') },
    { test: (id) => ['a:ar_p', 'a:inv_p', 'a:ap_p'].includes(id), check: (v) => (v >= 0 && v <= 730 ? null : '週轉參數為負數或過大，請確認') },
    { test: (id) => /^(f|d):.*:(capex|paid|dcost|dacc|dproc|drecv|imp|cost|acc|resid)$/.test(id) || /^l:.*:(draw|repay)$/.test(id) || ['a:div', 'a:cap_par', 'a:cap_prem'].includes(id), check: (v) => (v >= 0 ? null : '金額不應為負數') },
  ];
  for (const row of g.rows) {
    const rule = rules.find((x) => x.test(row.id));
    if (!rule) continue;
    row.cells.forEach((cell, c) => {
      if (!cell || cell.kind !== 'input' || typeof cell.value !== 'number') return;
      const msg = rule.check(cell.value);
      if (msg) out.push({ level: rule.level ?? 'warning', category: '輸入檢查', year: g.columns[c].type === 'forecast' ? g.columns[c].year : undefined, item: row.label, message: `${msg}（目前：${fmtNum(cell.value)}）`, rowId: row.id, page: row.sheet === '固定資產' || row.sheet === '固定資產明細' ? 'fixed' : row.sheet === '借款' ? 'loans' : 'assumptions' });
    });
  }
  return out;
}
