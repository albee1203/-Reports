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
