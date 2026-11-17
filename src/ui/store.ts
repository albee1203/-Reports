// 本機儲存（IndexedDB）。資料不傳送至任何外部服務。
import { get, set, del } from 'idb-keyval';
import { Project, uid, Version } from '../engine/project';
import { migrateProject } from '../engine/migrate';

export interface ProjectMeta { id: string; name: string; company: string; baseYear: number; updatedAt: string }

const INDEX = 'projects-index';

export async function listProjects(): Promise<ProjectMeta[]> {
  return ((await get(INDEX)) as ProjectMeta[] | undefined) ?? [];
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await get(`proj:${id}`);
  return raw ? migrateProject(raw) : undefined;
}

// 申請持久儲存，降低瀏覽器在空間不足時自動清除本機資料之機會
export async function requestPersistence(): Promise<{ persisted: boolean | null; usage?: number; quota?: number }> {
  try {
    const sm = navigator.storage;
    if (!sm?.persist) return { persisted: null };
    const persisted = (await sm.persisted()) || (await sm.persist());
    const est = await sm.estimate?.();
    return { persisted, usage: est?.usage, quota: est?.quota };
  } catch { return { persisted: null }; }
}

export async function saveProject(p: Project) {
  p.updatedAt = new Date().toISOString();
  await set(`proj:${p.id}`, p);
  const idx = await listProjects();
  const meta: ProjectMeta = { id: p.id, name: p.name, company: p.settings.companyName, baseYear: p.settings.baseYear, updatedAt: p.updatedAt };
  const i = idx.findIndex((x) => x.id === p.id);
  if (i >= 0) idx[i] = meta; else idx.unshift(meta);
  await set(INDEX, idx);
}

export async function deleteProject(id: string) {
  await del(`proj:${id}`);
  await set(INDEX, (await listProjects()).filter((x) => x.id !== id));
}

export function copyProject(p: Project, name: string): Project {
  const c: Project = JSON.parse(JSON.stringify(p));
  c.id = uid(); c.name = name; c.createdAt = new Date().toISOString();
  c.log = [...c.log, { at: c.createdAt, action: '複製專案', detail: `自「${p.name}」複製` }];
  return c;
}

export function snapshot(p: Project, label: string): Version {
  const { versions: _v, ...rest } = p;
  return { id: uid(), label, at: new Date().toISOString(), snapshot: JSON.stringify(rest) };
}

export function restoreVersion(p: Project, v: Version): Project {
  const data = migrateProject({ ...JSON.parse(v.snapshot), versions: [] });
  return { ...data, id: p.id, versions: p.versions, log: [...p.log, { at: new Date().toISOString(), action: '還原版本', detail: `${v.label}（${v.at}）` }] };
}

export function download(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 依路徑設定值：a.* / fa.* / loans.<id>.* 屬目前情境；settings.* / faBase.* 屬專案
export function setPath(p: Project, scenarioId: string, path: string, value: any): { old: any } {
  const sc = p.scenarios.find((s) => s.id === scenarioId)!;
  const parts = path.split('.');
  let obj: any;
  if (parts[0] === 'a') { obj = sc.a; parts.shift(); }
  else if (parts[0] === 'fa') { obj = sc.fa; parts.shift(); }
  else if (parts[0] === 'loans') { obj = sc.loans.find((l) => l.id === parts[1]); parts.splice(0, 2); }
  else if (parts[0] === 'settings') { obj = p.settings; parts.shift(); }
  else if (parts[0] === 'faBase') { obj = p.faBase; parts.shift(); }
  else if (parts[0] === 'faAssets') { obj = (p.faAssets ?? []).find((x) => x.id === parts[1]); parts.splice(0, 2); }
  else throw new Error('未知路徑 ' + path);
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  const k = parts[parts.length - 1];
  const old = obj[k];
  obj[k] = value;
  return { old };
}

export function getPath(p: Project, scenarioId: string, path: string): any {
  const sc = p.scenarios.find((s) => s.id === scenarioId)!;
  const parts = path.split('.');
  let obj: any;
  if (parts[0] === 'a') { obj = sc.a; parts.shift(); }
  else if (parts[0] === 'fa') { obj = sc.fa; parts.shift(); }
  else if (parts[0] === 'loans') { obj = sc.loans.find((l) => l.id === parts[1]); parts.splice(0, 2); }
  else if (parts[0] === 'settings') { obj = p.settings; parts.shift(); }
  else if (parts[0] === 'faBase') { obj = p.faBase; parts.shift(); }
  else if (parts[0] === 'faAssets') { obj = (p.faAssets ?? []).find((x) => x.id === parts[1]); parts.splice(0, 2); }
  for (const k of parts) obj = obj?.[k];
  return obj;
}
