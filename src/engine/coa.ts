// 依台灣企業會計準則公報（EAS）報表表達設計之預設科目分類。
// 金額儲存慣例：依報表表達之正常餘額為正數；減項科目（累計折舊、累計減損、庫藏股）以正數儲存，表達時減除。

export type Stmt = 'BS' | 'IS';
export type Section =
  | 'CA' | 'NCA' | 'CL' | 'NCL' | 'EQ' // 資產負債表
  | 'REV' | 'COGS' | 'OPEX' | 'NONOP' | 'TAX' | 'OCI'; // 綜合損益表
export type CfClass = 'operating' | 'investing' | 'financing';
// engine：由排程計算；other：使用者選擇預估方法
export type Role = 'engine' | 'other';

export interface AccountDef {
  code: string;
  name: string;
  stmt: Stmt;
  section: Section;
  role: Role;
  contra?: boolean; // 減項
  canBeNegative?: boolean;
  cf?: CfClass; // other 科目預設現金流量分類
  keywords: string[];
  custom?: boolean;
}

const A = (code: string, name: string, stmt: Stmt, section: Section, role: Role, keywords: string[], extra: Partial<AccountDef> = {}): AccountDef => ({ code, name, stmt, section, role, keywords, ...extra });

export const DEFAULT_COA: AccountDef[] = [
  // 流動資產
  A('cash', '現金及約當現金', 'BS', 'CA', 'engine', ['現金及約當現金', '現金', '銀行存款', '約當現金', '零用金']),
  A('fvpl_cur', '透過損益按公允價值衡量之金融資產－流動', 'BS', 'CA', 'other', ['公允價值', '交易目的', '短期投資'], { cf: 'investing' }),
  A('notes_rec', '應收票據', 'BS', 'CA', 'other', ['應收票據'], { cf: 'operating' }),
  A('ar', '應收帳款', 'BS', 'CA', 'engine', ['應收帳款', '應收款項']),
  A('other_rec', '其他應收款', 'BS', 'CA', 'other', ['其他應收款', '其他應收'], { cf: 'operating' }),
  A('disposal_rec', '其他應收款－處分資產', 'BS', 'CA', 'engine', ['應收處分', '應收出售資產']),
  A('inventory', '存貨', 'BS', 'CA', 'engine', ['存貨', '商品存貨', '原料', '製成品', '在製品', '物料']),
  A('prepay', '預付款項', 'BS', 'CA', 'other', ['預付款項', '預付費用', '預付貨款', '預付'], { cf: 'operating' }),
  A('tax_asset', '本期所得稅資產', 'BS', 'CA', 'engine', ['本期所得稅資產', '預付所得稅', '應收退稅']),
  A('other_ca', '其他流動資產', 'BS', 'CA', 'other', ['其他流動資產', '暫付款', '進項稅額', '留抵稅額'], { cf: 'operating' }),
  // 非流動資產
  A('lt_invest', '長期投資', 'BS', 'NCA', 'other', ['長期投資', '長期股權投資', '權益法', '備供出售', '持有至到期', '透過其他綜合損益'], { cf: 'investing' }),
  A('ppe_cost', '不動產、廠房及設備－成本', 'BS', 'NCA', 'engine', ['土地', '房屋及建築', '建築物', '機器設備', '運輸設備', '辦公設備', '生財器具', '租賃改良', '其他設備', '未完工程', '待驗設備', '預付設備款']),
  A('ppe_accdep', '減：累計折舊', 'BS', 'NCA', 'engine', ['累計折舊'], { contra: true }),
  A('ppe_accimp', '減：累計減損', 'BS', 'NCA', 'engine', ['累計減損'], { contra: true }),
  A('ppe_net', '不動產、廠房及設備（淨額）', 'BS', 'NCA', 'engine', ['不動產、廠房及設備', '不動產廠房及設備', '固定資產']),
  A('inv_property', '投資性不動產', 'BS', 'NCA', 'other', ['投資性不動產'], { cf: 'investing' }),
  A('intangible', '無形資產', 'BS', 'NCA', 'other', ['無形資產', '電腦軟體', '商譽', '專利權'], { cf: 'investing' }),
  A('dta', '遞延所得稅資產', 'BS', 'NCA', 'other', ['遞延所得稅資產'], { cf: 'operating' }),
  A('rou_asset', '使用權資產', 'BS', 'NCA', 'other', ['使用權資產'], { cf: 'investing' }),
  A('other_nca', '其他非流動資產', 'BS', 'NCA', 'other', ['其他非流動資產', '存出保證金', '其他資產', '長期預付'], { cf: 'investing' }),
  // 流動負債
  A('st_loan', '短期借款', 'BS', 'CL', 'engine', ['短期借款', '銀行借款']),
  A('st_notes', '應付短期票券', 'BS', 'CL', 'other', ['應付短期票券', '應付商業本票'], { cf: 'financing' }),
  A('notes_pay', '應付票據', 'BS', 'CL', 'other', ['應付票據'], { cf: 'operating' }),
  A('ap', '應付帳款', 'BS', 'CL', 'engine', ['應付帳款']),
  A('other_pay', '其他應付款', 'BS', 'CL', 'other', ['其他應付款', '應付費用', '應付薪資', '應付營業稅', '其他應付'], { cf: 'operating' }),
  A('int_pay', '其他應付款－應付利息', 'BS', 'CL', 'engine', ['應付利息']),
  A('div_pay', '其他應付款－應付股利', 'BS', 'CL', 'engine', ['應付股利']),
  A('equip_pay', '其他應付款－應付設備款', 'BS', 'CL', 'engine', ['應付設備款']),
  A('tax_pay', '本期所得稅負債', 'BS', 'CL', 'engine', ['本期所得稅負債', '應付所得稅']),
  A('contract_liab', '預收款項', 'BS', 'CL', 'other', ['預收款項', '預收貨款', '合約負債'], { cf: 'operating' }),
  A('ltd_cur', '一年或一營業週期內到期長期負債', 'BS', 'CL', 'engine', ['一年內到期', '一年或一營業週期內到期']),
  A('lease_liab_cur', '租賃負債－流動', 'BS', 'CL', 'other', ['租賃負債－流動', '租賃負債-流動'], { cf: 'financing' }),
  A('other_cl', '其他流動負債', 'BS', 'CL', 'other', ['其他流動負債', '代收款', '暫收款', '銷項稅額'], { cf: 'operating' }),
  // 非流動負債
  A('ltd', '長期借款', 'BS', 'NCL', 'engine', ['長期借款', '長期銀行借款']),
  A('dtl', '遞延所得稅負債', 'BS', 'NCL', 'other', ['遞延所得稅負債'], { cf: 'operating' }),
  A('lease_liab', '租賃負債－非流動', 'BS', 'NCL', 'other', ['租賃負債'], { cf: 'financing' }),
  A('other_ncl', '其他非流動負債', 'BS', 'NCL', 'other', ['其他非流動負債', '存入保證金', '應計退休金負債', '淨確定福利負債'], { cf: 'operating' }),
  // 權益
  A('capital', '股本', 'BS', 'EQ', 'engine', ['股本', '普通股', '資本', '實收資本']),
  A('cap_surplus', '資本公積', 'BS', 'EQ', 'engine', ['資本公積']),
  A('cap_adv', '預收股本（負數為應收股款）', 'BS', 'EQ', 'engine', ['預收股本', '預收股款'], { canBeNegative: true }),
  A('re', '保留盈餘', 'BS', 'EQ', 'engine', ['保留盈餘', '未分配盈餘', '法定盈餘公積', '特別盈餘公積', '累積虧損', '待彌補虧損'], { canBeNegative: true }),
  A('other_eq', '其他權益', 'BS', 'EQ', 'engine', ['其他權益', '其他綜合損益累計'], { canBeNegative: true }),
  A('treasury', '減：庫藏股票', 'BS', 'EQ', 'other', ['庫藏股'], { contra: true, cf: 'financing' }),
  // 綜合損益表
  A('revenue', '營業收入', 'IS', 'REV', 'engine', ['營業收入', '銷貨收入', '銷售收入', '勞務收入', '收入淨額', '營收']),
  A('cogs', '營業成本', 'IS', 'COGS', 'engine', ['營業成本', '銷貨成本', '勞務成本']),
  A('sell_exp', '推銷費用', 'IS', 'OPEX', 'engine', ['推銷費用', '銷售費用', '行銷費用']),
  A('admin_exp', '管理費用', 'IS', 'OPEX', 'engine', ['管理費用', '管理及總務費用', '一般管理']),
  A('rd_exp', '研究發展費用', 'IS', 'OPEX', 'engine', ['研究發展費用', '研發費用']),
  A('other_opex', '其他營業費用', 'IS', 'OPEX', 'engine', ['其他營業費用', '預期信用減損']),
  A('int_income', '利息收入', 'IS', 'NONOP', 'other', ['利息收入']),
  A('other_income', '其他收入', 'IS', 'NONOP', 'other', ['其他收入', '租金收入', '股利收入', '營業外收入']),
  A('other_gl', '其他利益及損失', 'IS', 'NONOP', 'other', ['其他利益及損失', '兌換', '處分', '其他損失', '營業外支出', '其他利益'], { canBeNegative: true }),
  A('fin_cost', '財務成本', 'IS', 'NONOP', 'engine', ['財務成本', '利息費用', '利息支出']),
  A('tax_exp', '所得稅費用', 'IS', 'TAX', 'engine', ['所得稅費用', '所得稅']),
  A('oci', '其他綜合損益（稅後淨額）', 'IS', 'OCI', 'engine', ['其他綜合損益'], { canBeNegative: true }),
];

