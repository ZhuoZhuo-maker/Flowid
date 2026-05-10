/**
 * 将系统文件拖入画布时按类型分组（部分系统对本地文件不给 MIME，用扩展名兜底）。
 */
export function partitionMediaFilesByKind(files: readonly File[]): {
  images: File[]
  videos: File[]
  audios: File[]
} {
  const images: File[] = []
  const videos: File[] = []
  const audios: File[] = []
  for (const f of files) {
    const t = String(f.type || '').toLowerCase()
    if (t.startsWith('image/')) {
      images.push(f)
      continue
    }
    if (t.startsWith('video/')) {
      videos.push(f)
      continue
    }
    if (t.startsWith('audio/')) {
      audios.push(f)
      continue
    }
    const name = f.name || ''
    if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i.test(name)) {
      videos.push(f)
      continue
    }
    if (/\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i.test(name)) {
      audios.push(f)
    }
  }
  return { images, videos, audios }
}
