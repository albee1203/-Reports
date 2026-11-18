import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractItems, itemsToSheets } from '../src/engine/pdfImport';
import { guessLayout, guessUnit, buildLines, newRawImport, applyImport, readFile } from '../src/engine/importer';
import { emptyYear } from '../src/engine/project';
import { sampleProject } from '../src/engine/sample';
import { buildGraph } from '../src/engine/model';
import { matchCfRow } from '../src/engine/cfImport';
import { parseSce, findHeaderRow } from '../src/engine/sceImport';

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
      // 自動辨識之報表工作表在前，其後為全部頁面及各頁
      expect(sheets.map((x) => x.name)).toEqual(['資產負債表（第 1 頁）', '綜合損益表（第 2 頁）', '全部頁面（2 頁）', '第 1 頁', '第 2 頁']);
      for (const [pi, stmt] of [[0, 'BS'], [1, 'IS']] as const) {
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

  it('整本財報_114.pdf：自動找出報表頁、跨頁合併、排除封面／查核報告／目錄／附註', async () => {
    const sheets = itemsToSheets(await extractItems(pdfjs, load('tests/fixtures/整本財報_114.pdf')));
    const stmts = sheets.filter((x) => /（第/.test(x.name)).map((x) => x.name);
    // 目錄（無編號、含頁次欄）不得誤判；現金流量表第 9 頁無標題，視為續頁合併
    expect(stmts).toEqual(['資產負債表（第 4–5 頁）', '綜合損益表（第 6 頁）', '權益變動表（第 7 頁）', '現金流量表（第 8–9 頁）']);
    for (const [name, stmt] of [['資產負債表（第 4–5 頁）', 'BS'], ['綜合損益表（第 6 頁）', 'IS']] as const) {
      const rows = sheets.find((x) => x.name === name)!.rows;
      for (const w of ['base', 'comp'] as const) {
        const { y } = await importSheet(rows, stmt, w);
        expect(problems(y)).toEqual([]);
        expect(y.accounts).toEqual(expected[`${stmt}-${w}`]);
      }
    }
    // 現金流量表：科目自動對應
    const cfRows = buildGraph(sampleProject(), sampleProject().scenarios[0]).g.rows.filter((r) => r.sheet === '現金流量表');
    const cf = sheets.find((x) => x.name.startsWith('現金流量表'))!.rows;
    const labels = cf.map((r) => r[1]).filter(Boolean);
    const isAmt = (c: string) => /^\(?[\d,]+\)?$/.test(c.trim());
    const unmatched = labels.filter((l) => cf.find((r) => r[1] === l)!.slice(2).some(isAmt) && !matchCfRow(l, cfRows));
    expect(unmatched).toEqual([]); // 「短期借款減少」對應「償還借款」
    // 權益變動表：矩陣解析，期初＋變動＝期末
    const sce = sheets.find((x) => x.name.startsWith('權益變動表'))!.rows;
    const r = parseSce(sce, findHeaderRow(sce), 1, 1000);
    expect(r.values['sce:cap_open']).toBe(50_000_000);
    expect(r.values['sce:re_open']).toBe(6_500_000);
    expect(r.values['sce:cap_inc']).toBe(10_000_000);
    expect(r.issues).toEqual([]);
    const reSum = ['sce:re_open', 'sce:re_div', 'sce:re_ni'].reduce((t, k) => t + (r.values[k] ?? 0), 0);
    expect(reSum).toBe(r.close.re);
  });

  it('財報_左右並列.pdf：資產負債表左資產、右負債及權益', async () => {
    const sheets = itemsToSheets(await extractItems(pdfjs, load('tests/fixtures/財報_左右並列.pdf')));
    const bs = sheets.find((x) => x.name.startsWith('資產負債表'))!;
    for (const w of ['base', 'comp'] as const) {
      const { y } = await importSheet(bs.rows, 'BS', w);
      expect(problems(y)).toEqual([]);
      expect(y.accounts).toEqual(expected[`BS-${w}`]);
    }
  });

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

describe('PDF 實務版式（以座標直接建構）', () => {
  // 以每字 10pt 寬度建立文字項目
  const row = (y: number, cells: [number, string, 'l' | 'r'][], page = 1) =>
    cells.map(([x, str, al]) => ({ str, x: al === 'r' ? x - str.length * 5.5 : x, y, w: str.length * (/[一-鿿]/.test(str) ? 10 : 5.5), h: 10, page }));
  it('標題與公司名稱同列、金額前有「$」', () => {
    const items = [
      ...row(40, [[80, '範例股份有限公司及子公司　合併資產負債表', 'l']]),
      ...row(55, [[80, '民國114年12月31日', 'l']]),
      ...row(80, [[40, '代碼', 'l'], [80, '會計項目', 'l'], [380, '114年12月31日', 'r']]),
      ...['現金及約當現金|$ 35,000', '應收帳款淨額|44,000', '存貨|30,000', '不動產、廠房及設備|75,000', '短期借款|20,000', '應付帳款|25,000', '股本|60,000', '資產總計|$ 198,000'].flatMap((t, i) => {
        const [l, a] = t.split('|');
        return row(100 + i * 14, [[40, String(1100 + i), 'l'], [80, l, 'l'], [380, a, 'r']]);
      }),
      ...row(40, [[80, '四、合併資產負債表', 'l']], 2), ...row(60, [[80, '目錄', 'l']], 2),
    ];
    const sheets = itemsToSheets(items);
    expect(sheets[0].name).toBe('合併資產負債表（第 1 頁）');
    const rows = sheets[0].rows;
    expect(rows.find((r) => r[1] === '現金及約當現金')!.includes('$ 35,000')).toBe(true);
    expect(sheets.filter((x) => /（第/.test(x.name)).length).toBe(1);
  });
});
