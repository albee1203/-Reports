// 依專案＋情境建立計算圖：假設 → 排程 → 四大報表 → 勾稽
import {
  Cell, Column, Expr, Graph, Row, RowFormat, Value,
  add, div, eq, fn, iff, makeGraph, max, min, mul, n, neg, r, range, s, sub, sum, cmp,
} from './graph';
import { AccountDef, FA_CLASSES, allAccounts } from './coa';
import { M, Project, Scenario, YearData, yearAmount, Num } from './project';

export const SH = {
  cover: '封面及說明',
  assump: '假設及計算依據',
  base: '基期資料',
  raw: '原始匯入資料',
  rev: '營收成本費用',
  wc: '營運資金',
  oth: '其他科目',
  fa: '固定資產',
  fad: '固定資產明細',
  ratio: '財務比率',
  loan: '借款',
  taxeq: '所得稅及權益',
  is: '綜合損益表',
  bs: '資產負債表',
  sce: '權益變動表',
  cf: '現金流量表',
  ck: '勾稽檢查',
  notes: '附註',
} as const;

export const STATEMENT_SHEETS = [SH.is, SH.bs, SH.sce, SH.cf];

const NA = (note = '未提供'): Cell => ({ kind: 'na', note });
const F = (e: Expr): Cell => ({ kind: 'formula', expr: e });
const ACT = (v: Num, note?: string): Cell => (v === null ? { kind: 'na', note: note ?? '未提供' } : { kind: 'actual', value: v });

type CellFn = (col: number, i: number) => Expr | Cell | null;

export interface ModelInfo {
  cb: number; // 基期欄索引
  N: number;
  fcols: number[];
  otherIS: AccountDef[];
  otherBS: AccountDef[];
  faClasses: typeof FA_CLASSES;
  loanIds: string[];
}

