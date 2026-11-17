import { useState } from 'react';
import { useP, fmtVal } from '../ctx';
import { NumInput } from '../Grid';
import { readFile, SheetData } from '../../engine/importer';
import { FA_FIELDS, FaField, guessFaColumns, parseFaRows } from '../../engine/faImport';
import { FA_CLASSES } from '../../engine/coa';
import { FaAsset } from '../../engine/project';

export function FaDetailSection() {
  const { p, update, ev, info } = useP();
  const [file, setFile] = useState<{ name: string; sheets: SheetData[] } | null>(null);
  const [si, setSi] = useState(0);
  const [hdr, setHdr] = useState(0);
  const [cols, setCols] = useState<Partial<Record<FaField, number>>>({});
  const [unit, setUnit] = useState(1);
  const [msg, setMsg] = useState<string[]>([]);
  const assets = p.faAssets ?? [];
  const fyEnd = `${p.settings.baseYear}-${p.settings.fyEnd}`;
  const onFile = async (f: File) => {
    try {
      const sheets = await readFile(f.name, await f.arrayBuffer());
      setFile({ name: f.name, sheets }); setSi(0); pickHeader(sheets[0], 0);
    } catch (e: any) { setMsg([e.message ?? String(e)]); }
  };
  const pickHeader = (sh: SheetData, forced?: number) => {
    let h = forced ?? 0;
    if (forced === undefined || forced === 0) {
      const found = sh.rows.findIndex((r) => r.some((c) => /成本|名稱/.test(c)));
      if (found >= 0) h = found;
    }
    setHdr(h); setCols(guessFaColumns(sh.rows[h] ?? []));
  };
  const sheet = file?.sheets[si];
  const doImport = (mode: 'replace' | 'append') => {
    if (!sheet) return;
    const res = parseFaRows(sheet.rows, hdr, cols, fyEnd, unit);
    update((np) => {
      np.faAssets = mode === 'replace' ? res.assets : [...(np.faAssets ?? []), ...res.assets];
      for (const a of np.faAssets) np.faBase[a.cls].enabled = true;
      np.faNature = 'gross';
    }, { action: '匯入固定資產明細', detail: `${file!.name}／${sheet.name}：${res.assets.length} 筆` });
    setMsg([`已匯入 ${res.assets.length} 筆資產。`, ...res.issues]);
    setFile(null);
  };
  const setA = (id: string, f: keyof FaAsset, v: any) => update((np) => { const a = np.faAssets!.find((x) => x.id === id)!; (a as any)[f] = v; if (f === 'cls') np.faBase[v].enabled = true; }, { action: '修改固定資產明細', detail: `${assets.find((x) => x.id === id)?.name}：${String(f)}＝${v}` });
  const nbvSum = assets.reduce((t, a) => t + (a.cost ?? 0) - (a.accDep ?? 0) - (a.accImp ?? 0), 0);
  const bsPpe = ev.num('bs:ppe', info.cb);
  const ncol = sheet ? Math.max(1, ...sheet.rows.slice(0, 30).map((r) => r.length)) : 0;
  return (
    <section className="card">
      <h3>逐筆固定資產明細（進階，選用）</h3>
      <p className="muted small">匯入財產目錄後，各類別基期成本、累計折舊及累計減損改以明細加總，既有資產折舊依每筆資產「(成本−累計折舊−累計減損−殘值)÷剩餘耐用年限」以直線法逐年計算。剩餘耐用年限優先採明細欄位；未提供時以耐用年限及取得日期推算；兩者皆無則依未折減比例概估。新增資本支出仍於下方排程依類別輸入。</p>
      <label className="file">選擇財產目錄（.xlsx、.csv）<input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
      {file && sheet && (
        <div>
          <div className="form compact">
            <label>工作表<select value={si} onChange={(e) => { setSi(+e.target.value); pickHeader(file.sheets[+e.target.value]); }}>{file.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>
            <label>標題列（第幾列）<NumInput value={hdr + 1} onCommit={(v) => v && pickHeader(sheet, v - 1)} /></label>
            <label>金額單位<select value={unit} onChange={(e) => setUnit(+e.target.value)}><option value={1}>元</option><option value={1000}>千元</option></select></label>
            {FA_FIELDS.map((f) => (
              <label key={f.key}>{f.label}{f.required ? '＊' : ''}
                <select value={cols[f.key] ?? ''} onChange={(e) => setCols({ ...cols, [f.key]: e.target.value === '' ? undefined : +e.target.value })}>
                  <option value="">（無）</option>
                  {Array.from({ length: ncol }, (_, c) => <option key={c} value={c}>{sheet.rows[hdr]?.[c] || `第 ${c + 1} 欄`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="preview"><table className="grid small"><tbody>{sheet.rows.slice(hdr, hdr + 15).map((r, i) => <tr key={i} className={i === 0 ? 'hdr' : ''}>{Array.from({ length: ncol }, (_, c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>
          <button className="primary" disabled={cols.name === undefined || cols.cost === undefined} onClick={() => (!assets.length || confirm('將取代現有明細，確定？')) && doImport('replace')}>匯入（取代現有明細）</button>{' '}
          {assets.length > 0 && <button onClick={() => doImport('append')}>匯入（附加）</button>}{' '}
          <button onClick={() => setFile(null)}>取消</button>
        </div>
      )}
      {msg.length > 0 && <div className="small">{msg.map((m, i) => <div key={i} className={i ? 'warn' : 'ok'}>{i ? '⚠ ' : ''}{m}</div>)}</div>}
      {assets.length > 0 && (
        <>
          <p className={Math.abs(nbvSum - bsPpe) >= 1 ? 'error' : 'ok'}>明細帳面淨額合計 {fmtVal(nbvSum, 'amount', 'yuan')}；資產負債表不動產、廠房及設備 {fmtVal(bsPpe, 'amount', 'yuan')}{Math.abs(nbvSum - bsPpe) >= 1 ? `，差額 ${fmtVal(nbvSum - bsPpe, 'amount', 'yuan')}（請檢查明細或基期對應）` : ' ✓ 一致'}</p>
          <div className="grid-wrap">
            <table className="grid fa-detail">
              <thead><tr><th>類別</th><th>名稱</th><th>取得日期</th><th>成本</th><th>累計折舊</th><th>累計減損</th><th>殘值</th><th>耐用年限</th><th>剩餘耐用年限</th><th>說明</th><th /></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td><select value={a.cls} onChange={(e) => setA(a.id, 'cls', e.target.value)}>{FA_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></td>
                    <td><input value={a.name} onChange={(e) => setA(a.id, 'name', e.target.value)} /></td>
                    <td className="nowrap">{a.acquired}</td>
                    {(['cost', 'accDep', 'accImp', 'residual', 'life', 'remLife'] as const).map((f) => <td key={f} className="in"><NumInput amount={!['life', 'remLife'].includes(f)} value={a[f]} onCommit={(v) => setA(a.id, f, v)} /></td>)}
                    <td className="desc small">{a.remLifeNote}</td>
                    <td><button className="mini danger" onClick={() => update((np) => { np.faAssets = np.faAssets!.filter((x) => x.id !== a.id); }, { action: '刪除固定資產明細', detail: a.name })}>刪除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="danger" onClick={() => confirm('清除全部明細？各類別將改回彙總輸入。') && update((np) => { np.faAssets = []; }, { action: '清除固定資產明細', detail: '' })}>清除全部明細</button>
        </>
      )}
    </section>
  );
}
