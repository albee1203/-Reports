import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { evaluate, colLetter } from '../src/engine/graph';
import { collectIssues } from '../src/engine/checks';
import { buildWorkbook } from '../src/export/excel';

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
    execFileSync('soffice', ['--headless', '--calc', '--convert-to', 'xlsx', '--outdir', 'tests/out/recalc', 'tests/out/in.xlsx'], { stdio: 'pipe' });
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
