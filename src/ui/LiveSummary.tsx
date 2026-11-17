import { useRef } from 'react';
import { useP, fmtVal } from './ctx';
import { paren, currencyUnit } from '../engine/format';

// 百萬元，一位小數；負數以括號表示
const mn = (v: number) => (Math.abs(v) < 50_000 ? '-' : paren(v, (a) => (a / 1e6).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })));

export const LIVE_PAGES = ['assumptions', 'fixed', 'loans'];

// 大螢幕並排之即時摘要：修改假設時立即顯示關鍵數字與勾稽狀態；與上次顯示不同之數字以底色標示
export function LiveSummary({ onClose }: { onClose: () => void }) {
  const { g, ev, info, p, issues, trace } = useP();
  const prev = useRef<Map<string, number>>(new Map());
  const u = p.settings.unit;
  void u;
  const thr = p.settings.cashThreshold;
  const cols = info.fcols;
  const lines: { id: string; label: string; fmt: 'amount' | 'pct'; f: (c: number) => number; warn?: (v: number) => boolean }[] = [
    { id: 'is:rev', label: '營業收入', fmt: 'amount', f: (c) => ev.num('is:rev', c) },
    { id: 'r:gm', label: '毛利率', fmt: 'pct', f: (c) => ev.num('r:gm', c) },
    { id: 'is:ni', label: '本期淨利', fmt: 'amount', f: (c) => ev.num('is:ni', c), warn: (v) => v < 0 },
    { id: 'bs:cash', label: '年末現金', fmt: 'amount', f: (c) => ev.num('bs:cash', c), warn: (v) => v < thr },
    { id: 'r:loans', label: '借款餘額', fmt: 'amount', f: (c) => ev.num('r:loans', c) },
    { id: 'r:debt', label: '負債比率', fmt: 'pct', f: (c) => ev.num('r:debt', c) },
    { id: 'r:dscr', label: '償債保障比率', fmt: 'amount', f: (c) => ev.num('r:dscr', c) },
  ];
  const next = new Map<string, number>();
  const ckOk = (c: number) => ['ck:bs', 'ck:cash', 'ck:eq', 'ck:ppe', 'ck:loan'].every((id) => !g.byId.has(id) || Math.abs(ev.num(id, c)) < 0.5);
  const missing = issues.filter((i) => i.level === 'incomplete').length;
  const errors = issues.filter((i) => i.level === 'error').length;
  const out = (
    <aside className="live">
      <div className="trace-head"><b>即時摘要</b><button className="mini" onClick={onClose} title="隱藏（可於頁面上方再次開啟）">✕</button></div>
      <p className="muted small">金額單位：{currencyUnit(p.settings.currency, 'million')}（精簡顯示，完整數字見報表）；點選數字可追溯公式。</p>
      <table className="grid small live-t">
        <thead><tr><th className="lbl">項目</th>{cols.map((c) => <th key={c} className="forecast">{g.columns[c].label}</th>)}</tr></thead>
        <tbody>
          {lines.filter((l) => g.byId.has(l.id)).map((l) => (
            <tr key={l.id}>
              <td className="lbl">{l.label}</td>
              {cols.map((c) => {
                const v = l.f(c);
                const key = `${l.id}@${c}`;
                next.set(key, v);
                const old = prev.current.get(key);
                const changed = old !== undefined && Math.abs(old - v) > (l.fmt === 'amount' ? 0.5 : 1e-9);
                const inc = ev.incomplete(l.id, c);
                return (
                  <td key={c} className={`v ${changed ? 'flash' : ''} ${l.warn?.(v) ? 'neg' : ''} ${inc ? 'inc' : ''}`} onClick={() => trace(l.id, c)}>
                    {l.id === 'r:dscr' ? (typeof ev.value(l.id, c) === 'number' ? `${v.toFixed(2)} 倍` : '—') : l.fmt === 'amount' ? mn(v) : fmtVal(v, l.fmt, u)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="subtotal">
            <td className="lbl">勾稽</td>
            {cols.map((c) => <td key={c} className={`v ${ckOk(c) ? 'ok' : 'neg'}`}>{ckOk(c) ? '✓ 通過' : '✗ 差異'}</td>)}
          </tr>
        </tbody>
      </table>
      <p className="small">{missing ? <span className="error">未完成假設 {missing} 項</span> : <span className="ok">必要假設已完成</span>}{errors ? <span className="error">；錯誤 {errors} 項</span> : ''}</p>
    </aside>
  );
  prev.current = next;
  return out;
}
