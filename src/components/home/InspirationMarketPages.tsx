import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  fetchInspirationItem,
  fetchInspirationList,
  fetchInspirationMeta,
  inspirationAbsoluteUrl,
  type InspirationListItem,
} from '../../lib/inspirationMarketApi'
import {
  destructurePromptWithLlm,
  synthesizePromptWithLlm,
  type InspirationPromptSegment,
} from '../../lib/inspirationMarketLlm'
import { loadAiAssistantConfig } from '../../lib/aiAssistantAgent'

/** 画廊式卡片：大图在上、橙字标题、圆角描边按钮（与参考稿一致） */
export function InspirationMarketGrid({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const [categories, setCategories] = useState<string[]>(['全部', 'UI', '海报', '角色', '场景', '产品', '其它'])
  const [cat, setCat] = useState('全部')
  const [items, setItems] = useState<InspirationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const meta = await fetchInspirationMeta()
      if (meta?.categories?.length) {
        setCategories(['全部', ...meta.categories])
      }
      const list = await fetchInspirationList(cat === '全部' ? undefined : cat)
      if (!list) {
        setErr('无法连接授权服务，请检查「设置 → 授权」中的服务地址（默认 3721）')
        setItems([])
        return
      }
      setItems(list.items)
    } catch (e) {
      setErr(String((e as Error)?.message || e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [cat])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-20">
        <div className="flex items-center gap-4 text-orange-500 font-black tracking-widest mb-6">
          <span className="text-xs">INSPIRATION_MARKET // V1</span>
          <div className="h-[1px] w-12 bg-orange-600" />
        </div>
        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic text-white/90 flex items-end gap-6 flex-wrap">
          灵感市集
          <div className="flex gap-2 mb-4">
            <div className="w-20 h-3 bg-orange-600" />
            <div className="w-8 h-3 bg-orange-600/40" />
            <div className="w-4 h-3 bg-orange-600/20" />
          </div>
        </h1>
      </div>

      <div className="flex gap-4 mb-16 overflow-x-auto pb-4 flex-wrap">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={`px-8 py-3 rounded-full text-[14px] font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 border whitespace-nowrap ${
              cat === c
                ? 'bg-orange-600 border-orange-600 text-white shadow-orange-600/30'
                : 'bg-[#111114] border-white/10 text-white/60 hover:border-white/20'
            }`}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="px-8 py-3 rounded-full text-[14px] font-black uppercase tracking-widest border border-white/10 bg-[#111114] text-white/60 hover:border-white/20 hover:text-white transition-all"
        >
          刷新
        </button>
      </div>

      {err ? (
        <div className="mb-8 rounded-2xl border border-amber-500/35 bg-amber-950/25 px-5 py-4 text-sm text-amber-100/95 font-bold leading-relaxed">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div
          className="min-h-[280px] rounded-2xl border border-white/5 bg-black/20 animate-pulse"
          aria-busy
          aria-label="加载中"
        />
      ) : !items.length ? (
        <div className="min-h-[280px] rounded-2xl border border-white/5 bg-black/20" aria-hidden />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((it) => (
            <motion.article
              key={it.id}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ y: -10 }}
              className="group overflow-hidden rounded-2xl border border-white/5 bg-[#0A0A0B] text-white transition-all duration-500 hover:border-orange-500/30"
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-black/40">
                <img
                  src={inspirationAbsoluteUrl(it.imageUrl)}
                  alt=""
                  className="h-full w-full object-cover grayscale opacity-50 pointer-events-none transition-all duration-1000 group-hover:scale-110 group-hover:opacity-100 group-hover:grayscale-0"
                  loading="lazy"
                />
                <div className="absolute left-3 top-3 z-10">
                  <span className="inline-flex items-center rounded-md border border-white/10 bg-black/60 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-orange-500/80 backdrop-blur-sm transition-colors duration-500 group-hover:text-orange-400">
                    {it.category}
                  </span>
                </div>
                <div
                  className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black via-transparent to-transparent opacity-60"
                  aria-hidden
                />
              </div>
              <div className="px-5 pb-5 pt-1 transition-opacity duration-500 opacity-80 group-hover:opacity-100">
                <h4 className="text-xl font-black leading-snug tracking-tight text-white/70 transition-colors duration-500 group-hover:text-orange-500">
                  {it.title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-white/40 line-clamp-2 transition-colors duration-500 group-hover:text-white/55">
                  {it.description || '—'}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenDetail(it.id)}
                  className="mt-5 w-full rounded-full border border-white/10 bg-white/5 py-3 text-[13px] font-black uppercase tracking-widest text-white/70 transition-all duration-500 group-hover:border-orange-500 group-hover:bg-orange-600 group-hover:text-white hover:bg-orange-600 hover:text-white"
                >
                  查看与拆解
                </button>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </div>
  )
}

export function InspirationMarketDetailPage({
  id,
  onBackHome,
  onBackMarket,
}: {
  id: string
  onBackHome: () => void
  onBackMarket: () => void
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchInspirationItem>>>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [segments, setSegments] = useState<InspirationPromptSegment[] | null>(null)
  const [composed, setComposed] = useState('')
  const [busy, setBusy] = useState<'destructure' | 'synthesize' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadErr(null)
      setSegments(null)
      setComposed('')
      setMsg(null)
      const d = await fetchInspirationItem(id)
      if (cancelled) return
      if (!d) {
        setLoadErr('条目不存在或网络错误')
        setDetail(null)
        return
      }
      setDetail(d)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const runDestructure = async () => {
    if (!detail?.promptText) return
    setBusy('destructure')
    setMsg(null)
    try {
      const cfg = loadAiAssistantConfig()
      const segs = await destructurePromptWithLlm(detail.promptText, cfg)
      setSegments(segs)
      setMsg('已拆解，可修改各块文字或颜色后点「合成同款提示词」。')
    } catch (e) {
      setMsg(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  const runSynthesize = async () => {
    if (!detail?.promptText || !segments?.length) return
    setBusy('synthesize')
    setMsg(null)
    try {
      const cfg = loadAiAssistantConfig()
      const text = await synthesizePromptWithLlm(segments, detail.promptText, cfg)
      setComposed(text)
      setMsg('已生成新的整段提示词，可复制到剪贴板或继续手改。')
    } catch (e) {
      setMsg(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  const copyComposed = async () => {
    const t = composed.trim()
    if (!t) return
    try {
      await navigator.clipboard.writeText(t)
      setMsg('已复制到剪贴板')
    } catch {
      window.alert(t)
    }
  }

  const shell =
    'rounded-2xl border border-white/5 bg-[#111114] p-5 md:p-6 shadow-[0_0_60px_rgba(0,0,0,0.45)]'
  const field =
    'w-full rounded-xl border border-white/10 bg-[#0c0c0e] text-white/90 text-sm font-mono px-3 py-2 outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/25'

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-[#080809] text-[#F0F0F0]">
      <div
        className="fixed inset-0 opacity-[0.05] pointer-events-none z-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #fff 1.2px, transparent 1.2px)',
          backgroundSize: '48px 48px',
        }}
        aria-hidden
      />
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-8 pb-24">
        <div className="flex flex-wrap items-center gap-3 mb-10">
          <button
            type="button"
            onClick={onBackHome}
            className="rounded-full bg-white text-black font-black text-[13px] uppercase tracking-widest px-8 py-2.5 hover:bg-orange-500 hover:text-white transition-all shadow-xl"
          >
            返回主页
          </button>
          <button
            type="button"
            onClick={onBackMarket}
            className="rounded-full border border-white/15 bg-white/5 text-white/80 font-black text-[13px] uppercase tracking-widest px-8 py-2.5 hover:border-orange-500/40 hover:text-white transition-all"
          >
            灵感市集
          </button>
        </div>

        {loadErr ? (
          <p className="text-red-400 font-bold text-sm border border-red-500/30 rounded-2xl bg-red-950/30 px-4 py-3">{loadErr}</p>
        ) : !detail ? (
          <p className="font-mono text-white/40 text-sm uppercase tracking-widest">加载中…</p>
        ) : (
          <>
            <header className={`mb-8 ${shell}`}>
              <div className="text-[11px] font-mono uppercase tracking-[0.25em] text-orange-500">{detail.category}</div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white mt-2">{detail.title}</h1>
              {detail.description ? (
                <p className="mt-3 text-sm text-white/50 leading-relaxed">{detail.description}</p>
              ) : null}
            </header>

            <div className={`mb-8 overflow-hidden ${shell} p-0`}>
              <img
                src={inspirationAbsoluteUrl(detail.imageUrl)}
                alt=""
                className="w-full max-h-[min(420px,55vh)] object-contain bg-black/40"
              />
            </div>

            <section className={`mb-6 ${shell}`}>
              <h2 className="text-[13px] font-black uppercase tracking-widest text-white/55 mb-3">原始提示词</h2>
              <pre
                className={`whitespace-pre-wrap text-sm text-white/70 font-mono leading-relaxed max-h-64 overflow-y-auto custom-scrollbar rounded-xl border border-white/5 bg-black/25 p-4`}
              >
                {detail.promptText}
              </pre>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void runDestructure()}
                  className="rounded-full bg-orange-600 px-8 py-2.5 text-[13px] font-black uppercase tracking-widest text-white shadow-lg shadow-orange-600/25 hover:bg-orange-500 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  {busy === 'destructure' ? '拆解中…' : '拆解'}
                </button>
              </div>
            </section>

            {segments?.length ? (
              <section className={`mb-6 ${shell}`}>
                <h2 className="text-[13px] font-black uppercase tracking-widest text-white/55 mb-4">可编辑语义块</h2>
                <div className="space-y-4">
                  {segments.map((s, idx) => (
                    <div key={s.id} className="rounded-xl border border-white/5 bg-black/25 p-4">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-white/35">块 {idx + 1}</span>
                        <input
                          value={s.label}
                          onChange={(e) => {
                            const v = e.target.value
                            setSegments((prev) =>
                              prev ? prev.map((x) => (x.id === s.id ? { ...x, label: v } : x)) : prev,
                            )
                          }}
                          className={`${field} flex-1 min-w-[120px] font-sans font-black`}
                        />
                        <label className="flex items-center gap-2 text-[11px] font-bold text-white/50">
                          强调色
                          <input
                            type="color"
                            value={s.color}
                            onChange={(e) => {
                              const v = e.target.value
                              setSegments((prev) =>
                                prev ? prev.map((x) => (x.id === s.id ? { ...x, color: v } : x)) : prev,
                              )
                            }}
                            className="h-9 w-14 cursor-pointer rounded-lg border border-white/10 bg-[#0c0c0e] p-0.5"
                          />
                        </label>
                      </div>
                      <textarea
                        value={s.text}
                        onChange={(e) => {
                          const v = e.target.value
                          setSegments((prev) =>
                            prev ? prev.map((x) => (x.id === s.id ? { ...x, text: v } : x)) : prev,
                          )
                        }}
                        rows={4}
                        className={field}
                        style={{ borderColor: s.color, boxShadow: `inset 0 0 0 1px ${s.color}33` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runSynthesize()}
                    className="rounded-full border border-white/15 bg-white/5 px-8 py-2.5 text-[13px] font-black uppercase tracking-widest text-white hover:border-orange-500/45 hover:bg-orange-600/15 disabled:opacity-40 disabled:pointer-events-none transition-all"
                  >
                    {busy === 'synthesize' ? '合成中…' : '合成同款提示词'}
                  </button>
                </div>
              </section>
            ) : null}

            {composed ? (
              <section className={`mb-6 ${shell} border-orange-500/20`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <h2 className="text-[13px] font-black uppercase tracking-widest text-orange-400/95">合成结果</h2>
                  <button
                    type="button"
                    onClick={() => void copyComposed()}
                    className="rounded-full bg-white text-black px-6 py-2 text-[12px] font-black uppercase tracking-widest hover:bg-orange-500 hover:text-white transition-colors"
                  >
                    复制
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-white/80 font-mono leading-relaxed">{composed}</pre>
              </section>
            ) : null}

            {msg ? (
              <p className="text-sm text-white/70 border border-white/10 rounded-2xl px-4 py-3 bg-black/30 font-medium leading-relaxed">
                {msg}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
