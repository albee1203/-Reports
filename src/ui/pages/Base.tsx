import { useState } from 'react';
import { useP, fmtVal } from '../ctx';
import { NumInput } from '../Grid';
import { allAccounts, SECTION_NAMES, Section, AccountDef, CfClass } from '../../engine/coa';
import { readFile, SheetData, guessLayout, buildLines, newRawImport, applyImport, remapLine, reconcileSubtotals, MapConfig } from '../../engine/importer';
import { Project, YearData, emptyYear, yearAmount, recomputeYearAccounts, uid } from '../../engine/project';
import { SH } from '../../engine/model';

const yearOf = (p: Project, year: number): YearData | undefined => (year === p.base.year ? p.base : p.comparatives.find((y) => y.year === year));

export function BasePage() {
  const { p, update } = useP();
  const [year, setYear] = useState(p.base.year);
  const y = yearOf(p, year) ?? p.base;
  const years = [p.base.year, ...p.comparatives.map((c) => c.year)].sort((a, b) => b - a);
  return (
    <div>
      <h1>2. 基期資料與科目對應</h1>
      <p className="muted">一個基期年度（全年損益表＋年末資產負債表）即可開始預估。銀行版可日後補匯前一年度財報作為比較資訊，補匯時保留原選定基期。</p>
      <div className="tabs">
        {years.map((yy) => <button key={yy} className={yy === year ? 'active' : ''} onClick={() => setYear(yy)}>{yy}{yy === p.base.year ? '（基期）' : '（前期比較）'}</button>)}
        <button onClick={() => {
          const ny = Math.min(p.base.year, ...p.comparatives.map((c) => c.year)) - 1;
          update((np) => { np.comparatives.push(emptyYear(ny)); }, { action: '新增前期比較年度', detail: String(ny) });
          setYear(ny);
        }}>＋ 補匯前期比較年度</button>
        {year !== p.base.year && <button className="danger" onClick={() => { if (confirm(`刪除 ${year} 年度比較資料？`)) { update((np) => { np.comparatives = np.comparatives.filter((c) => c.year !== year); }, { action: '刪除比較年度', detail: String(year) }); setYear(p.base.year); } }}>刪除此比較年度</button>}
      </div>
      <ImportWizard year={year} />
      <MappingTable y={y} />
      <AccountSummary y={y} />
      {year === p.base.year && <BaseExtraStatements />}
    </div>
  );
}

