import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson, isEncrypted } from '../src/ui/crypto';
import { sampleProject } from '../src/engine/sample';

describe('加密備份', () => {
  it('加密後可還原、錯誤密碼無法解密、密文不含原始資料', async () => {
    const p = sampleProject();
    const b = await encryptJson(p, 'correct horse 123');
    expect(isEncrypted(b)).toBe(true);
    expect(JSON.stringify(b)).not.toContain('範例股份有限公司');
    const back = await decryptJson<any>(b, 'correct horse 123');
    expect(back).toEqual(JSON.parse(JSON.stringify(p)));
    await expect(decryptJson(b, 'wrong password')).rejects.toThrow('密碼錯誤');
  });
});
