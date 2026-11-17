import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate, colLetter } from '../src/engine/graph';
import { collectIssues } from '../src/engine/checks';
import { buildWorkbook } from '../src/export/excel';

// LibreOffice 設定為載入 xlsx 時一律重算（模擬 Excel 之 fullCalcOnLoad）
const LO_PROFILE = `${process.cwd()}/tests/out/lo-profile`;
mkdirSync(`${LO_PROFILE}/user`, { recursive: true });
writeFileSync(`${LO_PROFILE}/user/registrymodifications.xcu`, `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
const soffice = (out: string, file: string) => execFileSync('soffice', [`-env:UserInstallation=file://${LO_PROFILE}`, '--headless', '--calc', '--convert-to', 'xlsx', '--outdir', out, file], { stdio: 'pipe' });

describe('excel parity (LibreOffice recalculation)', () => {
  it('formulas recompute to engine values', async () => {
    const p = sampleProject();
    const sc = p.scenarios[0];
    sc.overrides['w:ar'] = { 2: 60_000_000 };
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const issues = collectIssues(p, sc, g, ev, info);
    const wb = await buildWorkbook({ mode: 'internal', project: p, scenario: sc, graph: g, ev, issues, omitCachedResults: true });
    mkdirSync('tests/out', { recursive: true });
    await wb.xlsx.writeFile('tests/out/in.xlsx');
    soffice('tests/out/recalc', 'tests/out/in.xlsx');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile('tests/out/recalc/in.xlsx');
    // 依列順序定位
    const bySheet = new Map<string, string[]>();
    for (const r of g.rows) { if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []); bySheet.get(r.sheet)!.push(r.id); }
    let checked = 0; const bad: string[] = [];
    for (const r of g.rows) {
      const ws = wb2.getWorksheet(r.sheet)!;
      const rowNo = 5 + bySheet.get(r.sheet)!.indexOf(r.id);
      r.cells.forEach((cell, c) => {
        if (!cell || cell.kind !== 'formula') return;
        const xc = ws.getCell(`${colLetter(2 + c)}${rowNo}`);
        let v: any = xc.value;
        if (v && typeof v === 'object' && 'formula' in v) v = 'result' in v ? v.result : 0; // ExcelJS 讀取時省略 0 之結果
        const e = ev.value(r.id, c);
        checked++;
        if (typeof e === 'number') { if (typeof v !== 'number' || Math.abs(v - e) > 1e-6 * Math.max(1, Math.abs(e))) bad.push(`${r.sheet}!${r.id}@${g.columns[c].label}: excel=${JSON.stringify(xc.value)} app=${e}`); }
        else if (e !== null && v !== e) bad.push(`${r.sheet}!${r.id}@${g.columns[c].label}: excel=${v} app=${e}`);
      });
    }
    console.log('checked formulas', checked, 'mismatches', bad.length, bad.slice(0, 15));
    expect(bad).toEqual([]);
  });
});

describe('excel what-if', () => {
  it('editing an assumption in Excel keeps statements reconciled', async () => {
    const p = sampleProject();
    const sc = p.scenarios[0];
    const { g, info } = buildGraph(p, sc);
    const ev = evaluate(g);
    const wb = await buildWorkbook({ mode: 'bank', project: p, scenario: sc, graph: g, ev, issues: [] });
    const bySheet = new Map<string, string[]>();
    for (const r of g.rows) { if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []); bySheet.get(r.sheet)!.push(r.id); }
    const at = (id: string, c: number) => { const r = g.byId.get(id)!; return { ws: r.sheet, ref: `${colLetter(2 + c)}${5 + bySheet.get(r.sheet)!.indexOf(id)}` }; };
    const set = (id: string, c: number, v: any) => { const a = at(id, c); wb.getWorksheet(a.ws)!.getCell(a.ref).value = v; };
    set('a:growth', info.cb + 1, 0.5);
    set('a:ar_m', info.cb + 2, '占比率'); set('a:ar_p', info.cb + 2, 0.3);
    set('a:div', info.cb + 3, 50_000_000);
    mkdirSync('tests/out/whatif', { recursive: true });
    await wb.xlsx.writeFile('tests/out/whatif/w.xlsx');
    soffice('tests/out/whatif/r', 'tests/out/whatif/w.xlsx');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile('tests/out/whatif/r/w.xlsx');
    const get = (id: string, c: number) => { const a = at(id, c); let v: any = wb2.getWorksheet(a.ws)!.getCell(a.ref).value; if (v && typeof v === 'object' && 'formula' in v) v = 'result' in v ? v.result : 0; return v; };
    for (const c of info.fcols) {
      for (const id of ['ck:bs:st', 'ck:cash:st', 'ck:eq:st']) expect(get(id, c)).toBe('通過');
    }
    expect(get('c:rev', info.cb + 1)).toBeCloseTo(450_000_000, 0);
    expect(get('w:ar', info.cb + 2)).toBeCloseTo(get('c:rev', info.cb + 2) * 0.3, 0);
  });
});
