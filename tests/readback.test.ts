import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate, colLetter } from '../src/engine/graph';
import { buildWorkbook } from '../src/export/excel';
import { readBack } from '../src/export/excelImport';

describe('讀回 Excel 修改', () => {
  it('辨識假設修改、覆寫、恢復公式與無法套用之修改', async () => {
    const p = sampleProject();
    const sc = p.scenarios[0];
    sc.overrides['w:inv'] = { 1: 40_000_000 };
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const wb = await buildWorkbook({ mode: 'internal', project: p, scenario: sc, graph: g, ev, issues: [] });
    const bySheet = new Map<string, string[]>();
    for (const r of g.rows) { if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []); bySheet.get(r.sheet)!.push(r.id); }
    const cell = (id: string, c: number) => { const r = g.byId.get(id)!; return wb.getWorksheet(r.sheet)!.getCell(`${colLetter(2 + c)}${5 + bySheet.get(r.sheet)!.indexOf(id)}`); };
    const c1 = info.cb + 1;
    cell('a:growth', c1).value = 0.12;                 // 修改假設
    cell('a:ar_m', c1 + 1).value = '占比率';           // 修改方法
    cell('c:cogs', c1 + 2).value = 250_000_000;         // 公式改數值 → 覆寫
    cell('w:inv', c1 + 1).value = { formula: 'C1' } as any; // 覆寫改回公式 → 恢復
    cell('bs:assets', c1).value = 1;                    // 合計改數值 → 無法套用
    cell('c:rev', c1 + 3).value = ev.num('c:rev', c1 + 3); // 貼上相同數值 → 不視為修改
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const res = await readBack(buf, p, sc, g, ev);
    const k = (id: string) => res.changes.filter((c) => c.rowId === id).map((c) => c.kind);
    expect(res.warnings).toEqual([]);
    expect(k('a:growth')).toEqual(['input']);
    expect(k('a:ar_m')).toEqual(['input']);
    expect(k('c:cogs')).toEqual(['override']);
    expect(k('w:inv')).toEqual(['restore']);
    expect(k('bs:assets')).toEqual(['conflict']);
    expect(k('c:rev')).toEqual([]);
    expect(res.changes.length).toBe(5);
    expect(res.changes.find((c) => c.rowId === 'c:cogs')!.forecastIndex).toBe(2);
  });
});

import { matchCfRow } from '../src/engine/cfImport';
describe('基期現金流量表科目對應', () => {
  it('依關鍵字對應', () => {
    const p = sampleProject();
    const { g } = buildGraph(p, p.scenarios[0]);
    const rows = g.rows.filter((r) => r.sheet === '現金流量表');
    const m = (l: string) => matchCfRow(l, rows);
    expect(m('本期稅前淨利')).toBe('cf:pbt');
    expect(m('折舊費用')).toBe('cf:dep');
    expect(m('處分不動產、廠房及設備損失')).toBe('cf:gain');
    expect(m('取得不動產、廠房及設備')).toBe('cf:capex');
    expect(m('處分不動產、廠房及設備價款')).toBe('cf:disp');
    expect(m('應收帳款增加')).toBe('cf:d_ar');
    expect(m('預付款項減少')).toBe('cf:o:prepay');
    expect(m('營業活動之淨現金流入')).toBe('cf:op');
    expect(m('發放現金股利')).toBe('cf:divpaid');
    expect(m('期初現金及約當現金餘額')).toBe('cf:open');
    expect(m('神秘項目')).toBeNull();
  });
});

import { parseSce, findHeaderRow, sceTotals } from '../src/engine/sceImport';
import { matchMove } from '../src/engine/sceImport';
describe('權益變動表列名辨識', () => {
  it('以日期表示之期初、期末餘額', () => {
    expect(matchMove('114年1月1日餘額')).toBe('open');
    expect(matchMove('民國114年 1月 1日餘額')).toBe('open');
    expect(matchMove('114年12月31日餘額')).toBe('close');
    expect(matchMove('114年6月30日餘額')).toBe('close');
    expect(matchMove('期初餘額')).toBe('open');
  });
});

describe('基期權益變動表匯入', () => {
  it('矩陣格式解析、保留盈餘細項加總、盈餘公積提列互抵', () => {
    const rows = [
      ['範例公司　權益變動表', ''],
      ['項目', '股本', '資本公積', '法定盈餘公積', '特別盈餘公積', '未分配盈餘', '保留盈餘合計', '庫藏股票', '權益總額'],
      ['期初餘額', '60,000', '5,000', '3,000', '0', '5,440', '8,440', '(1,000)', '72,440'],
      ['提列法定盈餘公積', '', '', '1,000', '', '(1,000)', '', '', ''],
      ['現金股利', '', '', '', '', '(10,000)', '(10,000)', '', '(10,000)'],
      ['本期淨利', '', '', '', '', '26,560', '26,560', '', '26,560'],
      ['本期綜合損益總額', '', '', '', '', '26,560', '26,560', '', '26,560'],
      ['買回庫藏股', '', '', '', '', '', '', '(500)', '(500)'],
      ['期末餘額', '60,000', '5,000', '4,000', '0', '21,000', '25,000', '(1,500)', '88,500'],
    ];
    const h = findHeaderRow(rows);
    expect(h).toBe(1);
    const r = parseSce(rows, h, 0, 1000);
    expect(r.values['sce:cap_open']).toBe(60_000_000);
    expect(r.values['sce:re_open']).toBe(8_440_000);
    expect(r.values['sce:re_div']).toBe(-10_000_000);
    expect(r.values['sce:re_ni']).toBe(26_560_000);
    expect(r.values['sce:ot_open']).toBe(-1_000_000);
    expect(r.values['sce:ot_chg']).toBe(-500_000);
    expect(r.close.re).toBe(25_000_000);
    expect(r.approp).toBe(0);
    expect(r.issues).toEqual([]);
    const t = sceTotals(r.values, ['cap', 'cs', 'adv', 're', 'oe', 'ot']);
    expect(t['sce:t_open']).toBe(72_440_000);
    expect(t['sce:t_owner']).toBe(-10_000_000);
  });
});
