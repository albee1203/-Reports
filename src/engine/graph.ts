// 計算圖：列 × 欄的運算式模型。App 求值與 Excel 公式皆由此產生，確保計算慣例一致。

export type Expr =
  | { t: 'n'; v: number }
  | { t: 's'; v: string }
  | { t: 'r'; row: string; col: number }
  | { t: 'range'; row: string; c1: number; c2: number }
  | { t: 'op'; op: '+' | '-' | '*' | '/'; a: Expr; b: Expr }
  | { t: 'cmp'; op: '=' | '<>' | '<' | '>' | '<=' | '>='; a: Expr; b: Expr }
  | { t: 'neg'; a: Expr }
  | { t: 'fn'; name: 'SUM' | 'MIN' | 'MAX' | 'IF' | 'ISBLANK' | 'ABS' | 'ROUND' | 'AND' | 'OR'; args: Expr[] };

export type CellKind = 'actual' | 'input' | 'formula' | 'override' | 'na';
export type Value = number | string | null;

export interface Cell {
  kind: CellKind;
  value?: Value; // actual / input / override 的值；null = 空白
  expr?: Expr; // formula；override 時保留原公式
  required?: boolean; // input 為必要假設
  note?: string; // 說明（例如「概估」、「未提供」）
  options?: string[]; // input 下拉選項
  inputPath?: string; // 對應專案資料路徑（UI 編輯用）
}

export type RowFormat = 'amount' | 'pct' | 'days' | 'month' | 'years' | 'text' | 'ratio' | 'status' | 'times';

export interface Row {
  id: string;
  sheet: string;
  label: string;
  desc?: string; // 方法或公式說明
  format: RowFormat;
  cells: (Cell | null)[];
  style?: 'header' | 'subtotal' | 'total' | 'normal';
  indent?: number;
  overridable?: boolean;
  hidden?: boolean;
}

export interface Column {
  key: string;
  label: string; // 例如 2025
  year: number;
  type: 'comparative' | 'base' | 'forecast';
}

export interface Graph {
  columns: Column[];
  rows: Row[];
  byId: Map<string, Row>;
}

// ---- 建構輔助 ----
export const n = (v: number): Expr => ({ t: 'n', v });
export const s = (v: string): Expr => ({ t: 's', v });
export const r = (row: string, col: number): Expr => ({ t: 'r', row, col });
export const add = (...xs: Expr[]): Expr => xs.length === 0 ? n(0) : xs.reduce((a, b) => ({ t: 'op', op: '+', a, b }));
export const sub = (a: Expr, b: Expr): Expr => ({ t: 'op', op: '-', a, b });
export const mul = (...xs: Expr[]): Expr => xs.reduce((a, b) => ({ t: 'op', op: '*', a, b }));
export const div = (a: Expr, b: Expr): Expr => ({ t: 'op', op: '/', a, b });
export const neg = (a: Expr): Expr => ({ t: 'neg', a });
export const fn = (name: any, ...args: Expr[]): Expr => ({ t: 'fn', name, args });
export const iff = (c: Expr, a: Expr, b: Expr): Expr => fn('IF', c, a, b);
export const eq = (a: Expr, b: Expr): Expr => ({ t: 'cmp', op: '=', a, b });
export const cmp = (op: any, a: Expr, b: Expr): Expr => ({ t: 'cmp', op, a, b });
export const sum = (...xs: Expr[]): Expr => xs.length === 0 ? n(0) : xs.length === 1 ? xs[0] : fn('SUM', ...xs);
export const min = (...xs: Expr[]): Expr => fn('MIN', ...xs);
export const max = (...xs: Expr[]): Expr => fn('MAX', ...xs);
export const range = (row: string, c1: number, c2: number): Expr => ({ t: 'range', row, c1, c2 });

// ---- 求值 ----
export interface EvalResult {
  value: (rowId: string, col: number) => Value;
  num: (rowId: string, col: number) => number;
  incomplete: (rowId: string, col: number) => boolean; // 依賴未完成之必要假設
  missingSources: (rowId: string, col: number) => string[]; // 未完成之假設列 id@col
}

export class CycleError extends Error {}

