import { describe, it, expect } from 'vitest';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate } from '../src/engine/graph';

describe('engine', () => {
  it('balances and reconciles', () => {
    const p = sampleProject();
    const { g, info } = buildGraph(p, p.scenarios[0]);
    const ev = evaluate(g);
    for (const c of [info.cb, ...info.fcols]) {
      const show = ['is:rev','is:cogs','is:opex','is:fin','is:pbt','is:tax','is:ni','bs:cash','bs:ar','bs:inventory','bs:ppe','bs:ap','bs:assets','bs:le','f:dep','l:int','ck:bs','ck:cash','ck:eq','ck:ppe','ck:loan'].map(id => `${id}=${Math.round(ev.num(id,c))}`);
      console.log(g.columns[c].label, show.join(' '));
    }
    for (const c of info.fcols) {
      for (const id of ['ck:bs','ck:cash','ck:eq','ck:open','ck:ni','ck:ppe','ck:loan']) expect(Math.abs(ev.num(id, c))).toBeLessThan(0.5);
    }
    const missing = g.rows.flatMap(r => r.cells.map((_, c) => ev.incomplete(r.id, c) ? `${r.id}@${c}:${ev.missingSources(r.id,c).join(',')}` : null).filter(Boolean));
    console.log('missing', missing.slice(0, 10));
    expect(missing.length).toBe(0);
  });
});

import { newProject, syncScenarioWithBase } from '../src/engine/project';
import { collectIssues } from '../src/engine/checks';
describe('incomplete project', () => {
  it('flags missing assumptions without plugging', () => {
    const p = newProject('測試', 2025);
    p.base.manual = { cash: 10, revenue: 100, cogs: 60, capital: 10 };
    syncScenarioWithBase(p, p.scenarios[0]);
    const { g, info } = buildGraph(p, p.scenarios[0]);
    const ev = evaluate(g);
    const issues = collectIssues(p, p.scenarios[0], g, ev, info);
    expect(issues.some((i) => i.level === 'incomplete' && i.item === '營收成長率' && i.year === 2026)).toBe(true);
    expect(ev.incomplete('is:rev', info.cb + 1)).toBe(true);
    expect(ev.incomplete('is:rev', info.cb)).toBe(false);
    for (const c of info.fcols) expect(Math.abs(ev.num('ck:bs', c))).toBeLessThan(0.5);
  });
});
