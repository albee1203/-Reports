import { useState } from 'react';

// 類別色（固定順序指派，不循環；已通過色盲辨識檢查）
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const compact = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e8 ? `${+(a / 1e8).toFixed(2)} 億` : a >= 1e4 ? `${+(a / 1e4).toFixed(a >= 1e7 ? 0 : 1)} 萬` : `${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
};
const full = (v: number) => (v < 0 ? `(${Math.round(-v).toLocaleString('zh-TW')})` : Math.round(v).toLocaleString('zh-TW'));

function niceTicks(lo: number, hi: number, n = 4) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const t0 = Math.floor(lo / step) * step, t1 = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let t = t0; t <= t1 + step / 2; t += step) out.push(+t.toFixed(6));
  return out;
}

export interface Series { name: string; values: number[] }

// 單一 y 軸折線圖；含零基準線、門檻參考線、十字線提示
export function LineChart({ title, years, series, refLine }: { title: string; years: number[]; series: Series[]; refLine?: { value: number; label: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 420, H = 220, m = { l: 56, r: series.length <= 4 ? 78 : 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values).concat(refLine ? [refLine.value] : []).concat([0]);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const x = (i: number) => m.l + (years.length === 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (years.length - 1));
  const y = (v: number) => m.t + ((hi - v) * (H - m.t - m.b)) / (hi - lo || 1);
  // 線尾標示避免重疊：依 y 排序後最少間隔 12px
  const ends = series.map((s, k) => ({ k, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  const endY = Object.fromEntries(ends.map((e) => [e.k, e.y]));
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          years.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
          setHover(best);
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis0' : 'gridline'} />
            <text x={m.l - 6} y={y(t) + 4} className="tick" textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        {years.map((yr, i) => <text key={yr} x={x(i)} y={H - 8} className="tick" textAnchor="middle">{yr}</text>)}
        {refLine && <g><line x1={m.l} x2={W - m.r} y1={y(refLine.value)} y2={y(refLine.value)} className="refline" /><text x={m.l + 4} y={y(refLine.value) - 4} className="tick">{refLine.label}</text></g>}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} className="crosshair" />}
        {series.map((s, k) => (
          <g key={s.name}>
            <polyline fill="none" stroke={SERIES[k]} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3} fill={SERIES[k]} stroke="#fff" strokeWidth={2} />)}
            {series.length <= 4 && <text x={W - m.r + 6} y={endY[k] + 4} className="endlabel">{s.name}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) / W > 0.65 ? '-100%' : x(hover) / W < 0.35 ? '0' : '-50%'})` }}>
          <b>{years[hover]} 年</b>
          {series.map((s, k) => <div key={s.name}><i style={{ background: SERIES[k] }} />{s.name}<span>{full(s.values[hover])}</span></div>)}
        </div>
      )}
    </figure>
  );
}

export function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return <div className="legend">{names.map((n, k) => <span key={n}><i style={{ background: SERIES[k] }} />{n}</span>)}</div>;
}
