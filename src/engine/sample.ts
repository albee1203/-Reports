// 示範專案（供測試與「載入範例」使用；數字為虛構）
import { M, Project, newProject, syncScenarioWithBase, emptyLoan, arr, sarr } from './project';

export function sampleProject(): Project {
  const p = newProject('範例股份有限公司', 2025);
  const acc: Record<string, number> = {
    cash: 35_000_000, ar: 48_000_000, inventory: 30_000_000, prepay: 2_000_000, other_rec: 1_000_000,
    ppe_cost: 120_000_000, ppe_accdep: 45_000_000, intangible: 3_000_000, other_nca: 2_000_000,
    st_loan: 20_000_000, ap: 25_000_000, other_pay: 8_000_000, tax_pay: 3_000_000, ltd_cur: 10_000_000, ltd: 40_000_000,
    capital: 60_000_000, cap_surplus: 5_000_000, re: 25_000_000,
    revenue: 300_000_000, cogs: 225_000_000, sell_exp: 15_000_000, admin_exp: 20_000_000, rd_exp: 5_000_000,
    int_income: 200_000, other_income: 1_000_000, other_gl: -500_000, fin_cost: 2_500_000, tax_exp: 6_640_000,
  };
  p.base.manual = { ...acc };
  const fb = p.faBase;
  fb.land = { ...fb.land, cost: 20_000_000, accDep: 0, accImp: 0, enabled: true };
  fb.building = { ...fb.building, cost: 50_000_000, accDep: 15_000_000, accImp: 0, depreciableNbv: 35_000_000, residual: 0, remainingLife: 25, enabled: true };
  fb.machinery = { ...fb.machinery, cost: 50_000_000, accDep: 30_000_000, accImp: 0, depreciableNbv: 20_000_000, residual: 2_000_000, remainingLife: 5, enabled: true };
  p.faNature = 'gross';
  const sc = p.scenarios[0];
  syncScenarioWithBase(p, sc);
  const a = sc.a;
  a.growth = [0.08, 0.07, 0.06, 0.05, 0.05];
  a.gm = arr(5, 0.25);
  a.depIncluded = sarr(5, M.DEP_IN);
  a.depCogsShare = arr(5, 0.7);
  a.opex.sell_exp = arr(5, 0.05);
  a.opex.admin_exp = arr(5, 0.065);
  a.opex.rd_exp = arr(5, 0.017);
  a.ar.param = arr(5, 58);
  a.inv.param = arr(5, 48);
  a.ap.param = arr(5, 40);
  a.others.int_income.method = sarr(5, M.CASH_RATE); a.others.int_income.param = arr(5, 0.005); a.others.int_income.confirmed = true;
  a.others.other_income.method = sarr(5, M.MANUAL); a.others.other_income.param = arr(5, 1_000_000); a.others.other_income.confirmed = true;
  a.others.other_gl.method = sarr(5, M.MANUAL); a.others.other_gl.param = arr(5, 0); a.others.other_gl.confirmed = true;
  for (const k of ['prepay', 'other_rec', 'intangible', 'other_nca', 'other_pay']) a.others[k].confirmed = true;
  a.equity.dividend = [0, 10_000_000, 10_000_000, 12_000_000, 12_000_000];
  const mach = sc.fa.machinery;
  mach.capex = [10_000_000, 0, 15_000_000, 0, 0];
  mach.month = [4, null, null, null, null];
  mach.life = [8, null, 8, null, null];
  mach.residualPct = [0.1, null, 0.1, null, null];
  mach.paid = [8_000_000, null, null, null, null];
  const [st, lt] = sc.loans;
  st.rate = arr(5, 0.025); st.repay = [0, 5_000_000, 0, 0, 0]; st.repayMonth = [null, 6, null, null, null];
  lt.rate = arr(5, 0.028); lt.repay = arr(5, 10_000_000); lt.repayMonth = arr(5, 12); lt.nextRepay = 0; lt.accruedMonths = arr(5, 1);
  const nl = emptyLoan(5, '中期擴廠貸款', 'long');
  nl.baseBalance = 0; nl.rate = arr(5, 0.03); nl.draw = [0, 30_000_000, 0, 0, 0]; nl.drawMonth = [null, 10, null, null, null];
  nl.repay = [0, 0, 0, 6_000_000, 6_000_000]; nl.nextRepay = 6_000_000;
  sc.loans.push(nl);
  lt.nextRepay = 0;
  // 長期借款既有 50M：每年還 10M，第 5 年後已還清
  return p;
}
