import { useP } from '../ctx';
import { Grid, NumInput } from '../Grid';
import { SH } from '../../engine/model';
import { FA_CLASSES, findAccount, CfClass } from '../../engine/coa';
import { cloneScenario, defaultAssumptions, emptyLoan, uid, M, OTHER_METHODS } from '../../engine/project';
import { Row } from '../../engine/graph';
import { FaDetailSection } from './FaDetail';

function ScenarioBar() {
  const { p, sc, update } = useP();
  return (
    <div className="row scen-bar">
      <b>目前情境：{sc.name}</b>
      <button onClick={() => { const n = prompt('新情境名稱（複製目前情境之假設）', `${sc.name}－複本`); if (n) update((np) => { const c = cloneScenario(np.scenarios.find((s) => s.id === sc.id)!, n); np.scenarios.push(c); np.activeScenarioId = c.id; }, { action: '複製情境', detail: `${sc.name} → ${n}` }); }}>複製情境</button>
      <button onClick={() => { const n = prompt('新情境名稱（空白假設）', '新情境'); if (n) update((np) => { const c = { id: uid(), name: n, a: defaultAssumptions(np.settings.years), fa: {}, loans: [], overrides: {} }; np.scenarios.push(c); np.activeScenarioId = c.id; }, { action: '新增情境', detail: n }); }}>新增空白情境</button>
      <button onClick={() => { const n = prompt('情境名稱', sc.name); if (n) update((np) => { np.scenarios.find((s) => s.id === sc.id)!.name = n; }, { action: '重新命名情境', detail: `${sc.name} → ${n}` }); }}>重新命名</button>
      <button className="danger" disabled={p.scenarios.length <= 1} onClick={() => confirm(`刪除情境「${sc.name}」？`) && update((np) => { np.scenarios = np.scenarios.filter((s) => s.id !== sc.id); np.activeScenarioId = np.scenarios[0].id; }, { action: '刪除情境', detail: sc.name })}>刪除情境</button>
    </div>
  );
}