// 原表小計/合計判斷（用於核對，不計入明細）
export const SUBTOTAL_PATTERNS: { re: RegExp; check: string }[] = [
  { re: /^流動資產(合計|總計|總額)/, check: 'CA' },
  { re: /非流動資產(合計|總計|總額)/, check: 'NCA' },
  { re: /^資產(合計|總計|總額)|資產總(計|額)/, check: 'ASSETS' },
  { re: /非流動負債(合計|總計|總額)/, check: 'NCL' },
  { re: /^流動負債(合計|總計|總額)/, check: 'CL' },
  { re: /負債及權益|負債及股東權益|負債暨權益/, check: 'LE' },
  { re: /^負債(合計|總計|總額)|負債總(計|額)/, check: 'LIAB' },
  { re: /權益(合計|總計|總額)|權益總(計|額)/, check: 'EQ' },
  { re: /營業毛利|銷貨毛利|毛利/, check: 'GP' },
  { re: /營業費用(合計|總計|總額)/, check: 'OPEX' },
  { re: /營業(淨)?利益|營業(淨)?損失|營業損益/, check: 'OPINC' },
  { re: /營業外收入及支出(合計|總計)?$/, check: 'NONOP' },
  { re: /稅前/, check: 'PBT' },
  { re: /綜合損益總額/, check: 'CI' },
  { re: /本期(淨利|淨損|損益)|本年度(淨利|損益)|稅後淨利/, check: 'NI' },
  { re: /每股盈餘|每股/, check: 'EPS' },
  { re: /(合計|總計|小計)$/, check: 'OTHER' },
];