export function evaluate(g: Graph): EvalResult {
  const cache = new Map<string, { v: Value; miss: Set<string> }>();
  const visiting = new Set<string>();

  const cellOf = (rowId: string, col: number): Cell | null => {
    const row = g.byId.get(rowId);
    if (!row) throw new Error(`未知列：${rowId}`);
    return row.cells[col] ?? null;
  };

  const get = (rowId: string, col: number): { v: Value; miss: Set<string> } => {
    const key = rowId + '@' + col;
    const hit = cache.get(key);
    if (hit) return hit;
    if (visiting.has(key)) throw new CycleError(`循環參照：${key}`);
    visiting.add(key);
    const c = cellOf(rowId, col);
    let res: { v: Value; miss: Set<string> };
    if (!c || c.kind === 'na') res = { v: null, miss: new Set() };
    else if (c.kind === 'formula') {
      const miss = new Set<string>();
      const v = ev(c.expr!, miss);
      res = { v, miss };
    } else {
      const miss = new Set<string>();
      if (c.kind === 'input' && c.required && (c.value === null || c.value === undefined || c.value === '')) miss.add(key);
      res = { v: c.value ?? null, miss };
    }
    visiting.delete(key);
    cache.set(key, res);
    return res;
  };

  const toNum = (v: Value): number => (typeof v === 'number' ? v : v === null || v === '' ? 0 : Number(v) || 0);

  const ev = (e: Expr, miss: Set<string>): Value => {
    switch (e.t) {
      case 'n':
        return e.v;
      case 's':
        return e.v;
      case 'r': {
        const x = get(e.row, e.col);
        x.miss.forEach((m) => miss.add(m));
        return x.v;
      }
      case 'range': {
        let t = 0;
        for (let c = e.c1; c <= e.c2; c++) {
          const x = get(e.row, c);
          x.miss.forEach((m) => miss.add(m));
          t += toNum(x.v);
        }
        return t;
      }
      case 'neg':
        return -toNum(ev(e.a, miss));
      case 'op': {
        const a = toNum(ev(e.a, miss));
        const b = toNum(ev(e.b, miss));
        if (e.op === '+') return a + b;
        if (e.op === '-') return a - b;
        if (e.op === '*') return a * b;
        return b === 0 ? 0 : a / b; // Excel 會顯示 #DIV/0!；匯出時以 IF 保護
      }
      case 'cmp': {
        const a = ev(e.a, miss);
        const b = ev(e.b, miss);
        const norm = (v: Value) => (v === null ? (typeof (a ?? b) === 'string' ? '' : 0) : v);
        const x = norm(a), y = norm(b);
        switch (e.op) {
          case '=': return (x === y ? 1 : 0);
          case '<>': return (x !== y ? 1 : 0);
          case '<': return (x! < y! ? 1 : 0);
          case '>': return (x! > y! ? 1 : 0);
          case '<=': return (x! <= y! ? 1 : 0);
          case '>=': return (x! >= y! ? 1 : 0);
        }
        return 0;
      }
      case 'fn': {
        const { name, args } = e;
        if (name === 'IF') {
          // 只追蹤實際採用分支之未完成狀態
          const c = toNum(ev(args[0], miss));
          return c ? ev(args[1], miss) : ev(args[2], miss);
        }
        if (name === 'ISBLANK') {
          const a = args[0];
          if (a.t !== 'r') return 0;
          const x = get(a.row, a.col);
          return x.v === null || x.v === '' ? 1 : 0;
        }
        const vals = args.map((a) => toNum(ev(a, miss)));
        switch (name) {
          case 'SUM': return vals.reduce((p, q) => p + q, 0);
          case 'MIN': return Math.min(...vals);
          case 'MAX': return Math.max(...vals);
          case 'ABS': return Math.abs(vals[0]);
          case 'ROUND': { const f = Math.pow(10, vals[1] ?? 0); return Math.round(vals[0] * f) / f; }
          case 'AND': return vals.every(Boolean) ? 1 : 0;
          case 'OR': return vals.some(Boolean) ? 1 : 0;
        }
        return 0;
      }
    }
  };

  return {
    value: (id, c) => get(id, c).v,
    num: (id, c) => toNum(get(id, c).v),
    incomplete: (id, c) => get(id, c).miss.size > 0,
    missingSources: (id, c) => [...get(id, c).miss],
  };
}

