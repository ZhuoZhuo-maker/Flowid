import { useEffect, useMemo, useState } from 'react'
import { Copy, GripVertical, Shield, Tag } from 'lucide-react'
import { motion } from 'motion/react'
import {
  fetchSystemPromptPresets,
  getSystemPromptPresetClientStatus,
  loadActiveSystemPromptPresetId,
  saveActiveSystemPromptPresetId,
  type SystemPromptPresetMeta,
} from '../../lib/systemPromptPresets'

type Category = { id: string; label: string }

export function SystemPromptsPanel({ embedded = false }: { embedded?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<SystemPromptPresetMeta[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeId, setActiveId] = useState<string>(() => loadActiveSystemPromptPresetId())
  const clientStatus = useMemo(() => getSystemPromptPresetClientStatus(), [])

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
      // Prefer patterns like "剧-2-xxx" / "脚本-10 xxx" / "xx-3"
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
              return (
                <div
                  key={preset.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', token)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  role="button"
                  tabIndex={0}
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
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    selected
                      ? 'border-orange-500/35 bg-orange-500/10'
                      : 'border-white/10 bg-black/20 hover:bg-white/5 hover:border-white/20'
                  }`}
                  title={preset.description || preset.name}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical size={14} className="shrink-0 text-white/25" aria-hidden />
                        <div
                          className={`text-[13px] font-black uppercase tracking-widest truncate ${
                            selected ? 'text-orange-400' : 'text-white/75'
                          }`}
                        >
                          {preset.name}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-white/35 mt-1 truncate">
                        {preset.category || 'general'} · v{preset.version || '1.0.0'}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white/55 hover:text-white hover:bg-white/10 transition-colors"
                        title="复制引用（拖拽到提示词框也可）"
                        aria-label="复制引用"
                        onClick={async (event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          try {
                            await navigator.clipboard.writeText(token)
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        <Copy size={14} />
                      </button>
                      <div
                        className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                          selected
                            ? 'border-orange-500/40 bg-orange-500/15 text-orange-500'
                            : 'border-white/10 bg-white/5 text-white/45'
                        }`}
                      >
                        {selected ? '已启用' : '选择'}
                      </div>
                    </div>
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

