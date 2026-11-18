import { describe, it, expect } from 'vitest';
import { parseFaRows, guessFaColumns, parseDate, guessClass } from '../src/engine/faImport';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate } from '../src/engine/graph';
import { pasteValue } from '../src/ui/Grid';
import { detailProject } from './fixtures';

describe('fixed asset detail', () => {
  it('parses columns, dates and remaining life', () => {
    expect(parseDate('民國104/01/01')).toBe('2015-01-01');
    expect(parseDate('2021/7/1')).toBe('2021-07-01');
    expect(guessClass('堆高機')).toBe('transport');
    const { res, cols } = detailProject();
    expect(cols).toMatchObject({ cls: 0, name: 1, acquired: 2, cost: 3, accDep: 4, residual: 5, life: 6 });
    expect(res.assets.length).toBe(4);
    const cnc = res.assets.find((a) => a.name === 'CNC 加工機')!;
    expect(cnc.cls).toBe('machinery');
    expect(cnc.remLife).toBeCloseTo(3.5, 1);
    const pack = res.assets.find((a) => a.name === '包裝線')!;
    expect(pack.remLife).toBeCloseTo(4, 5); // 未折減 40% × 10 年
    expect(res.assets.find((a) => a.name === '廠房用地')!.remLife).toBeNull();
  });
  it('detail drives existing depreciation and statements still reconcile', () => {
    const { p } = detailProject();
    const sc = p.scenarios[0];
    sc.a.equity.capPar = [0, 20_000_000, 0, 0, 0];
    sc.a.equity.capPremium = [0, 5_000_000, 0, 0, 0];
    sc.a.equity.capCash = [10_000_000, 15_000_000, null, null, null]; // 預收 10M、次年再收 15M
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const c1 = info.cb + 1;
    // 機器：CNC (30−18−3)/3.5 + 包裝線 8/4；房屋 35/(35−11)=…
    expect(ev.num('f:machinery:exdep', c1)).toBeCloseTo(9_000_000 / 3.5 + 2_000_000, 0);
    expect(ev.num('ck:ppe', info.cb)).toBeCloseTo(0, 6);
    expect(ev.num('e:cap_adv', c1)).toBeCloseTo(10_000_000, 0);
    expect(ev.num('e:cap_adv', c1 + 1)).toBeCloseTo(0, 0);
    expect(ev.num('cf:capinc', c1)).toBeCloseTo(10_000_000, 0);
    for (const c of info.fcols) for (const id of ['ck:bs', 'ck:cash', 'ck:eq', 'ck:ppe', 'ck:loan']) expect(Math.abs(ev.num(id, c))).toBeLessThan(0.5);
    // 累計折舊不超過可折舊額
    const tot = info.fcols.reduce((t, c) => t + ev.num('d:' + p.faAssets!.find((a) => a.name === '包裝線')!.id + ':dep', c), 0);
    expect(tot).toBeCloseTo(8_000_000, 0);
  });
  it('paste conversion', () => {
    expect(pasteValue('8%', 'pct')).toBeCloseTo(0.08);
    expect(pasteValue('8', 'pct')).toBeCloseTo(0.08);
    expect(pasteValue('0.08', 'pct')).toBeCloseTo(0.08);
    expect(pasteValue('(1,200)', 'amount')).toBe(-1200);
    expect(pasteValue('週轉天數', 'text', ['週轉天數', '占比率'])).toBe('週轉天數');
    expect(pasteValue('abc', 'amount')).toBeUndefined();
  });
});

import { inputSanity } from '../src/engine/checks';
describe('input sanity', () => {
  it('flags out-of-range inputs', () => {
    const { p } = detailProject();
    const sc = p.scenarios[0];
    sc.a.gm[0] = 1.2;
    sc.fa.machinery.month[0] = 13;
    sc.loans[0].rate[1] = -0.01;
    const { g } = buildGraph(p, sc);
    const xs = inputSanity(g);
    expect(xs.some((x) => x.item === '毛利率' && x.year === 2026)).toBe(true);
    expect(xs.some((x) => x.level === 'error' && x.message.startsWith('月份'))).toBe(true);
    expect(xs.some((x) => x.message.startsWith('利率') && x.year === 2027)).toBe(true);
    const clean = inputSanity(buildGraph(sampleProject(), sampleProject().scenarios[0]).g);
    expect(clean).toEqual([]);
  });
});

