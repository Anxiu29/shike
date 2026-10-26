import { describe, expect, it } from 'vitest';
import { giteeUpdateAssets, githubUpdateAssets, normalizeUpdateRepository, updateAssetUrl, updateDownloadUrl, updateManifestSchema } from '../src/app-updates.js';
const prefix = 'https://github.com/Anxiu29/shike/releases/download/v0.12.0-test/';
const manifest = { schemaVersion: 1, appId: 'cn.anxiu29.shike', versionCode: 33, versionName: '0.12.0-test', releasedAt: '2026-10-24T04:00:00.000Z', minSdk: 24, bytes: 10485760, sha256: 'a'.repeat(64), notes: ['修复记录显示'] };
describe('公开GitHub应用更新契约', () => {
  it('Gitee旧版在前时按真实发布时间选择新版，跨时区比较且不改原列表', () => {
    const item = (tag: string, date: string, id: number) => ({ id, tag_name: tag, created_at: date, assets: ['shike.apk', 'shike-update.json'].map(name => ({ name, browser_download_url: `https://gitee.com/anxiu29/shike/releases/download/${tag}/${name}` })) });
    const list = [item('old', '2026-10-24T17:24:06+08:00', 1), item('new', '2026-10-26T09:12:37+08:00', 2)];
    expect(giteeUpdateAssets(list, 'anxiu29/shike')?.apkUrl).toContain('/new/'); expect(list[0]?.tag_name).toBe('old');
    expect(giteeUpdateAssets([item('utc-new', '2026-10-26T01:15:00Z', 1), list[1]], 'anxiu29/shike')?.apkUrl).toContain('/utc-new/');
    expect(giteeUpdateAssets([list[1], item('tie-new', list[1]!.created_at, 3)], 'anxiu29/shike')?.apkUrl).toContain('/tie-new/');
  });
  it('Gitee仓库与附件采用自己的来源规则，拒绝跨仓库、跨标签和外链', () => {
    expect(normalizeUpdateRepository('https://gitee.com/anxiu29/shike.git', 'gitee')).toBe('anxiu29/shike');
    expect(normalizeUpdateRepository('user_name/app', 'gitee')).toBe('user_name/app');
    for (const repo of ['https://github.com/anxiu29/shike', 'https://secret@gitee.com/a/b', 'http://gitee.com/a/b', 'a/../b', 'a/b?access_token=x']) expect(() => normalizeUpdateRepository(repo, 'gitee')).toThrow();
    const base = 'https://gitee.com/anxiu29/shike/releases/download/v-next/';
    const item = { created_at: manifest.releasedAt, tag_name: 'v-next', prerelease: true, assets: [{ name: 'shike.apk', browser_download_url: base + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: base + 'shike-update.json' }] };
    expect(giteeUpdateAssets([{ ...item, draft: true }, item], 'anxiu29/shike')).toEqual({ apkUrl: base + 'shike.apk', manifestUrl: base + 'shike-update.json', releaseUrl: 'https://gitee.com/anxiu29/shike/releases/tag/v-next' });
    for (const change of [{ tag_name: 'other' }, { assets: [item.assets[0], { ...item.assets[1], browser_download_url: base.replace('v-next', 'other') + 'shike-update.json' }] }, { assets: [{ ...item.assets[0], browser_download_url: base.replace('gitee.com', 'github.com') + 'shike.apk' }, item.assets[1]] }]) expect(() => giteeUpdateAssets([{ ...item, ...change }], 'anxiu29/shike')).toThrow();
    expect(giteeUpdateAssets([], 'anxiu29/shike')).toBeNull();
  });
  it('下载只允许对应平台的HTTPS固定主机，Gitee不能跳转到GitHub或任意对象存储', () => {
    expect(updateDownloadUrl('https://foruda.gitee.com/attach/example?signature=temporary', 'gitee')).toContain('foruda.gitee.com');
    for (const url of ['http://gitee.com/a', 'https://secret@gitee.com/a', 'https://gitee.com.evil.test/a', 'https://foruda.gitee.com:8443/a', 'https://github.com/a', 'https://some-oss.example/a']) expect(() => updateDownloadUrl(url, 'gitee')).toThrow();
    expect(() => updateDownloadUrl('https://foruda.gitee.com/a', 'github')).toThrow();
  });
  it('规范仓库名并拒绝凭据、任意服务器、空仓库与子路径', () => {
    expect(normalizeUpdateRepository(' https://github.com/Anxiu29/shike.git/ ')).toBe('Anxiu29/shike');
    for (const value of ['https://user:secret@github.com/a/b', 'http://github.com/a/b', 'https://evil.test/a/b', 'a/b/releases', 'a/..', 'a/.git', 'a/b?token=secret', 'a/b#fragment']) expect(() => normalizeUpdateRepository(value)).toThrow();
  });
  it('只接受同一仓库中的固定发布资源，不把发布说明当HTML', () => {
    expect(updateAssetUrl(prefix + 'shike.apk', 'Anxiu29/shike', 'shike.apk')).toBe(prefix + 'shike.apk');
    for (const value of [prefix.replace('/Anxiu29/', '/other/') + 'shike.apk', prefix + '../shike.apk', prefix + 'shike.apk?token=secret', prefix.replace('https:', 'http:') + 'shike.apk', prefix.replace('v0.12.0-test', '%2e%2e') + 'shike.apk', prefix.replace('v0.12.0-test', 'tag%2Fother') + 'shike.apk']) expect(() => updateAssetUrl(value, 'Anxiu29/shike', 'shike.apk')).toThrow();
  });
  it('包含测试发行版，跳过草稿及没有更新文件的历史版，拒绝跨版本资源', () => {
    const item = { draft: false, prerelease: true, published_at: manifest.releasedAt, assets: [{ name: 'shike.apk', size: manifest.bytes, browser_download_url: prefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: prefix + 'shike-update.json' }] };
    expect(githubUpdateAssets([{ ...item, draft: true }, { ...item, assets: [] }, item], 'Anxiu29/shike')).toEqual({ apkUrl: prefix + 'shike.apk', manifestUrl: prefix + 'shike-update.json', bytes: manifest.bytes, releaseUrl: 'https://github.com/Anxiu29/shike/releases/tag/v0.12.0-test' });
    expect(githubUpdateAssets([], 'Anxiu29/shike')).toBeNull();
    expect(() => githubUpdateAssets([{ ...item, assets: [item.assets[0], { ...item.assets[1], browser_download_url: prefix.replace('v0.12.0-test', 'other') + 'shike-update.json' }] }], 'Anxiu29/shike')).toThrow();
  });
  it('发布文件必须带有效版本、大小、SHA256与应用标识，拒绝任意附加地址', () => {
    expect(updateManifestSchema.parse(manifest)).toEqual(manifest);
    for (const change of [{ appId: 'other.app' }, { versionCode: 33.5 }, { bytes: 201 * 1024 * 1024 }, { sha256: 'wrong' }, { notes: [] }, { releasedAt: 'yesterday' }, { apkUrl: 'https://evil.test/x.apk' }]) expect(updateManifestSchema.safeParse({ ...manifest, ...change }).success).toBe(false);
  });
});
