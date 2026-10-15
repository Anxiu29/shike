import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { Backup } from '@shike/shared'

/** Web 下载 JSON；安卓通过系统分享菜单保存备份，不申请整个手机的存储权限。 */
export async function saveBackupFile(backup: Backup): Promise<void> {
  const filename = `食刻备份-${backup.exportedAt.slice(0, 10)}.json`
  const json = JSON.stringify(backup, null, 2)
  if (Capacitor.isNativePlatform()) {
    const file = await Filesystem.writeFile({ path: `backups/${filename}`, data: json, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    await Share.share({ title: '食刻饮食备份', files: [file.uri], dialogTitle: '保存或分享 JSON 备份' })
    return
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
