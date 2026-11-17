import { describe, it, expect } from 'vitest';
import { sampleProject } from '../src/engine/sample';
import { migrateProject, SCHEMA_VERSION } from '../src/engine/migrate';
import { buildGraph } from '../src/engine/model';
import { evaluate } from '../src/engine/graph';

describe('舊版專案資料轉換', () => {
  it('缺少新欄位之專案可正常開啟並計算', () => {
    const old: any = JSON.parse(JSON.stringify(sampleProject()));
    delete old.faAssets; delete old.schemaVersion;
    delete old.settings.advanced; delete old.settings.ociAccount;
    delete old.bank.includeRatios; delete old.bank.acks;
    delete old.base.sceActual; delete old.base.cfActual;
    for (const sc of old.scenarios) { delete sc.a.equity.capCash; delete sc.overrides; for (const l of sc.loans) delete l.accruedMonths; }
    const p = migrateProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.scenarios[0].a.equity.capCash.length).toBe(5);
    const { g, info } = buildGraph(p, p.scenarios[0]);
    const ev = evaluate(g);
    for (const c of info.fcols) expect(Math.abs(ev.num('ck:bs', c))).toBeLessThan(0.5);
  });
});
