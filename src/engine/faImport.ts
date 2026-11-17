// 逐筆固定資產明細匯入：欄位對應、類別判斷、剩餘耐用年限推算
import { FaAsset, uid, Num } from './project';
import { parseAmount } from './importer';

export type FaField = 'cls' | 'name' | 'acquired' | 'cost' | 'accDep' | 'accImp' | 'residual' | 'life' | 'remLife';
export const FA_FIELDS: { key: FaField; label: string; required?: boolean; patterns: RegExp }[] = [
  { key: 'cls', label: '資產類別', patterns: /類別|分類|科目|類型/ },
  { key: 'name', label: '資產名稱', required: true, patterns: /名稱|品名|資產|項目|說明/ },
  { key: 'acquired', label: '取得日期', patterns: /取得|購入|啟用|日期/ },
  { key: 'cost', label: '原始成本', required: true, patterns: /成本|原值|取得價/ },
  { key: 'accDep', label: '累計折舊', patterns: /累計折舊|累折/ },
  { key: 'accImp', label: '累計減損', patterns: /減損/ },
  { key: 'residual', label: '殘值', patterns: /殘值/ },
  { key: 'life', label: '耐用年限（年）', patterns: /^(?!.*剩餘).*(耐用|年限)/ },
  { key: 'remLife', label: '剩餘耐用年限（年）', patterns: /剩餘|未折減/ },
];

const CLASS_RULES: [RegExp, string][] = [
  [/未完工程|待驗|在建|預付設備/, 'cip'],
  [/土地/, 'land'],
  [/租賃改良|裝修|裝潢/, 'leasehold'],
  [/房屋|建築|廠房|建物/, 'building'],
  [/機器|機械|生產設備/, 'machinery'],
  [/運輸|車輛|汽車|貨車|機車|堆高機/, 'transport'],
  [/辦公|電腦|事務|生財|傢俱|家具/, 'office'],
];

export function guessClass(text: string): string {
  for (const [re, k] of CLASS_RULES) if (re.test(text)) return k;
  return 'other';
}

export function guessFaColumns(header: string[]): Partial<Record<FaField, number>> {
  const out: Partial<Record<FaField, number>> = {};
  const used = new Set<number>();
  // 先比對較特定之欄位
  for (const f of [...FA_FIELDS].sort((a, b) => (a.key === 'name' ? 1 : 0) - (b.key === 'name' ? 1 : 0))) {
    const i = header.findIndex((h, idx) => !used.has(idx) && f.patterns.test(String(h ?? '').replace(/\s/g, '')));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  return out;
}

// 解析日期（西元或民國、yyyy/mm/dd、yyyy-mm、Excel 序號）→ yyyy-mm-dd
export function parseDate(raw: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) { // Excel 日期序號
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = t.match(/^(?:民國)?\s*(\d{2,4})\s*[\/\-.年]\s*(\d{1,2})(?:\s*[\/\-.月]\s*(\d{1,2}))?/);
  if (!m) return null;
  let y = +m[1];
  if (y < 1911) y += 1911; // 民國年
  const mo = Math.min(12, Math.max(1, +m[2]));
  const d = m[3] ? Math.min(31, Math.max(1, +m[3])) : 1;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const num = (raw: string | undefined): { v: Num; err?: boolean } => {
  if (raw === undefined || String(raw).trim() === '') return { v: null };
  const p = parseAmount(String(raw));
  return p.error ? { v: null, err: true } : { v: p.value };
};

export interface FaParseResult { assets: FaAsset[]; issues: string[] }

// fyEnd：基期年度結束日 yyyy-mm-dd
export function parseFaRows(rows: string[][], headerRow: number, cols: Partial<Record<FaField, number>>, fyEnd: string, unitMultiplier = 1): FaParseResult {
  const assets: FaAsset[] = [];
  const issues: string[] = [];
  const get = (r: string[], f: FaField) => (cols[f] === undefined ? undefined : r[cols[f]!]);
  const end = new Date(fyEnd + 'T00:00:00Z');
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = String(get(r, 'name') ?? '').trim();
    const costR = num(get(r, 'cost'));
    if (!name && costR.v === null) continue;
    if (/合計|總計|小計/.test(name)) continue;
    const line = `第 ${i + 1} 列「${name || '（無名稱）'}」`;
    const fields: Record<string, Num> = {};
    for (const f of ['cost', 'accDep', 'accImp', 'residual'] as const) {
      const x = num(get(r, f));
      if (x.err) issues.push(`${line}：${f === 'cost' ? '成本' : f === 'accDep' ? '累計折舊' : f === 'accImp' ? '累計減損' : '殘值'}格式錯誤`);
      fields[f] = x.v === null ? null : Math.abs(x.v) * unitMultiplier;
    }
    const life = num(get(r, 'life')).v;
    const remIn = num(get(r, 'remLife')).v;
    const acquired = parseDate(String(get(r, 'acquired') ?? '')) ?? '';
    if (get(r, 'acquired') && !acquired) issues.push(`${line}：取得日期無法辨識`);
    const clsText = `${get(r, 'cls') ?? ''} ${name}`;
    const cls = guessClass(clsText);
    const cost = fields.cost ?? 0;
    if (fields.cost === null) issues.push(`${line}：缺少原始成本`);
    const accDep = fields.accDep ?? 0, accImp = fields.accImp ?? 0, residual = fields.residual ?? 0;
    if (accDep + accImp > cost + 0.5) issues.push(`${line}：累計折舊及減損大於成本`);
    let remLife: Num = null;
    let note = '';
    const depreciable = cls !== 'land' && cls !== 'cip';
    const depBase = cost - accDep - accImp - residual;
    if (depreciable) {
      if (remIn !== null) { remLife = remIn; note = '依明細提供之剩餘耐用年限'; }
      else if (life !== null && acquired) {
        const elapsed = (end.getTime() - new Date(acquired + 'T00:00:00Z').getTime()) / (365.25 * 86400000);
        remLife = Math.max(0, +(life - Math.max(0, elapsed)).toFixed(2));
        note = `耐用 ${life} 年，至基期末已使用約 ${Math.max(0, elapsed).toFixed(2)} 年`;
      } else if (life !== null && cost - residual > 0) {
        remLife = +(life * (depBase / (cost - residual))).toFixed(2);
        note = '未提供取得日期，依未折減比例推算，概估';
      } else note = '';
      if (depBase > 0.5 && (remLife === null || remLife <= 0)) issues.push(`${line}：尚有可折舊金額 ${Math.round(depBase).toLocaleString('zh-TW')}，但剩餘耐用年限為 ${remLife ?? '空白'}，請補入`);
    }
    assets.push({ id: uid(), cls, name: name || `資產 ${i + 1}`, acquired, cost, accDep, accImp, residual, life, remLife: depreciable ? (remLife !== null && remLife > 0 ? remLife : null) : null, remLifeNote: note || undefined });
  }
  return { assets, issues };
}
