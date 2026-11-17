// 將單檔打包結果命名為帶版本與日期之檔名
import { renameSync, readFileSync, statSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = `release/五年財務預估App_v${pkg.version}_${d}.html`;
renameSync('release/index.html', out);
console.log(`已產出：${out}（${(statSync(out).size / 1048576).toFixed(2)} MB）`);
