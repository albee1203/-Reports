import { useState, useEffect } from 'react';
import { Row, Cell } from '../engine/graph';
import { useP, fmtVal } from './ctx';
import { setPath, getPath } from './store';
import { parseAmount } from '../engine/importer';
import { fmtNum } from '../engine/format';

// 貼上值轉換：百分比列「8%」或「8」→ 0.08；小於 1 之數字視為小數比率
export function pasteValue(txt: string, format: string, options?: string[]): any {
  const t = txt.trim();
  if (t === '') return null;
  if (options) return options.includes(t) ? t : undefined;
  const pctSuffix = /[%％]$/.test(t);
  const pa = parseAmount(t.replace(/[%％]$/, ''));
  if (pa.value === null || pa.error) return undefined;
  if (format === 'pct') return pctSuffix || Math.abs(pa.value) >= 1 ? pa.value / 100 : pa.value;
  return pa.value;
}

export function NumInput({ value, pct, onCommit, className, placeholder }: { value: number | null; pct?: boolean; onCommit: (v: number | null) => void; className?: string; placeholder?: string }) {
  // 未編輯時以千分位顯示，編輯時顯示原始數字
  const [focus, setFocus] = useState(false);
  const show = (v: number | null, f = focus) => (v === null || v === undefined ? '' : pct ? (f ? String(+(v * 100).toFixed(6)) : fmtNum(v * 100)) : f ? String(v) : fmtNum(v));
  const [txt, setTxt] = useState(show(value));
  useEffect(() => setTxt(show(value)), [value, focus]);
  const commit = () => {
    const t = txt.trim();
    if (t === '') { if (value !== null) onCommit(null); return; }
    const pa = parseAmount(t); // 接受 1,234、(1,234)、-1,234
    if (pa.error || pa.value === null) { setTxt(show(value)); return; }
    const v = pa.value;
    const nv = pct ? v / 100 : v;
    if (nv !== value) onCommit(nv);
  };
  return (
    <span className={`num-input ${className ?? ''}`}>
      <input value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} onFocus={() => { setFocus(true); setTxt(show(value, true)); }} onBlur={() => { commit(); setFocus(false); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
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
  // 自 Excel 複製之多格資料（Tab 分欄、換行分列）依序填入目前及右方、下方之輸入格
  const inputRows = rows.filter((r) => r.cells.some((c) => c?.kind === 'input'));
  const onPaste = (e: React.ClipboardEvent, r: Row, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // 單一數值交由輸入框處理
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const r0 = inputRows.indexOf(r);
    const bad: string[] = [];
    update((np) => {
      matrix.forEach((line, dr) => {
        const row = inputRows[r0 + dr];
        if (!row) return;
        let ci = col;
        for (const raw of line) {
          while (ci < row.cells.length && row.cells[ci]?.kind !== 'input') ci++;
          const cell = row.cells[ci];
          if (!cell) break;
          const v = pasteValue(raw, row.format, cell.options);
          if (v === undefined) bad.push(`${row.label}［${g.columns[ci].label}］「${raw}」`);
          else setPath(np, sc.id, cell.inputPath!, v);
          ci++;
        }
      });
    }, { action: '貼上假設', detail: `${r.label} 起 ${matrix.length} 列 × ${matrix[0].length} 欄` });
    if (bad.length) alert(`下列儲存格格式不符，未貼上：\n${bad.slice(0, 10).join('\n')}`);
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
                  if (cell.kind === 'input') return <td key={c.key} className="in" onPasteCapture={(e) => onPaste(e, r, i)}><InputCell row={r} cell={cell} /></td>;
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
