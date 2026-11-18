// PDF 財報匯入（電腦產生之文字型 PDF）：依文字座標還原為表格，再沿用 Excel 匯入流程
// 掃描或拍照之圖片型 PDF 無文字可讀，會提示改用 Excel 或請對方提供電子檔。
import type { SheetData } from './importer';

export interface PdfItem { str: string; x: number; y: number; w: number; h: number; page: number }

const CJK = /[㐀-鿿豈-﫿]/;
// 金額或比率：可含括號、負號、千分位、小數、%；單獨之「-」視為零
const NUMERIC = /^[(（\-－−△▲]?\s*[\d,，]+(\.\d+)?\s*[)）]?\s*%?$|^[-－—]$/;
const CODE = /^[0-9X]{3,6}$/i;

interface Token { str: string; x: number; r: number; y: number; h: number; page: number }

// pdf.js 讀取（瀏覽器與測試環境各自傳入 pdf.js 模組）
export async function extractItems(pdfjs: any, data: ArrayBuffer): Promise<PdfItem[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true }).promise;
  const items: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, , d, e, f] = it.transform;
      const h = Math.abs(it.height || Math.hypot(b, d) || 10);
      void a;
      items.push(...splitItem({ str: it.str, x: e, y: vp.height - f, w: it.width, h, page: p }));
    }
  }
  await doc.destroy();
  return items;
}

// 部分軟體將整列輸出為單一字串（以多個空白分隔），依字元比例估算各段位置
function splitItem(it: PdfItem): PdfItem[] {
  if (!/\S\s{2,}\S/.test(it.str)) return [{ ...it, str: it.str.trim() }];
  const out: PdfItem[] = [];
  const unit = it.w / Math.max(1, it.str.length);
  const re = /\S+(?:\s\S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(it.str))) out.push({ ...it, str: m[0], x: it.x + m.index * unit, w: m[0].length * unit });
  return out;
}

export function isTextless(items: PdfItem[]) {
  return items.filter((i) => /[\d㐀-鿿]/.test(i.str)).length < 5;
}

// 文字座標 → 列 → 詞
function toRows(items: PdfItem[]): Token[][] {
  const rows: Token[][] = [];
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  for (const pg of pages) {
    const its = items.filter((i) => i.page === pg).sort((a, b) => a.y - b.y || a.x - b.x);
    const groups: PdfItem[][] = [];
    for (const it of its) {
      const g = groups[groups.length - 1];
      const tol = Math.max(2, 0.45 * Math.min(it.h, g?.[0].h ?? it.h));
      if (g && Math.abs(it.y - g[0].y) <= tol) g.push(it); else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const toks: Token[] = [];
      for (const it of g) {
        const t = toks[toks.length - 1];
        const gap = t ? it.x - t.r : Infinity;
        const bothText = t && CJK.test(t.str) && CJK.test(it.str);
        // 一般相鄰字元合併；中文字詞允許較寬字距（如「資　　產」），但不跨越明顯欄距
        // 數字與數字（含表示零之「-」）之間只要有空隙即視為不同欄位，避免「800」與鄰欄「-」誤併為尾端負號「800-」
        const numLike = (x: string) => NUMERIC.test(x.trim()) || /^[-－—]$/.test(x.trim());
        const bothNum = t && numLike(t.str) && numLike(it.str);
        const join = t && (bothNum ? gap < 0.1 * it.h : gap < 0.35 * it.h || (bothText && gap < 2.2 * it.h));
        if (join) { t.str += (gap > 0.6 * it.h && !bothText ? ' ' : '') + it.str; t.r = it.x + it.w; }
        else toks.push({ str: it.str, x: it.x, r: it.x + it.w, y: it.y, h: it.h, page: pg });
      }
      for (const t of toks) t.str = t.str.replace(/\s+/g, (s) => (s.length > 1 ? ' ' : s)).trim();
      // 表頭文字尾端緊接之「%」（如「金額%」）拆為獨立欄
      const split: Token[] = [];
      for (const t of toks) {
        const m = t.str.match(/^(.*[\u3400-\u9fff].*?)\s*([%％])$/);
        if (m) { const pw = 0.6 * t.h; split.push({ ...t, str: m[1], r: t.r - pw }, { ...t, str: m[2], x: t.r - pw }); } else split.push(t);
      }
      rows.push(split.filter((t) => t.str));
    }
  }
  return rows;
}

interface Cluster { key: number; left: number; right: number; n: number; numeric: boolean }

function cluster(values: { key: number; left: number; right: number }[], tol: number, numeric: boolean): Cluster[] {
  const sorted = [...values].sort((a, b) => a.key - b.key);
  const out: Cluster[] = [];
  for (const v of sorted) {
    const c = out[out.length - 1];
    if (c && v.key - c.key / c.n <= tol) { c.key += v.key; c.n++; c.left = Math.min(c.left, v.left); c.right = Math.max(c.right, v.right); }
    else out.push({ key: v.key, left: v.left, right: v.right, n: 1, numeric });
  }
  return out.map((c) => ({ ...c, key: c.key / c.n }));
}

