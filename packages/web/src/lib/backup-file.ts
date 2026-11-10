import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { Backup } from '@shike/shared'
import { MAX_BACKUP_BYTES } from './db'

/**
 * 输入是数据库导出的业务备份；此层只负责把它交给浏览器或安卓系统。
 * 格式化 JSON 后再按 UTF-8 计算大小，因为中文/缩进都会影响实际文件字节数。
 * 安卓先写 App 缓存再分享 URI，不申请整个手机的存储权限；share 完成表示系统流程返回，
 * 不代表用户已另存到可靠位置。缓存中的文件可能被系统清理，长期备份应由用户另存。
 */
export async function saveBackupFile(backup: Backup, includePhotos = true): Promise<void> {
  const filename = `食刻备份-${backup.exportedAt.slice(0, 10)}${includePhotos ? '' : '-不含照片'}.json`
  const json = JSON.stringify(backup, null, 2)
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new Error('备份超过100 MB，请取消“包含餐次照片”后导出记录备份。')
  if (Capacitor.isNativePlatform()) {
    const file = await Filesystem.writeFile({ path: `backups/${filename}`, data: json, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    await Share.share({ title: '食刻饮食备份', files: [file.uri], dialogTitle: '保存或分享 JSON 备份' })
    return
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  // 不能在 click 后立即释放：浏览器开始下载仍可能需要该 URL；短暂延迟后释放 Blob 引用。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
