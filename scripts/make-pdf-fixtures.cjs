// 產生 PDF 匯入測試檔：（一）瀏覽器列印之表格 PDF；（二）LibreOffice 由 Excel 轉出之 PDF
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const fx = path.resolve(__dirname, '../tests/fixtures');
  const { BS_ROWS, IS_ROWS } = JSON.parse(process.argv[2]);
  const table = (rows) => `<table>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="c${i}">${c.replace(/&/g, '&amp;')}</td>`).join('')}</tr>`).join('')}</table>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font-family:"Noto Sans CJK TC","Noto Sans TC",sans-serif;font-size:10pt} table{border-collapse:collapse;width:100%}
    td{padding:1px 6px} td.c3,td.c4,td.c5,td.c6{text-align:right} td.c0{width:40px} td.c1{width:220px} .pb{break-after:page}
  </style><div class="pb">${table(BS_ROWS)}</div><div>${table(IS_ROWS)}</div>`;
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.setContent(html);
  await pg.pdf({ path: path.join(fx, '財報_瀏覽器列印.pdf'), format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' } });
  await b.close();
  const out = path.resolve(__dirname, '../tests/out/pdf');
  fs.mkdirSync(out, { recursive: true });
  // 設定欄寬（科目欄加寬），模擬會計軟體正常輸出之版面
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(fx, '會計師版式財報_114.xlsx'));
  wb.eachSheet((ws) => { [8, 34, 8, 18, 6, 18, 6].forEach((w, i) => (ws.getColumn(i + 1).width = w)); ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; });
  const wide = path.join(out, 'financials_wide.xlsx');
  await wb.xlsx.writeFile(wide);
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out, wide], { stdio: 'pipe' });
  fs.copyFileSync(path.join(out, 'financials_wide.pdf'), path.join(fx, '財報_試算表軟體匯出.pdf'));
  console.log('已產生', fs.readdirSync(fx).filter((f) => f.endsWith('.pdf')));
})();
