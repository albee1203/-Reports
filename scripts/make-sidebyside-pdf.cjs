// 產生「資產負債表左右並列」測試 PDF（左：資產；右：負債及權益；同列並排，A4 橫式）
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const { BS_ROWS, IS_ROWS } = JSON.parse(process.argv[2]);
  const esc = (s) => String(s).replace(/&/g, '&amp;');
  const split = BS_ROWS.findIndex((r) => r[1] === '負債及權益');
  const left = BS_ROWS.slice(4, split);                 // 自表頭列起之資產
  const right = [['代碼', '負債及權益', '附註', '114年12月31日 金額', '%', '113年12月31日 金額', '%'], ...BS_ROWS.slice(split + 1)];
  const n = Math.max(left.length, right.length);
  const rows = Array.from({ length: n }, (_, i) => [...(left[i] ?? Array(7).fill('')), ...(right[i] ?? Array(7).fill(''))]);
  const td = (r) => r.map((c, i) => `<td class="c${i % 7}${i >= 7 ? ' r' : ''}">${esc(c)}</td>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font-family:"Noto Sans CJK TC",sans-serif;font-size:8pt} table{border-collapse:collapse;width:100%} td{padding:1px 4px;white-space:nowrap}
    td.c3,td.c4,td.c5,td.c6{text-align:right} td.c0.r{padding-left:18px} .h{text-align:center} .pg{break-after:page}
  </style>
  <div class="pg"><div class="h">範例精密工業股份有限公司</div><div class="h">資產負債表</div><div class="h">民國114年及113年12月31日</div><div style="text-align:right">單位：新台幣千元</div>
  <table>${rows.map((r) => `<tr>${td(r)}</tr>`).join('')}</table></div>
  <div><table>${IS_ROWS.map((r) => `<tr>${r.map((c, i) => `<td class="c${i}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.setContent(html);
  await pg.pdf({ path: path.resolve(__dirname, '../tests/fixtures/財報_左右並列.pdf'), format: 'A4', landscape: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await b.close();
  console.log('已產生 財報_左右並列.pdf');
})();
