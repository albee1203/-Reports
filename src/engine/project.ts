// 專案、情境、假設資料模型
import { AccountDef, DEFAULT_COA, FA_CLASSES, CfClass, findAccount } from './coa';

export type Num = number | null;
export type Arr = Num[];
export type SArr = (string | null)[];

export const M = {
  WC_DAYS: '週轉天數',
  WC_PCT: '占比率',
  AP_PURCH: '進貨額',
  AP_COGS: '銷貨成本（概估）',
  MANUAL: '手動金額',
  HOLD: '固定金額',
  GROWTH: '成長率',
  PCT_REV: '占營收比率',
  PCT_COGS: '占成本比率',
  CASH_RATE: '期初現金×利率',
  DEP_IN: '已含折舊',
  DEP_EX: '未含折舊',
  TAX_RATE: '稅率估算',
  TAX_MANUAL: '手動稅額',
  EXDEP_MANUAL: '逐年手動',
  EXDEP_EST: '估算',
} as const;

export const OTHER_METHODS = [M.MANUAL, M.HOLD, M.GROWTH, M.PCT_REV, M.PCT_COGS];

export interface StandardVersion { year: number; version: string; effectiveDate: string }

export interface Settings {
  companyName: string;
  taxId: string;
  baseYear: number;
  fyEnd: string; // MM-DD
  years: number;
  currency: string;
  unit: 'yuan' | 'thousand';
  cashThreshold: number;
  defaultMonth: number;
  daysBasis: number;
  interestPaidClass: 'operating' | 'financing';
  depExpenseLine: string; // 不含折舊時，營業費用部分歸屬科目
  ociAccount: string | null; // 其他綜合損益對應之資產負債科目
  standards: StandardVersion[];
  advanced: { lease: boolean; fx: boolean; related: boolean };
}

export interface RawImport {
  id: string;
  fileName: string;
  sheet: string;
  stmt: 'BS' | 'IS' | 'TB';
  year: number;
  currency: string;
  unitMultiplier: number; // 1 元 / 1000 千元 / 1e6 百萬元
  signConvention: 'presentation' | 'debitPositive';
  labelCol: number;
  amountCol: number;
  headerRow: number;
  rows: string[][]; // 原始資料（保留）
  importedAt: string;
}

export interface MappedLine {
  importId: string;
  rowIndex: number; // rows 中的索引
  label: string;
  rawAmount: string;
  amount: number | null; // 換算為元，依儲存慣例
  account: string | null; // null = 未對應
  kind: 'detail' | 'subtotal' | 'ignore';
  subtotalCheck?: string | null;
  issues: string[];
  confirmed: boolean;
}

export interface YearData {
  year: number;
  accounts: Record<string, Num>; // 由對應彙總或手動輸入
  manual: Record<string, Num>; // 手動輸入（優先於匯入）
  lines: MappedLine[];
  importIds: string[];
  cfActual: Record<string, Num>; // 基期現金流量表實際數（選填）
  sceActual: Record<string, Num>; // 基期權益變動表實際數（選填）
}

export interface FaBase {
  cost: Num; accDep: Num; accImp: Num; nbv: Num;
  existingMethod: string; // M.EXDEP_*
  depreciableNbv: Num; residual: Num; remainingLife: Num;
  enabled: boolean;
}

export interface FaPlan {
  capex: Arr; month: Arr; life: Arr; residualPct: Arr; paid: Arr; transferIn: Arr;
  dispCost: Arr; dispAccDep: Arr; dispProceeds: Arr; dispReceived: Arr; dispDepReduce: Arr;
  impairment: Arr; manualDep: Arr;
}

export interface Loan {
  id: string; name: string; type: 'short' | 'long';
  baseBalance: Num;
  rate: Arr; draw: Arr; drawMonth: Arr; repay: Arr; repayMonth: Arr; accruedMonths: Arr;
  nextRepay: Num;
}

export interface OtherAssump { method: SArr; param: Arr; cf: CfClass; confirmed: boolean }

export interface Assumptions {
  growth: Arr;
  gm: Arr;
  depIncluded: SArr;
  depCogsShare: Arr;
  opex: Record<string, Arr>;
  ar: { method: SArr; param: Arr };
  inv: { method: SArr; param: Arr };
  ap: { method: SArr; param: Arr; basis: SArr };
  others: Record<string, OtherAssump>; // IS 與 BS 之 other 科目
  tax: { method: SArr; rate: Arr; adj: Arr; manual: Arr; provisionalPct: Arr; baseNol: Num };
  equity: { capPar: Arr; capPremium: Arr; dividend: Arr; divPaidPct: Arr; oci: Arr };
}

