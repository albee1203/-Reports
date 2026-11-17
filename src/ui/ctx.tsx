import { createContext, useContext } from 'react';
import { Graph, EvalResult, Row, RowFormat, Value, exprToText, refsOf } from '../engine/graph';
import { ModelInfo } from '../engine/model';
import { Project, Scenario } from '../engine/project';
import { Issue } from '../engine/checks';

export interface Ctx {
  p: Project;
  sc: Scenario;
  g: Graph;
  ev: EvalResult;
  info: ModelInfo;
  issues: Issue[];
  bankIssues: Issue[];
  update: (mut: (p: Project) => void, log?: { action: string; detail: string }) => void;
  go: (page: string) => void;
  trace: (rowId: string, col: number) => void;
  error: string | null;
}

export const ProjectCtx = createContext<Ctx | null>(null);
export const useP = () => useContext(ProjectCtx)!;

export function fmtVal(v: Value, format: RowFormat, unit: 'yuan' | 'thousand'): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (!isFinite(v)) return '—';
  switch (format) {
    case 'amount': {
      const x = unit === 'thousand' ? v / 1000 : v;
      const r = Math.round(x);
      if (r === 0) return '-';
      const s = Math.abs(r).toLocaleString('zh-TW');
      return r < 0 ? `(${s})` : s;
    }
    case 'pct': return `${(v * 100).toFixed(2)}%`;
    case 'ratio': return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('zh-TW') : String(+v.toFixed(4));
    case 'days': case 'month': case 'years': return String(+v.toFixed(2));
    case 'times': return `${v.toFixed(2)} 倍`;
    default: return String(v);
  }
}

export const unitLabel = (u: 'yuan' | 'thousand') => (u === 'thousand' ? '新台幣千元' : '新台幣元');

export interface TraceInfo {
  row: Row; col: number; kindLabel: string; text: string; value: Value;
  refs: { row: Row; col: number; value: Value; kind: string }[];
  missing: { row: Row; col: number }[];
  original?: string;
}

export const KIND_LABEL: Record<string, string> = { actual: '歷史實際數', input: '使用者假設', formula: '自動計算', override: '手動覆寫', na: '未提供' };

export function traceInfo(g: Graph, ev: EvalResult, rowId: string, col: number): TraceInfo | null {
  const row = g.byId.get(rowId);
  if (!row) return null;
  const cell = row.cells[col];
  if (!cell) return null;
  const refs = cell.expr && cell.kind === 'formula' ? dedupe(refsOf(cell.expr)).map((x) => ({ row: g.byId.get(x.row)!, col: x.col, value: ev.value(x.row, x.col), kind: g.byId.get(x.row)!.cells[x.col]?.kind ?? 'na' })) : [];
  const missing = ev.missingSources(rowId, col).map((k) => { const [id, c] = k.split('@'); return { row: g.byId.get(id)!, col: +c }; });
  return {
    row, col, kindLabel: KIND_LABEL[cell.kind], value: ev.value(rowId, col),
    text: cell.kind === 'formula' ? exprToText(cell.expr!, g) : cell.kind === 'override' ? `手動覆寫值` : cell.kind === 'input' ? '使用者輸入' : cell.note ?? KIND_LABEL[cell.kind],
    original: cell.kind === 'override' && cell.expr ? exprToText(cell.expr, g) : undefined,
    refs, missing,
  };
}

function dedupe(xs: { row: string; col: number }[]) {
  const s = new Set<string>();
  return xs.filter((x) => { const k = x.row + '@' + x.col; if (s.has(k)) return false; s.add(k); return true; });
}
