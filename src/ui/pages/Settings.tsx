import { useP, unitLabel } from '../ctx';
import { NumInput } from '../Grid';
import { allAccounts, OPEX_CODES } from '../../engine/coa';

export function SettingsPage() {
  const { p, update, info } = useP();
  const s = p.settings;
  const set = (k: string, v: any, label: string) => update((np) => { (np.settings as any)[k] = v; }, { action: '修改專案設定', detail: `${label}：${v}` });
  const opexCodes = OPEX_CODES;
  const accts = allAccounts(p.customAccounts);
  return (
    <div>
      <h1>1. 專案設定</h1>
      <section className="card form">
        <label>專案名稱<input value={p.name} onChange={(e) => update((np) => { np.name = e.target.value; })} /></label>
        <label>公司名稱<input value={s.companyName} onChange={(e) => set('companyName', e.target.value, '公司名稱')} /></label>
        <label>統一編號（選填）<input value={s.taxId} onChange={(e) => set('taxId', e.target.value, '統一編號')} /></label>
        <label>基期年度<NumInput value={s.baseYear} onCommit={(v) => v && update((np) => {
          const d = v - np.settings.baseYear; np.settings.baseYear = v; np.base.year = v;
          np.settings.standards.forEach((x) => (x.year += d));
        }, { action: '修改基期年度', detail: String(v) })} /></label>
        <label>會計年度結束日（MM-DD）<input value={s.fyEnd} onChange={(e) => set('fyEnd', e.target.value, '會計年度結束日')} /></label>
        <label>預估年數<NumInput value={s.years} onCommit={(v) => v && v >= 1 && v <= 10 && set('years', Math.round(v), '預估年數')} /></label>
        <label>幣別<input value={s.currency} onChange={(e) => set('currency', e.target.value, '幣別')} /></label>
        <label>顯示單位
          <select value={s.unit} onChange={(e) => set('unit', e.target.value, '顯示單位')}>
            <option value="yuan">{unitLabel('yuan', s.currency)}</option><option value="thousand">{unitLabel('thousand', s.currency)}</option>
          </select>
          <span className="hint">僅影響顯示及輸出版面；底層以元計算，保留精度。</span>
        </label>
        <label>年末現金警示門檻（元）<NumInput amount value={s.cashThreshold} onCommit={(v) => v !== null && set('cashThreshold', v, '現金警示門檻')} /><span className="hint">預設 20,000,000；僅檢查各預估年度年末現金，不自動新增借款。</span></label>
        <label>借款／資產可用預設月份<NumInput value={s.defaultMonth} onCommit={(v) => v && v >= 1 && v <= 12 && set('defaultMonth', Math.round(v), '預設月份')} /><span className="hint">月份留白時採用；初始 7 月＝計息半年（月初生效，計息月數＝13−月份）。</span></label>
        <label>週轉天數計算基礎<NumInput value={s.daysBasis} onCommit={(v) => v && set('daysBasis', v, '天數基礎')} /></label>
        <label>支付利息之現金流量分類
          <select value={s.interestPaidClass} onChange={(e) => set('interestPaidClass', e.target.value, '利息分類')}>
            <option value="operating">營業活動</option><option value="financing">籌資活動</option>
          </select><span className="hint">影響營業／籌資小計，不影響現金淨增減。</span>
        </label>
        <label>折舊費用（營業費用部分）歸屬科目
          <select value={s.depExpenseLine} onChange={(e) => set('depExpenseLine', e.target.value, '折舊歸屬')}>
            {opexCodes.map((c) => <option key={c} value={c}>{accts.find((a) => a.code === c)?.name}</option>)}
          </select><span className="hint">僅於假設設定「未含折舊」時加計。</span>
        </label>
        <label>其他綜合損益對應科目
          <select value={s.ociAccount ?? ''} onChange={(e) => set('ociAccount', e.target.value || null, 'OCI 對應科目')}>
            <option value="">（未指定）</option>
            {info.otherBS.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select><span className="hint">其他綜合損益為非現金變動，需對應資產或負債科目以維持平衡。</span>
        </label>
      </section>
      <section className="card">
        <h2>各報導年度採用之準則版本</h2>
        <table className="list">
          <thead><tr><th>年度</th><th>準則版本</th><th>適用日期</th></tr></thead>
          <tbody>
            {s.standards.filter((x) => x.year <= s.baseYear + s.years).map((x, i) => (
              <tr key={x.year}>
                <td>{x.year}{x.year === s.baseYear ? '（基期）' : '（預估）'}</td>
                <td><input className="wide" value={x.version} onChange={(e) => update((np) => { np.settings.standards[i].version = e.target.value; })} /></td>
                <td><input value={x.effectiveDate} placeholder="YYYY-MM-DD" onChange={(e) => update((np) => { np.settings.standards[i].effectiveDate = e.target.value; })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="mini" onClick={() => update((np) => { const v = np.settings.standards[0]?.version ?? ''; const d = np.settings.standards[0]?.effectiveDate ?? ''; np.settings.standards.forEach((x) => { x.version = v; x.effectiveDate = d; }); })}>以基期設定套用至所有年度</button>
        <p className="hint">請依實際採用之企業會計準則公報（EAS）修正版本填寫；App 不自動聲明完整遵循 EAS。</p>
      </section>
      <section className="card">
        <h2>進階項目（預設關閉）</h2>
        {([['lease', '租賃'], ['fx', '外幣交易'], ['related', '關係人交易']] as const).map(([k, l]) => (
          <label key={k} className="check"><input type="checkbox" checked={s.advanced[k]} onChange={(e) => update((np) => { np.settings.advanced[k] = e.target.checked; }, { action: '進階項目', detail: `${l}：${e.target.checked ? '開啟' : '關閉'}` })} />{l}</label>
        ))}
        <p className="hint">第一版僅提示：開啟後請於「其他科目」選擇預估方式或手動補入資料；基期已有相關餘額時，勾稽頁會提示。目前顯示單位：{unitLabel(s.unit)}。</p>
      </section>
    </div>
  );
}
