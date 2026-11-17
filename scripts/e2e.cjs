// 端到端實測：以會計師查核報告版式財報走完整流程
// 用法：node scripts/e2e.cjs [網址或 HTML 檔路徑] [輸出資料夾]
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const target = process.argv[2] || 'http://localhost:4173/';
  const URL = /^https?:/.test(target) ? target : 'file://' + path.resolve(target);
  const SP = process.argv[3] || 'tests/out/e2e';
  fs.mkdirSync(SP, { recursive: true });
  const FIXTURE = path.resolve(__dirname, '../tests/fixtures/會計師版式財報_114.xlsx');
  const tmp = path.join(SP, 'client_fs.xlsx'); fs.copyFileSync(FIXTURE, tmp); // 測試工具對非 ASCII 路徑上傳不穩定，改用暫存英文檔名
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.accept());
  const log = (...a) => console.log('▶', ...a);
  const go = async (t) => { await pg.click(`.nav nav a:has-text("${t}")`); await pg.waitForTimeout(150); };
  // 依列名稱填第一個預估年度並延用至後續年度
  const fillRow = async (label, v) => {
    const row = pg.locator(`.grid-wrap tr:has(td.lbl:text-is("${label}"))`).first();
    const sel = row.locator('td.in select');
    if (await sel.count()) await sel.first().selectOption(v);
    else { const i = row.locator('td.in input').first(); await i.click(); await pg.keyboard.press('Control+a'); await pg.keyboard.type(String(v)); await pg.keyboard.press('Enter'); }
    await pg.waitForTimeout(80);
    const btn = row.locator('button:has-text("延用")');
    if (await btn.count()) { await btn.click(); await pg.waitForTimeout(80); }
  };
  const fillBase = async (label, v) => {
    const i = pg.locator(`.grid-wrap tr:has(td.lbl:text-is("${label}")) td.in input`).first();
    await i.click(); await pg.keyboard.press('Control+a'); await pg.keyboard.type(String(v)); await pg.keyboard.press('Enter'); await pg.waitForTimeout(80);
  };

  await pg.goto(URL);
  await pg.fill('input[placeholder^="例"]', '範例精密工業股份有限公司');
  await pg.click('button:has-text("建立")');
  await pg.waitForSelector('.nav');
  // ---- 匯入 ----
  await go('基期資料');
  await pg.locator('.card:has(h2:has-text("匯入 Excel")) input[type=file]').setInputFiles(tmp);
  for (const idx of [0, 1]) {
    await pg.waitForSelector('text=解析並建立對應');
    await pg.waitForTimeout(150);
    log(`工作表 ${idx} 自動辨識：`, (await pg.locator('.card:has(h2:has-text("匯入 Excel")) .small div').allInnerTexts()).join('｜'));
    await pg.click('text=解析並建立對應');
    await pg.waitForTimeout(200);
  }
  log('基期平衡：', await pg.locator('.card:has(h2:has-text("科目彙總")) p.ok, .card:has(h2:has-text("科目彙總")) p.error').first().innerText());
  log('待確認：', await pg.locator('label:has-text("只顯示待確認")').innerText());
  await pg.click('button:has-text("確認全部已對應項目")');
  log('年度頁籤：', (await pg.locator('.tabs button').allInnerTexts()).join('、'));
  // ---- 固定資產 ----
  await go('固定資產');
  await pg.check('label:has-text("僅有帳面淨額") input');
  await pg.check('label.check:has-text("機器設備") input');
  await pg.waitForTimeout(150);
  await fillBase('機器設備－成本（僅淨額，以淨額列示）', 75000000);
  await fillBase('機器設備－既有資產可折舊淨額（經確認）', 75000000);
  await fillBase('機器設備－既有資產殘值', 0);
  await fillBase('機器設備－既有資產剩餘耐用年限（年）', 10);
  await fillRow('機器設備－資本支出認列額', 8000000);
  await fillRow('機器設備－耐用年限（年）', 8);
  await fillRow('機器設備－殘值率', 0);
  // ---- 融資 ----
  await go('融資');
  log('借款：', (await pg.locator('.card table.grid tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join('｜'));
  await fillRow('既有短期借款－年利率', 2.4);
  await fillRow('既有長期借款－年利率', 2.8);
  await fillRow('既有長期借款－還款', 10000000);
  await fillRow('既有長期借款－還款月份（空白＝預設月份）', 12);
  await fillBase('既有長期借款－最末預估年度之次年度到期還款', 0);
  // ---- 假設 ----
  await go('逐年假設');
  for (const [l, v] of [['營收成長率', 5], ['毛利率', 25], ['折舊分攤至營業成本比率', 70], ['推銷費用占營收比率', 5], ['管理費用占營收比率', 6.5], ['研究發展費用占營收比率', 1.7], ['其他營業費用占營收比率', 0.1], ['應收帳款參數（天數或占營收比率）', 58], ['存貨參數（天數或占銷貨成本比率）', 48], ['應付帳款參數（天數或比率）', 40]]) await fillRow(l, v);
  const others = await pg.locator('.grid-wrap tr td.lbl:has-text("－預估方法")').allInnerTexts();
  for (const l of others) await fillRow(l, '固定金額');
  for (const l of ['利息收入', '其他收入', '其他利益及損失']) { await fillRow(`${l}－預估方法`, '手動金額'); await fillRow(`${l}－參數（金額或比率）`, 0); }
  await pg.locator('.card:has(h3:has-text("其他損益及資產負債科目")) input[type=checkbox]').evaluateAll((xs) => xs.forEach((x) => { if (!x.checked) x.click(); }));
  await pg.waitForTimeout(300);
  // ---- 結果 ----
  await go('勾稽與現金警示');
  const rows = await pg.locator('table.issues-t tbody tr').allInnerTexts();
  log('檢查清單（非提示）：'); rows.filter((r) => !/\t提示\t/.test(r)).forEach((r) => console.log('   ', r.replace(/\t/g, '｜')));
  await go('進度總覽');
  log('KPI：', (await pg.locator('.kpi').allInnerTexts()).map((x) => x.replace(/\n/g, ' ')).join('｜'));
  log('步驟：', (await pg.locator('table.steps tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join('｜'));
  await go('四大報表');
  await pg.click('.tabs button:has-text("資產負債表")');
  await pg.screenshot({ path: `${SP}/e2e_bs.png`, fullPage: true });
  await go('匯出');
  const [x1] = await Promise.all([pg.waitForEvent('download'), pg.click('text=匯出內部預估版 Excel')]);
  await x1.saveAs(`${SP}/e2e_internal.xlsx`);
  log('已匯出內部版 Excel');
  // PDF（銀行版列印版面）
  await go('銀行版編修');
  await pg.click('text=預覽列印版面');
  await pg.waitForTimeout(500);
  await pg.emulateMedia({ media: 'print' });
  await pg.pdf({ path: path.join(SP, 'e2e_bank.pdf'), preferCSSPageSize: true, printBackground: true });
  await pg.emulateMedia({ media: 'screen' });
  log('已產生銀行版 PDF');
  // 重新整理後資料仍在（本機儲存）
  await pg.reload();
  await pg.waitForSelector('table.list');
  log('重新整理後專案清單：', (await pg.locator('table.list tbody tr').allInnerTexts()).map((x) => x.split('	')[0]).join('、'));
  console.log('頁面錯誤', errs);
  await b.close();
  if (errs.length) process.exit(1);
})();