// 列 → 表格（第 0 欄代碼、第 1 欄科目、其後依位置排列之金額／附註欄）
// 各頁版面可能不同（如資產負債表與損益表欄寬不同），故逐頁分欄；「全部頁面」依各頁欄位順序對齊合併
export function itemsToSheets(items: PdfItem[]): SheetData[] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const perPage = pages.map((pg) => ({ pg, rows: pageGrid(items.filter((i) => i.page === pg)) }));
  if (pages.length === 1) return [{ name: '第 1 頁', rows: perPage[0].rows }];
  const width = Math.max(...perPage.map((p) => Math.max(0, ...p.rows.map((r) => r.length))));
  const all = perPage.flatMap((p) => p.rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]));
  return [{ name: `全部頁面（${pages.length} 頁）`, rows: all }, ...perPage.map((p) => ({ name: `第 ${p.pg} 頁`, rows: p.rows }))];
}

const HEADER_CODE = /^(代碼|代號|編號|科目代號|會計科目代號)\s*(.*)$/;

function pageGrid(items: PdfItem[]): string[][] {
  const rows = toRows(items);
  const isNum = (s: string) => NUMERIC.test(s.trim());
  // 每列：科目＝第一個含中文之詞；其前為代碼。表頭「代碼」與科目名稱相連時拆開
  const parsed = rows.map((toks) => {
    const li = toks.findIndex((t) => CJK.test(t.str));
    let label = li >= 0 ? { ...toks[li] } : null;
    const pre = li >= 0 ? toks.slice(0, li).map((t) => t.str) : [];
    const rest = li >= 0 ? toks.slice(li + 1) : toks;
    const m = label?.str.match(HEADER_CODE);
    if (label && m) { pre.push(m[1]); label = { ...label, str: m[2] }; }
    return { toks, label, pre, rest };
  });
  const h = items.length ? items.reduce((t, i) => t + i.h, 0) / items.length : 10;
  // 數字欄：以右緣對齊分群（僅取科目右側之數字，排除代碼）
  const isDash = (s: string) => /^[-－—]$/.test(s.trim());
  // 分群只採含數字之詞；表示零之「-」對齊方式不一，另依中心位置分配
  const numTok = parsed.flatMap((p) => p.rest.filter((t) => isNum(t.str) && !isDash(t.str)));
  const numCl = cluster(numTok.map((t) => ({ key: t.r, left: t.x, right: t.r })), Math.max(6, 1.2 * h), true).filter((c) => c.n >= 2);
  const inNum = (t: Token) => {
    // 數字：右緣最接近之數字欄；文字（表頭）：與數字欄水平範圍重疊者
    let best: Cluster | null = null, bd = Infinity;
    if (isDash(t.str)) {
      const mid = (t.x + t.r) / 2;
      for (const c of numCl) { const d = Math.abs(mid - (c.left + c.right) / 2); if (d < bd) { bd = d; best = c; } }
      return best;
    }
    if (isNum(t.str)) {
      for (const c of numCl) { const d = Math.abs(t.r - c.key); if (d < bd) { bd = d; best = c; } }
      return bd <= Math.max(10, 2 * h) ? best : null;
    }
    // 表頭文字：與數字欄水平範圍重疊者中，取右緣位於表頭右緣之後最近之欄（適用靠右、置中、靠左之表頭）
    const ov = numCl.filter((c) => !(t.r < c.left - 0.5 * h || t.x > c.right + 0.5 * h));
    if (!ov.length) return null;
    const after = ov.filter((c) => c.key >= t.r - 0.5 * h).sort((a, b) => a.key - b.key);
    return after[0] ?? ov.sort((a, b) => b.key - a.key)[0];
  };
  // 其餘文字欄（如附註）：以左緣分群
  const otherTok = parsed.flatMap((p) => p.rest.filter((t) => !inNum(t)));
  const txtCl = cluster(otherTok.map((t) => ({ key: t.x, left: t.x, right: t.r })), Math.max(8, 2 * h), false);
  const cols = [...numCl, ...txtCl].sort((a, b) => (a.numeric ? a.left : a.left) - (b.numeric ? b.left : b.left));
  const colOf = (t: Token) => {
    const nc = inNum(t);
    if (nc) return cols.indexOf(nc);
    let best = 0, bd = Infinity;
    cols.forEach((c, i) => { if (!c.numeric) { const d = Math.abs(t.x - c.key); if (d < bd) { bd = d; best = i; } } });
    return best;
  };
  return parsed.filter((p) => p.toks.length).map((p) => {
    const r: string[] = Array(2 + cols.length).fill('');
    r[0] = p.pre.join(' ');
    r[1] = p.label?.str ?? '';
    let lastNum = -1;
    for (const t of [...p.rest].sort((a, b) => a.x - b.x)) {
      let i = 2 + colOf(t);
      // 同列兩個數字落入同一欄時，右側者移至右邊下一個數字欄
      if (isNum(t.str) && r[i] && i <= lastNum) {
        const next = cols.findIndex((c, k) => k + 2 > lastNum && c.numeric);
        if (next >= 0) i = next + 2;
      }
      if (isNum(t.str)) lastNum = i;
      r[i] = r[i] ? `${r[i]} ${t.str}` : t.str;
    }
    // 無中文之列（純數字列）：第一個詞若為代碼則置於代碼欄
    if (!p.label && p.rest.length && CODE.test(p.rest[0].str) && !r[0]) r[0] = p.rest[0].str;
    return r;
  });
}