export function buildGraph(p: Project, sc: Scenario): { g: Graph; info: ModelInfo } {
  const st = p.settings;
  const N = st.years;
  const comps = [...p.comparatives].sort((a, b) => a.year - b.year);
  const columns: Column[] = [
    ...comps.map((y) => ({ key: `C${y.year}`, label: String(y.year), year: y.year, type: 'comparative' as const })),
    { key: `B${st.baseYear}`, label: String(st.baseYear), year: st.baseYear, type: 'base' as const },
    ...Array.from({ length: N }, (_, i) => ({ key: `F${i + 1}`, label: String(st.baseYear + i + 1), year: st.baseYear + i + 1, type: 'forecast' as const })),
  ];
  const ncol = columns.length;
  const cb = comps.length;
  const fcols = Array.from({ length: N }, (_, i) => cb + 1 + i);
  const isF = (c: number) => c > cb;
  const fi = (c: number) => c - cb - 1;
  const years: YearData[] = [...comps, p.base];
  const rows: Row[] = [];
  const A = sc.a;
  const accts = allAccounts(p.customAccounts);

  const addRow = (sheet: string, id: string, label: string, format: RowFormat, cells: (Cell | null)[], extra: Partial<Row> = {}) => {
    const row: Row = { id, sheet, label, format, cells, ...extra };
    rows.push(row);
    return row;
  };
  const toCell = (x: Expr | Cell | null): Cell | null => (x === null ? null : 'kind' in x ? x : F(x));
  // 預估欄公式＋基期欄（及比較欄）設定
  const frow = (sheet: string, id: string, label: string, format: RowFormat, f: CellFn, opt: { base?: CellFn; comp?: CellFn } & Partial<Row> = {}) => {
    const { base, comp, ...extra } = opt;
    const cells: (Cell | null)[] = [];
    for (let c = 0; c < ncol; c++) {
      if (isF(c)) cells.push(toCell(f(c, fi(c))));
      else if (c === cb) cells.push(base ? toCell(base(c, -1)) : null);
      else cells.push(comp ? toCell(comp(c, -1)) : null);
    }
    return addRow(sheet, id, label, format, cells, extra);
  };
  // 逐年輸入列
  const irow = (sheet: string, id: string, label: string, format: RowFormat, vals: Value[], path: string, opt: { required?: boolean | ((i: number) => boolean); options?: string[]; base?: CellFn } & Partial<Row> = {}) => {
    const { required, options, base, ...extra } = opt;
    return frow(sheet, id, label, format, (_c, i) => ({
      kind: 'input', value: vals[i] ?? null, required: typeof required === 'function' ? required(i) : !!required, options, inputPath: `${path}.${i}`,
    }), { base, ...extra });
  };
  // 單一數值輸入（置於基期欄）
  const prow = (sheet: string, id: string, label: string, format: RowFormat, v: Value, path: string, opt: { required?: boolean; options?: string[] } & Partial<Row> = {}) => {
    const { required, options, ...extra } = opt;
    const cells: (Cell | null)[] = Array.from({ length: ncol }, () => null);
    cells[cb] = { kind: 'input', value: v, required: !!required, options, inputPath: path };
    return addRow(sheet, id, label, format, cells, extra);
  };
  const prev = (id: string, c: number) => r(id, c - 1);
  const P = (id: string) => r(id, cb); // 參數（基期欄）

  // ===== 基期資料 =====
  const acctRow = (code: string) => `acct:${code}`;
  const usedAccounts = accts.filter((a) => years.some((y) => yearAmount(y, a.code) !== null) || a.role === 'engine' || A.others[a.code]);
  for (const a of accts) {
    const cells: (Cell | null)[] = Array.from({ length: ncol }, () => null);
    years.forEach((y, c) => { const v = yearAmount(y, a.code); cells[c] = v === null ? { kind: 'na', note: '未提供' } : { kind: 'actual', value: v }; });
    addRow(SH.base, acctRow(a.code), a.name, 'amount', cells, { desc: `${a.stmt === 'BS' ? '資產負債表' : '綜合損益表'}／${a.contra ? '減項（以正數儲存）' : ''}`, hidden: !usedAccounts.includes(a) });
  }
  const AC = (code: string, c: number) => r(acctRow(code), c);

  // ===== 專案參數 =====
  prow(SH.assump, 'p:threshold', '年末現金警示門檻', 'amount', st.cashThreshold, 'settings.cashThreshold', { required: true, style: 'normal' });
  prow(SH.assump, 'p:defMonth', '借款／資產可用預設月份（月份留白時採用）', 'month', st.defaultMonth, 'settings.defaultMonth', { required: true });
  prow(SH.assump, 'p:days', '週轉天數計算基礎（天）', 'days', st.daysBasis, 'settings.daysBasis', { required: true });

  // ===== 營收成本費用假設 =====
  const rev0 = (c: number) => AC('revenue', c);
  irow(SH.assump, 'a:growth', '營收成長率', 'pct', A.growth, 'a.growth', {
    required: true,
    base: (c) => (cb > 0 ? div(sub(rev0(c), rev0(c - 1)), rev0(c - 1)) : NA('無前期資料')),
  });
  irow(SH.assump, 'a:gm', '毛利率', 'pct', A.gm, 'a.gm', { required: true, base: (c) => sub(n(1), div(AC('cogs', c), rev0(c))) });
  irow(SH.assump, 'a:depIn', '毛利率／費用率是否已含折舊', 'text', A.depIncluded, 'a.depIncluded', { required: true, options: [M.DEP_IN, M.DEP_EX] });
  irow(SH.assump, 'a:depShare', '折舊分攤至營業成本比率', 'pct', A.depCogsShare, 'a.depCogsShare', { required: true });
  const opexCodes = ['sell_exp', 'admin_exp', 'rd_exp', 'other_opex'].filter((c) => A.opex[c]);
  for (const c of opexCodes) {
    const name = accts.find((a) => a.code === c)!.name;
    irow(SH.assump, `a:opex:${c}`, `${name}占營收比率`, 'pct', A.opex[c], `a.opex.${c}`, { required: true, base: (col) => div(AC(c, col), rev0(col)) });
  }

  // ===== 營運資金假設 =====
  const wcOpts = [M.WC_DAYS, M.WC_PCT];
  irow(SH.assump, 'a:ar_m', '應收帳款預估方法', 'text', A.ar.method, 'a.ar.method', { required: true, options: wcOpts });
  irow(SH.assump, 'a:ar_p', '應收帳款參數（天數或占營收比率）', 'ratio', A.ar.param, 'a.ar.param', {
    required: true, base: (c) => iff(eq(r('a:ar_m', cb + 1), s(M.WC_DAYS)), mul(div(AC('ar', c), rev0(c)), P('p:days')), div(AC('ar', c), rev0(c))),
  });
  irow(SH.assump, 'a:inv_m', '存貨預估方法', 'text', A.inv.method, 'a.inv.method', { required: true, options: wcOpts });
  irow(SH.assump, 'a:inv_p', '存貨參數（天數或占銷貨成本比率）', 'ratio', A.inv.param, 'a.inv.param', {
    required: true, base: (c) => iff(eq(r('a:inv_m', cb + 1), s(M.WC_DAYS)), mul(div(AC('inventory', c), AC('cogs', c)), P('p:days')), div(AC('inventory', c), AC('cogs', c))),
  });
  irow(SH.assump, 'a:ap_m', '應付帳款預估方法', 'text', A.ap.method, 'a.ap.method', { required: true, options: wcOpts });
  irow(SH.assump, 'a:ap_b', '應付帳款計算基礎', 'text', A.ap.basis, 'a.ap.basis', { required: true, options: [M.AP_PURCH, M.AP_COGS] });
  irow(SH.assump, 'a:ap_p', '應付帳款參數（天數或比率）', 'ratio', A.ap.param, 'a.ap.param', {
    required: true, desc: '基期參考值以銷貨成本計算（基期進貨額未知）',
    base: (c) => iff(eq(r('a:ap_m', cb + 1), s(M.WC_DAYS)), mul(div(AC('ap', c), AC('cogs', c)), P('p:days')), div(AC('ap', c), AC('cogs', c))),
  });

  // ===== 其他科目假設 =====
  const otherIS = accts.filter((a) => a.role === 'other' && a.stmt === 'IS' && A.others[a.code]);
  const otherBS = accts.filter((a) => a.role === 'other' && a.stmt === 'BS' && A.others[a.code]);
  for (const a of [...otherIS, ...otherBS]) {
    const o = A.others[a.code];
    const opts = a.code === 'int_income' ? [...[M.MANUAL, M.HOLD, M.GROWTH, M.PCT_REV, M.PCT_COGS], M.CASH_RATE] : [M.MANUAL, M.HOLD, M.GROWTH, M.PCT_REV, M.PCT_COGS];
    irow(SH.assump, `a:om:${a.code}`, `${a.name}－預估方法`, 'text', o.method, `a.others.${a.code}.method`, { required: true, options: opts, desc: a.stmt === 'BS' ? `現金流量分類：${{ operating: '營業', investing: '投資', financing: '籌資' }[o.cf]}` : undefined });
    irow(SH.assump, `a:op:${a.code}`, `${a.name}－參數（金額或比率）`, 'ratio', o.param, `a.others.${a.code}.param`, { required: (i) => o.method[i] !== M.HOLD });
  }

  // ===== 所得稅假設 =====
  irow(SH.assump, 'a:tax_m', '所得稅估算方法', 'text', A.tax.method, 'a.tax.method', { required: true, options: [M.TAX_RATE, M.TAX_MANUAL] });
  irow(SH.assump, 'a:tax_rate', '預估稅率', 'pct', A.tax.rate, 'a.tax.rate', { required: (i) => A.tax.method[i] !== M.TAX_MANUAL });
  irow(SH.assump, 'a:tax_adj', '稅前損益調整（加項為正）', 'amount', A.tax.adj, 'a.tax.adj', {});
  irow(SH.assump, 'a:tax_manual', '手動稅額', 'amount', A.tax.manual, 'a.tax.manual', { required: (i) => A.tax.method[i] === M.TAX_MANUAL });
  irow(SH.assump, 'a:tax_prov', '暫繳比例（占前一年度所得稅費用）', 'pct', A.tax.provisionalPct, 'a.tax.provisionalPct', { required: true });
  prow(SH.assump, 'a:nol0', '基期可扣除虧損餘額', 'amount', A.tax.baseNol, 'a.tax.baseNol', { required: true });

  // ===== 權益假設 =====
  irow(SH.assump, 'a:cap_par', '現金增資－股本（面額）', 'amount', A.equity.capPar, 'a.equity.capPar', { required: true });
  irow(SH.assump, 'a:cap_prem', '現金增資－溢價（資本公積）', 'amount', A.equity.capPremium, 'a.equity.capPremium', { required: true });
  irow(SH.assump, 'a:cap_cash', '增資款當年度收現（空白＝同認列額）', 'amount', A.equity.capCash, 'a.equity.capCash', { desc: '收現早於認列列為預收股本；晚於認列列為應收股款' });
  irow(SH.assump, 'a:div', '宣告現金股利', 'amount', A.equity.dividend, 'a.equity.dividend', { required: true });
  irow(SH.assump, 'a:div_pct', '現金股利當年度支付比例', 'pct', A.equity.divPaidPct, 'a.equity.divPaidPct', { required: true });
  irow(SH.assump, 'a:oci', '其他綜合損益（稅後）', 'amount', A.equity.oci, 'a.equity.oci', { required: true, desc: st.ociAccount ? `對應科目：${accts.find((a) => a.code === st.ociAccount)?.name}` : '未指定對應科目（非零時資產負債表將不平衡）' });

  // ===== 固定資產 =====
  const faClasses = FA_CLASSES.filter((c) => p.faBase[c.key]?.enabled);
  const fa = (k: string, f: string) => `f:${k}:${f}`;
  for (const cl of faClasses) {
    const b = p.faBase[cl.key];
    const pl = sc.fa[cl.key];
    const path = `fa.${cl.key}`;
    const nm = cl.name;
    // 逐筆資產明細（有匯入明細之類別，既有資產折舊依明細計算）
    const assets = (p.faAssets ?? []).filter((x) => x.cls === cl.key);
    const detail = assets.length > 0;
    for (const x of assets) {
      const d = (f: string) => `d:${x.id}:${f}`;
      const ap = `faAssets.${x.id}`;
      addRow(SH.fad, d('hdr'), `【${nm}】${x.name}${x.acquired ? `（取得 ${x.acquired}）` : ''}`, 'text', Array(ncol).fill(null), { style: 'header' });
      prow(SH.fad, d('cost'), `${x.name}－原始成本`, 'amount', x.cost, `${ap}.cost`, { required: true });
      prow(SH.fad, d('acc'), `${x.name}－累計折舊`, 'amount', x.accDep, `${ap}.accDep`, {});
      prow(SH.fad, d('imp'), `${x.name}－累計減損`, 'amount', x.accImp, `${ap}.accImp`, {});
      if (cl.depreciable) {
        prow(SH.fad, d('resid'), `${x.name}－殘值`, 'amount', x.residual, `${ap}.residual`, {});
        prow(SH.fad, d('rlife'), `${x.name}－剩餘耐用年限（年）`, 'years', x.remLife, `${ap}.remLife`, { required: (x.cost ?? 0) - (x.accDep ?? 0) - (x.accImp ?? 0) - (x.residual ?? 0) > 0.5, desc: x.remLifeNote });
        frow(SH.fad, d('dep'), `${x.name}－折舊`, 'amount', (c) => {
          const depBase = sub(sub(sub(P(d('cost')), P(d('acc'))), P(d('imp'))), P(d('resid')));
          const remaining = c === cb + 1 ? depBase : sub(depBase, range(d('dep'), cb + 1, c - 1));
          return max(n(0), min(div(depBase, P(d('rlife'))), remaining));
        }, { desc: '(成本−累計折舊−累計減損−殘值)÷剩餘耐用年限，直線法' });
      }
    }
    const dsum = (f: string, c: number) => add(...assets.map((x) => r(`d:${x.id}:${f}`, c)));
    addRow(SH.fa, `f:${cl.key}:hdr`, `【${nm}】`, 'text', Array(ncol).fill(null), { style: 'header' });
    irow(SH.fa, fa(cl.key, 'capex'), `${nm}－資本支出認列額`, 'amount', pl.capex, `${path}.capex`, {});
    irow(SH.fa, fa(cl.key, 'paid'), `${nm}－資本支出付款額（空白＝同認列額）`, 'amount', pl.paid, `${path}.paid`, {});
    if (!cl.cip) irow(SH.fa, fa(cl.key, 'tin'), `${nm}－由在建工程轉入`, 'amount', pl.transferIn, `${path}.transferIn`, {});
    if (cl.depreciable) {
      const hasAdd = (i: number) => (pl.capex[i] ?? 0) + (pl.transferIn[i] ?? 0) > 0;
      irow(SH.fa, fa(cl.key, 'month'), `${nm}－可供使用月份（空白＝預設月份）`, 'month', pl.month, `${path}.month`, {});
      irow(SH.fa, fa(cl.key, 'life'), `${nm}－耐用年限（年）`, 'years', pl.life, `${path}.life`, { required: hasAdd });
      irow(SH.fa, fa(cl.key, 'res'), `${nm}－殘值率`, 'pct', pl.residualPct, `${path}.residualPct`, { required: hasAdd });
      frow(SH.fa, fa(cl.key, 'meff'), `${nm}－採用月份`, 'month', (c) => iff(fn('ISBLANK', r(fa(cl.key, 'month'), c)), P('p:defMonth'), r(fa(cl.key, 'month'), c)));
    }
    irow(SH.fa, fa(cl.key, 'dcost'), `${nm}－處分／報廢除列成本`, 'amount', pl.dispCost, `${path}.dispCost`, {});
    irow(SH.fa, fa(cl.key, 'dacc'), `${nm}－處分除列累計折舊`, 'amount', pl.dispAccDep, `${path}.dispAccDep`, {});
    irow(SH.fa, fa(cl.key, 'dproc'), `${nm}－處分價款`, 'amount', pl.dispProceeds, `${path}.dispProceeds`, {});
    irow(SH.fa, fa(cl.key, 'drecv'), `${nm}－處分當年度收現（空白＝同價款）`, 'amount', pl.dispReceived, `${path}.dispReceived`, {});
    if (cl.depreciable) irow(SH.fa, fa(cl.key, 'dred'), `${nm}－處分後減少之折舊`, 'amount', pl.dispDepReduce, `${path}.dispDepReduce`, {});
    irow(SH.fa, fa(cl.key, 'imp'), `${nm}－減損損失`, 'amount', pl.impairment, `${path}.impairment`, {});
    if (cl.depreciable && detail) {
      frow(SH.fa, fa(cl.key, 'exdep'), `${nm}－既有資產折舊（逐筆明細合計）`, 'amount', (c) => dsum('dep', c), { desc: `依「${SH.fad}」${assets.length} 筆資產計算` });
    }
    if (cl.depreciable && !detail) {
      prow(SH.fa, fa(cl.key, 'exm'), `${nm}－既有資產折舊方式`, 'text', b.existingMethod, `faBase.${cl.key}.existingMethod`, { required: true, options: [M.EXDEP_EST, M.EXDEP_MANUAL] });
      const est = b.existingMethod === M.EXDEP_EST;
      prow(SH.fa, fa(cl.key, 'dnbv'), `${nm}－既有資產可折舊淨額（經確認）`, 'amount', b.depreciableNbv, `faBase.${cl.key}.depreciableNbv`, { required: est, desc: '概估' });
      prow(SH.fa, fa(cl.key, 'resid'), `${nm}－既有資產殘值`, 'amount', b.residual, `faBase.${cl.key}.residual`, { required: est });
      prow(SH.fa, fa(cl.key, 'rlife'), `${nm}－既有資產剩餘耐用年限（年）`, 'years', b.remainingLife, `faBase.${cl.key}.remainingLife`, { required: est });
      irow(SH.fa, fa(cl.key, 'mdep'), `${nm}－既有資產折舊（逐年手動）`, 'amount', pl.manualDep, `${path}.manualDep`, { required: !est });
      frow(SH.fa, fa(cl.key, 'exdep'), `${nm}－既有資產折舊`, 'amount', (c) => {
        const depBase = sub(P(fa(cl.key, 'dnbv')), P(fa(cl.key, 'resid')));
        const annual = div(depBase, P(fa(cl.key, 'rlife')));
        const remaining = c === cb + 1 ? depBase : sub(depBase, range(fa(cl.key, 'exdep'), cb + 1, c - 1));
        return iff(eq(P(fa(cl.key, 'exm')), s(M.EXDEP_MANUAL)), r(fa(cl.key, 'mdep'), c), max(n(0), min(annual, remaining)));
      }, { desc: est ? '估算＝(可折舊淨額−殘值)÷剩餘耐用年限，概估' : '逐年手動輸入' });
    }
    if (cl.depreciable) {
      // 新增資產（各年度取得之批次）
      for (let k = 0; k < N; k++) {
        const ck = cb + 1 + k;
        const depBase = mul(add(r(fa(cl.key, 'capex'), ck), r(fa(cl.key, 'tin'), ck)), sub(n(1), r(fa(cl.key, 'res'), ck)));
        const annual = div(depBase, r(fa(cl.key, 'life'), ck));
        const lid = fa(cl.key, `L${k + 1}`);
        frow(SH.fa, lid, `${nm}－第${k + 1}年度（${st.baseYear + k + 1}）新增資產折舊`, 'amount', (c, i) => {
          if (i < k) return n(0);
          if (i === k) return min(div(mul(annual, sub(n(13), r(fa(cl.key, 'meff'), ck))), n(12)), depBase);
          return max(n(0), min(annual, sub(depBase, range(lid, ck, c - 1))));
        }, { desc: '直線法；取得年度依可用月份計提（13−月份）/12' });
      }
      frow(SH.fa, fa(cl.key, 'dep'), `${nm}－折舊合計`, 'amount', (c) =>
        sub(add(r(fa(cl.key, 'exdep'), c), ...Array.from({ length: N }, (_, k) => r(fa(cl.key, `L${k + 1}`), c))), r(fa(cl.key, 'dred'), c)), { style: 'subtotal', overridable: true });
    }
    const baseIn = (v: Num, pth: string): CellFn => () => ({ kind: 'input', value: v, inputPath: pth });
    const nature = p.faNature === 'net';
    frow(SH.fa, fa(cl.key, 'cost'), `${nm}－成本${nature ? '（僅淨額，以淨額列示）' : ''}`, 'amount', (c) => {
      if (cl.cip) return sub(add(prev(fa(cl.key, 'cost'), c), r(fa(cl.key, 'capex'), c)), add(...faClasses.filter((x) => !x.cip).map((x) => r(fa(x.key, 'tin'), c))));
      return sub(add(prev(fa(cl.key, 'cost'), c), r(fa(cl.key, 'capex'), c), r(fa(cl.key, 'tin'), c)), r(fa(cl.key, 'dcost'), c));
    }, { base: detail ? (c) => dsum('cost', c) : baseIn(nature ? b.nbv : b.cost, `faBase.${cl.key}.${nature ? 'nbv' : 'cost'}`) });
    frow(SH.fa, fa(cl.key, 'accdep'), `${nm}－累計折舊`, 'amount', (c) =>
      sub(add(prev(fa(cl.key, 'accdep'), c), cl.depreciable ? r(fa(cl.key, 'dep'), c) : n(0)), r(fa(cl.key, 'dacc'), c)), { base: detail ? (c) => dsum('acc', c) : nature ? () => n(0) : baseIn(b.accDep, `faBase.${cl.key}.accDep`) });
    frow(SH.fa, fa(cl.key, 'accimp'), `${nm}－累計減損`, 'amount', (c) => add(prev(fa(cl.key, 'accimp'), c), r(fa(cl.key, 'imp'), c)), { base: detail ? (c) => dsum('imp', c) : nature ? () => n(0) : baseIn(b.accImp, `faBase.${cl.key}.accImp`) });
    frow(SH.fa, fa(cl.key, 'nbv'), `${nm}－帳面淨額`, 'amount', (c) => sub(sub(r(fa(cl.key, 'cost'), c), r(fa(cl.key, 'accdep'), c)), r(fa(cl.key, 'accimp'), c)), { base: (c) => sub(sub(r(fa(cl.key, 'cost'), c), r(fa(cl.key, 'accdep'), c)), r(fa(cl.key, 'accimp'), c)), style: 'subtotal' });
    frow(SH.fa, fa(cl.key, 'gain'), `${nm}－處分損益`, 'amount', (c) => sub(r(fa(cl.key, 'dproc'), c), sub(r(fa(cl.key, 'dcost'), c), r(fa(cl.key, 'dacc'), c))));
    frow(SH.fa, fa(cl.key, 'paidEff'), `${nm}－資本支出實際付款`, 'amount', (c) => iff(fn('ISBLANK', r(fa(cl.key, 'paid'), c)), r(fa(cl.key, 'capex'), c), r(fa(cl.key, 'paid'), c)));
    frow(SH.fa, fa(cl.key, 'recvEff'), `${nm}－處分實際收現`, 'amount', (c) => iff(fn('ISBLANK', r(fa(cl.key, 'drecv'), c)), r(fa(cl.key, 'dproc'), c), r(fa(cl.key, 'drecv'), c)));
  }
  const faSum = (f: string, c: number, filter = (_x: typeof FA_CLASSES[number]) => true) => add(...faClasses.filter(filter).map((x) => r(fa(x.key, f), c)));
  addRow(SH.fa, 'f:hdr_total', '【合計】', 'text', Array(ncol).fill(null), { style: 'header' });
  frow(SH.fa, 'f:dep', '折舊費用合計', 'amount', (c) => faSum('dep', c, (x) => x.depreciable), { style: 'total' });
  frow(SH.fa, 'f:capex', '資本支出認列合計', 'amount', (c) => faSum('capex', c));
  frow(SH.fa, 'f:paid', '資本支出付款合計', 'amount', (c) => faSum('paidEff', c));
  frow(SH.fa, 'f:imp', '減損損失合計', 'amount', (c) => faSum('imp', c));
  frow(SH.fa, 'f:gain', '處分損益合計', 'amount', (c) => faSum('gain', c));
  frow(SH.fa, 'f:dproc', '處分價款合計', 'amount', (c) => faSum('dproc', c));
  frow(SH.fa, 'f:dnbv_out', '處分除列帳面淨額合計', 'amount', (c) => sub(faSum('dcost', c), faSum('dacc', c)));
  frow(SH.fa, 'f:recv', '處分收現合計', 'amount', (c) => faSum('recvEff', c));
  frow(SH.fa, 'f:nbv', '不動產、廠房及設備淨額', 'amount', (c) => faSum('nbv', c), { base: (c) => faSum('nbv', c), style: 'total' });
  frow(SH.fa, 'f:equip_pay', '應付設備款', 'amount', (c) => sub(add(prev('f:equip_pay', c), r('f:capex', c)), r('f:paid', c)), { base: (c) => AC('equip_pay', c) });
  frow(SH.fa, 'f:disp_rec', '應收處分資產款', 'amount', (c) => sub(add(prev('f:disp_rec', c), r('f:dproc', c)), r('f:recv', c)), { base: (c) => AC('disposal_rec', c) });

  // ===== 營收成本費用 =====
  frow(SH.rev, 'c:rev', '營業收入', 'amount', (c) => mul(prev('c:rev', c), add(n(1), r('a:growth', c))), { base: (c) => AC('revenue', c), overridable: true, desc: '前一年度營收 ×（1＋成長率）' });
  frow(SH.rev, 'c:dep_cogs', '折舊－歸屬營業成本', 'amount', (c) => mul(r('f:dep', c), r('a:depShare', c)));
  frow(SH.rev, 'c:dep_opex', '折舊－歸屬營業費用', 'amount', (c) => sub(r('f:dep', c), r('c:dep_cogs', c)));
  const depEx = (c: number) => eq(r('a:depIn', c), s(M.DEP_EX));
  frow(SH.rev, 'c:cogs', '營業成本', 'amount', (c) => {
    const core = mul(r('c:rev', c), sub(n(1), r('a:gm', c)));
    return iff(depEx(c), add(core, r('c:dep_cogs', c)), core);
  }, { base: (c) => AC('cogs', c), overridable: true, desc: '營收 ×（1−毛利率）；未含折舊時另加歸屬營業成本之折舊' });
  frow(SH.rev, 'c:cogs_exdep', '營業成本（不含折舊）', 'amount', (c) => sub(r('c:cogs', c), r('c:dep_cogs', c)));
  frow(SH.rev, 'c:gp', '營業毛利', 'amount', (c) => sub(r('c:rev', c), r('c:cogs', c)), { base: (c) => sub(AC('revenue', c), AC('cogs', c)), style: 'subtotal' });
  frow(SH.rev, 'c:gm_eff', '報表毛利率', 'pct', (c) => div(r('c:gp', c), r('c:rev', c)), { base: (c) => div(r('c:gp', c), r('c:rev', c)) });
  const depLine = opexCodes.includes(st.depExpenseLine) ? st.depExpenseLine : opexCodes[0];
  for (const c of opexCodes) {
    const name = accts.find((a) => a.code === c)!.name;
    frow(SH.rev, `c:opex:${c}`, name, 'amount', (col) => {
      const core = mul(r('c:rev', col), r(`a:opex:${c}`, col));
      return c === depLine ? iff(depEx(col), add(core, r('c:dep_opex', col)), core) : core;
    }, { base: (col) => AC(c, col), overridable: true, desc: `營收 × 費用率${c === depLine ? '；未含折舊時另加歸屬營業費用之折舊' : ''}` });
  }
  frow(SH.rev, 'c:opex_total', '營業費用合計', 'amount', (c) => add(...opexCodes.map((x) => r(`c:opex:${x}`, c))), { base: (c) => add(...opexCodes.map((x) => r(`c:opex:${x}`, c))), style: 'subtotal' });
  // 其他損益科目
  const methodExpr = (id: string, code: string, c: number, extra?: Expr) => {
    const m = r(`a:om:${code}`, c), p_ = r(`a:op:${code}`, c), pv = prev(id, c);
    const tail = code === 'int_income' ? iff(eq(m, s(M.CASH_RATE)), mul(r('bs:cash', c - 1), p_), n(0)) : n(0);
    let e: Expr = iff(eq(m, s(M.MANUAL)), p_, iff(eq(m, s(M.HOLD)), pv, iff(eq(m, s(M.GROWTH)), mul(pv, add(n(1), p_)), iff(eq(m, s(M.PCT_REV)), mul(r('c:rev', c), p_), iff(eq(m, s(M.PCT_COGS)), mul(r('c:cogs', c), p_), tail)))));
    if (extra) e = add(e, extra);
    return e;
  };
  for (const a of otherIS) {
    frow(SH.rev, `c:oth:${a.code}`, a.code === 'other_gl' ? `${a.name}（不含資產處分及減損）` : a.name, 'amount', (c) => methodExpr(`c:oth:${a.code}`, a.code, c), { base: (c) => AC(a.code, c), overridable: true });
  }
  frow(SH.rev, 'c:other_gl', '其他利益及損失（含資產處分損益及減損）', 'amount', (c) => add(otherIS.some((a) => a.code === 'other_gl') ? r('c:oth:other_gl', c) : n(0), r('f:gain', c), neg(r('f:imp', c))), { base: (c) => AC('other_gl', c) });

  // ===== 營運資金 =====
  const wc = (id: string, label: string, m: string, p_: string, baseFn: (c: number) => Expr, code: string, desc: string) =>
    frow(SH.wc, id, label, 'amount', (c) => iff(eq(r(m, c), s(M.WC_DAYS)), div(mul(baseFn(c), r(p_, c)), P('p:days')), mul(baseFn(c), r(p_, c))), { base: (c) => AC(code, c), overridable: true, desc });
  wc('w:ar', '應收帳款', 'a:ar_m', 'a:ar_p', (c) => r('c:rev', c), 'ar', '基礎：營業收入');
  wc('w:inv', '存貨', 'a:inv_m', 'a:inv_p', (c) => r('c:cogs', c), 'inventory', '基礎：營業成本');
  frow(SH.wc, 'w:purch', '進貨額（推估）', 'amount', (c) => add(r('c:cogs_exdep', c), sub(r('w:inv', c), r('w:inv', c - 1))), { desc: '營業成本（不含折舊）＋期末存貨−期初存貨' });
  frow(SH.wc, 'w:ap_base', '應付帳款計算基礎金額', 'amount', (c) => iff(eq(r('a:ap_b', c), s(M.AP_PURCH)), r('w:purch', c), r('c:cogs', c)));
  wc('w:ap', '應付帳款', 'a:ap_m', 'a:ap_p', (c) => r('w:ap_base', c), 'ap', '基礎：進貨額；選「銷貨成本」時為概估');

  // ===== 其他資產負債科目 =====
  const ociAcc = st.ociAccount && otherBS.find((a) => a.code === st.ociAccount) ? st.ociAccount : null;
  const isDebit = (a: AccountDef) => (['CA', 'NCA'].includes(a.section) ? !a.contra : !!a.contra);
  for (const a of otherBS) {
    frow(SH.oth, `o:${a.code}`, a.name, 'amount', (c) => {
      const base = methodExpr(`o:${a.code}`, a.code, c);
      if (a.code !== ociAcc) return base;
      return isDebit(a) ? add(base, r('a:oci', c)) : sub(base, r('a:oci', c));
    }, { base: (c) => AC(a.code, c), overridable: true, desc: `${a.code === ociAcc ? '含其他綜合損益；' : ''}現金流量：${{ operating: '營業', investing: '投資', financing: '籌資' }[A.others[a.code].cf]}` });
  }

  // ===== 借款 =====
  const loans = sc.loans;
  for (const L of loans) {
    const id = (f: string) => `l:${L.id}:${f}`;
    const path = `loans.${L.id}`;
    const nm = L.name;
    addRow(SH.loan, id('hdr'), `【${nm}】（${L.type === 'short' ? '短期' : '長期'}）`, 'text', Array(ncol).fill(null), { style: 'header' });
    irow(SH.loan, id('rate'), `${nm}－年利率`, 'pct', L.rate, `${path}.rate`, { required: true });
    irow(SH.loan, id('draw'), `${nm}－新增借款`, 'amount', L.draw, `${path}.draw`, {});
    irow(SH.loan, id('dm'), `${nm}－新增借款月份（空白＝預設月份）`, 'month', L.drawMonth, `${path}.drawMonth`, {});
    irow(SH.loan, id('repay'), `${nm}－還款`, 'amount', L.repay, `${path}.repay`, {});
    irow(SH.loan, id('rm'), `${nm}－還款月份（空白＝預設月份）`, 'month', L.repayMonth, `${path}.repayMonth`, {});
    irow(SH.loan, id('acm'), `${nm}－年末應付利息月數`, 'month', L.accruedMonths, `${path}.accruedMonths`, { required: true });
    frow(SH.loan, id('dme'), `${nm}－採用借款月份`, 'month', (c) => iff(fn('ISBLANK', r(id('dm'), c)), P('p:defMonth'), r(id('dm'), c)));
    frow(SH.loan, id('rme'), `${nm}－採用還款月份`, 'month', (c) => iff(fn('ISBLANK', r(id('rm'), c)), P('p:defMonth'), r(id('rm'), c)));
    frow(SH.loan, id('bal'), `${nm}－期末餘額`, 'amount', (c) => sub(add(prev(id('bal'), c), r(id('draw'), c)), r(id('repay'), c)), {
      base: () => ({ kind: 'input', value: L.baseBalance, required: true, inputPath: `${path}.baseBalance` }), style: 'subtotal',
    });
    frow(SH.loan, id('int'), `${nm}－利息費用`, 'amount', (c) => {
      const rt = r(id('rate'), c);
      return sub(add(mul(prev(id('bal'), c), rt), div(mul(r(id('draw'), c), rt, sub(n(13), r(id('dme'), c))), n(12))), div(mul(r(id('repay'), c), rt, sub(n(13), r(id('rme'), c))), n(12)));
    }, { overridable: true, desc: '期初餘額×利率＋新增×利率×(13−月份)/12−還款×利率×(13−月份)/12' });
    frow(SH.loan, id('ipay'), `${nm}－年末應付利息`, 'amount', (c) => div(mul(r(id('bal'), c), r(id('rate'), c), r(id('acm'), c)), n(12)));
    if (L.type === 'long') {
      const cells: (Cell | null)[] = Array(ncol).fill(null);
      cells[cb + N] = { kind: 'input', value: L.nextRepay, required: true, inputPath: `${path}.nextRepay` };
      addRow(SH.loan, id('next'), `${nm}－最末預估年度之次年度到期還款`, 'amount', cells);
      frow(SH.loan, id('cur'), `${nm}－一年內到期部分`, 'amount', (c, i) => min(r(id('bal'), c), i < N - 1 ? r(id('repay'), c + 1) : r(id('next'), c)));
    }
    frow(SH.loan, id('excess'), `${nm}－還款超過可還餘額`, 'amount', (c) => max(n(0), sub(r(id('repay'), c), add(prev(id('bal'), c), r(id('draw'), c)))));
  }
  const lsum = (f: string, c: number, flt = (_: typeof loans[number]) => true) => add(...loans.filter(flt).map((L) => r(`l:${L.id}:${f}`, c)));
  addRow(SH.loan, 'l:hdr_total', '【合計】', 'text', Array(ncol).fill(null), { style: 'header' });
  frow(SH.loan, 'l:short', '短期借款合計', 'amount', (c) => lsum('bal', c, (L) => L.type === 'short'), { base: (c) => lsum('bal', c, (L) => L.type === 'short') });
  frow(SH.loan, 'l:long_cur', '長期借款－一年內到期', 'amount', (c) => lsum('cur', c, (L) => L.type === 'long'));
  frow(SH.loan, 'l:long_nc', '長期借款－非流動', 'amount', (c) => sub(lsum('bal', c, (L) => L.type === 'long'), r('l:long_cur', c)));
  frow(SH.loan, 'l:long_total', '長期借款合計', 'amount', (c) => lsum('bal', c, (L) => L.type === 'long'), { base: (c) => lsum('bal', c, (L) => L.type === 'long') });
  frow(SH.loan, 'l:draw', '新增借款合計', 'amount', (c) => lsum('draw', c));
  frow(SH.loan, 'l:repay', '償還借款合計', 'amount', (c) => lsum('repay', c));
  frow(SH.loan, 'l:int', '利息費用合計', 'amount', (c) => lsum('int', c), { style: 'subtotal' });
  frow(SH.loan, 'l:ipay', '應付利息合計', 'amount', (c) => lsum('ipay', c), { base: (c) => AC('int_pay', c) });
  frow(SH.loan, 'l:ipaid', '實際付息', 'amount', (c) => sub(add(r('l:int', c), prev('l:ipay', c)), r('l:ipay', c)), { desc: '利息費用＋期初應付利息−期末應付利息' });
  frow(SH.loan, 'l:excess', '還款超過可還餘額合計', 'amount', (c) => lsum('excess', c));

  // ===== 綜合損益表 =====
  const isRow = (id: string, label: string, f: (c: number) => Expr, opt: Partial<Row> & { baseF?: (c: number) => Expr } = {}) => {
    const { baseF, ...extra } = opt;
    return frow(SH.is, id, label, 'amount', f, { base: baseF ?? f, comp: baseF ?? f, ...extra });
  };
  const nonopCodes = otherIS.map((a) => a.code);
  isRow('is:rev', '營業收入', (c) => r('c:rev', c), { baseF: (c) => AC('revenue', c) });
  isRow('is:cogs', '營業成本', (c) => r('c:cogs', c), { baseF: (c) => AC('cogs', c) });
  isRow('is:gp', '營業毛利', (c) => sub(r('is:rev', c), r('is:cogs', c)), { style: 'subtotal' });
  for (const c of opexCodes) isRow(`is:${c}`, accts.find((a) => a.code === c)!.name, (col) => r(`c:opex:${c}`, col), { baseF: (col) => AC(c, col), indent: 1 });
  isRow('is:opex', '營業費用合計', (c) => add(...opexCodes.map((x) => r(`is:${x}`, c))), { style: 'subtotal' });
  isRow('is:opinc', '營業利益（損失）', (c) => sub(r('is:gp', c), r('is:opex', c)), { style: 'subtotal' });
  const nonopLines: string[] = [];
  for (const code of ['int_income', 'other_income']) if (nonopCodes.includes(code)) { isRow(`is:${code}`, accts.find((a) => a.code === code)!.name, (c) => r(`c:oth:${code}`, c), { baseF: (c) => AC(code, c), indent: 1 }); nonopLines.push(`is:${code}`); }
  isRow('is:other_gl', '其他利益及損失', (c) => r('c:other_gl', c), { baseF: (c) => AC('other_gl', c), indent: 1 }); nonopLines.push('is:other_gl');
  for (const a of otherIS.filter((a) => !['int_income', 'other_income', 'other_gl'].includes(a.code))) { isRow(`is:${a.code}`, a.name, (c) => r(`c:oth:${a.code}`, c), { baseF: (c) => AC(a.code, c), indent: 1 }); nonopLines.push(`is:${a.code}`); }
  isRow('is:fin', '財務成本', (c) => r('l:int', c), { baseF: (c) => AC('fin_cost', c), indent: 1 });
  isRow('is:nonop', '營業外收入及支出合計', (c) => sub(add(...nonopLines.map((x) => r(x, c))), r('is:fin', c)), { style: 'subtotal' });
  isRow('is:pbt', '稅前淨利（淨損）', (c) => add(r('is:opinc', c), r('is:nonop', c)), { style: 'subtotal' });
  isRow('is:tax', '所得稅費用', (c) => r('t:tax', c), { baseF: (c) => AC('tax_exp', c) });
  isRow('is:ni', '本期淨利（淨損）', (c) => sub(r('is:pbt', c), r('is:tax', c)), { style: 'total' });
  isRow('is:oci', '其他綜合損益（稅後淨額）', (c) => r('a:oci', c), { baseF: (c) => AC('oci', c) });
  isRow('is:ci', '本期綜合損益總額', (c) => add(r('is:ni', c), r('is:oci', c)), { style: 'total' });

  // ===== 所得稅 =====
  frow(SH.taxeq, 't:pbt', '稅前淨利', 'amount', (c) => r('is:pbt', c));
  frow(SH.taxeq, 't:taxable', '課稅所得（扣除虧損前）', 'amount', (c) => add(r('t:pbt', c), r('a:tax_adj', c)));
  frow(SH.taxeq, 't:nol_open', '期初可扣除虧損', 'amount', (c) => (c === cb + 1 ? P('a:nol0') : r('t:nol_close', c - 1)));
  frow(SH.taxeq, 't:nol_used', '本期虧損扣除', 'amount', (c) => min(r('t:nol_open', c), max(n(0), r('t:taxable', c))));
  frow(SH.taxeq, 't:nol_close', '期末可扣除虧損', 'amount', (c) => add(sub(r('t:nol_open', c), r('t:nol_used', c)), max(n(0), neg(r('t:taxable', c)))));
  frow(SH.taxeq, 't:calc', '依稅率估算之所得稅', 'amount', (c) => mul(max(n(0), sub(r('t:taxable', c), r('t:nol_used', c))), r('a:tax_rate', c)));
  frow(SH.taxeq, 't:tax', '當期所得稅費用', 'amount', (c) => iff(eq(r('a:tax_m', c), s(M.TAX_MANUAL)), r('a:tax_manual', c), r('t:calc', c)), { base: (c) => AC('tax_exp', c), overridable: true, style: 'subtotal', desc: '簡化估算；不含遞延所得稅' });
  frow(SH.taxeq, 't:prov', '當年度暫繳', 'amount', (c) => mul(r('a:tax_prov', c), r('t:tax', c - 1)));
  frow(SH.taxeq, 't:net', '應付所得稅淨額（負數為預付）', 'amount', (c) => sub(r('t:tax', c), r('t:prov', c)), { base: (c) => sub(AC('tax_pay', c), AC('tax_asset', c)) });
  frow(SH.taxeq, 't:paid', '實際付稅', 'amount', (c) => add(prev('t:net', c), r('t:prov', c)), { desc: '期初應付所得稅（結算申報）＋當年度暫繳' });
  // ===== 權益 =====
  frow(SH.taxeq, 'e:capital', '股本', 'amount', (c) => add(prev('e:capital', c), r('a:cap_par', c)), { base: (c) => AC('capital', c) });
  frow(SH.taxeq, 'e:cs', '資本公積', 'amount', (c) => add(prev('e:cs', c), r('a:cap_prem', c)), { base: (c) => AC('cap_surplus', c) });
  frow(SH.taxeq, 'e:cap_rec', '增資認列額（股本＋溢價）', 'amount', (c) => add(r('a:cap_par', c), r('a:cap_prem', c)));
  frow(SH.taxeq, 'e:cap_cash', '增資實際收現', 'amount', (c) => iff(fn('ISBLANK', r('a:cap_cash', c)), r('e:cap_rec', c), r('a:cap_cash', c)));
  frow(SH.taxeq, 'e:cap_adv', '預收股本（負數為應收股款）', 'amount', (c) => add(prev('e:cap_adv', c), sub(r('e:cap_cash', c), r('e:cap_rec', c))), { base: (c) => AC('cap_adv', c) });
  frow(SH.taxeq, 'e:re', '保留盈餘', 'amount', (c) => sub(add(prev('e:re', c), r('is:ni', c)), r('a:div', c)), { base: (c) => AC('re', c) });
  frow(SH.taxeq, 'e:oe', '其他權益', 'amount', (c) => add(prev('e:oe', c), r('a:oci', c)), { base: (c) => AC('other_eq', c) });
  frow(SH.taxeq, 'e:div_paid', '現金股利支付', 'amount', (c) => add(prev('e:div_pay', c), mul(r('a:div', c), r('a:div_pct', c))));
  frow(SH.taxeq, 'e:div_pay', '應付股利', 'amount', (c) => sub(add(prev('e:div_pay', c), r('a:div', c)), r('e:div_paid', c)), { base: (c) => AC('div_pay', c) });

  // ===== 現金流量表（間接法） =====
  const cfBase = (id: string): CellFn => () => ACT(p.base.cfActual[id] ?? null);
  const cfRow = (id: string, label: string, f: (c: number) => Expr, extra: Partial<Row> = {}) =>
    frow(SH.cf, id, label, 'amount', f, { base: cfBase(id), comp: () => NA(), ...extra });
  addRow(SH.cf, 'cf:h_op', '營業活動之現金流量', 'text', Array(ncol).fill(null), { style: 'header' });
  cfRow('cf:pbt', '本期稅前淨利（淨損）', (c) => r('is:pbt', c), { indent: 1 });
  cfRow('cf:dep', '折舊費用', (c) => r('f:dep', c), { indent: 1 });
  cfRow('cf:imp', '減損損失', (c) => r('f:imp', c), { indent: 1 });
  cfRow('cf:gain', '處分不動產、廠房及設備（利益）損失', (c) => neg(r('f:gain', c)), { indent: 1 });
  cfRow('cf:intexp', '利息費用', (c) => r('is:fin', c), { indent: 1 });
  const hasIntInc = nonopCodes.includes('int_income');
  if (hasIntInc) cfRow('cf:intinc', '利息收入', (c) => neg(r('is:int_income', c)), { indent: 1 });
  const opChanges: string[] = [];
  const chg = (id: string, label: string, cur: (c: number) => Expr, prv: (c: number) => Expr, debit: boolean) => {
    cfRow(id, label, (c) => (debit ? sub(prv(c), cur(c)) : sub(cur(c), prv(c))), { indent: 1 });
  };
  chg('cf:d_ar', '應收帳款（增加）減少', (c) => r('w:ar', c), (c) => r('w:ar', c - 1), true); opChanges.push('cf:d_ar');
  chg('cf:d_inv', '存貨（增加）減少', (c) => r('w:inv', c), (c) => r('w:inv', c - 1), true); opChanges.push('cf:d_inv');
  chg('cf:d_ap', '應付帳款增加（減少）', (c) => r('w:ap', c), (c) => r('w:ap', c - 1), false); opChanges.push('cf:d_ap');
  const clsOf = (a: AccountDef) => A.others[a.code].cf;
  const ociOf = (a: AccountDef, c: number) => (a.code === ociAcc ? r('a:oci', c) : n(0));
  const otherChange = (a: AccountDef, c: number) => {
    // 現金影響：借方科目增加為流出；排除其他綜合損益（非現金）
    const d = sub(r(`o:${a.code}`, c), r(`o:${a.code}`, c - 1));
    return isDebit(a) ? sub(ociOf(a, c), d) : add(d, ociOf(a, c));
  };
  for (const a of otherBS.filter((a) => clsOf(a) === 'operating')) {
    const id = `cf:o:${a.code}`;
    cfRow(id, `${a.name}${isDebit(a) ? '（增加）減少' : '增加（減少）'}`, (c) => otherChange(a, c), { indent: 1 });
    opChanges.push(id);
  }
  const opAdj = ['cf:pbt', 'cf:dep', 'cf:imp', 'cf:gain', 'cf:intexp', ...(hasIntInc ? ['cf:intinc'] : []), ...opChanges];
  cfRow('cf:gen', '營運產生之現金流入（流出）', (c) => add(...opAdj.map((x) => r(x, c))), { style: 'subtotal' });
  if (hasIntInc) cfRow('cf:intrec', '收取之利息', (c) => r('is:int_income', c), { indent: 1 });
  const intOp = st.interestPaidClass === 'operating';
  if (intOp) cfRow('cf:intpaid', '支付之利息', (c) => neg(r('l:ipaid', c)), { indent: 1 });
  cfRow('cf:taxpaid', '支付之所得稅', (c) => neg(r('t:paid', c)), { indent: 1 });
  cfRow('cf:op', '營業活動之淨現金流入（流出）', (c) => add(r('cf:gen', c), ...(hasIntInc ? [r('cf:intrec', c)] : []), ...(intOp ? [r('cf:intpaid', c)] : []), r('cf:taxpaid', c)), { style: 'total' });

  addRow(SH.cf, 'cf:h_inv', '投資活動之現金流量', 'text', Array(ncol).fill(null), { style: 'header' });
  cfRow('cf:capex', '取得不動產、廠房及設備', (c) => neg(r('f:paid', c)), { indent: 1 });
  cfRow('cf:disp', '處分不動產、廠房及設備', (c) => r('f:recv', c), { indent: 1 });
  const invLines = ['cf:capex', 'cf:disp'];
  for (const a of otherBS.filter((a) => clsOf(a) === 'investing')) {
    const id = `cf:o:${a.code}`;
    cfRow(id, `${a.name}${isDebit(a) ? '（增加）減少' : '增加（減少）'}`, (c) => otherChange(a, c), { indent: 1 });
    invLines.push(id);
  }
  cfRow('cf:inv', '投資活動之淨現金流入（流出）', (c) => add(...invLines.map((x) => r(x, c))), { style: 'total' });

  addRow(SH.cf, 'cf:h_fin', '籌資活動之現金流量', 'text', Array(ncol).fill(null), { style: 'header' });
  cfRow('cf:draw', '舉借借款', (c) => r('l:draw', c), { indent: 1 });
  cfRow('cf:repay', '償還借款', (c) => neg(r('l:repay', c)), { indent: 1 });
  const finLines = ['cf:draw', 'cf:repay'];
  if (!intOp) { cfRow('cf:intpaid', '支付之利息', (c) => neg(r('l:ipaid', c)), { indent: 1 }); finLines.push('cf:intpaid'); }
  cfRow('cf:capinc', '現金增資', (c) => r('e:cap_cash', c), { indent: 1 });
  cfRow('cf:divpaid', '發放現金股利', (c) => neg(r('e:div_paid', c)), { indent: 1 });
  finLines.push('cf:capinc', 'cf:divpaid');
  for (const a of otherBS.filter((a) => clsOf(a) === 'financing')) {
    const id = `cf:o:${a.code}`;
    cfRow(id, `${a.name}${isDebit(a) ? '（增加）減少' : '增加（減少）'}`, (c) => otherChange(a, c), { indent: 1 });
    finLines.push(id);
  }
  cfRow('cf:fin', '籌資活動之淨現金流入（流出）', (c) => add(...finLines.map((x) => r(x, c))), { style: 'total' });
  cfRow('cf:net', '本期現金及約當現金增加（減少）數', (c) => add(r('cf:op', c), r('cf:inv', c), r('cf:fin', c)), { style: 'subtotal' });
  cfRow('cf:open', '期初現金及約當現金餘額', (c) => r('cf:close', c - 1));
  frow(SH.cf, 'cf:close', '期末現金及約當現金餘額', 'amount', (c) => add(r('cf:open', c), r('cf:net', c)), { base: (c) => AC('cash', c), comp: () => NA(), style: 'total' });

  // ===== 資產負債表 =====
  const bsRow = (id: string, label: string, f: (c: number) => Expr, baseF: (c: number) => Expr, extra: Partial<Row> = {}) =>
    frow(SH.bs, id, label, 'amount', f, { base: baseF, comp: baseF, ...extra });
  const sect = (sec: string) => otherBS.filter((a) => a.section === sec);
  const ENG: Record<string, { label: string; f: (c: number) => Expr; b: (c: number) => Expr }> = {
    cash: { label: '現金及約當現金', f: (c) => r('cf:close', c), b: (c) => AC('cash', c) },
    ar: { label: '應收帳款', f: (c) => r('w:ar', c), b: (c) => AC('ar', c) },
    disposal_rec: { label: '其他應收款－處分資產', f: (c) => r('f:disp_rec', c), b: (c) => AC('disposal_rec', c) },
    inventory: { label: '存貨', f: (c) => r('w:inv', c), b: (c) => AC('inventory', c) },
    tax_asset: { label: '本期所得稅資產', f: (c) => max(n(0), neg(r('t:net', c))), b: (c) => AC('tax_asset', c) },
    ppe: { label: '不動產、廠房及設備', f: (c) => r('f:nbv', c), b: (c) => add(sub(sub(AC('ppe_cost', c), AC('ppe_accdep', c)), AC('ppe_accimp', c)), AC('ppe_net', c)) },
    st_loan: { label: '短期借款', f: (c) => r('l:short', c), b: (c) => AC('st_loan', c) },
    ap: { label: '應付帳款', f: (c) => r('w:ap', c), b: (c) => AC('ap', c) },
    int_pay: { label: '其他應付款－應付利息', f: (c) => r('l:ipay', c), b: (c) => AC('int_pay', c) },
    div_pay: { label: '其他應付款－應付股利', f: (c) => r('e:div_pay', c), b: (c) => AC('div_pay', c) },
    equip_pay: { label: '其他應付款－應付設備款', f: (c) => r('f:equip_pay', c), b: (c) => AC('equip_pay', c) },
    tax_pay: { label: '本期所得稅負債', f: (c) => max(n(0), r('t:net', c)), b: (c) => AC('tax_pay', c) },
    ltd_cur: { label: '一年或一營業週期內到期長期負債', f: (c) => r('l:long_cur', c), b: (c) => AC('ltd_cur', c) },
    ltd: { label: '長期借款', f: (c) => r('l:long_nc', c), b: (c) => AC('ltd', c) },
    capital: { label: '股本', f: (c) => r('e:capital', c), b: (c) => AC('capital', c) },
    cap_surplus: { label: '資本公積', f: (c) => r('e:cs', c), b: (c) => AC('cap_surplus', c) },
    cap_adv: { label: '預收股本（應收股款）', f: (c) => r('e:cap_adv', c), b: (c) => AC('cap_adv', c) },
    re: { label: '保留盈餘', f: (c) => r('e:re', c), b: (c) => AC('re', c) },
    other_eq: { label: '其他權益', f: (c) => r('e:oe', c), b: (c) => AC('other_eq', c) },
  };
  const ORDER: Record<string, string[]> = {
    CA: ['cash', 'fvpl_cur', 'notes_rec', 'ar', 'other_rec', 'disposal_rec', 'inventory', 'prepay', 'tax_asset', 'other_ca'],
    NCA: ['lt_invest', 'ppe', 'inv_property', 'intangible', 'rou_asset', 'dta', 'other_nca'],
    CL: ['st_loan', 'st_notes', 'notes_pay', 'ap', 'other_pay', 'int_pay', 'div_pay', 'equip_pay', 'tax_pay', 'contract_liab', 'ltd_cur', 'lease_liab_cur', 'other_cl'],
    NCL: ['ltd', 'dtl', 'lease_liab', 'other_ncl'],
    EQ: ['capital', 'cap_surplus', 'cap_adv', 're', 'other_eq', 'treasury'],
  };
  const secRows: Record<string, string[]> = {};
  const SECTION_LABEL: Record<string, string> = { CA: '流動資產', NCA: '非流動資產', CL: '流動負債', NCL: '非流動負債', EQ: '權益' };
  for (const sec of ['CA', 'NCA', 'CL', 'NCL', 'EQ']) {
    addRow(SH.bs, `bs:h_${sec}`, SECTION_LABEL[sec], 'text', Array(ncol).fill(null), { style: 'header' });
    const codes = [...ORDER[sec], ...sect(sec).map((a) => a.code).filter((c) => !ORDER[sec].includes(c))];
    secRows[sec] = [];
    for (const code of codes) {
      const id = `bs:${code}`;
      if (ENG[code]) { bsRow(id, ENG[code].label, ENG[code].f, ENG[code].b, { indent: 1 }); secRows[sec].push(id); continue; }
      const a = otherBS.find((x) => x.code === code);
      if (!a) continue;
      const sign = a.contra ? -1 : 1;
      bsRow(id, a.name, (c) => (sign < 0 ? neg(r(`o:${code}`, c)) : r(`o:${code}`, c)), (c) => (sign < 0 ? neg(AC(code, c)) : AC(code, c)), { indent: 1 });
      secRows[sec].push(id);
    }
    const tot = (c: number) => add(...secRows[sec].map((x) => r(x, c)));
    bsRow(`bs:t_${sec}`, `${SECTION_LABEL[sec]}合計`, tot, tot, { style: 'subtotal' });
    if (sec === 'NCA') { const f = (c: number) => add(r('bs:t_CA', c), r('bs:t_NCA', c)); bsRow('bs:assets', '資產總計', f, f, { style: 'total' }); }
    if (sec === 'NCL') { const f = (c: number) => add(r('bs:t_CL', c), r('bs:t_NCL', c)); bsRow('bs:liab', '負債總計', f, f, { style: 'total' }); }
  }
  { const f = (c: number) => r('bs:t_EQ', c); bsRow('bs:equity', '權益總計', f, f, { style: 'total' }); }
  { const f = (c: number) => add(r('bs:liab', c), r('bs:equity', c)); bsRow('bs:le', '負債及權益總計', f, f, { style: 'total' }); }

  // ===== 權益變動表 =====
  const otherEqAccts = sect('EQ');
  const oeItems = (c: number, base: boolean) => add(...otherEqAccts.map((a) => (a.contra ? neg(base ? AC(a.code, c) : r(`o:${a.code}`, c)) : (base ? AC(a.code, c) : r(`o:${a.code}`, c)))));
  const sceBase = (id: string): CellFn => () => ACT(p.base.sceActual[id] ?? null);
  const sceRow = (id: string, label: string, f: (c: number) => Expr, opt: Partial<Row> & { baseF?: CellFn } = {}) => {
    const { baseF, ...extra } = opt;
    return frow(SH.sce, id, label, 'amount', f, { base: baseF ?? sceBase(id), comp: () => NA(), ...extra });
  };
  const comp = (key: string, label: string, closeSrc: string, closeBase: (c: number) => Expr, moves0: { id: string; label: string; f: (c: number) => Expr }[]) => {
    // 「其他變動」：承接基期實際報表中無法歸類之變動；預估年度為零
    const moves = [...moves0, { id: `sce:${key}_oth`, label: '其他變動', f: () => n(0) }];
    addRow(SH.sce, `sce:h_${key}`, label, 'text', Array(ncol).fill(null), { style: 'header' });
    sceRow(`sce:${key}_open`, '期初餘額', (c) => r(`sce:${key}_close`, c - 1), { indent: 1 });
    for (const m of moves) sceRow(m.id, m.label, m.f, { indent: 1 });
    sceRow(`sce:${key}_close`, '期末餘額', (c) => add(r(`sce:${key}_open`, c), ...moves.map((m) => r(m.id, c))), { baseF: (c) => closeBase(c), style: 'subtotal' });
    void closeSrc;
  };
  comp('cap', '股本', 'e:capital', (c) => AC('capital', c), [{ id: 'sce:cap_inc', label: '現金增資', f: (c) => r('a:cap_par', c) }]);
  comp('cs', '資本公積', 'e:cs', (c) => AC('cap_surplus', c), [{ id: 'sce:cs_inc', label: '現金增資溢價', f: (c) => r('a:cap_prem', c) }]);
  comp('adv', '預收股本（應收股款）', 'e:cap_adv', (c) => AC('cap_adv', c), [{ id: 'sce:adv_chg', label: '增資收現與認列差額', f: (c) => sub(r('e:cap_cash', c), r('e:cap_rec', c)) }]);
  comp('re', '保留盈餘', 'e:re', (c) => AC('re', c), [
    { id: 'sce:re_ni', label: '本期淨利（淨損）', f: (c) => r('is:ni', c) },
    { id: 'sce:re_div', label: '現金股利', f: (c) => neg(r('a:div', c)) },
  ]);
  comp('oe', '其他權益', 'e:oe', (c) => AC('other_eq', c), [{ id: 'sce:oe_oci', label: '本期其他綜合損益', f: (c) => r('is:oci', c) }]);
  if (otherEqAccts.length) comp('ot', '其他權益項目（庫藏股等）', '', (c) => oeItems(c, true), [{ id: 'sce:ot_chg', label: '本期變動', f: (c) => sub(oeItems(c, false), oeItems(c - 1, c - 1 === cb)) }]);
  addRow(SH.sce, 'sce:h_total', '權益總額', 'text', Array(ncol).fill(null), { style: 'header' });
  const keys = ['cap', 'cs', 'adv', 're', 'oe', ...(otherEqAccts.length ? ['ot'] : [])];
  sceRow('sce:t_open', '期初權益', (c) => add(...keys.map((k) => r(`sce:${k}_open`, c))), { indent: 1 });
  sceRow('sce:t_ci', '本期綜合損益總額', (c) => add(r('sce:re_ni', c), r('sce:oe_oci', c)), { indent: 1 });
  sceRow('sce:t_owner', '與業主之交易（增資、股利）', (c) => add(r('sce:cap_inc', c), r('sce:cs_inc', c), r('sce:adv_chg', c), r('sce:re_div', c)), { indent: 1 });
  if (otherEqAccts.length) sceRow('sce:t_other', '其他權益項目變動', (c) => r('sce:ot_chg', c), { indent: 1 });
  sceRow('sce:t_oth', '其他變動', (c) => add(...keys.map((k) => r(`sce:${k}_oth`, c))), { indent: 1 });
  sceRow('sce:t_close', '期末權益', (c) => add(...keys.map((k) => r(`sce:${k}_close`, c))), { baseF: (c) => add(...keys.map((k) => r(`sce:${k}_close`, c))), style: 'total' });

  // ===== 財務比率 =====
  // 分母為零時顯示「—」；需前一年度之比率僅於有前一年度資料之欄位計算
  const DASH = s('—');
  const g_prepay = (c: number) => (rows.some((x) => x.id === 'bs:prepay') ? r('bs:prepay', c) : n(0));
  const ratio = (a: Expr, b: Expr) => iff(eq(b, n(0)), DASH, div(a, b));
  const hasPrev = (c: number) => c > 0;
  const rRow = (id: string, label: string, format: RowFormat, f: (c: number) => Expr | Cell | null, desc: string, opt: { forecastOnly?: boolean; needPrev?: boolean } & Partial<Row> = {}) => {
    const { forecastOnly, needPrev, ...extra } = opt;
    const fx: CellFn = (c) => (needPrev && !hasPrev(c) ? NA('無前期資料') : f(c));
    return frow(SH.ratio, id, label, format, fx, { base: forecastOnly ? () => NA('—') : fx, comp: forecastOnly ? () => NA('—') : fx, desc, ...extra });
  };
  const hdr = (id: string, label: string) => addRow(SH.ratio, id, label, 'text', Array(ncol).fill(null), { style: 'header' });
  const days = P('p:days');
  // 折舊：預估取排程；基期取現金流量表實際數（未提供時不計算 EBITDA）
  const depAvail = (c: number) => isF(c) || (c === cb && p.base.cfActual['cf:dep'] !== undefined && p.base.cfActual['cf:dep'] !== null);
  const depOf = (c: number) => (isF(c) ? r('f:dep', c) : r('cf:dep', c));
  hdr('r:h_grow', '成長與獲利能力');
  rRow('r:rev_g', '營收成長率', 'pct', (c) => ratio(sub(r('is:rev', c), r('is:rev', c - 1)), r('is:rev', c - 1)), '（本期營收−前期營收）÷前期營收', { needPrev: true, indent: 1 });
  rRow('r:gm', '毛利率', 'pct', (c) => ratio(r('is:gp', c), r('is:rev', c)), '營業毛利÷營業收入', { indent: 1 });
  rRow('r:opm', '營業利益率', 'pct', (c) => ratio(r('is:opinc', c), r('is:rev', c)), '營業利益÷營業收入', { indent: 1 });
  rRow('r:npm', '稅後淨利率', 'pct', (c) => ratio(r('is:ni', c), r('is:rev', c)), '本期淨利÷營業收入', { indent: 1 });
  rRow('r:ebitda', 'EBITDA', 'amount', (c) => (depAvail(c) ? add(r('is:pbt', c), r('is:fin', c), depOf(c)) : NA('需基期折舊')), '稅前淨利＋財務成本＋折舊', { indent: 1 });
  rRow('r:roe', '權益報酬率（ROE）', 'pct', (c) => ratio(r('is:ni', c), div(add(r('bs:equity', c), r('bs:equity', c - 1)), n(2))), '本期淨利÷平均權益', { needPrev: true, indent: 1 });
  rRow('r:roa', '資產報酬率（ROA）', 'pct', (c) => ratio(r('is:ni', c), div(add(r('bs:assets', c), r('bs:assets', c - 1)), n(2))), '本期淨利÷平均資產（未加回利息）', { needPrev: true, indent: 1 });
  hdr('r:h_liq', '流動性');
  rRow('r:cur', '流動比率', 'pct', (c) => ratio(r('bs:t_CA', c), r('bs:t_CL', c)), '流動資產÷流動負債', { indent: 1 });
  rRow('r:quick', '速動比率', 'pct', (c) => ratio(sub(sub(r('bs:t_CA', c), r('bs:inventory', c)), g_prepay(c)), r('bs:t_CL', c)), '（流動資產−存貨−預付款項）÷流動負債', { indent: 1 });
  rRow('r:ar_days', '應收帳款週轉天數', 'days', (c) => ratio(mul(r('bs:ar', c), days), r('is:rev', c)), '期末應收帳款÷營業收入×天數', { indent: 1 });
  rRow('r:inv_days', '存貨週轉天數', 'days', (c) => ratio(mul(r('bs:inventory', c), days), r('is:cogs', c)), '期末存貨÷營業成本×天數', { indent: 1 });
  rRow('r:ap_days', '應付帳款週轉天數', 'days', (c) => ratio(mul(r('bs:ap', c), days), r('is:cogs', c)), '期末應付帳款÷營業成本×天數', { indent: 1 });
  hdr('r:h_lev', '財務結構與償債能力');
  rRow('r:debt', '負債比率', 'pct', (c) => ratio(r('bs:liab', c), r('bs:assets', c)), '負債總計÷資產總計', { indent: 1 });
  rRow('r:de', '負債對權益比率', 'pct', (c) => ratio(r('bs:liab', c), r('bs:equity', c)), '負債總計÷權益總計', { indent: 1 });
  rRow('r:loans', '有息負債（借款）', 'amount', (c) => add(r('bs:st_loan', c), r('bs:ltd_cur', c), r('bs:ltd', c)), '短期借款＋一年內到期長期借款＋長期借款', { indent: 1 });
  rRow('r:netdebt', '淨借款', 'amount', (c) => sub(r('r:loans', c), r('bs:cash', c)), '有息負債−現金及約當現金', { indent: 1 });
  rRow('r:icr', '利息保障倍數', 'times', (c) => ratio(add(r('is:pbt', c), r('is:fin', c)), r('is:fin', c)), '（稅前淨利＋財務成本）÷財務成本', { indent: 1 });
  rRow('r:debt_ebitda', '有息負債÷EBITDA', 'times', (c) => (depAvail(c) ? ratio(r('r:loans', c), r('r:ebitda', c)) : NA('需基期折舊')), '有息負債÷EBITDA', { indent: 1 });
  rRow('r:dscr', '償債保障比率（DSCR）', 'times', (c) => ratio(sub(r('r:ebitda', c), r('t:paid', c)), add(r('l:repay', c), r('l:ipaid', c))), '（EBITDA−支付所得稅）÷（償還借款＋支付利息）；僅預估年度', { forecastOnly: true, indent: 1 });
  rRow('r:cfo_cov', '營業現金流量÷流動負債', 'pct', (c) => ratio(r('cf:op', c), r('bs:t_CL', c)), '營業活動淨現金流量÷流動負債；僅預估年度', { forecastOnly: true, indent: 1 });

  // ===== 勾稽檢查 =====
  const ckAll = (id: string, label: string, f: (c: number) => Expr, baseF?: (c: number) => Expr, desc?: string) => {
    frow(SH.ck, id, label, 'amount', f, { base: baseF, comp: baseF, desc });
    frow(SH.ck, `${id}:st`, `${label}－結果`, 'status', (c) => iff(cmp('<', fn('ABS', r(id, c)), n(0.5)), s('通過'), s('差異')), { base: baseF ? (c) => iff(cmp('<', fn('ABS', r(id, c)), n(0.5)), s('通過'), s('差異')) : undefined, comp: baseF ? (c) => iff(cmp('<', fn('ABS', r(id, c)), n(0.5)), s('通過'), s('差異')) : undefined });
  };
  ckAll('ck:bs', '資產−負債−權益', (c) => sub(r('bs:assets', c), r('bs:le', c)), (c) => sub(r('bs:assets', c), r('bs:le', c)));
  ckAll('ck:cash', '現金流量表期末現金−資產負債表現金', (c) => sub(r('cf:close', c), r('bs:cash', c)));
  ckAll('ck:eq', '權益變動表期末權益−資產負債表權益', (c) => sub(r('sce:t_close', c), r('bs:equity', c)), (c) => sub(r('sce:t_close', c), r('bs:equity', c)));
  ckAll('ck:open', '期初現金−前一年度期末現金', (c) => sub(r('cf:open', c), r('bs:cash', c - 1)));
  ckAll('ck:ni', '本期淨利−權益變動表本期淨利', (c) => sub(r('is:ni', c), r('sce:re_ni', c)));
  ckAll('ck:ppe', '固定資產排程淨額−資產負債表', (c) => sub(r('f:nbv', c), r('bs:ppe', c)), (c) => sub(r('f:nbv', c), r('bs:ppe', c)), '基期：各類別基期淨額合計須等於資產負債表');
  ckAll('ck:loan', '借款排程−資產負債表借款', (c) => sub(add(r('l:short', c), r('l:long_total', c)), add(r('bs:st_loan', c), r('bs:ltd_cur', c), r('bs:ltd', c))),
    (c) => sub(add(r('l:short', c), r('l:long_total', c)), add(r('bs:st_loan', c), r('bs:ltd_cur', c), r('bs:ltd', c))));
  ckAll('ck:excess', '還款超過可還餘額', (c) => r('l:excess', c));
  frow(SH.ck, 'ck:cash_bal', '預估年末現金', 'amount', (c) => r('bs:cash', c));
  frow(SH.ck, 'ck:below', '低於門檻差額', 'amount', (c) => max(n(0), sub(P('p:threshold'), r('bs:cash', c))));
  frow(SH.ck, 'ck:gap', '資金缺口（現金為負）', 'amount', (c) => max(n(0), neg(r('bs:cash', c))));
  frow(SH.ck, 'ck:alert', '現金警示', 'status', (c) => iff(cmp('<', r('bs:cash', c), n(0)), s('資金缺口'), iff(cmp('<', r('bs:cash', c), P('p:threshold')), s('低於門檻'), s('正常'))));

  // ===== 覆寫 =====
  const g = makeGraph(columns, rows);
  for (const [rid, map] of Object.entries(sc.overrides)) {
    const row = g.byId.get(rid);
    if (!row || !row.overridable) continue;
    for (const [k, v] of Object.entries(map)) {
      const c = cb + 1 + Number(k);
      const cell = row.cells[c];
      if (!cell || v === null || v === undefined) continue;
      row.cells[c] = { kind: 'override', value: v, expr: cell.expr, note: '手動覆寫' };
    }
  }
  return { g, info: { cb, N, fcols, otherIS, otherBS, faClasses, loanIds: loans.map((l) => l.id) } };
}

// 全部欄位皆為零（或未提供）之明細列；標題、小計、合計列不視為零值列
export function isZeroRow(r: Row, ev: { value: (id: string, c: number) => Value }, ncol: number) {
  if (r.style === 'header' || r.style === 'total' || r.style === 'subtotal') return false;
  for (let c = 0; c < ncol; c++) {
    const cell = r.cells[c];
    if (!cell || cell.kind === 'na') continue;
    const v = ev.value(r.id, c);
    if (typeof v === 'number' && Math.abs(v) >= (r.format === 'amount' ? 0.5 : 1e-9)) return false;
  }
  return true;
}
