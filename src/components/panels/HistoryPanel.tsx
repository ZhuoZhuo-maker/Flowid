import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { motion } from 'motion/react'
import type { HistoryItem } from './types'
import { loadLocalDiskPathsSettings } from '../../lib/localDiskPathsSettings'
import { sanitizeFileStem } from '../../lib/localAssetDiskMirror'

/** 与 `mirrorComfyOutputToDisk` 的 `${stem}-${isoStamp}.ext` 命名一致，用于从展示名还原 stem。 */
function hasOutputMirrorTimestampSuffix(leaf: string): boolean {
  return /-\d{4}-\d{2}-\d{2}T[\d-]+Z$/i.test(String(leaf || '').trim())
}

function stripOutputMirrorTimestampSuffix(leaf: string): string {
  return String(leaf || '')
    .trim()
    .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z$/i, '')
    .trim()
}

function diskHistoryLeafStemForDedup(leaf: string): string {
  const s = String(leaf || '').trim()
  if (!hasOutputMirrorTimestampSuffix(s)) return sanitizeFileStem(s)
  return sanitizeFileStem(stripOutputMirrorTimestampSuffix(s))
}

const HISTORY_TABS = ['全部', '图片', '视频', '音频', '音乐'] as const
type HistoryTab = (typeof HISTORY_TABS)[number]
type DisplayHistoryItem = HistoryItem & {
  mediaKind: 'image' | 'video' | 'audio' | 'music' | null
  displayTitle: string
}

const OUTPUT_HISTORY_LIMIT = 30

/**
 * 将本地绝对路径转换为 file URL，供浏览器媒体标签直接预览。
 */
function toFileUrl(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`
  }
  return `file://${encodeURI(normalized)}`
}

/**
 * 根据文件扩展名推断媒体类型。
 */
function resolveMediaKindByExt(fileName: string): 'image' | 'video' | 'audio' | 'music' | null {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'audio'
  return null
}

function resolveMimeByExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'mkv') return 'video/x-matroska'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'flac') return 'audio/flac'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'aac') return 'audio/aac'
  return 'application/octet-stream'
}

function resolveLocalFilePath(item: HistoryItem): string {
  // Our disk-mapped history items use id: `output:${file.path}`.
  if (item.id && item.id.startsWith('output:')) return item.id.slice('output:'.length)
  return ''
}

function resolveMediaKind(item: HistoryItem): 'image' | 'video' | 'audio' | 'music' | null {
  if (!item.src) return null
  if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' || item.kind === 'music') {
    return item.kind
  }
  const title = item.title || ''
  const text = item.text || ''
  if (/^音乐节点/.test(title) || text.includes('音乐')) {
    return 'music'
  }
  return null
}

/**
 * 视频历史条目封面：静音加载后 seek 到首帧附近并暂停，用画面作缩略图；点击由上层切到播放态。
 */
function HistoryVideoPosterThumb({ src, onPlay }: { src: string; onPlay: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null)
  const [posterFailed, setPosterFailed] = useState(false)

  useEffect(() => {
    setPosterFailed(false)
  }, [src])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {!posterFailed ? (
        <video
          ref={vRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none block h-full w-full object-cover"
          onLoadedMetadata={() => {
            const v = vRef.current
            if (!v) return
            try {
              const d = v.duration
              if (Number.isFinite(d) && d > 0) {
                v.currentTime = Math.min(0.12, Math.max(0.001, d * 0.02))
              } else {
                v.currentTime = 0.08
              }
            } catch {
              try {
                v.currentTime = 0
              } catch {
                // ignore
              }
            }
          }}
          onSeeked={() => {
            try {
              vRef.current?.pause()
            } catch {
              // ignore
            }
          }}
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40">视</div>
      )}
      <button
        type="button"
        className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 text-[22px] text-white/90 transition-colors hover:bg-black/10 hover:text-orange-300"
        onClick={onPlay}
        title="播放"
      >
        <span className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]" aria-hidden>
          ▷
        </span>
      </button>
    </div>
  )
}

/**
 * 历史缩略图内联视频：不用原生 `controls`，避免浏览器自带的「⋯」等控件；
 * 进入后自动播放，点击画面暂停/继续，播完由上层收起。
 */