export function AssumptionsPage() {
  const { info, sc, update } = useP();
  const pre = (...xs: string[]) => (r: Row) => xs.some((x) => r.id.startsWith(x));
  const setOther = (code: string, k: 'cf' | 'confirmed', v: any) => update((np) => { (np.scenarios.find((s) => s.id === sc.id)!.a.others[code] as any)[k] = v; }, { action: '其他科目設定', detail: `${findAccount(code)?.name ?? code}：${k}=${v}` });
  return (
    <div>
      <h1>3. 逐年假設（情境：{sc.name}）</h1>
      <ScenarioBar />
      <p className="muted">藍字欄位為輸入；紅框為未完成之必要假設。成長率以逐年手動輸入為主，可按「延用」將空白年度以前一年度值填入。基期欄為依實際數計算之參考值。點選任一計算數可追溯公式。</p>
      <Grid sheet={SH.assump} title="營收、成本及費用" filter={pre('a:growth', 'a:gm', 'a:depIn', 'a:depShare', 'a:opex')} />
      <Grid sheet={SH.rev} title="營收成本費用計算明細" carry={false} filter={(r) => !r.id.startsWith('c:oth')} />
      <Grid sheet={SH.assump} title="營運資金" filter={pre('a:ar', 'a:inv', 'a:ap')} />
      <Grid sheet={SH.wc} title="營運資金計算明細" carry={false} />
      <section className="card">
        <h3>其他損益及資產負債科目</h3>
        <p className="muted small">每個重大科目須有明確預估方式。方法：{OTHER_METHODS.join('／')}（利息收入另可選「{M.CASH_RATE}」）。參數：手動金額為金額（元），成長率／比率以小數輸入（例 0.05＝5%）。資產負債科目預設「固定金額」，確認後才不列為待確認。</p>
        <table className="grid">
          <thead><tr><th>科目</th><th>現金流量分類</th><th>確認方法</th></tr></thead>
          <tbody>
            {[...info.otherIS, ...info.otherBS].map((a) => (
              <tr key={a.code}>
                <td>{a.name}</td>
                <td>{a.stmt === 'BS' ? (
                  <select value={sc.a.others[a.code].cf} onChange={(e) => setOther(a.code, 'cf', e.target.value as CfClass)}>
                    <option value="operating">營業</option><option value="investing">投資</option><option value="financing">籌資</option>
                  </select>) : <span className="muted">（損益科目，假設收付現）</span>}</td>
                <td><label className="check"><input type="checkbox" checked={sc.a.others[a.code].confirmed} onChange={(e) => setOther(a.code, 'confirmed', e.target.checked)} />已確認</label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Grid sheet={SH.assump} title="其他科目預估方法與參數" filter={pre('a:om', 'a:op')} />
      <Grid sheet={SH.rev} title="其他損益科目計算結果" carry={false} filter={pre('c:oth', 'c:other_gl')} />
      <Grid sheet={SH.oth} title="其他資產負債科目計算結果" carry={false} />
      <Grid sheet={SH.assump} title="所得稅（簡化當期估算，不含遞延所得稅）" filter={pre('a:tax', 'a:nol0')} />
      <Grid sheet={SH.taxeq} title="所得稅計算" carry={false} filter={pre('t:')} />
      <Grid sheet={SH.assump} title="權益" filter={pre('a:cap', 'a:div', 'a:oci')} />
      <Grid sheet={SH.taxeq} title="權益計算" carry={false} filter={pre('e:')} />
      <Grid sheet={SH.assump} title="專案參數" carry={false} filter={pre('p:')} />
    </div>
  );
}

export function FixedAssetsPage() {
  const { p, update, sc } = useP();
  return (
    <div>
      <h1>固定資產（情境：{sc.name}）</h1>
      <p className="muted">第一版按資產類別彙總。輸入基期餘額與各年度資本支出預算；逐筆資產明細匯入列為進階功能。資本支出區分「認列」與「付款」，處分區分「價款」與「收現」；現金流量表投資活動依實際收付列示。</p>
      <section className="card">
        <h3>基期餘額性質確認</h3>
        <label className="check"><input type="radio" checked={p.faNature === 'gross'} onChange={() => update((np) => { np.faNature = 'gross'; }, { action: '固定資產餘額性質', detail: '成本／累計折舊' })} />提供原始成本、累計折舊及累計減損</label>
        <label className="check"><input type="radio" checked={p.faNature === 'net'} onChange={() => update((np) => { np.faNature = 'net'; }, { action: '固定資產餘額性質', detail: '僅淨額' })} />僅有帳面淨額（成本欄輸入淨額，折舊為概估）</label>
        <h3>啟用資產類別</h3>
        <div className="row">
          {FA_CLASSES.map((c) => (
            <label key={c.key} className="check"><input type="checkbox" checked={p.faBase[c.key].enabled} onChange={(e) => update((np) => { np.faBase[c.key].enabled = e.target.checked; }, { action: '固定資產類別', detail: `${c.name}：${e.target.checked ? '啟用' : '停用'}` })} />{c.name}</label>
          ))}
        </div>
        <p className="hint">既有資產折舊可選「逐年手動」輸入各年度折舊額，或「估算」＝(經確認之可折舊淨額−殘值)÷剩餘耐用年限（標示概估）。新增資產採直線法，取得年度依可供使用月份計提（13−月份）/12。土地不提折舊；未完工程不提折舊，完工時以「由在建工程轉入」轉列至目標類別。</p>
      </section>
      <FaDetailSection />
      <Grid sheet={SH.fa} title="固定資產排程" />
      {(p.faAssets ?? []).length > 0 && <Grid sheet={SH.fad} title="逐筆資產折舊計算" carry={false} />}
    </div>
  );
}

export function LoansPage() {
  const { sc, update } = useP();
  const mut = (id: string, f: (l: any) => void, detail: string) => update((np) => { const l = np.scenarios.find((s) => s.id === sc.id)!.loans.find((x) => x.id === id); if (l) f(l); }, { action: '修改借款', detail });
  return (
    <div>
      <h1>融資（借款）（情境：{sc.name}）</h1>
      <p className="muted">利息＝期初餘額×利率＋新增借款×利率×(13−月份)/12−還款×利率×(13−月份)/12（月初生效）。月份留白採專案預設月份（初始 7 月＝半年）。既有借款即使沒有新增計畫，仍依已確認利率計息。長期借款一年內到期部分＝次年度還款額，列為流動負債。</p>
      <section className="card">
        <table className="grid">
          <thead><tr><th>借款名稱</th><th>類型</th><th>基期餘額（元）</th><th /></tr></thead>
          <tbody>
            {sc.loans.map((l) => (
              <tr key={l.id}>
                <td><input value={l.name} onChange={(e) => mut(l.id, (x) => (x.name = e.target.value), `名稱：${e.target.value}`)} /></td>
                <td><select value={l.type} onChange={(e) => mut(l.id, (x) => (x.type = e.target.value), `${l.name} 類型：${e.target.value}`)}><option value="short">短期借款</option><option value="long">長期借款</option></select></td>
                <td className="in"><NumInput value={l.baseBalance} onCommit={(v) => mut(l.id, (x) => (x.baseBalance = v), `${l.name} 基期餘額：${v}`)} /></td>
                <td><button className="danger mini" onClick={() => confirm(`刪除「${l.name}」？`) && update((np) => { const s = np.scenarios.find((x) => x.id === sc.id)!; s.loans = s.loans.filter((x) => x.id !== l.id); }, { action: '刪除借款', detail: l.name })}>刪除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => update((np) => { const s = np.scenarios.find((x) => x.id === sc.id)!; const l = emptyLoan(np.settings.years); l.baseBalance = 0; s.loans.push(l); }, { action: '新增借款', detail: '新借款' })}>＋ 新增借款</button>
      </section>
      <Grid sheet={SH.loan} title="借款排程" />
    </div>
  );
}
