import { useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useP, fmtVal, unitLabel } from '../ctx';
import { STATEMENT_SHEETS, SH } from '../../engine/model';
import { reportStatus } from '../../engine/checks';
import { uid } from '../../engine/project';
import { StatementTable, isZeroRow } from './Statements';
import { IssueList } from './Checks';

import { defaultPeriodText as defaultPeriod } from '../../engine/project';

export function BankPage() {
  const { p, g, update, bankIssues } = useP();
  const [tab, setTab] = useState<string>(STATEMENT_SHEETS[0]);
  const [preview, setPreview] = useState(false);
  const status = reportStatus(bankIssues, 'bank');
  const b = p.bank;
  return (
    <div>
      <h1>5. 銀行送件及報表編修</h1>
      <p className="muted">編修正式報表版式（標題、期間、科目名稱）、附註，並完成送件前檢查。歷史實際數與預估數分欄標示，預估數保留「預估」標示。App 不聲明完整遵循 EAS、已查核或已核閱。</p>
      <div className={`status-banner st-${status}`}>送件狀態：<b>{status}</b>{status !== '已完成檢查' && '（輸出之報表與 PDF 將標示此狀態）'}</div>

      <section className="card">
        <h2>報表標題、期間與科目名稱</h2>
        <div className="tabs">{STATEMENT_SHEETS.map((s) => <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)}>{b.titles[s] || s}</button>)}</div>
        <div className="form compact">
          <label>報表標題<input value={b.titles[tab] ?? tab} onChange={(e) => update((np) => { np.bank.titles[tab] = e.target.value; })} /></label>
          <label>報導期間<input className="wide" value={b.periodText[tab] ?? defaultPeriod(p, tab)} onChange={(e) => update((np) => { np.bank.periodText[tab] = e.target.value; })} /></label>
          <label>公司名稱（全部報表）<input value={p.settings.companyName} onChange={(e) => update((np) => { np.settings.companyName = e.target.value; })} /></label>
          <label>金額單位<select value={p.settings.unit} onChange={(e) => update((np) => { np.settings.unit = e.target.value as any; })}><option value="yuan">{unitLabel('yuan', p.settings.currency)}</option><option value="thousand">{unitLabel('thousand', p.settings.currency)}</option></select></label>
        </div>
        <p className="hint">直接修改下表科目名稱即可；科目分類請於「基期資料」調整對應或新增自訂科目。</p>
        <StatementTable sheet={tab} labels={b.labels} onLabel={(id, v) => update((np) => { np.bank.labels[id] = v; })} />
        <button className="mini" onClick={() => update((np) => { for (const r of g.rows) if (r.sheet === tab) delete np.bank.labels[r.id]; delete np.bank.titles[tab]; delete np.bank.periodText[tab]; }, { action: '還原報表名稱', detail: tab })}>還原此表預設名稱</button>
      </section>

      <NotesEditor />

      <section className="card">
        <h2>送件前檢查</h2>
        <IssueList issues={bankIssues.filter((i) => i.level !== 'info' || i.category === '銀行送件')} />
        <label className="check"><input type="checkbox" checked={!!b.acks['ack:review']} onChange={(e) => update((np) => { np.bank.acks['ack:review'] = e.target.checked; }, { action: '送件前檢查', detail: `已複核會計處理及必要調整：${e.target.checked}` })} />我已複核附註、比較資訊、會計處理及必要調整</label>
      </section>

      <section className="card">
        <h2>列印／PDF</h2>
        <p className="muted small">A4，依報表寬度自動選擇直式或橫式；含負責人及財務主管空白簽章欄，不含頁碼。於瀏覽器列印對話框選擇「另存為 PDF」，並取消勾選「頁首及頁尾」。勾稽檢查不列入列印版面。</p>
        <label className="check"><input type="checkbox" checked={!!b.includeRatios} onChange={(e) => update((np) => { np.bank.includeRatios = e.target.checked; }, { action: '銀行版設定', detail: `列印附財務比率：${e.target.checked}` })} />列印時附「財務比率」頁</label>
        <button className="primary" onClick={() => setPreview(true)}>預覽列印版面</button>
      </section>
      {preview && <PrintView onClose={() => setPreview(false)} />}
    </div>
  );
}

function NotesEditor() {
  const { p, update } = useP();
  const notes = p.bank.notes;
  const mut = (f: (n: any[]) => void, detail: string) => update((np) => f(np.bank.notes), { action: '編輯附註', detail });
  const importFile = async (f: File) => {
    const text = await f.text();
    mut((n) => n.push({ id: uid(), title: f.name.replace(/\.(txt|md)$/i, ''), body: text }), `匯入 ${f.name}`);
  };
  return (
    <section className="card">
      <h2>財務報表附註（自由編輯）</h2>
      <p className="muted small">第一版不提供附註範本。可補入重大會計政策、財務預測基本假設及銀行要求之說明。可匯入 .txt／.md 檔。</p>
      {notes.map((n, i) => (
        <div key={n.id} className="note">
          <div className="row">
            <input className="wide" value={n.title} onChange={(e) => mut((x) => (x[i].title = e.target.value), `標題：${e.target.value}`)} />
            <button className="mini" disabled={i === 0} onClick={() => mut((x) => { [x[i - 1], x[i]] = [x[i], x[i - 1]]; }, '移動附註')}>↑</button>
            <button className="mini" disabled={i === notes.length - 1} onClick={() => mut((x) => { [x[i + 1], x[i]] = [x[i], x[i + 1]]; }, '移動附註')}>↓</button>
            <button className="mini danger" onClick={() => confirm('刪除此附註？') && mut((x) => x.splice(i, 1), `刪除附註：${n.title}`)}>刪除</button>
          </div>
          <textarea rows={6} value={n.body} placeholder="（待補）" onChange={(e) => mut((x) => (x[i].body = e.target.value), `內容：${n.title}`)} />
        </div>
      ))}
      <div className="row">
        <button onClick={() => mut((x) => x.push({ id: uid(), title: `${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][notes.length] ?? notes.length + 1}、`, body: '' }), '新增附註')}>＋ 新增附註</button>
        <label className="file">匯入附註檔<input type="file" accept=".txt,.md" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
      </div>
    </section>
  );
}

