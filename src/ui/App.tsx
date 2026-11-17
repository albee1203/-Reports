import { useEffect, useMemo, useRef, useState } from 'react';
import { Project, newProject, syncScenarioWithBase, resizeProject } from '../engine/project';
import { buildGraph } from '../engine/model';
import { evaluate } from '../engine/graph';
import { collectIssues, reportStatus } from '../engine/checks';
import { sampleProject } from '../engine/sample';
import { ProjectCtx, Ctx, traceInfo, fmtVal, useP } from './ctx';
import { listProjects, loadProject, saveProject, deleteProject, copyProject, ProjectMeta, download } from './store';
import { NumInput } from './Grid';
import { SettingsPage } from './pages/Settings';
import { BasePage } from './pages/Base';
import { AssumptionsPage, FixedAssetsPage, LoansPage } from './pages/Assumptions';
import { StatementsPage } from './pages/Statements';
import { ChecksPage, ComparePage } from './pages/Checks';
import { BankPage } from './pages/Bank';
import { ExportPage, VersionsPage } from './pages/Export';

const PAGES: { key: string; label: string; step?: number }[] = [
  { key: 'settings', label: '專案設定', step: 1 },
  { key: 'base', label: '基期資料與科目對應', step: 2 },
  { key: 'assumptions', label: '逐年假設', step: 3 },
  { key: 'fixed', label: '固定資產', step: 3 },
  { key: 'loans', label: '融資（借款）', step: 3 },
  { key: 'statements', label: '四大報表', step: 4 },
  { key: 'checks', label: '勾稽與現金警示', step: 4 },
  { key: 'compare', label: '情境比較', step: 4 },
  { key: 'bank', label: '銀行版編修', step: 5 },
  { key: 'export', label: '匯出', step: 5 },
  { key: 'versions', label: '版本與修改紀錄' },
];

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  return projectId ? <Workspace id={projectId} onClose={() => setProjectId(null)} /> : <ProjectList onOpen={setProjectId} />;
}

function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<ProjectMeta[]>([]);
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const refresh = () => listProjects().then(setList);
  useEffect(() => { refresh(); }, []);
  const create = async (p: Project) => { await saveProject(p); onOpen(p.id); };
  const importJson = async (f: File) => {
    const p = JSON.parse(await f.text()) as Project;
    if (!p.id || !p.settings) { alert('檔案格式不符'); return; }
    await saveProject(p); refresh();
  };
  return (
    <div className="home">
      <header className="home-head">
        <h1>五年財務預估與銀行報表編修</h1>
        <p className="privacy">🔒 所有財報資料僅儲存在本機瀏覽器（IndexedDB），匯入、計算、匯出皆在本機完成，不傳送至任何雲端或 AI 服務。清除瀏覽器資料會刪除專案，請定期匯出備份。</p>
      </header>
      <section className="card">
        <h2>建立專案</h2>
        <div className="row">
          <label>公司名稱 <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：○○股份有限公司" /></label>
          <label>基期年度 <NumInput value={year} onCommit={(v) => setYear(v ?? year)} /></label>
          <button className="primary" disabled={!name.trim()} onClick={() => create(newProject(name.trim(), year))}>建立</button>
          <button onClick={() => create(sampleProject())}>載入範例專案</button>
        </div>
      </section>
      <section className="card">
        <h2>我的專案</h2>
        {list.length === 0 && <p className="muted">尚無專案。</p>}
        <table className="list">
          <thead><tr><th>專案</th><th>公司</th><th>基期</th><th>最後修改</th><th /></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td><a onClick={() => onOpen(m.id)}>{m.name}</a></td><td>{m.company}</td><td>{m.baseYear}</td>
                <td>{new Date(m.updatedAt).toLocaleString('zh-TW')}</td>
                <td className="actions">
                  <button onClick={() => onOpen(m.id)}>開啟</button>
                  <button onClick={async () => { const p = await loadProject(m.id); if (!p) return; const n = prompt('新專案名稱', `${p.name}（複本）`); if (n) { await saveProject(copyProject(p, n)); refresh(); } }}>複製</button>
                  <button onClick={async () => { const p = await loadProject(m.id); if (p) download(`${p.name}_備份.json`, JSON.stringify(p), 'application/json'); }}>備份</button>
                  <button className="danger" onClick={async () => { if (confirm(`確定刪除「${m.name}」？此動作無法復原。`)) { await deleteProject(m.id); refresh(); } }}>刪除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="file">匯入專案備份（.json）<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /></label>
      </section>
    </div>
  );
}

