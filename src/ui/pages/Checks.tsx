import { useMemo, useState } from 'react';
import { useP, fmtVal, unitLabel } from '../ctx';
import { Grid } from '../Grid';
import { SH, buildGraph } from '../../engine/model';
import { evaluate } from '../../engine/graph';
import { cashAlerts, Issue } from '../../engine/checks';
import { LineChart, Legend } from '../Charts';

const LEVEL: Record<string, string> = { error: '勾稽差異', incomplete: '未完成', warning: '待確認', info: '提示' };

export function IssueList({ issues }: { issues: Issue[] }) {
  const { go, update, p } = useP();
  const [lv, setLv] = useState<string>('all');
  const shown = issues.filter((i) => lv === 'all' || i.level === lv);
  return (
    <section className="card">
      <div className="tabs">
        {['all', 'error', 'incomplete', 'warning', 'info'].map((k) => <button key={k} className={lv === k ? 'active' : ''} onClick={() => setLv(k)}>{k === 'all' ? '全部' : LEVEL[k]}（{k === 'all' ? issues.length : issues.filter((i) => i.level === k).length}）</button>)}
      </div>
      <table className="grid issues-t">
        <thead><tr><th>類別</th><th>狀態</th><th>年度</th><th>項目</th><th>原因／說明</th><th /></tr></thead>
        <tbody>
          {shown.map((i, k) => (
            <tr key={k} className={`lv-${i.level}`}>
              <td>{i.category}</td><td>{LEVEL[i.level]}</td><td>{i.year ?? '—'}</td><td>{i.item}</td><td>{i.message}</td>
              <td>
                {i.page && <button className="mini" onClick={() => go(i.page!)}>前往</button>}
                {i.ackKey && !p.bank.acks[i.ackKey] && <button className="mini" onClick={() => update((np) => { np.bank.acks[i.ackKey!] = true; }, { action: '確認提示', detail: `${i.item}` })}>已確認</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ChecksPage() {
  const { issues, g, ev, info, p } = useP();
  const alerts = cashAlerts(g, ev, info, p.settings.cashThreshold);
  const u = p.settings.unit;
  return (
    <div>
      <h1>勾稽與現金警示</h1>
      <section className="card">
        <h2>年末現金警示（門檻 {fmtVal(p.settings.cashThreshold, 'amount', u)}，{unitLabel(u)}）</h2>
        {alerts.length === 0 ? <p className="ok">✓ 各預估年度年末現金均不低於門檻。</p> : (
          <table className="grid">
            <thead><tr><th>年度</th><th>預估年末現金</th><th>低於門檻差額</th><th>資金缺口（現金為負）</th></tr></thead>
            <tbody>{alerts.map((a) => <tr key={a.year} className={a.gap > 0 ? 'lv-error' : 'lv-warning'}><td>{a.year}</td><td className="num">{fmtVal(a.cash, 'amount', u)}</td><td className="num">{fmtVal(a.below, 'amount', u)}</td><td className="num">{a.gap > 0 ? fmtVal(a.gap, 'amount', u) : '—'}</td></tr>)}</tbody>
          </table>
        )}
        <p className="hint">僅提示，不自動新增借款；如需補足資金，請至「融資」自行規劃。</p>
      </section>
      <Grid sheet={SH.ck} title="勾稽檢查（差額小於 0.5 元視為通過；不使用平衡數調整）" carry={false} showDesc />
      <h2>檢查結果清單</h2>
      <IssueList issues={issues} />
    </div>
  );
}

export function ComparePage() {
  const { p } = useP();
  const [sel, setSel] = useState<string[]>(p.scenarios.map((s) => s.id));
  const u = p.settings.unit;
  const data = useMemo(() => p.scenarios.filter((s) => sel.includes(s.id)).map((sc) => {
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const val = (id: string) => info.fcols.map((c) => ev.num(id, c));
    const cash = val('bs:cash');
    return {
      sc, years: info.fcols.map((c) => g.columns[c].year),
      metrics: [
        ['營業收入', val('is:rev')],
        ['本期淨利', val('is:ni')],
        ['年末現金', cash],
        ['借款餘額', info.fcols.map((c) => ev.num('l:short', c) + ev.num('l:long_total', c))],
        ['負債總計', val('bs:liab')],
        ['低於門檻差額', cash.map((x) => Math.max(0, p.settings.cashThreshold - x))],
        ['資金缺口（現金為負）', cash.map((x) => Math.max(0, -x))],
      ] as [string, number[]][],
      incomplete: g.rows.some((r) => r.cells.some((_, c) => ev.incomplete(r.id, c))),
    };
  }), [p, sel]);
  if (!data.length) return <div><h1>情境比較</h1><ScenPick sel={sel} setSel={setSel} /></div>;
  const years = data[0].years;
  return (
    <div>
      <h1>情境比較（{unitLabel(u)}）</h1>
      <ScenPick sel={sel} setSel={setSel} />
      <section className="card">
        <Legend names={data.map((d) => d.sc.name)} />
        <div className="charts">
          {[0, 1, 2, 3].map((mi) => (
            <LineChart key={mi} title={data[0].metrics[mi][0]} years={years}
              series={data.map((d) => ({ name: d.sc.name, values: d.metrics[mi][1] }))}
              refLine={mi === 2 ? { value: p.settings.cashThreshold, label: '現金警示門檻' } : undefined} />
          ))}
        </div>
        <p className="hint">滑鼠移至圖上可檢視各年度數值；完整數字見下表。最多 8 個情境以固定顏色區分。</p>
      </section>
      <table className="grid stmt">
        <thead><tr><th>指標</th><th>情境</th>{years.map((y) => <th key={y} className="forecast">{y}</th>)}</tr></thead>
        <tbody>
          {data[0].metrics.map(([name], mi) => data.map((d, di) => (
            <tr key={`${mi}-${di}`} className={di === 0 ? 'group-start' : ''}>
              {di === 0 && <td rowSpan={data.length} className="lbl"><b>{name}</b></td>}
              <td>{d.sc.name}{d.incomplete && <span className="tag inc">未完成</span>}</td>
              {d.metrics[mi][1].map((v, k) => <td key={k} className={`num ${mi >= 5 && v > 0 ? 'neg' : ''}`}>{fmtVal(v, 'amount', u)}</td>)}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function ScenPick({ sel, setSel }: { sel: string[]; setSel: (x: string[]) => void }) {
  const { p } = useP();
  return (
    <div className="row">
      {p.scenarios.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={sel.includes(s.id)} onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} />{s.name}</label>)}
      <span className="hint">情境可於「逐年假設」頁命名、複製及設定不同逐年假設。</span>
    </div>
  );
}
