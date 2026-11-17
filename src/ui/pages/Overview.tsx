import { useP, fmtVal, unitLabel } from '../ctx';
import { reportStatus, cashAlerts, Issue } from '../../engine/checks';
import { yearAmount } from '../../engine/project';

type St = 'done' | 'todo' | 'warn';
const ICON: Record<St, string> = { done: '✓', warn: '!', todo: '✗' };

export function OverviewPage() {
  const { p, sc, issues, bankIssues, ev, info, g, go } = useP();
  const u = p.settings.unit;
  const by = (pred: (i: Issue) => boolean) => issues.filter(pred);
  const lv = (xs: Issue[]): St => (xs.some((i) => i.level === 'error' || i.level === 'incomplete') ? 'todo' : xs.some((i) => i.level === 'warning') ? 'warn' : 'done');
  const baseBal = Math.abs(ev.num('ck:bs', info.cb)) < 0.5;
  const hasBase = yearAmount(p.base, 'revenue') !== null && yearAmount(p.base, 'cash') !== null;
  const steps: { key: string; title: string; st: St; detail: string }[] = [
    { key: 'settings', title: '1. 專案設定', st: p.settings.standards.some((s) => /請填入/.test(s.version)) ? 'warn' : 'done', detail: p.settings.standards.some((s) => /請填入/.test(s.version)) ? '各年度準則版本尚未確認' : `${p.settings.companyName}；基期 ${p.settings.baseYear}；預估 ${p.settings.years} 年` },
    { key: 'base', title: '2. 基期資料與科目對應', st: !hasBase || !baseBal ? 'todo' : lv(by((i) => i.category === '匯入')), detail: !hasBase ? '尚未建立基期營收或現金' : !baseBal ? `基期資產負債表不平衡，差額 ${fmtVal(ev.num('ck:bs', info.cb), 'amount', 'yuan')}` : `${by((i) => i.category === '匯入').length} 項匯入問題待確認` },
    { key: 'assumptions', title: '3. 逐年假設', st: lv(by((i) => i.page === 'assumptions' && i.category !== '勾稽')), detail: `${by((i) => i.page === 'assumptions' && i.level === 'incomplete').length} 項必要假設未完成；${by((i) => i.category === '假設' && i.level === 'warning').length} 項方法待確認；${by((i) => i.category === '輸入檢查' && i.page === 'assumptions').length} 項輸入超出常見範圍` },
    { key: 'fixed', title: '　固定資產', st: lv(by((i) => i.page === 'fixed' || (i.rowId === 'ck:ppe'))), detail: `${info.faClasses.length} 個類別${(p.faAssets ?? []).length ? `；明細 ${(p.faAssets ?? []).length} 筆` : ''}` },
    { key: 'loans', title: '　融資（借款）', st: lv(by((i) => i.page === 'loans' || i.rowId === 'ck:loan' || i.rowId === 'ck:excess')), detail: `${sc.loans.length} 筆借款` },
    { key: 'checks', title: '4. 四大報表與勾稽', st: by((i) => i.category === '勾稽').length ? 'todo' : 'done', detail: by((i) => i.category === '勾稽').length ? `${by((i) => i.category === '勾稽').length} 項勾稽差異` : '資產負債平衡、現金、權益、固定資產、借款勾稽皆通過' },
    { key: 'bank', title: '5. 銀行送件', st: ({ 草稿: 'todo', 待確認: 'warn', 已完成檢查: 'done' } as const)[reportStatus(bankIssues, 'bank')], detail: `送件狀態：${reportStatus(bankIssues, 'bank')}；附註 ${p.bank.notes.filter((n) => n.body.trim()).length}／${p.bank.notes.length} 節已填寫` },
  ];
  const last = info.fcols[info.fcols.length - 1];
  const alerts = cashAlerts(g, ev, info, p.settings.cashThreshold);
  const minCash = Math.min(...info.fcols.map((c) => ev.num('bs:cash', c)));
  const kpi = [
    [`${g.columns[last].year} 營業收入`, ev.num('is:rev', last)],
    [`${g.columns[last].year} 本期淨利`, ev.num('is:ni', last)],
    ['預估期間最低年末現金', minCash],
    [`${g.columns[last].year} 借款餘額`, ev.num('l:short', last) + ev.num('l:long_total', last)],
  ] as [string, number][];
  return (
    <div>
      <h1>進度總覽（情境：{sc.name}）</h1>
      <div className="kpis">
        {kpi.map(([k, v]) => <div key={k} className="kpi"><div className="k">{k}</div><div className={`v ${v < 0 ? 'neg' : ''}`}>{fmtVal(v, 'amount', u)}</div></div>)}
      </div>
      <p className="muted small">單位：{unitLabel(u)}。{alerts.length ? `⚠ ${alerts.length} 個預估年度年末現金低於門檻 ${fmtVal(p.settings.cashThreshold, 'amount', u)}${alerts.some((a) => a.gap > 0) ? '，且有資金缺口' : ''}。` : '各預估年度年末現金均不低於門檻。'}</p>
      <section className="card">
        <h2>編製步驟</h2>
        <table className="grid steps">
          <tbody>
            {steps.map((s) => (
              <tr key={s.key} className={`st-${s.st}`}>
                <td className="icon">{ICON[s.st]}</td>
                <td><b>{s.title}</b></td>
                <td>{s.detail}</td>
                <td><button className="mini" onClick={() => go(s.key)}>前往</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">✓ 完成　! 待確認　✗ 未完成或有差異。狀態依目前情境計算。</p>
      </section>
    </div>
  );
}
