// 比較兩個計算圖之假設輸入與覆寫差異（情境比較、版本比較共用）
import { Graph, Value } from './graph';

export interface AssumpDiff { rowId: string; sheet: string; label: string; year: number; values: Value[] }

const cellVal = (g: Graph, id: string, year: number): { v: Value; kind: string } | undefined => {
  const row = g.byId.get(id);
  if (!row) return undefined;
  const c = g.columns.findIndex((x) => x.year === year);
  const cell = c >= 0 ? row.cells[c] : null;
  if (!cell || (cell.kind !== 'input' && cell.kind !== 'override')) return undefined;
  return { v: cell.value ?? null, kind: cell.kind };
};

const eqv = (a: Value | undefined, b: Value | undefined) =>
  (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

// 以第一個計算圖為基準，列出任一其他計算圖值不同之輸入或覆寫儲存格
export function assumptionDiff(graphs: Graph[]): AssumpDiff[] {
  const out: AssumpDiff[] = [];
  const seen = new Set<string>();
  for (const g of graphs) {
    for (const row of g.rows) {
      row.cells.forEach((cell, c) => {
        if (!cell || (cell.kind !== 'input' && cell.kind !== 'override')) return;
        const year = g.columns[c].year;
        const key = `${row.id}@${year}`;
        if (seen.has(key)) return;
        seen.add(key);
        const vals = graphs.map((x) => cellVal(x, row.id, year));
        const first = vals[0]?.v;
        if (vals.some((v) => !eqv(v?.v, first) || (v?.kind ?? '') !== (vals[0]?.kind ?? ''))) {
          out.push({ rowId: row.id, sheet: row.sheet, label: row.label + (vals.some((v) => v?.kind === 'override') ? '（覆寫）' : ''), year, values: vals.map((v) => (v === undefined ? null : v.v)) });
        }
      });
    }
  }
  return out;
}
