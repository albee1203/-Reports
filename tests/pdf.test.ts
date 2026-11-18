import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractItems, itemsToSheets } from '../src/engine/pdfImport';
import { guessLayout, guessUnit, buildLines, newRawImport, applyImport, readFile } from '../src/engine/importer';
import { emptyYear } from '../src/engine/project';

const load = (f: string) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

async function importSheet(rows: string[][], stmt: 'BS' | 'IS', which: 'base' | 'comp') {
  const lay = guessLayout(rows);
  const unit = guessUnit(rows) ?? 1;
  const amountCol = which === 'base' ? lay.amountCol : lay.compCol!;
  const cfg = { fileName: 'x', sheet: 's', stmt, year: 2025, currency: 'TWD', unitMultiplier: unit, signConvention: 'presentation' as const, headerRow: lay.headerRow, labelCol: lay.labelCol, amountCol };
  const raw = newRawImport(cfg, rows);
  const y = emptyYear(2025);
  applyImport(y, raw, buildLines(rows, cfg, raw.id));
  return { lay, y };
}
const problems = (y: any) => y.lines.filter((l: any) => l.kind !== 'ignore' && (l.issues.length || (l.kind === 'detail' && !l.account))).map((l: any) => `${l.label}｜${l.rawAmount}｜${l.issues.join('；')}`);

describe('PDF 財報匯入（文字型）', async () => {
  // 以 Excel 原檔匯入結果作為標準答案
  const xs = await readFile('會計師版式財報_114.xlsx', load('tests/fixtures/會計師版式財報_114.xlsx'));
  const expected: Record<string, any> = {};
  for (const [i, stmt] of [[0, 'BS'], [1, 'IS']] as const) for (const w of ['base', 'comp'] as const) expected[`${stmt}-${w}`] = (await importSheet(xs[i].rows, stmt, w)).y.accounts;

  for (const file of ['財報_瀏覽器列印.pdf', '財報_試算表軟體匯出.pdf']) {
    it(file, async () => {
      const items = await extractItems(pdfjs, load(`tests/fixtures/${file}`));
      const sheets = itemsToSheets(items);
      expect(sheets.length).toBe(3); // 全部頁面＋2 頁
      for (const [pi, stmt] of [[1, 'BS'], [2, 'IS']] as const) {
        const rows = sheets[pi].rows;
        for (const w of ['base', 'comp'] as const) {
          const { lay, y } = await importSheet(rows, stmt, w);
          if (w === 'base') expect(lay).toMatchObject({ year: 2025, compYear: 2024 });
          expect(problems(y)).toEqual([]);
          expect(y.accounts).toEqual(expected[`${stmt}-${w}`]);
        }
      }
    });
  }

  it('財報_標準中文字型.pdf（字型未內嵌，需繁體中文字元對照表）', async () => {
    const withCMap = { ...pdfjs, getDocument: (o: any) => (pdfjs as any).getDocument({ ...o, cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true }) };
    const sheets = itemsToSheets(await extractItems(withCMap, load('tests/fixtures/財報_標準中文字型.pdf')));
    for (const w of ['base', 'comp'] as const) {
      const { y } = await importSheet(sheets[0].rows, 'BS', w);
      expect(problems(y)).toEqual([]);
      expect(y.accounts).toEqual(expected[`BS-${w}`]);
    }
  });
});
