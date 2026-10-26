// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { saveBackupFile } from '../src/lib/backup-file'
import type { Backup } from '@shike/shared'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: vi.fn() }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))
const backup: Backup = { schemaVersion: 11, mealPhotos: [], libraryFoods: [], packagedFoods: [], exportedAt: '2026-10-15T03:00:00.000Z', meals: [], weights: [], estimatedFoods: [], water: [], exercises: [], dailyPlans: [], settings: { targetWeightKg: null } }
beforeEach(() => vi.clearAllMocks())
describe('安卓备份导出', () => {
  it('把完整 JSON 写入 App 缓存并用系统分享，不依赖 WebView 的 blob 下载', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'file:///cache/backup.json' })
    await saveBackupFile(backup)
    expect(Filesystem.writeFile).toHaveBeenCalledWith({ path: 'backups/食刻备份-2026-10-15.json', data: JSON.stringify(backup, null, 2), directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/backup.json'] }))
  })
  it('写入失败不弹出分享菜单，错误交回页面处理', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error('no space'))
    await expect(saveBackupFile(backup)).rejects.toThrow('no space')
    expect(Share.share).not.toHaveBeenCalled()
  })
})