export interface Scenario {
  id: string;
  name: string;
  a: Assumptions;
  fa: Record<string, FaPlan>;
  loans: Loan[];
  overrides: Record<string, Record<number, number>>; // rowId -> 預估年度索引(0..N-1) -> 值
}

export interface NoteSection { id: string; title: string; body: string }

export interface BankSettings {
  titles: Record<string, string>;
  periodText: Record<string, string>;
  labels: Record<string, string>; // rowId -> 自訂科目名稱
  notes: NoteSection[];
  acks: Record<string, boolean>;
  reviewer: string;
}

export interface LogEntry { at: string; scenario?: string; action: string; detail: string }
export interface Version { id: string; label: string; at: string; snapshot: string }

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  customAccounts: AccountDef[];
  imports: RawImport[];
  base: YearData;
  comparatives: YearData[];
  faBase: Record<string, FaBase>;
  faNature: 'gross' | 'net' | null; // 基期餘額性質確認
  scenarios: Scenario[];
  activeScenarioId: string;
  bank: BankSettings;
  versions: Version[];
  log: LogEntry[];
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const arr = (n: number, v: Num = null): Arr => Array.from({ length: n }, () => v);
export const sarr = (n: number, v: string | null = null): SArr => Array.from({ length: n }, () => v);

export function emptyYear(year: number): YearData {
  return { year, accounts: {}, manual: {}, lines: [], importIds: [], cfActual: {}, sceActual: {} };
}

export function emptyFaPlan(n: number): FaPlan {
  const z = () => arr(n);
  return { capex: z(), month: z(), life: z(), residualPct: z(), paid: z(), transferIn: z(), dispCost: z(), dispAccDep: z(), dispProceeds: z(), dispReceived: z(), dispDepReduce: z(), impairment: z(), manualDep: z() };
}

export function emptyLoan(n: number, name = '新借款', type: 'short' | 'long' = 'long'): Loan {
  return { id: uid(), name, type, baseBalance: null, rate: arr(n), draw: arr(n), drawMonth: arr(n), repay: arr(n), repayMonth: arr(n), accruedMonths: arr(n, 0), nextRepay: null };
}

export function defaultAssumptions(n: number): Assumptions {
  return {
    growth: arr(n),
    gm: arr(n),
    depIncluded: sarr(n, M.DEP_IN),
    depCogsShare: arr(n),
    opex: {},
    ar: { method: sarr(n, M.WC_DAYS), param: arr(n) },
    inv: { method: sarr(n, M.WC_DAYS), param: arr(n) },
    ap: { method: sarr(n, M.WC_DAYS), param: arr(n), basis: sarr(n, M.AP_PURCH) },
    others: {},
    tax: { method: sarr(n, M.TAX_RATE), rate: arr(n, 0.2), adj: arr(n, 0), manual: arr(n), provisionalPct: arr(n, 0.5), baseNol: 0 },
    equity: { capPar: arr(n, 0), capPremium: arr(n, 0), dividend: arr(n, 0), divPaidPct: arr(n, 1), oci: arr(n, 0) },
  };
}

export function newProject(name: string, baseYear: number): Project {
  const n = 5;
  const sc: Scenario = { id: uid(), name: '基本情境', a: defaultAssumptions(n), fa: {}, loans: [], overrides: {} };
  const now = new Date().toISOString();
  const faBase: Record<string, FaBase> = {};
  for (const c of FA_CLASSES) faBase[c.key] = { cost: null, accDep: null, accImp: null, nbv: null, existingMethod: M.EXDEP_EST, depreciableNbv: null, residual: null, remainingLife: null, enabled: false };
  return {
    id: uid(), name, createdAt: now, updatedAt: now,
    settings: {
      companyName: name, taxId: '', baseYear, fyEnd: '12-31', years: n, currency: 'TWD', unit: 'yuan',
      cashThreshold: 20_000_000, defaultMonth: 7, daysBasis: 365, interestPaidClass: 'operating',
      depExpenseLine: 'admin_exp', ociAccount: null,
      standards: Array.from({ length: n + 1 }, (_, i) => ({ year: baseYear + i, version: '企業會計準則公報（EAS）（請填入適用之修正版本）', effectiveDate: '' })),
      advanced: { lease: false, fx: false, related: false },
    },
    customAccounts: [], imports: [], base: emptyYear(baseYear), comparatives: [],
    faBase, faNature: null,
    scenarios: [sc], activeScenarioId: sc.id,
    bank: { titles: {}, periodText: {}, labels: {}, notes: [{ id: uid(), title: '一、公司沿革及業務範圍', body: '' }, { id: uid(), title: '二、重大會計政策之彙總說明', body: '' }, { id: uid(), title: '三、財務預測之基本假設', body: '' }], acks: {}, reviewer: '' },
    versions: [], log: [{ at: now, action: '建立專案', detail: name }],
  };
}