export const FA_CLASSES: { key: string; name: string; depreciable: boolean; cip?: boolean }[] = [
  { key: 'land', name: '土地', depreciable: false },
  { key: 'building', name: '房屋及建築', depreciable: true },
  { key: 'machinery', name: '機器設備', depreciable: true },
  { key: 'transport', name: '運輸設備', depreciable: true },
  { key: 'office', name: '辦公設備', depreciable: true },
  { key: 'leasehold', name: '租賃改良', depreciable: true },
  { key: 'other', name: '其他設備', depreciable: true },
  { key: 'cip', name: '未完工程及待驗設備', depreciable: false, cip: true },
];

export const SECTION_NAMES: Record<Section, string> = {
  CA: '流動資產', NCA: '非流動資產', CL: '流動負債', NCL: '非流動負債', EQ: '權益',
  REV: '營業收入', COGS: '營業成本', OPEX: '營業費用', NONOP: '營業外收入及支出', TAX: '所得稅', OCI: '其他綜合損益',
};

export function allAccounts(custom: AccountDef[] = []): AccountDef[] {
  return [...DEFAULT_COA, ...custom];
}

export function findAccount(code: string, custom: AccountDef[] = []) {
  return allAccounts(custom).find((a) => a.code === code);
}

export const norm = (s: string) => s.replace(/[\s　:：()（）\-－、,，.]/g, '').replace(/^[0-9A-Za-z一二三四五六七八九十]+[.、]/, '');

// 依關鍵字建議對應科目；最長關鍵字優先
export function suggestAccount(label: string, stmt: Stmt | null, custom: AccountDef[] = []): string | null {
  const l = norm(label);
  if (!l) return null;
  if (stmt !== 'IS') {
    if (l.includes('累計折舊')) return 'ppe_accdep';
    if (l.includes('累計減損')) return 'ppe_accimp';
  }
  let best: { code: string; len: number } | null = null;
  for (const a of allAccounts(custom)) {
    if (stmt && a.stmt !== stmt) continue;
    for (const k of [a.name, ...a.keywords]) {
      const kk = norm(k);
      if (kk && l.includes(kk) && (!best || kk.length > best.len)) best = { code: a.code, len: kk.length };
    }
  }
  return best?.code ?? null;
}

export function detectSubtotal(label: string): string | null {
  const l = label.replace(/[\s　]/g, '');
  for (const p of SUBTOTAL_PATTERNS) if (p.re.test(l)) return p.check;
  return null;
}
