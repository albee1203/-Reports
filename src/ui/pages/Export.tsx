import { useState, useMemo } from 'react';
import { useP, unitLabel, fmtVal } from '../ctx';
import { buildGraph } from '../../engine/model';
import { evaluate } from '../../engine/graph';
import { assumptionDiff } from '../../engine/diff';
import { DiffTable } from './Checks';
import { Project, Version } from '../../engine/project';
import { download, snapshot, restoreVersion } from '../store';
import { reportStatus } from '../../engine/checks';
import { PrintView } from './Bank';
import { ReadBackSection } from './ReadBack';

export function ExportPage() {
  const { p, sc, g, ev, issues, bankIssues, update } = useP();
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const doExcel = async (mode: 'internal' | 'bank') => {
    setBusy(mode);
    try {
      const { workbookBuffer, fileName } = await import('../../export/excel');
      const buf = await workbookBuffer({ mode, project: p, scenario: sc, graph: g, ev, issues: mode === 'bank' ? bankIssues : issues });
      download(fileName(p, mode), buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      update(() => {}, { action: '匯出 Excel', detail: `${mode === 'bank' ? '銀行版' : '內部版'}／情境：${sc.name}` });
    } finally { setBusy(''); }
  };
  return (
    <div>
      <h1>匯出</h1>
      <section className="card">
        <h2>Excel（.xlsx，預設）</h2>
        <p>作為後續手動調整的主檔。活頁簿包含：封面及說明、假設及計算依據、基期資料、原始匯入資料、各計算明細、四大報表、勾稽檢查{'；'}銀行版另含附註。每個預估年度保留可在 Excel 重算之公式，修改「假設及計算依據」等輸入儲存格後，報表及勾稽一併更新。</p>
        <p className="muted small">情境：{sc.name}　單位：{unitLabel(p.settings.unit)}（千元以儲存格格式顯示，底層仍為元）　內部版狀態：{reportStatus(issues, 'internal')}　銀行版狀態：{reportStatus(bankIssues, 'bank')}</p>
        <div className="row">
          <button className="primary" disabled={!!busy} onClick={() => doExcel('internal')}>{busy === 'internal' ? '產生中…' : '匯出內部預估版 Excel'}</button>
          <button className="primary" disabled={!!busy} onClick={() => doExcel('bank')}>{busy === 'bank' ? '產生中…' : '匯出銀行送件版 Excel'}</button>
        </div>
        <p className="hint">內部預估版不含財報附註。勾稽檢查工作表供內部查閱，不在正式報表列印範圍內。</p>
      </section>
      <ReadBackSection />
      <section className="card">
        <h2>PDF（銀行版，選用）</h2>
        <p className="muted small">A4，依報表寬度自動直式／橫式；含空白簽章欄，無頁碼。</p>
        <button onClick={() => setPreview(true)}>預覽並列印／另存 PDF</button>
      </section>
      <section className="card">
        <h2>專案備份</h2>
        <button onClick={() => download(`${p.name}_備份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(p), 'application/json')}>下載專案備份（未加密 .json）</button>
        <p className="hint">備份檔包含所有財報資料，請妥善保管；需寄送或存放於共用位置時，建議使用加密備份。</p>
        <EncryptedBackupForm />
      </section>
      {preview && <PrintView onClose={() => setPreview(false)} />}
    </div>
  );
}

function EncryptedBackupForm() {
  const { p, update } = useP();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = pw.length >= 8 && pw === pw2;
  const go = async () => {
    setBusy(true);
    try {
      const { encryptJson } = await import('../crypto');
      const b = await encryptJson(p, pw);
      download(`${p.name}_加密備份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
      update(() => {}, { action: '下載加密備份', detail: p.name });
      setPw(''); setPw2('');
    } finally { setBusy(false); }
  };
  return (
    <div className="subcard">
      <b>加密備份</b>
      <div className="row">
        <input type="password" autoComplete="new-password" placeholder="密碼（至少 8 碼）" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="再次輸入密碼" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button className="primary" disabled={!ok || busy} onClick={go}>{busy ? '加密中…' : '下載加密備份'}</button>
      </div>
      {pw2 && pw !== pw2 && <p className="warn small">兩次輸入的密碼不同。</p>}
      <p className="hint">於本機以 AES-GCM 256 位元加密，金鑰由密碼經 PBKDF2（310,000 次）推導。密碼不會儲存或傳送；忘記密碼將無法還原備份。</p>
    </div>
  );
}

export function VersionsPage() {
  const [cmp, setCmp] = useState<string | null>(null);
  const { p, update } = useP();
  const [label, setLabel] = useState('');
  return (
    <div>
      <h1>版本與修改紀錄</h1>
      <section className="card">
        <h2>版本保存</h2>
        <div className="row">
          <input placeholder="版本名稱（例：送銀行前定稿）" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="primary" disabled={!label.trim()} onClick={() => { update((np) => { np.versions.unshift(snapshot(np, label.trim())); }, { action: '保存版本', detail: label.trim() }); setLabel(''); }}>保存目前版本</button>
        </div>
        <table className="grid">
          <thead><tr><th>版本</th><th>保存時間</th><th /></tr></thead>
          <tbody>
            {p.versions.map((v) => (
              <tr key={v.id}>
                <td>{v.label}</td><td>{new Date(v.at).toLocaleString('zh-TW')}</td>
                <td>
                  <button className="mini" onClick={() => setCmp(cmp === v.id ? null : v.id)}>{cmp === v.id ? '關閉比較' : '與目前比較'}</button>
                  <button className="mini" onClick={() => confirm(`還原至「${v.label}」？目前未保存之內容將被取代（可先保存目前版本）。`) && update((np) => { Object.assign(np, restoreVersion(np, v)); })}>還原</button>
                  <button className="mini danger" onClick={() => confirm('刪除此版本？') && update((np) => { np.versions = np.versions.filter((x) => x.id !== v.id); }, { action: '刪除版本', detail: v.label })}>刪除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {cmp && p.versions.find((v) => v.id === cmp) && <VersionCompare v={p.versions.find((v) => v.id === cmp)!} />}
      <section className="card">
        <h2>修改紀錄（最近 300 筆）</h2>
        <table className="grid">
          <thead><tr><th>時間</th><th>情境</th><th>動作</th><th>內容</th></tr></thead>
          <tbody>
            {[...p.log].reverse().slice(0, 300).map((l, i) => <tr key={i}><td className="nowrap">{new Date(l.at).toLocaleString('zh-TW')}</td><td>{l.scenario ?? ''}</td><td>{l.action}</td><td>{l.detail}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// 版本比較：同一情境之關鍵數字與假設差異
function VersionCompare({ v }: { v: Version }) {
  const { p, sc, g, ev, info } = useP();
  const res = useMemo(() => {
    const old: Project = { ...JSON.parse(v.snapshot), versions: [] };
    const osc = old.scenarios.find((x) => x.id === sc.id);
    if (!osc) return null;
    const og = buildGraph(old, osc);
    return { g: og.g, ev: evaluate(og.g), info: og.info };
  }, [v, sc.id]);
  if (!res) return <section className="card"><p className="warn">版本「{v.label}」中沒有目前情境「{sc.name}」，無法比較。</p></section>;
  const u = p.settings.unit;
  const years = info.fcols.map((c) => g.columns[c].year).filter((y) => res.g.columns.some((c) => c.year === y && c.type === 'forecast'));
  const val = (gg: typeof g, e: typeof ev, id: string, y: number) => { const c = gg.columns.findIndex((x) => x.year === y); return gg.byId.has(id) ? e.num(id, c) : 0; };
  const metrics: [string, (gg: typeof g, e: typeof ev, y: number) => number][] = [
    ['營業收入', (gg, e, y) => val(gg, e, 'is:rev', y)],
    ['本期淨利', (gg, e, y) => val(gg, e, 'is:ni', y)],
    ['年末現金', (gg, e, y) => val(gg, e, 'bs:cash', y)],
    ['借款餘額', (gg, e, y) => val(gg, e, 'l:short', y) + val(gg, e, 'l:long_total', y)],
    ['權益總計', (gg, e, y) => val(gg, e, 'bs:equity', y)],
  ];
  return (
    <>
      <section className="card">
        <h2>版本比較：「{v.label}」與目前（情境：{sc.name}，{unitLabel(u)}）</h2>
        <table className="grid stmt">
          <thead><tr><th>指標</th><th /> {years.map((y) => <th key={y} className="forecast">{y}</th>)}</tr></thead>
          <tbody>
            {metrics.map(([name, f]) => ['版本', '目前', '差異'].map((k, ki) => (
              <tr key={name + k} className={ki === 0 ? 'group-start' : ki === 2 ? 'subtotal' : ''}>
                {ki === 0 && <td rowSpan={3} className="lbl"><b>{name}</b></td>}
                <td className="muted">{k}</td>
                {years.map((y) => {
                  const a = f(res.g, res.ev, y), b = f(g, ev, y);
                  const x = ki === 0 ? a : ki === 1 ? b : b - a;
                  return <td key={y} className={`num ${ki === 2 && Math.abs(x) >= 0.5 ? 'changed' : ''}`}>{fmtVal(x, 'amount', u)}</td>;
                })}
              </tr>
            )))}
          </tbody>
        </table>
      </section>
      <DiffTable title="假設及覆寫差異" names={[`版本「${v.label}」`, '目前']} diffs={assumptionDiff([res.g, g])} graphs={[res.g, g]} />
    </>
  );
}
