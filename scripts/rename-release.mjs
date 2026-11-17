// 發行：將單檔打包結果命名為帶版本與日期之檔名，並產生含使用說明之 ZIP（固定檔名，方便由 GitHub 直接下載）
import { renameSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import JSZip from 'jszip';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const name = `五年財務預估App_v${pkg.version}_${d}.html`;
const out = `release/${name}`;
renameSync('release/index.html', out);
const zip = new JSZip();
zip.file(name, readFileSync(out));
zip.file('使用說明.txt', '﻿' + readFileSync('scripts/使用說明.txt', 'utf8').replace(/\n/g, '\r\n'));
const zipPath = 'release/五年財務預估App_最新版.zip';
writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
for (const f of [out, zipPath]) console.log(`已產出：${f}（${(statSync(f).size / 1048576).toFixed(2)} MB）`);