function Workspace({ id, onClose }: { id: string; onClose: () => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [page, setPage] = useState('settings');
  const [tr, setTr] = useState<{ row: string; col: number } | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<any>(null);
  useEffect(() => { loadProject(id).then((x) => { if (x) { x.scenarios.forEach((s) => syncScenarioWithBase(x, s)); setP(x); } }); }, [id]);
  const update: Ctx['update'] = (mut, log) => {
    setP((cur) => {
      if (!cur) return cur;
      const np: Project = structuredClone(cur);
      mut(np);
      if (np.settings.years !== cur.settings.years) resizeProject(np, np.settings.years);
      np.scenarios.forEach((s) => syncScenarioWithBase(np, s));
      if (log) { np.log.push({ at: new Date().toISOString(), scenario: np.scenarios.find((s) => s.id === np.activeScenarioId)?.name, ...log }); if (np.log.length > 3000) np.log.splice(0, np.log.length - 3000); }
      setSaved(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveProject(np).then(() => setSaved(true)), 400);
      return np;
    });
  };
  const model = useMemo(() => {
    if (!p) return null;
    const sc = p.scenarios.find((s) => s.id === p.activeScenarioId) ?? p.scenarios[0];
    try {
      const { g, info } = buildGraph(p, sc);
      const ev = evaluate(g);
      // 觸發求值以捕捉循環參照
      g.rows.forEach((r) => r.cells.forEach((_, c) => ev.value(r.id, c)));
      const issues = collectIssues(p, sc, g, ev, info, 'internal');
      const bankIssues = collectIssues(p, sc, g, ev, info, 'bank');
      return { sc, g, ev, info, issues, bankIssues, error: null };
    } catch (e: any) {
      return { sc, error: String(e?.message ?? e) } as any;
    }
  }, [p]);
  if (!p || !model) return <div className="loading">載入中…</div>;
  if (model.error) return <div className="card error">計算發生錯誤：{model.error}<button onClick={onClose}>返回</button></div>;
  const ctx: Ctx = { p, ...model, update, go: setPage, trace: (row, col) => setTr({ row, col }) };
  const status = reportStatus(model.issues, 'internal');
  const counts = { error: model.issues.filter((i: any) => i.level === 'error').length, incomplete: model.issues.filter((i: any) => i.level === 'incomplete').length };
  const PageComp = { settings: SettingsPage, base: BasePage, assumptions: AssumptionsPage, fixed: FixedAssetsPage, loans: LoansPage, statements: StatementsPage, checks: ChecksPage, compare: ComparePage, bank: BankPage, export: ExportPage, versions: VersionsPage }[page] ?? SettingsPage;
  return (
    <ProjectCtx.Provider value={ctx}>
      <div className="app">
        <aside className="nav">
          <div className="brand" onClick={onClose} title="返回專案清單">◀ 專案清單</div>
          <div className="proj-name">{p.settings.companyName}</div>
          <div className="muted small">基期 {p.settings.baseYear}・預估 {p.settings.years} 年</div>
          <ScenarioSwitcher />
          <nav>
            {PAGES.map((x) => (
              <a key={x.key} className={page === x.key ? 'active' : ''} onClick={() => setPage(x.key)}>
                {x.step && <span className="step">{x.step}</span>}{x.label}
                {x.key === 'checks' && (counts.error + counts.incomplete > 0) && <span className="badge">{counts.error + counts.incomplete}</span>}
              </a>
            ))}
          </nav>
          <div className={`status st-${status}`}>報表狀態：{status}</div>
          <div className="muted small">{saved ? '已儲存於本機' : '儲存中…'}</div>
        </aside>
        <main className="main">
          <PageComp />
        </main>
        {tr && <TracePanel row={tr.row} col={tr.col} onClose={() => setTr(null)} onNav={(row, col) => setTr({ row, col })} />}
      </div>
    </ProjectCtx.Provider>
  );
}

function ScenarioSwitcher() {
  const { p, sc, update } = useP();
  return (
    <div className="scen">
      <label>情境
        <select value={sc.id} onChange={(e) => update((np) => { np.activeScenarioId = e.target.value; })}>
          {p.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function TracePanel({ row, col, onClose, onNav }: { row: string; col: number; onClose: () => void; onNav: (r: string, c: number) => void }) {
  const { g, ev, p, sc, update } = useP();
  const t = traceInfo(g, ev, row, col);
  if (!t) return null;
  const unit = p.settings.unit;
  const colInfo = g.columns[col];
  const fIndex = col - (g.columns.findIndex((c) => c.type === 'base') + 1);
  const canOverride = t.row.overridable && colInfo.type === 'forecast';
  const ov = sc.overrides[row]?.[fIndex];
  const setOv = (v: number | null) => update((np) => {
    const s = np.scenarios.find((x) => x.id === sc.id)!;
    s.overrides[row] = { ...(s.overrides[row] ?? {}) };
    if (v === null) delete s.overrides[row][fIndex]; else s.overrides[row][fIndex] = v;
  }, { action: v === null ? '恢復公式' : '手動覆寫', detail: `${t.row.label}［${colInfo.label}］${v === null ? '' : `：公式值 ${fmtVal(t.value, t.row.format, 'yuan')} → ${v}`}` });
  return (
    <aside className="trace">
      <div className="trace-head"><b>公式追溯</b><button className="mini" onClick={onClose}>✕</button></div>
      <div className="trace-title">{t.row.sheet}／{t.row.label}［{colInfo.label}｜{colInfo.type === 'forecast' ? '預估' : '實際'}］</div>
      <div className={`kind k-${g.byId.get(row)!.cells[col]?.kind}`}>{t.kindLabel}</div>
      <div className="trace-val">{fmtVal(t.value, t.row.format, unit) || '—'}</div>
      {t.row.desc && <p className="muted small">{t.row.desc}</p>}
      <div className="formula">{t.text}</div>
      {t.original && <div className="small">原公式：<div className="formula">{t.original}</div></div>}
      {t.missing.length > 0 && (
        <div className="warn small">未完成：缺少 {t.missing.slice(0, 8).map((m, i) => <a key={i} onClick={() => onNav(m.row.id, m.col)}>{m.row.label}［{g.columns[m.col].label}］ </a>)}</div>
      )}
      {t.refs.length > 0 && (
        <table className="refs">
          <tbody>
            {t.refs.map((x, i) => (
              <tr key={i} onClick={() => onNav(x.row.id, x.col)}>
                <td>{x.row.label}<span className="muted">［{g.columns[x.col].label}］</span></td>
                <td className={`k-${x.kind}`}>{fmtVal(x.value, x.row.format, unit) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canOverride && (
        <div className="override">
          <b>手動覆寫</b>
          <p className="small muted">覆寫會在來源科目生效，並重新計算受影響報表及後續年度；原公式保留。</p>
          <NumInput value={ov ?? null} pct={t.row.format === 'pct'} onCommit={(v) => setOv(v)} placeholder="輸入覆寫值（元）" />
          {ov !== undefined && <button onClick={() => setOv(null)}>恢復公式</button>}
        </div>
      )}
      {!canOverride && colInfo.type === 'forecast' && g.byId.get(row)!.cells[col]?.kind === 'formula' && <p className="small muted">此為彙總或連動數，請點選上方來源科目後覆寫，合計將依明細重算。</p>}
    </aside>
  );
}
