import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { GripVertical, ImageUp, Shield, Tag } from 'lucide-react'
import { motion } from 'motion/react'
import { imageMimeTypeFromPath } from '../../lib/materialLibrary'
import { loadLocalDiskPathsSettings } from '../../lib/localDiskPathsSettings'
import { FLOWID_COVER_DISK_CHANGED_EVENT, saveCoverReplaceByTitle } from '../../lib/coverDisk'
import { SYSTEM_PROMPT_COVER_EXT_TRIES, coverLeafForTry, joinDiskPath } from '../../lib/systemPromptCoverPaths'
import {
  fetchSystemPromptPresets,
  getSystemPromptPresetClientStatus,
  loadActiveSystemPromptPresetId,
  saveActiveSystemPromptPresetId,
  type SystemPromptPresetMeta,
} from '../../lib/systemPromptPresets'

type Category = { id: string; label: string }

function isDesktopFileIo(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      window.flowidDesktop?.readBinaryFile &&
      window.flowidDesktop?.writeBinaryFile &&
      window.flowidDesktop?.ensureDirectory &&
      window.flowidDesktop?.deleteFile,
  )
}

export function SystemPromptsPanel({ embedded = false }: { embedded?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<SystemPromptPresetMeta[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeId, setActiveId] = useState<string>(() => loadActiveSystemPromptPresetId())
  const [pathsTick, setPathsTick] = useState(0)
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>({})
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputPresetIdRef = useRef<string | null>(null)
  const coverUrlByIdRef = useRef<Record<string, string>>({})

  const clientStatus = useMemo(() => getSystemPromptPresetClientStatus(), [])

  useEffect(() => {
    coverUrlByIdRef.current = coverUrlById
  }, [coverUrlById])

  useEffect(() => {
    const onPaths = () => setPathsTick((n) => n + 1)
    window.addEventListener('flowid:local-disk-paths-changed', onPaths as EventListener)
    window.addEventListener(FLOWID_COVER_DISK_CHANGED_EVENT, onPaths as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', onPaths as EventListener)
      window.removeEventListener(FLOWID_COVER_DISK_CHANGED_EVENT, onPaths as EventListener)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const next = await fetchSystemPromptPresets()
      if (cancelled) return
      setItems(next)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const categories = useMemo<Category[]>(() => {
    const set = new Set<string>()
    for (const item of items) set.add(item.category || 'general')
    const list = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    return [{ id: 'all', label: '全部' }, ...list.map((c) => ({ id: c, label: c }))]
  }, [items])

  const filtered = useMemo(() => {
    if (activeCategory === 'all') return items
    return items.filter((i) => (i.category || 'general') === activeCategory)
  }, [activeCategory, items])

  const sortedFiltered = useMemo(() => {
    const list = filtered.slice()
    const pickIndex = (name: string): number | null => {
      const raw = String(name || '').trim()
      const m = raw.match(/-(\d+)(?:\D|$)/u) || raw.match(/\b(\d+)\b/u)
      if (!m) return null
      const n = Number(m[1])
      return Number.isFinite(n) ? n : null
    }
    list.sort((a, b) => {
      const ai = pickIndex(a.name)
      const bi = pickIndex(b.name)
      if (ai != null && bi != null && ai !== bi) return ai - bi
      if (ai != null && bi == null) return -1
      if (ai == null && bi != null) return 1
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
    })
    return list
  }, [filtered])

  const buildToken = (title: string) => `@系统提示词(${String(title || '').trim()})`

  /** 从封面目录加载缩略图（桌面端）；失败则无封面 */
  useEffect(() => {
    const desk = window.flowidDesktop
    const root = String(loadLocalDiskPathsSettings().systemPromptCoverPath || '').trim()
    const readBinaryFile = desk?.readBinaryFile
    if (!readBinaryFile || !root) {
      for (const u of Object.values(coverUrlByIdRef.current)) {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      }
      setCoverUrlById({})
      return
    }

    let cancelled = false
    const prev = { ...coverUrlByIdRef.current }
    for (const u of Object.values(prev)) {
      try {
        URL.revokeObjectURL(u)
      } catch {
        /* ignore */
      }
    }

    void (async () => {
      const next: Record<string, string> = {}
      for (const preset of sortedFiltered) {
        if (cancelled) break
        let found: string | null = null
        for (const ext of SYSTEM_PROMPT_COVER_EXT_TRIES) {
          const leaf = coverLeafForTry(preset.name, ext)
          const fp = joinDiskPath(root, leaf)
          const r = await readBinaryFile(fp)
          if (r.ok && r.data && r.data.byteLength > 0) {
            const mime = imageMimeTypeFromPath(fp)
            found = URL.createObjectURL(new Blob([r.data], { type: mime }))
            break
          }
        }
        if (found) next[preset.id] = found
      }
      if (!cancelled) setCoverUrlById(next)
    })()

    return () => {
      cancelled = true
    }
  }, [sortedFiltered, pathsTick])

  useEffect(() => {
    return () => {
      for (const u of Object.values(coverUrlByIdRef.current)) {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const saveCoverFromFile = useCallback(async (preset: SystemPromptPresetMeta, file: File) => {
    setUploadBusyId(preset.id)
    try {
      const r = await saveCoverReplaceByTitle(preset.name, file)
      if (!r.ok) window.alert(r.error)
    } finally {
      setUploadBusyId(null)
    }
  }, [])

  const openFilePickerForPreset = (presetId: string) => {
    fileInputPresetIdRef.current = presetId
    queueMicrotask(() => fileInputRef.current?.click())
  }

  const onCoverFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const pid = fileInputPresetIdRef.current
    e.target.value = ''
    fileInputPresetIdRef.current = null
    if (!file || !pid) return
    const preset = sortedFiltered.find((p) => p.id === pid)
    if (!preset) return
    await saveCoverFromFile(preset, file)
  }

  const shellClassName = embedded
    ? 'flex flex-col h-full min-h-0 overflow-hidden'
    : 'w-80 bg-[#111114] border border-white/10 rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px]'

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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        onChange={(e) => void onCoverFileInputChange(e)}
      />

      <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50">系统提示词</div>
          <div className="text-[11px] font-mono text-white/35 mt-1 truncate">仅展示预设名称，不展示内容</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Shield size={14} className="text-white/50" aria-hidden />
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-black uppercase tracking-widest text-white/60 hover:border-white/20 hover:text-white transition-colors"
            onClick={() => {
              setLoading(true)
              void (async () => {
                const next = await fetchSystemPromptPresets()
                setItems(next)
                setLoading(false)
              })()
            }}
            title="刷新预设列表"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-white/5 shrink-0 select-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-[14px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
              activeCategory === cat.id
                ? 'bg-orange-500/10 border-orange-500/20 text-orange-500'
                : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20'
            }`}
            title={cat.label}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="py-10 text-center text-[12px] font-mono uppercase tracking-widest text-white/35">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center opacity-40">
            <Tag size={32} className="mb-4" />
            <p className="text-[12px] font-black uppercase tracking-widest text-white/40 m-0">
              暂无预设
            </p>
            {!clientStatus.ok ? (
              <p className="mt-3 mb-0 max-w-[220px] text-[11px] leading-relaxed tracking-wide text-white/35">
                {`未配置授权服务地址。请在右上角「授权」里填写授权服务地址（例如 ${clientStatus.baseUrl || 'http://127.0.0.1:3721'}）。`}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedFiltered.map((preset) => {
              const selected = preset.id === activeId
              const token = buildToken(preset.name)
              const coverUrl = coverUrlById[preset.id]
              const busy = uploadBusyId === preset.id
              return (
                <div
                  key={preset.id}
                  className={`w-full flex flex-row items-stretch gap-2 rounded-xl border transition-colors overflow-hidden ${
                    selected
                      ? 'border-orange-500/35 bg-orange-500/10'
                      : 'border-white/10 bg-black/20 hover:bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', token)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => {
                      setActiveId(preset.id)
                      saveActiveSystemPromptPresetId(preset.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setActiveId(preset.id)
                        saveActiveSystemPromptPresetId(preset.id)
                      }
                    }}
                    className="min-w-0 flex-1 flex items-start gap-2 p-3 text-left cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 rounded-l-xl"
                    title={preset.description || preset.name}
                  >
                    <GripVertical size={14} className="shrink-0 text-white/25 mt-0.5" aria-hidden />
                    <div
                      className="min-w-0 flex-1 cursor-grab"
                      onDoubleClick={async (event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        try {
                          await navigator.clipboard.writeText(token)
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      <div
                        className={`text-[13px] font-black uppercase tracking-widest truncate ${
                          selected ? 'text-orange-400' : 'text-white/75'
                        }`}
                        title={preset.name}
                      >
                        {preset.name}
                      </div>
                      <div className="text-[11px] font-mono text-white/35 mt-1 truncate">
                        {preset.category || 'general'} · v{preset.version || '1.0.0'}
                        {selected ? ' · 已启用' : ''}
                      </div>
                    </div>
                  </div>

                  <div
                    className="relative w-14 h-14 shrink-0 self-center m-2 rounded-lg border border-white/10 bg-white/5 overflow-hidden group/cover"
                    title={coverUrl ? '拖拽新图片到此处可替换封面' : undefined}
                    onClick={(ev) => ev.stopPropagation()}
                    onDragOver={(e) => {
                      if (!isDesktopFileIo()) return
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'copy'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const f = e.dataTransfer.files?.[0]
                      if (f) void saveCoverFromFile(preset, f)
                    }}
                  >
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                        draggable={false}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
                    )}
                    {!coverUrl ? (
                      <>
                        <div className="absolute inset-0 bg-black/0 group-hover/cover:bg-black/25 transition-colors pointer-events-none" />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            openFilePickerForPreset(preset.id)
                          }}
                          className="absolute inset-0 m-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 hover:border-orange-400/50 hover:bg-orange-600/30 hover:text-white transition-colors pointer-events-auto disabled:opacity-40"
                          title={isDesktopFileIo() ? '上传封面（或把图片拖到此处）' : '桌面版可上传封面到「封面存储」目录'}
                          aria-label="上传封面"
                        >
                          <ImageUp size={14} strokeWidth={2} />
                        </button>
                      </>
                    ) : (
                      <span className="sr-only">已有封面；可将新图片拖到此处以替换</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}
