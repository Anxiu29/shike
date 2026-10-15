import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../src/id.js';

afterEach(() => vi.unstubAllGlobals());

describe('安全上下文与局域网 HTTP 的记录 ID', () => {
  it('支持原生 randomUUID 时优先使用原生实现', () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    const randomUUID = vi.fn(() => id), getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    expect(createId()).toBe(id);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it.each([
    [0, '00000000-0000-4000-8000-000000000000'],
    [255, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ])('没有 randomUUID 时用随机字节 %i 生成正确版本及变体', (byte, expected) => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => array.fill(byte) });
    expect(createId()).toBe(expected);
  });

  it('局域网回退仍使用安全随机数，连续生成不同的合法 UUID', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) });
    const ids = Array.from({ length: 200 }, createId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });

  it('浏览器连安全随机字节都不支持时明确报错，不使用弱随机数', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createId()).toThrow('缺少安全随机数支持');
  });
});