function ImportWizard({ year }: { year: number }) {
  const { p, update } = useP();
  const [file, setFile] = useState<{ name: string; sheets: SheetData[] } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [cfg, setCfg] = useState<Omit<MapConfig, 'fileName' | 'sheet'> | null>(null);
  const [err, setErr] = useState('');
  const onFile = async (f: File) => {
    setErr('');
    try {
      const sheets = await readFile(f.name, await f.arrayBuffer());
      setFile({ name: f.name, sheets }); setSheetIdx(0);
      const lay = guessLayout(sheets[0].rows);
      setCfg({ stmt: 'BS', year, currency: 'TWD', unitMultiplier: 1, signConvention: 'presentation', ...lay });
    } catch (e: any) { setErr(e.message ?? String(e)); }
  };
  const sheet = file?.sheets[sheetIdx];
  const doImport = () => {
    if (!file || !sheet || !cfg) return;
    const full: MapConfig = { ...cfg, fileName: file.name, sheet: sheet.name, year };
    update((np) => {
      const raw = newRawImport(full, sheet.rows);
      np.imports.push(raw);
      const yd = yearOf(np, year)!;
      applyImport(yd, raw, buildLines(sheet.rows, full, raw.id, np.customAccounts), np.customAccounts);
    }, { action: '匯入財報', detail: `${file.name}／${sheet.name}／${cfg.stmt}／${year}` });
    setFile(null);
  };
  const set = (k: string, v: any) => setCfg((c) => ({ ...c!, [k]: v }));
  return (
    <section className="card">
      <h2>匯入 Excel／CSV（{year} 年度）</h2>
      <label className="file">選擇檔案（.xlsx、.csv）<input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
      {err && <p className="error">{err}</p>}
      {file && sheet && cfg && (
        <>
          <div className="form compact">
            <label>工作表<select value={sheetIdx} onChange={(e) => { const i = +e.target.value; setSheetIdx(i); setCfg({ ...cfg, ...guessLayout(file.sheets[i].rows) }); }}>{file.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>
            <label>報表類型<select value={cfg.stmt} onChange={(e) => set('stmt', e.target.value)}><option value="BS">資產負債表</option><option value="IS">綜合損益表</option><option value="TB">試算表（兩表合一）</option></select></label>
            <label>年度<input value={year} disabled /></label>
            <label>幣別<input value={cfg.currency} onChange={(e) => set('currency', e.target.value)} /></label>
            <label>金額單位<select value={cfg.unitMultiplier} onChange={(e) => set('unitMultiplier', +e.target.value)}><option value={1}>元</option><option value={1000}>千元</option><option value={1000000}>百萬元</option></select></label>
            <label>正負號慣例<select value={cfg.signConvention} onChange={(e) => set('signConvention', e.target.value)}><option value="presentation">報表表達（正常餘額為正）</option><option value="debitPositive">借方正、貸方負（試算表）</option></select></label>
            <label>標題列（第幾列）<NumInput value={cfg.headerRow + 1} onCommit={(v) => v && set('headerRow', v - 1)} /></label>
            <label>科目欄<select value={cfg.labelCol} onChange={(e) => set('labelCol', +e.target.value)}>{colOpts(sheet)}</select></label>
            <label>金額欄<select value={cfg.amountCol} onChange={(e) => set('amountCol', +e.target.value)}>{colOpts(sheet)}</select></label>
          </div>
          {cfg.currency !== p.settings.currency && <p className="warn">匯入幣別（{cfg.currency}）與專案幣別（{p.settings.currency}）不同，第一版不自動換算，請確認。</p>}
          <div className="preview">
            <table className="grid small">
              <tbody>
                {sheet.rows.slice(0, 40).map((r, i) => (
                  <tr key={i} className={i === cfg.headerRow ? 'hdr' : i < cfg.headerRow ? 'skip' : ''}>
                    <td className="muted">{i + 1}</td>
                    {Array.from({ length: Math.max(...sheet.rows.slice(0, 40).map((x) => x.length), 1) }, (_, c) => <td key={c} className={c === cfg.labelCol ? 'sel-l' : c === cfg.amountCol ? 'sel-a' : ''}>{r[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primary" onClick={doImport}>解析並建立對應</button> <button onClick={() => setFile(null)}>取消</button>
        </>
      )}
    </section>
  );
}

const colOpts = (s: SheetData) => Array.from({ length: Math.max(1, ...s.rows.map((r) => r.length)) }, (_, c) => <option key={c} value={c}>{String.fromCharCode(65 + (c % 26))}{c >= 26 ? c : ''} 欄</option>);

function acctOptions(custom: AccountDef[], stmt?: string) {
  const all = allAccounts(custom).filter((a) => !stmt || stmt === 'TB' || a.stmt === stmt);
  const groups = new Map<string, AccountDef[]>();
  for (const a of all) { const k = SECTION_NAMES[a.section]; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(a); }
  return [...groups].map(([k, v]) => <optgroup key={k} label={k}>{v.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</optgroup>);
}

function MappingTable({ y }: { y: YearData }) {
  const { p, update } = useP();
  const [onlyIssues, setOnlyIssues] = useState(false);
  if (!y.lines.length) return null;
  const imports = p.imports.filter((i) => y.importIds.includes(i.id));
  const yearIdx = (np: Project) => yearOf(np, y.year)!;
  const lines = y.lines.map((l, i) => ({ l, i })).filter(({ l }) => !onlyIssues || (l.issues.length && !l.confirmed));
  const nIssues = y.lines.filter((l) => l.issues.length && !l.confirmed && l.kind !== 'ignore').length;
  return (
    <section className="card">
      <h2>科目對應（{y.year}）</h2>
      <p className="muted small">來源：{imports.map((i) => `${i.fileName}／${i.sheet}（${{ BS: '資產負債表', IS: '綜合損益表', TB: '試算表' }[i.stmt]}，單位×${i.unitMultiplier}）`).join('；')}。原始資料完整保留於匯出檔「原始匯入資料」工作表。合計列僅用於核對，不計入明細。</p>
      <div className="row">
        <label className="check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />只顯示待確認（{nIssues}）</label>
        <button onClick={() => update((np) => { yearIdx(np).lines.forEach((l) => { if (l.kind !== 'detail' || l.account) l.confirmed = true; }); }, { action: '確認科目對應', detail: `${y.year} 全部（未對應者除外）` })}>確認全部已對應項目</button>
        {imports.map((im) => <button key={im.id} className="danger mini" onClick={() => confirm(`移除匯入「${im.fileName}／${im.sheet}」？`) && update((np) => { const yd = yearIdx(np); yd.lines = yd.lines.filter((l) => l.importId !== im.id); yd.importIds = yd.importIds.filter((x) => x !== im.id); np.imports = np.imports.filter((x) => x.id !== im.id); reconcileSubtotals(yd, np.customAccounts); }, { action: '移除匯入', detail: im.fileName })}>移除 {im.sheet}</button>)}
      </div>
      <table className="grid map">
        <thead><tr><th>列</th><th>原始科目</th><th>原始金額</th><th>認列金額（元）</th><th>類型</th><th>對應科目</th><th>問題</th><th>確認</th></tr></thead>
        <tbody>
          {lines.map(({ l, i }) => {
            const im = p.imports.find((x) => x.id === l.importId);
            return (
              <tr key={i} className={l.kind === 'subtotal' ? 'subtotal' : l.kind === 'ignore' ? 'skip' : ''}>
                <td className="muted">{l.rowIndex + 1}</td>
                <td>{l.label}</td>
                <td className="num">{l.rawAmount}</td>
                <td className="num">{l.amount === null ? '—' : fmtVal(l.amount, 'amount', 'yuan')}</td>
                <td>
                  <select value={l.kind} onChange={(e) => update((np) => { const ln = yearIdx(np).lines[i]; ln.kind = e.target.value as any; remapLine(ln, ln.kind === 'detail' ? ln.account : null, im, np.customAccounts); reconcileSubtotals(yearIdx(np), np.customAccounts); }, { action: '修改對應類型', detail: `${l.label}：${e.target.value}` })}>
                    <option value="detail">明細</option><option value="subtotal">合計（核對用）</option><option value="ignore">略過</option>
                  </select>
                </td>
                <td>
                  {l.kind === 'detail' ? (
                    <select className={l.account ? '' : 'missing'} value={l.account ?? ''} onChange={(e) => update((np) => { const ln = yearIdx(np).lines[i]; remapLine(ln, e.target.value || null, im, np.customAccounts); ln.confirmed = false; reconcileSubtotals(yearIdx(np), np.customAccounts); }, { action: '修改科目對應', detail: `${l.label} → ${e.target.value}` })}>
                      <option value="">（未對應）</option>
                      {acctOptions(p.customAccounts, im?.stmt)}
                    </select>
                  ) : <span className="muted">{l.subtotalCheck ? '核對用' : ''}</span>}
                </td>
                <td className="issues">{l.issues.map((x, k) => <div key={k}>⚠ {x}</div>)}</td>
                <td><input type="checkbox" checked={l.confirmed} onChange={(e) => update((np) => { yearIdx(np).lines[i].confirmed = e.target.checked; })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function AccountSummary({ y }: { y: YearData }) {
  const { p, update } = useP();
  const [newAcc, setNewAcc] = useState<{ name: string; section: Section; cf: CfClass }>({ name: '', section: 'CA', cf: 'operating' });
  const accts = allAccounts(p.customAccounts);
  const yi = (np: Project) => yearOf(np, y.year)!;
  const sec = (s: Section) => accts.filter((a) => a.section === s);
  const total = (secs: Section[]) => secs.flatMap(sec).reduce((t, a) => t + (a.contra ? -1 : 1) * (yearAmount(y, a.code) ?? 0), 0);
  const assets = total(['CA', 'NCA']), le = total(['CL', 'NCL', 'EQ']);
  const required = ['cash', 'revenue', 'cogs'];
  const missingReq = required.filter((c) => yearAmount(y, c) === null);
  return (
    <section className="card">
      <h2>科目彙總與手動輸入（{y.year}）</h2>
      <p className="muted small">「匯入合計」由對應明細加總；「手動輸入」可直接建檔或覆蓋匯入數（留白則採匯入數）。減項科目（累計折舊、累計減損、庫藏股）以正數輸入。</p>
      {missingReq.length > 0 && <p className="warn">缺少必要科目：{missingReq.map((c) => accts.find((a) => a.code === c)?.name).join('、')}</p>}
      <p className={Math.abs(assets - le) >= 1 ? 'error' : 'ok'}>資產合計 {fmtVal(assets, 'amount', 'yuan')}　負債及權益合計 {fmtVal(le, 'amount', 'yuan')}　{Math.abs(assets - le) >= 1 ? `差額 ${fmtVal(assets - le, 'amount', 'yuan')}（請檢查對應或漏列科目，系統不自動調整）` : '✓ 平衡'}</p>
      <div className="two-col">
        {(['BS', 'IS'] as const).map((stmt) => (
          <table key={stmt} className="grid">
            <thead><tr><th>{stmt === 'BS' ? '資產負債表科目' : '綜合損益表科目'}</th><th>匯入合計</th><th>手動輸入</th></tr></thead>
            <tbody>
              {(Object.keys(SECTION_NAMES) as Section[]).filter((s) => accts.some((a) => a.section === s && a.stmt === stmt)).map((s) => (
                [<tr key={s} className="header"><td colSpan={3}>{SECTION_NAMES[s]}</td></tr>,
                ...sec(s).map((a) => (
                  <tr key={a.code}>
                    <td style={{ paddingLeft: 16 }}>{a.name}{a.custom && <span className="tag">自訂</span>}</td>
                    <td className="num">{y.accounts[a.code] !== undefined ? fmtVal(y.accounts[a.code], 'amount', 'yuan') : <span className="na">未提供</span>}</td>
                    <td className="in"><NumInput value={y.manual[a.code] ?? null} onCommit={(v) => update((np) => { const yd = yi(np); if (v === null) delete yd.manual[a.code]; else yd.manual[a.code] = v; }, { action: '手動輸入基期科目', detail: `${y.year} ${a.name}：${v ?? '清除'}` })} /></td>
                  </tr>
                ))]
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <div className="row">
        <b>新增自訂科目</b>
        <input placeholder="科目名稱" value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} />
        <select value={newAcc.section} onChange={(e) => setNewAcc({ ...newAcc, section: e.target.value as Section })}>
          {(['CA', 'NCA', 'CL', 'NCL', 'EQ', 'NONOP'] as Section[]).map((s) => <option key={s} value={s}>{SECTION_NAMES[s]}</option>)}
        </select>
        <select value={newAcc.cf} onChange={(e) => setNewAcc({ ...newAcc, cf: e.target.value as CfClass })}>
          <option value="operating">現金流量：營業</option><option value="investing">投資</option><option value="financing">籌資</option>
        </select>
        <button disabled={!newAcc.name.trim()} onClick={() => update((np) => {
          const isBS = ['CA', 'NCA', 'CL', 'NCL', 'EQ'].includes(newAcc.section);
          np.customAccounts.push({ code: `x_${uid()}`, name: newAcc.name.trim(), stmt: isBS ? 'BS' : 'IS', section: newAcc.section, role: 'other', keywords: [newAcc.name.trim()], cf: newAcc.cf, custom: true, canBeNegative: !isBS });
          recomputeYearAccounts(yi(np));
          setNewAcc({ ...newAcc, name: '' });
        }, { action: '新增自訂科目', detail: newAcc.name })}>新增</button>
      </div>
    </section>
  );
}

function BaseExtraStatements() {
  const { g, p, update } = useP();
  const rows = (sheet: string) => g.rows.filter((r) => r.sheet === sheet && !['cf:close'].includes(r.id) && !/_close$|t_close/.test(r.id));
  const block = (sheet: string, key: 'cfActual' | 'sceActual', title: string) => (
    <div>
      <h3>{title}</h3>
      <table className="grid">
        <tbody>
          {rows(sheet).map((r) => (
            <tr key={r.id} className={r.style ?? ''}>
              <td style={{ paddingLeft: 6 + (r.indent ?? 0) * 12 }}>{r.label}</td>
              {r.style === 'header' ? <td /> : <td className="in"><NumInput value={p.base[key][r.id] ?? null} placeholder="未提供" onCommit={(v) => update((np) => { if (v === null) delete np.base[key][r.id]; else np.base[key][r.id] = v; }, { action: `補入基期${title}`, detail: `${r.label}：${v ?? '清除'}` })} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="card">
      <h2>基期現金流量表／權益變動表實際數（選填）</h2>
      <p className="muted small">只提供損益表及資產負債表時，基期現金流量表與權益變動表顯示「未提供」；可於取得實際報表後補入。期末數依基期資產負債表自動帶入。</p>
      <div className="two-col">
        {block(SH.cf, 'cfActual', '現金流量表')}
        {block(SH.sce, 'sceActual', '權益變動表')}
      </div>
    </section>
  );
}