// 基期科目金額（手動輸入優先）
export function yearAmount(y: YearData, code: string): Num {
  if (code in y.manual && y.manual[code] !== null && y.manual[code] !== undefined) return y.manual[code];
  return code in y.accounts ? y.accounts[code] : null;
}

export function recomputeYearAccounts(y: YearData) {
  const acc: Record<string, Num> = {};
  for (const l of y.lines) {
    if (l.kind !== 'detail' || !l.account || l.amount === null) continue;
    acc[l.account] = (acc[l.account] ?? 0) + l.amount;
  }
  y.accounts = acc;
}

// 調整陣列長度（變更預估年數）
export function resizeProject(p: Project, n: number) {
  const fix = (a: any[]) => { while (a.length < n) { const last = a[a.length - 1]; a.push(typeof last === 'string' ? last : null); } a.length = n; };
  const walk = (o: any) => {
    if (Array.isArray(o)) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v) && (v.length === 0 || typeof v[0] !== 'object' || v[0] === null)) fix(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const sc of p.scenarios) {
    walk(sc.a); for (const k in sc.fa) walk(sc.fa[k]); sc.loans.forEach(walk);
    for (const rid in sc.overrides) for (const i in sc.overrides[rid]) if (+i >= n) delete sc.overrides[rid][i];
  }
  p.settings.years = n;
  const st = p.settings.standards;
  for (let i = 0; i <= n; i++) if (!st.find((s) => s.year === p.settings.baseYear + i)) st.push({ year: p.settings.baseYear + i, version: st[st.length - 1]?.version ?? '', effectiveDate: '' });
  st.sort((a, b) => a.year - b.year);
}

// 依基期資料補齊情境預設（費用率啟用、其他科目方法、借款 stub、固定資產類別）
export function syncScenarioWithBase(p: Project, sc: Scenario) {
  const n = p.settings.years;
  const base = p.base;
  const has = (c: string) => { const v = yearAmount(base, c); return v !== null && v !== 0; };
  for (const c of ['sell_exp', 'admin_exp', 'rd_exp', 'other_opex']) if ((has(c) || p.customAccounts.some((a) => a.code === c)) && !sc.a.opex[c]) sc.a.opex[c] = arr(n);
  const others = [...DEFAULT_COA, ...p.customAccounts].filter((a) => a.role === 'other');
  for (const a of others) {
    const relevant = has(a.code) || a.custom || p.comparatives.some((y) => { const v = yearAmount(y, a.code); return v !== null && v !== 0; });
    if (relevant && !sc.a.others[a.code]) {
      const isBS = a.stmt === 'BS';
      sc.a.others[a.code] = { method: sarr(n, isBS ? M.HOLD : null), param: arr(n), cf: a.cf ?? 'operating', confirmed: false };
    }
  }
  for (const c of FA_CLASSES) { if (!sc.fa[c.key]) sc.fa[c.key] = emptyFaPlan(n); }
  const st = yearAmount(base, 'st_loan') ?? 0;
  const lt = (yearAmount(base, 'ltd') ?? 0) + (yearAmount(base, 'ltd_cur') ?? 0);
  if (sc.loans.length === 0) {
    if (st) { const l = emptyLoan(n, '既有短期借款', 'short'); l.baseBalance = st; sc.loans.push(l); }
    if (lt) { const l = emptyLoan(n, '既有長期借款', 'long'); l.baseBalance = lt; sc.loans.push(l); }
  }
}

export function accountName(p: Project, code: string) {
  return findAccount(code, p.customAccounts)?.name ?? code;
}

export function cloneScenario(sc: Scenario, name: string): Scenario {
  const c: Scenario = JSON.parse(JSON.stringify(sc));
  c.id = uid(); c.name = name;
  return c;
}
