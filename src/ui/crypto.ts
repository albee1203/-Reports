// 專案備份加密：PBKDF2(SHA-256, 310,000 次) 推導金鑰，AES-GCM 256 加密。全部於本機瀏覽器執行。
const ITER = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface EncryptedBackup { format: 'fin-forecast-encrypted'; v: 1; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; data: string }

async function key(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(obj: unknown, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(password, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj))));
  // 大型資料分段轉 base64，避免呼叫堆疊過深
  let s = '';
  for (let i = 0; i < ct.length; i += 0x8000) s += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  return { format: 'fin-forecast-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: btoa(s) };
}

export function isEncrypted(x: any): x is EncryptedBackup {
  return x && x.format === 'fin-forecast-encrypted';
}

export async function decryptJson<T>(b: EncryptedBackup, password: string): Promise<T> {
  const k = await key(password, unb64(b.salt), b.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(b.iv) as BufferSource }, k, unb64(b.data) as BufferSource);
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new Error('密碼錯誤或檔案已損毀，無法解密');
  }
}
