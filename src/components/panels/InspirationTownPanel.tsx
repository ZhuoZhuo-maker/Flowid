import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Tag } from 'lucide-react'
import {
  fetchInspirationList,
  fetchInspirationMeta,
  inspirationAbsoluteUrl,
  type InspirationListItem,
} from '../../lib/inspirationMarketApi'
import { InspirationMarketDetailPage } from '../home/InspirationMarketPages'

export function InspirationTownPanel({
  embedded = false,
  canvasDayMode = false,
}: {
  embedded?: boolean
  /** 嵌入右栏且画布为日间模式时，与 `RightPanel` 浅色底一致 */
  canvasDayMode?: boolean
}) {
  const [categories, setCategories] = useState<string[]>(['全部'])
  const [cat, setCat] = useState('全部')
  const [items, setItems] = useState<InspirationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const fetchSeqRef = useRef(0)
  const itemsRef = useRef<InspirationListItem[]>([])
  itemsRef.current = items

  const load = useCallback(async () => {
    const seq = ++fetchSeqRef.current
    setErr(null)
    const hasItems = itemsRef.current.length > 0
    if (hasItems) setRefreshing(true)
    else setLoading(true)
    try {
      const meta = await fetchInspirationMeta()
      if (seq !== fetchSeqRef.current) return
      if (meta?.categories?.length) {
        setCategories(['全部', ...meta.categories])
      }
      const list = await fetchInspirationList(cat === '全部' ? undefined : cat)
      if (seq !== fetchSeqRef.current) return
      if (!list) {
        setErr('无法拉取灵感小镇（请检查授权服务地址）')
        setItems([])
        return
      }
      setItems(list.items)
    } catch (e) {
      if (seq !== fetchSeqRef.current) return
      setErr(String((e as Error)?.message || e))
      setItems([])
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [cat])

  useEffect(() => {
    void load()
  }, [load])

  const shellClassName = embedded
    ? `flex flex-col h-full min-h-0 overflow-hidden${canvasDayMode ? ' inspiration-town-root--day' : ''}`
    : 'w-80 bg-[#111114] border border-white/10 rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px]'

  const day = canvasDayMode && embedded

  return (
    <>
      {detailId
        ? createPortal(
            <InspirationMarketDetailPage
              id={detailId}
              onBackHome={() => setDetailId(null)}
              onBackMarket={() => setDetailId(null)}
            />,
            document.body,
          )
        : null}
      <div className={shellClassName}>
        <div
          className={
            day
              ? 'p-4 border-b border-[#E8E8E8] flex items-center justify-between gap-3 shrink-0 bg-[#FAFAFA]'
              : 'p-4 border-b border-white/5 flex items-center justify-between gap-3 shrink-0'
          }
        >
          <div className="min-w-0">
            <div
              className={
                day
                  ? 'text-[14px] font-mono uppercase tracking-[0.2em] text-black/45'
                  : 'text-[14px] font-mono uppercase tracking-[0.2em] text-white/50'
              }
            >
              灵感小镇
            </div>
            <div
              className={
                day
                  ? 'text-[11px] font-mono text-black/40 mt-1 truncate'
                  : 'text-[11px] font-mono text-white/35 mt-1 truncate'
              }
            >
              按分类浏览，点击查看详情
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Sparkles size={14} className={day ? 'text-black/35' : 'text-white/50'} aria-hidden />
            <button
              type="button"
              className={
                day
                  ? 'rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[12px] font-black uppercase tracking-widest text-black/60 hover:border-black/20 hover:text-black/80 transition-colors disabled:opacity-50 shadow-sm'
                  : 'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-black uppercase tracking-widest text-white/60 hover:border-white/20 hover:text-white transition-colors disabled:opacity-50'
              }
              onClick={() => void load()}
              disabled={refreshing || loading}
              title="刷新列表与分类"
            >
              刷新
            </button>
          </div>
        </div>

        <div
          className={`system-prompts-category-tabs inspiration-town-cat-tabs px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar shrink-0 select-none ${
            day ? 'border-b border-[#E8E8E8] bg-[#FAFAFA]' : 'border-b border-white/5'
          }`}
        >
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              data-active={cat === c ? 'true' : undefined}
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
              className={
                day
                  ? `px-3 py-1.5 rounded-lg text-[14px] font-black uppercase tracking-widest whitespace-nowrap transition-all border border-black/10 ${
                      cat === c
                        ? 'bg-orange-500/15 text-[#9a3412] border-orange-500/35 shadow-[inset_0_0_0_1px_rgba(234,88,12,0.15)]'
                        : 'bg-white text-black/60 hover:border-black/20 hover:text-black/80'
                    }`
                  : `px-3 py-1.5 rounded-lg text-[14px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
                      cat === c
                        ? 'bg-orange-500/10 border-orange-500/20 text-orange-500'
                        : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20'
                    }`
              }
              title={c}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar ${day ? 'bg-white' : ''}`}>
          {err ? (
            <div
              className={
                day
                  ? 'rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-3 text-[12px] text-amber-900/90 font-bold leading-relaxed'
                  : 'rounded-xl border border-amber-500/35 bg-amber-950/25 px-3 py-3 text-[12px] text-amber-100/90 font-bold leading-relaxed'
              }
            >
              {err}
            </div>
          ) : loading && !items.length ? (
            <div
              className={
                day
                  ? 'py-10 text-center text-[12px] font-mono uppercase tracking-widest text-black/35'
                  : 'py-10 text-center text-[12px] font-mono uppercase tracking-widest text-white/35'
              }
            >
              Loading…
            </div>
          ) : !items.length ? (
            <div className={`h-48 flex flex-col items-center justify-center text-center ${day ? 'opacity-50' : 'opacity-40'}`}>
              <Tag size={28} className={`mb-3 ${day ? 'text-black/30' : ''}`} />
              <p
                className={
                  day
                    ? 'text-[12px] font-black uppercase tracking-widest text-black/45 m-0'
                    : 'text-[12px] font-black uppercase tracking-widest text-white/40 m-0'
                }
              >
                暂无灵感条目
              </p>
              <p
                className={
                  day
                    ? 'mt-2 mb-0 max-w-[220px] text-[11px] leading-relaxed text-black/40'
                    : 'mt-2 mb-0 max-w-[220px] text-[11px] leading-relaxed text-white/35'
                }
              >
                请在 Auth 管理台「灵感小镇」上传条目。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailId(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setDetailId(it.id)
                    }
                  }}
                  className={
                    day
                      ? 'flex w-full cursor-pointer gap-2 overflow-hidden rounded-xl border border-[#E8E8E8] bg-[#FAFAFA] text-left outline-none transition-colors hover:border-orange-400/45 hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-orange-500/35'
                      : 'flex w-full cursor-pointer gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#121212] text-left outline-none transition-colors hover:border-orange-500/35 focus-visible:ring-2 focus-visible:ring-orange-500/40'
                  }
                >
                  <div className="flex min-w-0 flex-1 flex-col p-3">
                    <div
                      className={
                        day
                          ? 'text-[11px] font-mono uppercase tracking-widest text-orange-700'
                          : 'text-[11px] font-mono uppercase tracking-widest text-orange-400'
                      }
                    >
                      {it.category}
                    </div>
                    <div
                      className={
                        day
                          ? 'mt-1 truncate text-[13px] font-black leading-snug text-neutral-900'
                          : 'mt-1 truncate text-[13px] font-black leading-snug text-orange-400'
                      }
                    >
                      {it.title}
                    </div>
                    {it.description ? (
                      <div
                        className={
                          day
                            ? 'mt-1 line-clamp-2 text-[11px] leading-relaxed text-black/50'
                            : 'mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/40'
                        }
                      >
                        {it.description}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={
                      day
                        ? 'relative min-h-[88px] w-20 shrink-0 self-stretch border-l border-[#E8E8E8] bg-neutral-100'
                        : 'relative min-h-[88px] w-20 shrink-0 self-stretch border-l border-white/5 bg-black/30'
                    }
                  >
                    <img
                      src={inspirationAbsoluteUrl(it.imageUrl)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