import { assumptionDiff } from '../src/engine/diff';
import { cloneScenario, M } from '../src/engine/project';
describe('假設差異', () => {
  it('列出不同情境之假設與覆寫差異', () => {
    const p = sampleProject();
    const a = p.scenarios[0];
    const b = cloneScenario(a, '保守');
    b.a.growth[1] = 0.02;
    b.overrides['c:cogs'] = { 3: 1 };
    const d = assumptionDiff([buildGraph(p, a).g, buildGraph(p, b).g]);
    expect(d.map((x) => `${x.rowId}@${x.year}`).sort()).toEqual(['a:growth@2027', 'c:cogs@2029']);
    expect(d.find((x) => x.rowId === 'a:growth')!.values).toEqual([0.07, 0.02]);
    expect(assumptionDiff([buildGraph(p, a).g, buildGraph(p, a).g])).toEqual([]);
  });
});

import { collectIssues } from '../src/engine/checks';
import { evaluate as ev2 } from '../src/engine/graph';
describe('參數像金額', () => {
  it('方法為成長率但參數過大時列為錯誤', () => {
    const p = sampleProject();
    const sc = p.scenarios[0];
    sc.a.others.other_income.method[0] = M.GROWTH;
    sc.a.others.other_income.param[0] = 1_000_000;
    const { g, info } = buildGraph(p, sc);
    const xs = collectIssues(p, sc, g, ev2(g), info);
    expect(xs.some((x) => x.level === 'error' && x.message.includes('看似金額') && x.year === 2026)).toBe(true);
  });
});

describe('減資與轉增資', () => {
  it('四種權益交易之股本、資本公積、保留盈餘與現金影響', () => {
    const p = sampleProject();
    const sc = p.scenarios[0];
    const e = sc.a.equity;
    e.capRedCash[0] = 5_000_000; e.capRedLoss[1] = 3_000_000; e.stockDiv[2] = 6_000_000; e.csToCap[3] = 2_000_000;
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const [c1, c2, c3, c4] = info.fcols;
    expect(ev.num('e:capital', c1)).toBe(55_000_000);
    expect(ev.num('cf:capred', c1)).toBe(-5_000_000);
    expect(ev.num('e:capital', c2)).toBe(52_000_000);
    expect(ev.num('sce:re_red', c2)).toBe(3_000_000);
    expect(ev.num('e:capital', c3)).toBe(58_000_000);
    expect(ev.num('sce:re_sd', c3)).toBe(-6_000_000);
    expect(ev.num('e:capital', c4)).toBe(60_000_000);
    expect(ev.num('e:cs', c4)).toBe(3_000_000);
    for (const c of info.fcols) for (const id of ['ck:bs', 'ck:cash', 'ck:eq', 'ck:ni']) expect(Math.abs(ev.num(id, c))).toBeLessThan(0.5);
    // 權益變動表：期初＋各項變動＝期末
    for (const c of info.fcols) {
      const parts = ['sce:t_open', 'sce:t_ci', 'sce:t_owner', 'sce:t_oth'].reduce((t, id) => t + ev.num(id, c), 0);
      expect(parts).toBeCloseTo(ev.num('sce:t_close', c), 2);
    }
  });
});

import { syncScenarioWithBase, arr as arr2 } from '../src/engine/project';
describe('營業費用僅列總額', () => {
  it('opex_total 參與推估且四表平衡', () => {
    const p = sampleProject();
    const m = p.base.manual;
    m.opex_total = (m.sell_exp ?? 0) + (m.admin_exp ?? 0) + (m.rd_exp ?? 0);
    delete m.sell_exp; delete m.admin_exp; delete m.rd_exp;
    const sc = p.scenarios[0];
    sc.a.opex = {};
    syncScenarioWithBase(p, sc);
    expect(Object.keys(sc.a.opex)).toEqual(['opex_total']);
    sc.a.opex.opex_total = arr2(5, 0.133);
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    expect(g.byId.get('a:opex:opex_total')!.label).toBe('營業費用占營收比率');
    expect(ev.num('is:opex', info.cb + 1)).toBeCloseTo(ev.num('is:rev', info.cb + 1) * 0.133, 0);
    for (const c of info.fcols) for (const id of ['ck:bs', 'ck:cash', 'ck:eq']) expect(Math.abs(ev.num(id, c))).toBeLessThan(0.5);
  });
});