function HistoryInlineVideo({ src, onEnded }: { src: string; onEnded: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)

  useLayoutEffect(() => {
    const v = ref.current
    if (!v) return
    void v.play().catch(() => {})
  }, [src])

  return (
    <video
      ref={ref}
      src={src}
      playsInline
      preload="auto"
      className="block h-full w-full cursor-pointer bg-black object-cover"
      title="点击画面暂停或继续"
      onEnded={onEnded}
      onLoadedData={(e) => {
        void e.currentTarget.play().catch(() => {})
      }}
      onClick={(e) => {
        const v = e.currentTarget
        if (v.paused) void v.play()
        else v.pause()
      }}
    />
  )
}

/**
 * 历史记录面板：展示最近操作流水。
 */
export function HistoryPanel({
  historyItems,
  onRemoveHistoryItems,
  embedded = false,
}: {
  historyItems: HistoryItem[]
  onRemoveHistoryItems: (ids: string[]) => void
  /** 嵌入到右侧面板时去掉卡片外壳（避免双层边框/阴影）。 */
  embedded?: boolean
}) {
  const [activeTab, setActiveTab] = useState<HistoryTab>('全部')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [diskHistoryItems, setDiskHistoryItems] = useState<HistoryItem[] | null>(null)
  const [diskPathsTick, setDiskPathsTick] = useState(0)
  const [diskDebug, setDiskDebug] = useState<{
    outputPath: string
    scannedFiles: number
    matchedMedia: number
    error: string
  }>(() => ({
    outputPath: '',
    scannedFiles: 0,
    matchedMedia: 0,
    error: '',
  }))
  /** 图片缩略图加载失败（过期 URL、404 等）时记录 id，改显示占位 */
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(() => new Set())
  const [previewSrcById, setPreviewSrcById] = useState<Record<string, string>>({})
  const previewSrcRef = useRef<Record<string, string>>({})
  /** 在缩略图方格内内联播放音视频的条目 id（不占额外高度，再点「收起」或切换条目关闭） */
  const [activeInlinePlayerId, setActiveInlinePlayerId] = useState<string | null>(null)

  useEffect(() => {
    const onChanged = () => setDiskPathsTick((v) => v + 1)
    window.addEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    }
  }, [])

  useEffect(() => {
    previewSrcRef.current = previewSrcById
  }, [previewSrcById])

  useEffect(() => {
    return () => {
      // Cleanup blob URLs on unmount.
      for (const url of Object.values(previewSrcRef.current)) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // ignore
        }
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const desktop = window.flowidDesktop
      if (!desktop?.readDirectory) {
        if (!cancelled) setDiskHistoryItems(null)
        if (!cancelled) {
          setDiskDebug({
            outputPath: '',
            scannedFiles: 0,
            matchedMedia: 0,
            error: 'desktop.readDirectory unavailable',
          })
        }
        return
      }
      const outputPath = String(loadLocalDiskPathsSettings().outputPath || '').trim()
      if (!outputPath) {
        if (!cancelled) setDiskHistoryItems(null)
        if (!cancelled) {
          setDiskDebug({
            outputPath: '',
            scannedFiles: 0,
            matchedMedia: 0,
            error: 'outputPath empty',
          })
        }
        return
      }
      const res = await desktop.readDirectory(outputPath, { recursive: true, maxFiles: 4000, maxDepth: 6 })
      if (cancelled) return
      if (!res?.ok || !Array.isArray(res.files)) {
        setDiskHistoryItems(null)
        setDiskDebug({
          outputPath,
          scannedFiles: 0,
          matchedMedia: 0,
          error: String(res?.error || 'readDirectory failed'),
        })
        return
      }
      const scannedFiles = res.files.length
      let matchedMedia = 0
      const mapped: HistoryItem[] = res.files
        .map((file) => {
          const kind = resolveMediaKindByExt(file.name)
          if (!kind) return null
          matchedMedia += 1
          return {
            id: `output:${file.path}`,
            text: 'output',
            createdAt: Number(file.mtimeMs || 0),
            kind,
            src: toFileUrl(file.path),
            title: file.name.replace(/\.[^.]+$/, ''),
          } as HistoryItem
        })
        .filter((item): item is HistoryItem => Boolean(item))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, OUTPUT_HISTORY_LIMIT)
      setDiskHistoryItems(mapped)
      setDiskDebug({
        outputPath,
        scannedFiles,
        matchedMedia,
        error: '',
      })
    })()
    return () => {
      cancelled = true
    }
  }, [historyItems.length, diskPathsTick])

  /**
   * 桌面端会扫描 output 目录得到 diskHistoryItems；若目录为空，diskHistoryItems 为 []。
   * 不能用 `[] ?? historyItems`（空数组不是 nullish），否则本地流水 historyItems 会被整表盖住。
   */
  const sourceItems = useMemo(() => {
    if (diskHistoryItems === null) return historyItems
    /**
     * 一次 Comfy 任务多路视频/图会镜像多个 `标题-ISO时间戳.ext` 到输出目录；
     * 磁盘扫描会每条文件占一格，与内存里「视频生成成功」一条并列，截断标题后像重复执行多次。
     * 对已识别为镜像时间戳命名的磁盘条目：若与近期同类型内存条目的标题 stem 一致，则不再重复展示。
     */
    const memoryKinds = new Set(['image', 'video', 'audio', 'music'])
    const memoryMedia = historyItems.filter((h) => {
      const src = String(h.src || '').trim()
      if (!src || src.startsWith('file://')) return false
      const k = h.kind
      return Boolean(k && memoryKinds.has(k))
    })
    const timeSkewMs = 180_000
    const filteredDisk = diskHistoryItems.filter((d) => {
      if (!d.id?.startsWith('output:')) return true
      const leaf = String(d.title || '').trim()
      if (!leaf || !hasOutputMirrorTimestampSuffix(leaf)) return true
      const diskStem = diskHistoryLeafStemForDedup(leaf)
      const diskCt = Number(d.createdAt) || 0
      const shadowed = memoryMedia.some((h) => {
        const memStem = sanitizeFileStem(String(h.title || '').trim())
        if (memStem !== diskStem) return false
        if (h.kind && d.kind && h.kind !== d.kind) return false
        const memCt = Number(h.createdAt) || 0
        return Math.abs(memCt - diskCt) < timeSkewMs
      })
      return !shadowed
    })
    const merged = [...historyItems, ...filteredDisk]
    merged.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    return merged
  }, [diskHistoryItems, historyItems])

  const displayItems = useMemo<DisplayHistoryItem[]>(() => {
    const mediaItems = sourceItems
      .map((item) => ({ item, mediaKind: resolveMediaKind(item) }))
      .filter((entry) => Boolean(entry.mediaKind))
    /**
     * 同源去重：同一个媒体地址只保留最新一条，避免缓存命中时历史卡片翻倍。
     */
    const deduped = mediaItems.filter((entry, index, arr) => {
      const src = entry.item.src
      if (!src) return true
      const key = `${entry.mediaKind}:${src}`
      return (
        arr.findIndex((candidate) => {
          const candidateSrc = candidate.item.src
          if (!candidateSrc) return false
          return `${candidate.mediaKind}:${candidateSrc}` === key
        }) === index
      )
    })
    const filtered = deduped.filter((item) => {
      if (activeTab === '全部') return true
      if (activeTab === '图片') return item.mediaKind === 'image'
      if (activeTab === '视频') return item.mediaKind === 'video'
      if (activeTab === '音频') return item.mediaKind === 'audio'
      return item.mediaKind === 'music'
    })
    const sliced = filtered.slice(0, OUTPUT_HISTORY_LIMIT).map((entry) => entry.item)
    const titleCounter = new Map<string, number>()
    const normalizeTitleBase = (raw: string): string => {
      const v = String(raw || '').trim()
      if (!v) return ''
      // 若标题本身已带 "(数字)"，先去掉，避免重复追加成 "xxx(1)(1)"。
      return v.replace(/\(\d+\)$/u, '').trim()
    }
    return sliced.map((item) => {
      const mediaKind = resolveMediaKind(item)
      const rawTitle = (item.title || '').trim() || item.text.slice(0, 8) || '记录'
      const baseTitle = normalizeTitleBase(rawTitle) || '记录'
      const count = titleCounter.get(baseTitle) ?? 0
      titleCounter.set(baseTitle, count + 1)
      const displayTitle = count === 0 ? baseTitle : `${baseTitle}(${count})`
      return {
        ...item,
        mediaKind,
        displayTitle,
      }
    })
  }, [activeTab, sourceItems])

  /**
   * Electron renderer often blocks `file://` resources. For desktop preview, read file bytes by IPC and create `blob:` URLs.
   * We only generate previews for currently displayed items (up to OUTPUT_HISTORY_LIMIT).
   */
  useEffect(() => {
    const desktop = window.flowidDesktop
    const readBinaryFile = desktop?.readBinaryFile
    if (!readBinaryFile) return
    const targets = displayItems
      .filter(
        (item) =>
          item.src &&
          item.src.startsWith('file://') &&
          (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio'),
      )
      .slice(0, OUTPUT_HISTORY_LIMIT)
    if (!targets.length) return

    let cancelled = false

    void (async () => {
      for (const item of targets) {
        if (cancelled) return
        if (previewSrcRef.current[item.id]) continue
        const fp = resolveLocalFilePath(item)
        if (!fp) continue
        const res = await readBinaryFile(fp)
        if (cancelled) return
        if (!res?.ok || !res.data) continue
        try {
          const blob = new Blob([res.data], { type: resolveMimeByExt(fp) })
          const url = URL.createObjectURL(blob)
          setPreviewSrcById((prev) => {
            // Avoid leaking old URL if overwritten.
            const existing = prev[item.id]
            if (existing) {
              try {
                URL.revokeObjectURL(existing)
              } catch {
                // ignore
              }
            }
            return { ...prev, [item.id]: url }
          })
        } catch {
          // ignore
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [displayItems])

  const resolvePlayableSrc = (h: DisplayHistoryItem): string => {
    const rawSrc = String(h.src || '')
    const isLocalFile = rawSrc.startsWith('file://')
    return (previewSrcById[h.id] || (!isLocalFile ? rawSrc : '')) as string
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const downloadSelected = () => {
    const selected = displayItems.filter((item) => selectedIds.includes(item.id) && item.src)
    selected.forEach((item, index) => {
      const a = document.createElement('a')
      a.href = (previewSrcById[item.id] || (item.src as string)) as string
      a.download = item.displayTitle || `history-${index + 1}`
      a.click()
    })
  }

  const deleteSelected = () => {
    if (!selectedIds.length) return
    // 空数组仍为 truthy；仅在有实际扫描到的磁盘条目时才走「只改 disk 列表」分支
    if (diskHistoryItems !== null && diskHistoryItems.length > 0) {
      setDiskHistoryItems((prev) => (prev ? prev.filter((item) => !selectedIds.includes(item.id)) : prev))
      setSelectedIds([])
      setBatchMode(false)
      return
    }
    const selectedItems = displayItems.filter((item) => selectedIds.includes(item.id))
    const deleteIdSet = new Set<string>(selectedIds)
    // 同源联删：当历史里存在同一媒体地址的重复记录时，避免“删掉一条又出现一条”。
    selectedItems.forEach((selected) => {
      if (!selected.src || !selected.mediaKind) return
      sourceItems.forEach((raw) => {
        if (!raw.src) return
        const rawKind = resolveMediaKind(raw)
        if (rawKind === selected.mediaKind && raw.src === selected.src) {
          deleteIdSet.add(raw.id)
        }
      })
    })
    onRemoveHistoryItems(Array.from(deleteIdSet))
    setSelectedIds([])
    setBatchMode(false)
  }

  const shellClassName = embedded
    ? 'flex flex-col h-full min-h-0 overflow-hidden'
    : 'w-80 bg-[#111114] border border-white/10 rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px] max-h-[min(88vh,720px)]'

  const Shell = embedded ? 'div' : motion.div

  return (
    <Shell
      {...(!embedded
        ? {
            initial: { opacity: 0, x: -20 },
            animate: { opacity: 1, x: 0 },
            exit: { opacity: 0, x: -16 },
            transition: { duration: 0.18 },
          }
        : {})}
      className={shellClassName}
    >
      <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50">历史</div>
          <div className="text-[11px] font-mono text-white/35 mt-1 truncate">只保留最近30条，请及时保存</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Clock size={14} className="text-white/50" aria-hidden />
          <button
            type="button"
            title="批量选择"
            onClick={() => {
              setBatchMode((prev) => !prev)
              setSelectedIds([])
              setActiveInlinePlayerId(null)
            }}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-black uppercase tracking-widest transition-colors ${
              batchMode
                ? 'border-orange-500/40 bg-orange-500/15 text-orange-500'
                : 'border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white'
            }`}
          >
            批量
          </button>
        </div>
      </div>

      <div className="px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-white/5 shrink-0 select-none">
        {HISTORY_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-lg text-[14px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
              activeTab === tab
                ? 'bg-orange-500/10 border-orange-500/20 text-orange-500'
                : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 min-h-0">
        {displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-white/40">
            <Clock size={32} className="mb-4 opacity-40" />
            <div className="text-[14px] font-black uppercase tracking-widest">暂无记录</div>
            {diskHistoryItems ? (
              <div className="mt-3 max-w-[260px] text-[11px] font-mono leading-relaxed text-white/30">
                <div>Output: {diskDebug.outputPath || '-'}</div>
                <div>Scanned: {diskDebug.scannedFiles} files</div>
                <div>Matched: {diskDebug.matchedMedia} media</div>
                {diskDebug.error ? <div>Error: {diskDebug.error}</div> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={`grid gap-3 ${displayItems.length >= 8 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {displayItems.map((h) => {
              const playable = resolvePlayableSrc(h)
              const inlineOpen = !batchMode && activeInlinePlayerId === h.id
              return (
                <div
                  key={h.id}
                  className="group flex flex-col gap-1.5 rounded-xl border border-white/5 bg-black/30 p-2 hover:border-orange-500/30 transition-colors"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black/40">
                    {batchMode ? (
                      <button
                        type="button"
                        title="选择"
                        onClick={() => toggleSelect(h.id)}
                        className={`absolute left-1.5 top-1.5 z-10 h-4 w-4 rounded-full border-2 ${
                          selectedIds.includes(h.id)
                            ? 'border-orange-500 bg-orange-500'
                            : 'border-white/40 bg-black/50'
                        }`}
                      />
                    ) : null}
                    {h.mediaKind === 'image' && h.src ? (
                      brokenImageIds.has(h.id) ? (
                        <span
                          className="flex h-full w-full items-center justify-center text-[12px] text-white/40"
                          title="预览不可用或资源已失效"
                        >
                          图
                        </span>
                      ) : (
                        (() => {
                          const rawSrc = String(h.src || '')
                          const isLocalFile = rawSrc.startsWith('file://')
                          const preview = previewSrcById[h.id]
                          const imgSrc = preview || (!isLocalFile ? rawSrc : '')
                          if (!imgSrc) {
                            return (
                              <span className="flex h-full w-full items-center justify-center text-[12px] text-white/40">
                                图
                              </span>
                            )
                          }
                          return (
                            <img
                              src={imgSrc}
                              alt={h.title || '图片'}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              onError={() =>
                                setBrokenImageIds((prev) => {
                                  const next = new Set(prev)
                                  next.add(h.id)
                                  return next
                                })
                              }
                            />
                          )
                        })()
                      )
                    ) : null}
                    {(h.mediaKind === 'audio' || h.mediaKind === 'music') && h.src ? (
                      (() => {
                        if (!playable) {
                          return (
                            <span className="flex h-full w-full items-center justify-center text-[12px] text-white/40">
                              音
                            </span>
                          )
                        }
                        if (inlineOpen) {
                          return (
                            <audio
                              src={playable}
                              controls
                              autoPlay
                              className="h-full w-full max-h-full object-contain"
                              onEnded={() =>
                                setActiveInlinePlayerId((cur) => (cur === h.id ? null : cur))
                              }
                            />
                          )
                        }
                        return (
                          <button
                            type="button"
                            className="flex h-full w-full items-center justify-center text-[22px] text-white/70 hover:text-orange-400"
                            onClick={() => setActiveInlinePlayerId(h.id)}
                            title="在缩略图内播放"
                          >
                            ▶
                          </button>
                        )
                      })()
                    ) : null}
                    {h.mediaKind === 'video' && h.src ? (
                      (() => {
                        if (!playable) {
                          return (
                            <span className="flex h-full w-full items-center justify-center text-[12px] text-white/40">
                              视
                            </span>
                          )
                        }
                        if (inlineOpen) {
                          return (
                            <HistoryInlineVideo
                              src={playable}
                              onEnded={() =>
                                setActiveInlinePlayerId((cur) => (cur === h.id ? null : cur))
                              }
                            />
                          )
                        }
                        return (
                          <HistoryVideoPosterThumb
                            src={playable}
                            onPlay={() => setActiveInlinePlayerId(h.id)}
                          />
                        )
                      })()
                    ) : null}
                  </div>
                  <div className="truncate text-center text-[11px] font-black uppercase tracking-wider text-white/55">
                    {h.displayTitle}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {batchMode ? (
        <div className="flex gap-2 border-t border-white/5 bg-black/20 p-3 shrink-0">
          <button
            type="button"
            onClick={downloadSelected}
            disabled={!selectedIds.length}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-[12px] font-black uppercase tracking-widest text-white/85 hover:bg-white/10 disabled:opacity-40"
          >
            下载
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedIds.length}
            className="flex-1 rounded-xl border border-red-500/25 bg-red-500/10 py-2 text-[12px] font-black uppercase tracking-widest text-red-200 hover:bg-red-500/20 disabled:opacity-40"
          >
            删除
          </button>
        </div>
      ) : null}
    </Shell>
  )
}
