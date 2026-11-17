import { describe, it, expect } from 'vitest';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate } from '../src/engine/graph';
import { resizeProject, syncScenarioWithBase, M, emptyLoan, arr } from '../src/engine/project';
import { detailProject } from './fixtures';

// 可重現之亂數
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export function randomProject(seed: number) {
  const R = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(R() * xs.length)];
  const between = (a: number, b: number) => a + (b - a) * R();
  const base = seed % 2 ? detailProject().p : sampleProject();
  const p = base;
  const years = 1 + Math.floor(R() * 8); // 1–8 年
  resizeProject(p, years);
  const sc = p.scenarios[0];
  syncScenarioWithBase(p, sc);
  const a = sc.a;
  const n = years;
  const fill = (xs: any[], f: () => any) => { for (let i = 0; i < n; i++) xs[i] = f(); };
  fill(a.growth, () => between(-0.4, 0.5));
  fill(a.gm, () => between(-0.1, 0.6));
  fill(a.depIncluded, () => pick([M.DEP_IN, M.DEP_EX]));
  fill(a.depCogsShare, () => R());
  for (const k of Object.keys(a.opex)) fill(a.opex[k], () => between(0, 0.3));
  for (const w of [a.ar, a.inv, a.ap]) { fill(w.method, () => pick([M.WC_DAYS, M.WC_PCT])); fill(w.param, () => (R() < 0.5 ? between(0, 120) : between(0, 0.4))); }
  fill(a.ap.basis, () => pick([M.AP_PURCH, M.AP_COGS]));
  for (const [code, o] of Object.entries(a.others)) {
    fill(o.method, () => pick(code === 'int_income' ? [M.MANUAL, M.HOLD, M.GROWTH, M.PCT_REV, M.PCT_COGS, M.CASH_RATE] : [M.MANUAL, M.HOLD, M.GROWTH, M.PCT_REV, M.PCT_COGS]));
    for (let i = 0; i < n; i++) o.param[i] = o.method[i] === M.MANUAL ? between(-5e6, 5e6) : between(-0.2, 0.3);
    o.cf = pick(['operating', 'investing', 'financing'] as const);
  }
  fill(a.tax.method, () => pick([M.TAX_RATE, M.TAX_MANUAL]));
  fill(a.tax.rate, () => between(0, 0.3)); fill(a.tax.adj, () => between(-5e6, 5e6)); fill(a.tax.manual, () => between(0, 1e7)); fill(a.tax.provisionalPct, () => R());
  a.tax.baseNol = between(0, 2e7);
  fill(a.equity.capPar, () => (R() < 0.3 ? between(0, 3e7) : 0)); fill(a.equity.capPremium, () => (R() < 0.3 ? between(0, 1e7) : 0));
  fill(a.equity.capCash, () => (R() < 0.3 ? between(0, 4e7) : null));
  fill(a.equity.dividend, () => (R() < 0.5 ? between(0, 2e7) : 0)); fill(a.equity.divPaidPct, () => R());
  fill(a.equity.oci, () => (R() < 0.3 ? between(-3e6, 3e6) : 0));
  p.settings.ociAccount = Object.keys(a.others).find((c) => ['lt_invest', 'other_nca', 'intangible'].includes(c)) ?? null;
  if (!p.settings.ociAccount) fill(a.equity.oci, () => 0);
  p.settings.interestPaidClass = pick(['operating', 'financing'] as const);
  p.settings.defaultMonth = 1 + Math.floor(R() * 12);
  for (const [k, pl] of Object.entries(sc.fa)) {
    if (!p.faBase[k].enabled) continue;
    fill(pl.capex, () => (R() < 0.5 ? between(0, 3e7) : 0)); fill(pl.paid, () => (R() < 0.3 ? between(0, 3e7) : null));
    fill(pl.month, () => (R() < 0.7 ? 1 + Math.floor(R() * 12) : null)); fill(pl.life, () => 1 + Math.floor(R() * 20)); fill(pl.residualPct, () => between(0, 0.2));
    fill(pl.transferIn, () => 0);
    fill(pl.dispCost, () => (R() < 0.2 ? between(0, 5e6) : 0)); fill(pl.dispAccDep, () => (R() < 0.2 ? between(0, 3e6) : 0));
    fill(pl.dispProceeds, () => (R() < 0.2 ? between(0, 4e6) : 0)); fill(pl.dispReceived, () => (R() < 0.3 ? between(0, 4e6) : null));
    fill(pl.dispDepReduce, () => 0); fill(pl.impairment, () => (R() < 0.15 ? between(0, 2e6) : 0));
  }
  if (R() < 0.5) { const l = emptyLoan(n, '隨機借款', pick(['short', 'long'] as const)); l.baseBalance = 0; sc.loans.push(l); }
  for (const l of sc.loans) {
    fill(l.rate, () => between(0, 0.08)); fill(l.draw, () => (R() < 0.4 ? between(0, 5e7) : 0)); fill(l.repay, () => (R() < 0.4 ? between(0, 2e7) : 0));
    fill(l.drawMonth, () => (R() < 0.5 ? 1 + Math.floor(R() * 12) : null)); fill(l.repayMonth, () => (R() < 0.5 ? 1 + Math.floor(R() * 12) : null));
    fill(l.accruedMonths, () => Math.floor(R() * 4)); l.nextRepay = between(0, 1e7);
  }
  // 隨機覆寫
  if (R() < 0.5) sc.overrides['c:cogs'] = { [Math.floor(R() * n)]: between(1e8, 4e8) };
  if (R() < 0.5) sc.overrides['w:ar'] = { [Math.floor(R() * n)]: between(0, 1e8) };
  return p;
}

describe('壓力測試：隨機假設下四表恆平衡', () => {
  it('500 組隨機專案', () => {
    let worst = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const p = randomProject(seed);
      const sc = p.scenarios[0];
      const { g, info } = buildGraph(p, sc);
      const ev = evaluate(g);
      expect(info.fcols.length).toBe(p.settings.years);
      for (const c of info.fcols) {
        for (const id of ['ck:bs', 'ck:cash', 'ck:eq', 'ck:open', 'ck:ni', 'ck:ppe']) {
          const v = ev.num(id, c);
          worst = Math.max(worst, Math.abs(v));
          if (Math.abs(v) >= 0.5) throw new Error(`seed ${seed} ${id} @${g.columns[c].label}: ${v}`);
        }
        for (const r of g.rows) { const v = ev.value(r.id, c); if (typeof v === 'number' && !isFinite(v)) throw new Error(`seed ${seed} ${r.id} 非有限值`); }
      }
    }
    console.log('最大勾稽差額', worst);
  });
});