// ---- 公式文字（追溯用） ----
export function exprToText(e: Expr, g: Graph): string {
  const lbl = (row: string, col: number) => `${g.byId.get(row)?.label ?? row}[${g.columns[col]?.label ?? col}]`;
  const go = (x: Expr, p = 0): string => {
    switch (x.t) {
      case 'n': return fmtNum(x.v);
      case 's': return `「${x.v}」`;
      case 'r': return lbl(x.row, x.col);
      case 'range': return `${g.byId.get(x.row)?.label}[${g.columns[x.c1].label}…${g.columns[x.c2].label}]`;
      case 'neg': return `−${go(x.a, 3)}`;
      case 'op': {
        const pr = x.op === '+' || x.op === '-' ? 1 : 2;
        const sym = { '+': ' ＋ ', '-': ' − ', '*': ' × ', '/': ' ÷ ' }[x.op];
        const s = `${go(x.a, pr)}${sym}${go(x.b, pr + (x.op === '-' || x.op === '/' ? 1 : 0))}`;
        return pr < p ? `(${s})` : s;
      }
      case 'cmp': return `${go(x.a, 1)} ${x.op} ${go(x.b, 1)}`;
      case 'fn': return `${x.name}(${x.args.map((a) => go(a)).join(', ')})`;
    }
  };
  return go(e);
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(10)));

// 收集運算式直接引用的列
export function refsOf(e: Expr, out: { row: string; col: number }[] = []) {
  switch (e.t) {
    case 'r': out.push({ row: e.row, col: e.col }); break;
    case 'range': for (let c = e.c1; c <= e.c2; c++) out.push({ row: e.row, col: c }); break;
    case 'op': case 'cmp': refsOf(e.a, out); refsOf(e.b, out); break;
    case 'neg': refsOf(e.a, out); break;
    case 'fn': e.args.forEach((a) => refsOf(a, out)); break;
  }
  return out;
}

// ---- Excel 公式 ----
export interface CellAddr { sheet: string; row: number; colLetter: (col: number) => string }

export function colLetter(i: number): string {
  // 0 => A
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

export function exprToExcel(
  e: Expr,
  currentSheet: string,
  addr: (row: string, col: number) => { sheet: string; ref: string },
  isText: (row: string, col: number) => boolean = () => false,
): string {
  const ref = (row: string, col: number) => {
    const a = addr(row, col);
    const x = a.sheet === currentSheet ? a.ref : `'${a.sheet}'!${a.ref}`;
    return isText(row, col) ? `N(${x})` : x; // 「未提供」文字儲存格以 0 參與運算
  };
  const go = (x: Expr, p = 0): string => {
    switch (x.t) {
      case 'n': return x.v < 0 ? `(${fmtNum(x.v)})` : fmtNum(x.v);
      case 's': return `"${x.v.replace(/"/g, '""')}"`;
      case 'r': return ref(x.row, x.col);
      case 'range': {
        const a = addr(x.row, x.c1), b = addr(x.row, x.c2);
        const pre = a.sheet === currentSheet ? '' : `'${a.sheet}'!`;
        return `SUM(${pre}${a.ref}:${b.ref})`;
      }
      case 'neg': return `-${go(x.a, 3)}`;
      case 'op': {
        const pr = x.op === '+' || x.op === '-' ? 1 : 2;
        if (x.op === '/') {
          const b = go(x.b, 3);
          return `IF(${b}=0,0,${go(x.a, 2)}/${b})`;
        }
        const s = `${go(x.a, pr)}${x.op}${go(x.b, pr + (x.op === '-' ? 1 : 0))}`;
        return pr < p ? `(${s})` : s;
      }
      case 'cmp': return `${go(x.a, 1)}${x.op}${go(x.b, 1)}`;
      case 'fn': return `${x.name}(${x.args.map((a) => go(a)).join(',')})`;
    }
  };
  return go(e);
}

export function makeGraph(columns: Column[], rows: Row[]): Graph {
  const byId = new Map<string, Row>();
  for (const row of rows) {
    if (byId.has(row.id)) throw new Error(`重複列 id：${row.id}`);
    byId.set(row.id, row);
  }
  return { columns, rows, byId };
}
