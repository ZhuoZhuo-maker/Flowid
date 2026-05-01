import { useEffect, useRef, useState } from 'react'
import { loadLocalDiskPathsSettings } from '../lib/localDiskPathsSettings'
import { FLOWID_COVER_DISK_CHANGED_EVENT, loadCoverBlobUrlFromTitle } from '../lib/coverDisk'

/**
 * 预设模板封面：优先显示「封面存储」下与标题匹配的图片；预设模板页与画布左侧同源。
 */
export function PresetTemplateCoverImage({
  title,
  fallbackSrc,
  className,
  alt,
  onDiskCoverResolved,
}: {
  title: string
  fallbackSrc: string
  className?: string
  alt?: string
  /** 是否在磁盘上存在该标题的封面（用于隐藏上传按钮等） */
  onDiskCoverResolved?: (hasDiskCover: boolean) => void
}) {
  const [src, setSrc] = useState(fallbackSrc)
  const blobRef = useRef<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const onResolvedRef = useRef(onDiskCoverResolved)
  onResolvedRef.current = onDiskCoverResolved

  useEffect(() => {
    const bump = () => setReloadKey((n) => n + 1)
    window.addEventListener('flowid:local-disk-paths-changed', bump as EventListener)
    window.addEventListener(FLOWID_COVER_DISK_CHANGED_EVENT, bump as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', bump as EventListener)
      window.removeEventListener(FLOWID_COVER_DISK_CHANGED_EVENT, bump as EventListener)
    }
  }, [])

  useEffect(() => {
    const root = String(loadLocalDiskPathsSettings().systemPromptCoverPath || '').trim()
    let cancelled = false
    if (blobRef.current) {
      try {
        URL.revokeObjectURL(blobRef.current)
      } catch {
        /* ignore */
      }
      blobRef.current = null
    }
    setSrc(fallbackSrc)
    void (async () => {
      const blob = await loadCoverBlobUrlFromTitle(root, title)
      if (cancelled) {
        if (blob) {
          try {
            URL.revokeObjectURL(blob)
          } catch {
            /* ignore */
          }
        }
        return
      }
      if (blob) {
        blobRef.current = blob
        setSrc(blob)
        onResolvedRef.current?.(true)
      } else {
        onResolvedRef.current?.(false)
      }
    })()
    return () => {
      cancelled = true
      if (blobRef.current) {
        try {
          URL.revokeObjectURL(blobRef.current)
        } catch {
          /* ignore */
        }
        blobRef.current = null
      }
    }
  }, [title, fallbackSrc, reloadKey])

  return <img src={src} alt={alt ?? ''} className={className} draggable={false} />
}
