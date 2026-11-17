import { useState, useEffect } from 'react';
import { Row, Cell } from '../engine/graph';
import { useP, fmtVal } from './ctx';
import { setPath, getPath } from './store';

export function NumInput({ value, pct, onCommit, className, placeholder }: { value: number | null; pct?: boolean; onCommit: (v: number | null) => void; className?: string; placeholder?: string }) {
  const show = (v: number | null) => (v === null || v === undefined ? '' : pct ? String(+(v * 100).toFixed(6)) : String(v));
  const [txt, setTxt] = useState(show(value));
  useEffect(() => setTxt(show(value)), [value]);
  const commit = () => {
    const t = txt.replace(/,/g, '').trim();
    if (t === '') { if (value !== null) onCommit(null); return; }
    const v = Number(t);
    if (!isFinite(v)) { setTxt(show(value)); return; }
    const nv = pct ? v / 100 : v;
    if (nv !== value) onCommit(nv);
  };
  return (
    <span className={`num-input ${className ?? ''}`}>
      <input value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {pct && <i>%</i>}
    </span>
  );
}

export function InputCell({ row, cell }: { row: Row; cell: Cell }) {
  const { p, sc, update } = useP();
  const path = cell.inputPath!;
  const commit = (v: any) => update((np) => { setPath(np, sc.id, path, v); }, { action: '修改假設', detail: `${row.label}：${fmtLog(getPath(p, sc.id, path))} → ${fmtLog(v)}` });
  const missing = cell.required && (cell.value === null || cell.value === undefined || cell.value === '');
  if (cell.options) {
    return (
      <select className={`cell-select ${missing ? 'missing' : ''}`} value={(cell.value as string) ?? ''} onChange={(e) => commit(e.target.value || null)}>
        <option value="">（請選擇）</option>
        {cell.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  return <NumInput value={cell.value as number | null} pct={row.format === 'pct'} onCommit={commit} className={missing ? 'missing' : ''} placeholder={missing ? '未完成' : ''} />;
}

const fmtLog = (v: any) => (v === null || v === undefined || v === '' ? '（空白）' : String(v));

export function Grid({ sheet, filter, showDesc = true, title, carry = true }: { sheet: string; filter?: (r: Row) => boolean; showDesc?: boolean; title?: string; carry?: boolean }) {
  const { g, ev, p, trace, update, sc } = useP();
  const unit = p.settings.unit;
  const rows = g.rows.filter((r) => r.sheet === sheet && (!filter || filter(r)));
  const cols = g.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.type !== 'comparative');
  const carryForward = (r: Row) => {
    update((np) => {
      let prev: any = null;
      r.cells.forEach((cell) => {
        if (!cell || cell.kind !== 'input' || !cell.inputPath) return;
        const cur = getPath(np, sc.id, cell.inputPath);
        if ((cur === null || cur === undefined || cur === '') && prev !== null) setPath(np, sc.id, cell.inputPath, prev);
        else prev = cur ?? prev;
      });
    }, { action: '延用上一年度', detail: r.label });
  };
  return (
    <div className="grid-wrap">
      {title && <h3>{title}</h3>}
      <table className="grid">
        <thead>
          <tr>
            <th className="lbl">項目</th>
            {showDesc && <th className="desc">說明／方法</th>}
            {cols.map(({ c }) => <th key={c.key} className={c.type}>{c.label}<div className="sub">{c.type === 'base' ? '基期實際／參考' : '預估'}</div></th>)}
            {carry && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hasInputs = r.cells.some((c, i) => c?.kind === 'input' && g.columns[i].type === 'forecast');
            return (
              <tr key={r.id} className={r.style ?? ''}>
                <td className="lbl" style={{ paddingLeft: 6 + (r.indent ?? 0) * 14 }}>{r.label}</td>
                {showDesc && <td className="desc">{r.desc}</td>}
                {cols.map(({ c, i }) => {
                  const cell = r.cells[i];
                  if (!cell) return <td key={c.key} />;
                  if (cell.kind === 'input') return <td key={c.key} className="in"><InputCell row={r} cell={cell} /></td>;
                  const inc = ev.incomplete(r.id, i);
                  const v = ev.value(r.id, i);
                  return (
                    <td key={c.key} className={`v ${cell.kind} ${inc ? 'inc' : ''}`} onClick={() => trace(r.id, i)} title={inc ? '未完成：依賴未輸入之必要假設' : cell.kind === 'override' ? '手動覆寫' : '點選檢視公式'}>
                      {cell.kind === 'na' ? <span className="na">{cell.note ?? '未提供'}</span> : fmtVal(v, r.format, unit)}
                      {cell.kind === 'override' && <span className="tag">覆</span>}
                    </td>
                  );
                })}
                {carry && <td>{hasInputs && <button className="mini" title="將空白年度以前一年度值填入" onClick={() => carryForward(r)}>延用</button>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
