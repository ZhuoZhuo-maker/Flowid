import type { Node } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { StudioNodeData } from '../../types'
import { computeAccessState, loadLicenseSnapshotV2 } from '../../lib/licenseAccess'
import { PresetTemplateCoverImage } from '../PresetTemplateCoverImage'
import {
  FLOWID_PRESET_TEMPLATE_DRAG_MIME,
  PRESET_TEMPLATE_MOCKS,
  buildPresetTemplateCategoryTabs,
  fetchPresetTemplatesFromServer,
  filterPresetTemplatesByCategory,
  type PresetTemplate,
  type PresetTemplateDragPayload,
} from '../../lib/templateCatalog'

function PresetTemplateTile({
  t,
  onMergePresetTemplate,
  setDragPayload,
  canvasDayMode = false,
}: {
  t: PresetTemplate
  onMergePresetTemplate?: (payload: PresetTemplateDragPayload) => void | Promise<void>
  setDragPayload: (e: React.DragEvent, t: PresetTemplate) => void
  canvasDayMode?: boolean
}) {
  return (
    <div
      className={
        canvasDayMode
          ? 'flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#E8E8E8] bg-white transition-colors hover:border-[rgba(234,88,12,0.45)]'
          : 'flex min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/30 transition-colors hover:border-orange-500/40'
      }
    >
      <div
        className={
          canvasDayMode
            ? 'relative aspect-square w-full shrink-0 overflow-hidden bg-[#F5F5F5]'
            : 'relative aspect-square w-full shrink-0 overflow-hidden bg-white/5'
        }
        title="封面与「预设模板」页一致；上传请在预设模板页操作"
      >
        <PresetTemplateCoverImage
          title={t.name}
          fallbackSrc={t.image}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          alt=""
        />
      </div>
      <div
        className={`flex min-w-0 flex-1 flex-col gap-0.5 border-t p-1.5 ${
          canvasDayMode ? 'border-[#E8E8E8]' : 'border-white/5'
        } ${onMergePresetTemplate ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
        draggable={Boolean(onMergePresetTemplate)}
        onDragStart={(e) => {
          if (!onMergePresetTemplate) return
          setDragPayload(e, t)
        }}
      >
        <div
          className={
            canvasDayMode
              ? 'line-clamp-2 text-[10px] font-bold leading-snug text-[#262626]'
              : 'line-clamp-2 text-[10px] font-bold leading-snug text-white/90'
          }
          title={t.name}
        >
          {t.name}
        </div>
        <div
          className={
            canvasDayMode
              ? 'flex items-center justify-between gap-0.5 font-mono text-[9px] text-[#737373]'
              : 'flex items-center justify-between gap-0.5 font-mono text-[9px] text-white/40'
          }
        >
          <span className="truncate uppercase">{t.category}</span>
          {t.tier === 'pro' ? (
            <span className={canvasDayMode ? 'shrink-0 text-orange-600' : 'shrink-0 text-orange-400'}>PRO</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * 画布左侧「预设模板」：封面与「预设模板」管理页同源（封面存储）；仅展示、不在此上传；拖到画布空白处合并节点。
 */
export function DownloadPanel({
  selectedNode,
  onDownloadSelected,
  onDownloadProject,
  onMergePresetTemplate,
  canvasDayMode = false,
}: {
  selectedNode: Node<StudioNodeData> | null
  onDownloadSelected: () => void
  onDownloadProject: () => void
  onMergePresetTemplate?: (payload: PresetTemplateDragPayload) => void | Promise<void>
  /** 画布日间模式：白底面板、分类 pill 与系统提示词选中态一致 */
  canvasDayMode?: boolean
}) {
  const [licenseTick, setLicenseTick] = useState(0)
  const [catalog, setCatalog] = useState<{ ok: true; items: PresetTemplate[] } | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState('全部')

  useEffect(() => {
    const onLic = () => setLicenseTick((n) => n + 1)
    window.addEventListener('flowid:license-changed', onLic as EventListener)
    return () => window.removeEventListener('flowid:license-changed', onLic as EventListener)
  }, [])

  const access = useMemo(() => computeAccessState(loadLicenseSnapshotV2()), [licenseTick])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setCatalogLoading(true)
      const fromServer = await fetchPresetTemplatesFromServer()
      if (!cancelled) {
        setCatalog(fromServer)
        setCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [licenseTick])

  const baseList = useMemo(
    () => (catalog?.ok ? catalog.items : PRESET_TEMPLATE_MOCKS),
    [catalog],
  )

  const categoryTabs = useMemo(
    () => buildPresetTemplateCategoryTabs(baseList, access === 'valid'),
    [baseList, access],
  )

  useEffect(() => {
    setSelectedCategory((cur) => (categoryTabs.includes(cur) ? cur : '全部'))
  }, [categoryTabs])

  const filtered = useMemo(
    () => filterPresetTemplatesByCategory(baseList, selectedCategory, access === 'valid'),
    [baseList, selectedCategory, access],
  )

  const emptyHint = useMemo(() => {
    if (catalogLoading) return '正在加载预设模板…'
    if (!filtered.length) return '暂无预设模板'
    return ''
  }, [catalogLoading, filtered.length])

  const setDragPayload = (event: React.DragEvent, t: PresetTemplate) => {
    const payload: PresetTemplateDragPayload = { id: t.id, name: t.name, tier: t.tier }
    event.dataTransfer.setData(FLOWID_PRESET_TEMPLATE_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', t.name)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.18 }}
      className={
        canvasDayMode
          ? 'flex min-h-[500px] w-80 flex-col overflow-hidden rounded-2xl border border-[#E8E8E8] bg-white shadow-xl'
          : 'flex min-h-[500px] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111114] shadow-2xl backdrop-blur-xl'
      }
    >
      <div className={`shrink-0 border-b p-4 ${canvasDayMode ? 'border-[#E8E8E8]' : 'border-white/5'}`}>
        <div
          className={
            canvasDayMode
              ? 'font-mono text-[14px] uppercase tracking-[0.2em] text-[#525252]'
              : 'font-mono text-[14px] uppercase tracking-[0.2em] text-white/50'
          }
        >
          预设模板
        </div>
      </div>

      <div
        className={`no-scrollbar flex shrink-0 gap-2 overflow-x-auto border-b px-4 py-3 ${
          canvasDayMode ? 'border-[#E8E8E8]' : 'border-white/5'
        }`}
      >
        {categoryTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSelectedCategory(tab)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-black uppercase tracking-widest transition-all ${
              selectedCategory === tab
                ? canvasDayMode
                  ? 'border-[rgba(234,88,12,0.38)] bg-[rgba(234,88,12,0.18)] text-[#9a3412]'
                  : 'border-orange-500/50 bg-orange-600/90 text-white'
                : canvasDayMode
                  ? 'border-[#E8E8E8] bg-[#F5F5F5] text-[#525252] hover:border-[#D4D4D4]'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/25'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        <p
          className={
            canvasDayMode
              ? 'm-0 mb-2 font-mono text-[11px] uppercase tracking-wider text-[#737373]'
              : 'm-0 mb-2 font-mono text-[11px] uppercase tracking-wider text-white/35'
          }
        >
          拖到画布空白处即可合并节点；封面上传在「预设模板」页
        </p>
        {catalogLoading || !filtered.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center opacity-40">
            <h4
              className={
                canvasDayMode
                  ? 'text-sm font-black uppercase tracking-widest text-[#525252]'
                  : 'text-sm font-black uppercase tracking-widest text-white/50'
              }
            >
              {emptyHint}
            </h4>
          </div>
        ) : (
          <div className="grid grid-cols-3 content-start gap-2">
            {filtered.map((t) => (
              <PresetTemplateTile
                key={t.id}
                t={t}
                canvasDayMode={canvasDayMode}
                onMergePresetTemplate={onMergePresetTemplate}
                setDragPayload={setDragPayload}
              />
            ))}
          </div>
        )}
      </div>

      {selectedNode ? (
        <div
          className={`shrink-0 space-y-2 border-t p-4 ${
            canvasDayMode ? 'border-[#E8E8E8] bg-[#FAFAFA]' : 'border-white/5 bg-black/20'
          }`}
        >
          <button
            type="button"
            onClick={onDownloadSelected}
            className={
              canvasDayMode
                ? 'w-full rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[13px] font-black uppercase tracking-widest text-[#262626] transition-colors hover:bg-[#F5F5F5]'
                : 'w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-[13px] font-black uppercase tracking-widest text-white/85 transition-colors hover:bg-white/10'
            }
          >
            下载选中节点
          </button>
          <button
            type="button"
            onClick={onDownloadProject}
            className={
              canvasDayMode
                ? 'w-full rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[13px] font-black uppercase tracking-widest text-[#262626] transition-colors hover:bg-[#F5F5F5]'
                : 'w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-[13px] font-black uppercase tracking-widest text-white/85 transition-colors hover:bg-white/10'
            }
          >
            下载工程 JSON
          </button>
          <div
            className={
              canvasDayMode
                ? 'truncate text-center font-mono text-[12px] text-[#737373]'
                : 'truncate text-center font-mono text-[12px] text-white/45'
            }
            title={String(selectedNode.data.title)}
          >
            {selectedNode.data.title}
          </div>
        </div>
      ) : null}
    </motion.div>
  )
}
