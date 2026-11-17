// 專案資料版本轉換：開啟舊版專案或匯入舊版備份時補齊新欄位
import { Project, arr, emptyFaPlan, syncScenarioWithBase } from './project';
import { FA_CLASSES } from './coa';

export const SCHEMA_VERSION = 2;

export function migrateProject(raw: any): Project {
  const p = raw as Project & { schemaVersion?: number };
  const n = p.settings?.years ?? 5;
  p.settings = { ...p.settings };
  p.settings.advanced ??= { lease: false, fx: false, related: false };
  p.settings.daysBasis ??= 365;
  p.settings.interestPaidClass ??= 'operating';
  p.settings.depExpenseLine ??= 'admin_exp';
  p.settings.ociAccount ??= null;
  p.settings.standards ??= [];
  p.customAccounts ??= [];
  p.imports ??= [];
  p.comparatives ??= [];
  for (const y of [p.base, ...p.comparatives]) { y.manual ??= {}; y.accounts ??= {}; y.lines ??= []; y.importIds ??= []; y.cfActual ??= {}; y.sceActual ??= {}; }
  p.faAssets ??= [];
  for (const c of FA_CLASSES) p.faBase[c.key] ??= { cost: null, accDep: null, accImp: null, nbv: null, existingMethod: '估算', depreciableNbv: null, residual: null, remainingLife: null, enabled: false };
  p.bank ??= { titles: {}, periodText: {}, labels: {}, notes: [], acks: {}, reviewer: '' };
  p.bank.acks ??= {}; p.bank.labels ??= {}; p.bank.titles ??= {}; p.bank.periodText ??= {}; p.bank.notes ??= [];
  p.versions ??= []; p.log ??= [];
  for (const sc of p.scenarios) {
    sc.overrides ??= {};
    sc.loans ??= [];
    sc.fa ??= {};
    for (const c of FA_CLASSES) sc.fa[c.key] ??= emptyFaPlan(n);
    sc.a.equity.capCash ??= arr(n);
    sc.a.others ??= {};
    sc.a.opex ??= {};
    for (const l of sc.loans) { l.accruedMonths ??= arr(n, 0); l.nextRepay ??= null; }
    syncScenarioWithBase(p, sc);
  }
  if (!p.scenarios.some((s) => s.id === p.activeScenarioId)) p.activeScenarioId = p.scenarios[0].id;
  p.schemaVersion = SCHEMA_VERSION;
  return p;
}