export function PrintView({ onClose }: { onClose: () => void }) {
  const { p, g, ev, bankIssues } = useP();
  const status = reportStatus(bankIssues, 'bank');
  const b = p.bank;
  const u = p.settings.unit;
  const root = useRef<HTMLDivElement>(null);
  // 依內容寬高選擇 A4 直式或橫式，並於必要時等比例縮小，確保保持在列印範圍內
  useLayoutEffect(() => {
    const px = (v: number) => (v * 96) / 25.4;
    root.current?.querySelectorAll<HTMLElement>('.page').forEach((pg) => {
      const inner = pg.querySelector<HTMLElement>('.page-inner');
      if (!inner || pg.classList.contains('notes-page')) return;
      inner.style.zoom = '1';
      inner.style.width = 'max-content';
      const w = Math.max(inner.scrollWidth, px(150)), h = inner.scrollHeight;
      const fit = (W: number, H: number) => Math.min(1, px(W) / w, px(H) / h);
      const zp = fit(182, 269), zl = fit(269, 182);
      const land = zl > zp + 0.02;
      pg.classList.toggle('landscape', land);
      pg.classList.toggle('portrait', !land);
      const availW = px(land ? 269 : 182), availH = px(land ? 182 : 269);
      let z = land ? zl : zp;
      inner.style.width = `${availW / z}px`;
      z = Math.min(z, availH / inner.scrollHeight);
      inner.style.width = `${availW / z}px`;
      inner.style.zoom = String(Math.floor(z * 1000) / 1000);
    });
  });
  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <button className="primary" onClick={() => window.print()}>列印／另存 PDF</button>
        <button onClick={onClose}>關閉預覽</button>
        <span className="muted small">列印時請選擇 A4、取消「頁首及頁尾」。</span>
      </div>
      <div className="print-root" ref={root}>
        {[...STATEMENT_SHEETS, ...(b.includeRatios ? [SH.ratio] : [])].map((sheet) => {
          const rows = g.rows.filter((r) => r.sheet === sheet && !isZeroRow(r, ev, g.columns.length));
          return (
            <section key={sheet} className="page portrait"><div className="page-inner">
              {status !== '已完成檢查' && <div className="draft-mark">{status}</div>}
              <div className="ph">
                <div className="co">{p.settings.companyName}</div>
                <div className="ti">{b.titles[sheet] || sheet}</div>
                <div className="pe">{b.periodText[sheet] || defaultPeriod(p, sheet)}</div>
                <div className="un">單位：{unitLabel(u, p.settings.currency)}</div>
              </div>
              <table className="pt">
                <thead>
                  <tr><th rowSpan={2} className="lbl">{sheet === SH.bs || sheet === SH.is ? '會計項目' : '項目'}</th>{g.columns.map((c) => <th key={c.key}>{c.label} 年度</th>)}</tr>
                  <tr>{g.columns.map((c) => <th key={c.key} className={c.type === 'forecast' ? 'fc' : 'ac'}>{c.type === 'forecast' ? '預估' : '實際'}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.style ?? ''}>
                      <td className="lbl" style={{ paddingLeft: 4 + (r.indent ?? 0) * 12 }}>{b.labels[r.id] || r.label}</td>
                      {g.columns.map((c, i) => {
                        const cell = r.cells[i];
                        if (!cell || r.style === 'header') return <td key={c.key} />;
                        return <td key={c.key} className={c.type === 'forecast' ? 'fc' : ''}>{cell.kind === 'na' ? '未提供' : fmtVal(ev.value(r.id, i), r.format, u)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pn">註：標示「預估」之欄位係依假設編製之財務預估數，非實際數。{u === 'thousand' && `金額以${unitLabel('thousand', p.settings.currency)}表達，因四捨五入，合計數與明細加總可能有尾差。`}</p>
              <div className="sig"><span>負責人：＿＿＿＿＿＿＿＿＿＿</span><span>財務主管：＿＿＿＿＿＿＿＿＿＿</span></div>
            </div></section>
          );
        })}
        {b.notes.length > 0 && (
          <section className="page portrait notes-page">
            {status !== '已完成檢查' && <div className="draft-mark">{status}</div>}
            <div className="ph"><div className="co">{p.settings.companyName}</div><div className="ti">財務報表附註</div></div>
            {b.notes.map((n) => (<div key={n.id} className="pnote"><h4>{n.title}</h4>{(n.body || '（待補）').split('\n').map((x, i) => <p key={i}>{x}</p>)}</div>))}
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
