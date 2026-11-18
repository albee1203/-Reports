// 瀏覽器端 PDF 讀取：pdf.js 與其 worker、繁體中文字元對照表（CMap）皆內嵌於 App，不需連網
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { extractItems, itemsToSheets, isTextless } from './engine/pdfImport';
import type { SheetData } from './engine/importer';

// 字元對照表（CMap）：繁體中文（CNS、Big5、香港）全套，及中日韓 Unicode 類（部分軟體以簡體、日、韓字型之 Unicode 編碼輸出繁體字），約 580 KB
const CMAPS = import.meta.glob(
  [
    '/node_modules/pdfjs-dist/cmaps/*CNS*.bcmap',
    '/node_modules/pdfjs-dist/cmaps/*B5*.bcmap',
    '/node_modules/pdfjs-dist/cmaps/Uni{GB,JIS,KS}-{UCS2,UTF16}-{H,V}.bcmap',
    '/node_modules/pdfjs-dist/cmaps/Adobe-{GB1,Japan1,Korea1}-*.bcmap',
  ],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

class InlineCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const key = Object.keys(CMAPS).find((k) => k.endsWith(`/${name}.bcmap`));
    if (!key) throw new Error(`不支援之字元對照表：${name}`);
    const buf = await (await fetch(CMAPS[key])).arrayBuffer();
    return { cMapData: new Uint8Array(buf), isCompressed: true };
  }
}

let workerUrl: string | null = null;

export async function readPdf(buf: ArrayBuffer): Promise<SheetData[]> {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const lib = { ...pdfjs, getDocument: (o: any) => (pdfjs as any).getDocument({ ...o, CMapReaderFactory: InlineCMapReaderFactory, useWorkerFetch: false }) };
  const items = await extractItems(lib, buf);
  if (isTextless(items)) throw new Error('此 PDF 沒有可讀取之文字（可能為掃描或拍照檔）。請改用 Excel 檔，或向對方索取由系統產生之電子檔 PDF。');
  return itemsToSheets(items);
}
