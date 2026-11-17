import { useState } from 'react';
import { useP, fmtVal, unitLabel } from '../ctx';
import { STATEMENT_SHEETS, SH } from '../../engine/model';

export { isZeroRow } from '../../engine/model';
import { isZeroRow } from '../../engine/model';

export function StatementTable({ sheet, labels, onLabel }: { sheet: string; labels?: Record<string, string>; onLabel?: (id: string, v: string) => void }) {
  const { g, ev, p, trace } = useP();
  const [showZero, setShowZero] = useState(false);
  const rows = g.rows.filter((r) => r.sheet === sheet && (showZero || !isZeroRow(r, ev, g.columns.length)));
  return (
    <>
      <label className="check small"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />顯示零值科目</label>
      <table className="grid stmt">
        <thead>
          <tr><th className="lbl">科目</th>{g.columns.map((c) => <th key={c.key} className={c.type}>{c.label} 年度<div className="sub">{c.type === 'forecast' ? '預估' : c.type === 'base' ? '實際（基期）' : '實際（比較）'}</div></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.style ?? ''}>
              <td className="lbl" title={r.desc} style={{ paddingLeft: 6 + (r.indent ?? 0) * 16 }}>
                {onLabel ? <input className="label-edit" value={labels?.[r.id] ?? r.label} onChange={(e) => onLabel(r.id, e.target.value)} /> : r.label}
              </td>
              {g.columns.map((c, i) => {
                const cell = r.cells[i];
                if (!cell || r.style === 'header') return <td key={c.key} />;
                const inc = ev.incomplete(r.id, i);
                return (
                  <td key={c.key} className={`v ${cell.kind} ${c.type} ${inc ? 'inc' : ''}`} onClick={() => trace(r.id, i)}>
                    {cell.kind === 'na' ? <span className="na">{cell.note ?? '未提供'}</span> : fmtVal(ev.value(r.id, i), r.format, p.settings.unit)}
                    {inc && <span className="tag inc">未完成</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function StatementsPage() {
  const { p, sc } = useP();
  const [tab, setTab] = useState<string>(STATEMENT_SHEETS[0]);
  return (
    <div>
      <h1>4. 四大報表（情境：{sc.name}）</h1>
      <p className="muted">單位：{unitLabel(p.settings.unit)}。灰色欄為歷史實際數，藍色欄為預估數；橘色為手動覆寫；紅色斜體為依賴未完成假設之數字。點選數字可追溯公式及來源，並於來源科目覆寫。</p>
      <div className="tabs">{[...STATEMENT_SHEETS, SH.ratio].map((s) => <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)}>{s}</button>)}</div>
      {p.settings.unit === 'thousand' && <p className="hint">以千元顯示：各數字個別四捨五入，合計數與明細加總可能有 ±1 千元尾差；底層計算仍以元為準。</p>}
      {tab === SH.ratio && <p className="hint">財務比率依報表數字自動計算；分母為零時顯示「—」。基期 EBITDA 需於「基期資料」補入基期現金流量表之折舊費用。</p>}
      <StatementTable sheet={tab} />
    </div>
  );
}
