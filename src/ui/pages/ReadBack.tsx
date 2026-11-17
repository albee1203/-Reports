import { useState } from 'react';
import { useP, fmtVal } from '../ctx';
import { setPath } from '../store';
import type { ExcelChange } from '../../export/excelImport';

const KIND: Record<string, string> = { input: '修改假設', override: '手動覆寫', restore: '恢復公式', conflict: '無法套用' };

export function ReadBackSection() {
  const { p, sc, g, ev, update } = useP();
  const [res, setRes] = useState<{ file: string; changes: ExcelChange[]; warnings: string[] } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const onFile = async (f: File) => {
    setErr('');
    try {
      const { readBack } = await import('../../export/excelImport');
      const r = await readBack(await f.arrayBuffer(), p, sc, g, ev);
      setRes({ file: f.name, ...r });
      setSel(new Set(r.changes.map((c, i) => (c.kind === 'conflict' ? -1 : i)).filter((i) => i >= 0)));
    } catch (e: any) { setErr(e.message ?? String(e)); }
  };
  const fmt = (c: ExcelChange, v: any) => (v === null || v === undefined ? '（空白）' : typeof v === 'number' ? fmtVal(v, g.byId.get(c.rowId)?.format ?? 'amount', 'yuan') : String(v));
  const apply = () => {
    if (!res) return;
    const picked = res.changes.filter((_, i) => sel.has(i));
    update((np) => {
      const s = np.scenarios.find((x) => x.id === sc.id)!;
      for (const c of picked) {
        if (c.kind === 'input' && c.path) setPath(np, sc.id, c.path, c.newValue);
        if (c.kind === 'override') { s.overrides[c.rowId] = { ...(s.overrides[c.rowId] ?? {}), [c.forecastIndex!]: c.newValue as number }; }
        if (c.kind === 'restore' && s.overrides[c.rowId]) delete s.overrides[c.rowId][c.forecastIndex!];
      }
    }, { action: '讀回 Excel 修改', detail: `${res.file}：套用 ${picked.length} 項（${picked.slice(0, 5).map((c) => `${c.label}［${c.year}］`).join('、')}${picked.length > 5 ? ' 等' : ''}）` });
    setRes(null);
  };
  return (
    <section className="card">
      <h2>讀回 Excel 修改</h2>
      <p className="muted small">選擇由本 App 匯出、並在 Excel 修改過的檔案。App 會比對假設輸入格及覆寫，列出差異供你勾選後套用至目前情境「{sc.name}」。公式儲存格被改為數值時，來源科目以「手動覆寫」處理並保留原公式；合計或連動數無法直接套用，需於來源科目修改。科目名稱、新增列及公式內容之修改不會讀回。</p>
      <label className="file">選擇 Excel 檔（.xlsx）<input type="file" accept=".xlsx" onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ''; }} /></label>
      {err && <p className="error">{err}</p>}
      {res && (
        <div>
          {res.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
          {res.changes.length === 0 ? <p className="ok">與目前情境相比沒有差異。</p> : (
            <>
              <table className="grid">
                <thead><tr><th><input type="checkbox" checked={sel.size > 0 && [...sel].length === res.changes.filter((c) => c.kind !== 'conflict').length} onChange={(e) => setSel(new Set(e.target.checked ? res.changes.map((c, i) => (c.kind === 'conflict' ? -1 : i)).filter((i) => i >= 0) : []))} /></th><th>類型</th><th>工作表</th><th>項目</th><th>年度</th><th>App 目前值</th><th>Excel 值</th><th>說明</th></tr></thead>
                <tbody>
                  {res.changes.map((c, i) => (
                    <tr key={i} className={c.kind === 'conflict' ? 'lv-warning' : ''}>
                      <td>{c.kind !== 'conflict' && <input type="checkbox" checked={sel.has(i)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); setSel(n); }} />}</td>
                      <td>{KIND[c.kind]}</td><td>{c.sheet}</td><td>{c.label}</td><td>{c.year}</td>
                      <td className="num">{c.kind === 'override' && c.oldValue === null ? fmt(c, ev.value(c.rowId, c.col)) + '（公式）' : fmt(c, c.oldValue)}</td>
                      <td className="num">{c.kind === 'restore' ? '（公式）' : fmt(c, c.newValue)}</td>
                      <td className="small">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button className="primary" disabled={!sel.size} onClick={apply}>套用勾選之 {sel.size} 項</button>
                <button onClick={() => setRes(null)}>取消</button>
                <span className="hint">套用後可用「復原」撤銷；建議先於「版本與修改紀錄」保存版本。</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
