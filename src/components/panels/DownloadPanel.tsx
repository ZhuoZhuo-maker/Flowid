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
}: {
  t: PresetTemplate
  onMergePresetTemplate?: (payload: PresetTemplateDragPayload) => void | Promise<void>
  setDragPayload: (e: React.DragEvent, t: PresetTemplate) => void
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 overflow-hidden hover:border-orange-500/40 transition-colors flex flex-col min-w-0">
      <div
        className="relative aspect-square w-full overflow-hidden bg-white/5 shrink-0"
        title="封面与「预设模板」页一致；上传请在预设模板页操作"
      >
        <PresetTemplateCoverImage
          title={t.name}
          fallbackSrc={t.image}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          alt=""
        />
      </div>
      <div
        className={`p-1.5 flex flex-col gap-0.5 min-w-0 flex-1 border-t border-white/5 ${
          onMergePresetTemplate ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        draggable={Boolean(onMergePresetTemplate)}
        onDragStart={(e) => {
          if (!onMergePresetTemplate) return
          setDragPayload(e, t)
        }}
      >
        <div className="text-[10px] font-bold text-white/90 line-clamp-2 leading-snug" title={t.name}>
          {t.name}
        </div>
        <div className="flex items-center justify-between gap-0.5 text-[9px] font-mono text-white/40">
          <span className="truncate uppercase">{t.category}</span>
          {t.tier === 'pro' ? <span className="text-orange-400 shrink-0">PRO</span> : null}
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
}: {
  selectedNode: Node<StudioNodeData> | null
  onDownloadSelected: () => void
  onDownloadProject: () => void
  onMergePresetTemplate?: (payload: PresetTemplateDragPayload) => void | Promise<void>
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
      className="w-80 bg-[#111114] border border-white/10 rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px]"
    >
      <div className="p-4 border-b border-white/5 shrink-0">
        <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50">预设模板</div>
      </div>

      <div className="px-4 py-3 flex gap-2 border-b border-white/5 shrink-0 overflow-x-auto no-scrollbar">
        {categoryTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSelectedCategory(tab)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
              selectedCategory === tab
                ? 'bg-orange-600/90 border-orange-500/50 text-white'
                : 'bg-white/5 border-white/10 text-white/60 hover:border-white/25'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 min-h-0">
        <p className="m-0 mb-2 text-[11px] font-mono text-white/35 uppercase tracking-wider">
          拖到画布空白处即可合并节点；封面上传在「预设模板」页
        </p>
        {catalogLoading || !filtered.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center opacity-40">
            <h4 className="text-sm font-black text-white/50 uppercase tracking-widest">{emptyHint}</h4>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 content-start">
            {filtered.map((t) => (
              <PresetTemplateTile
                key={t.id}
                t={t}
                onMergePresetTemplate={onMergePresetTemplate}
                setDragPayload={setDragPayload}
              />
            ))}
          </div>
        )}
      </div>

      {selectedNode ? (
        <div className="shrink-0 border-t border-white/5 bg-black/20 p-4 space-y-2">
          <button
            type="button"
            onClick={onDownloadSelected}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-[13px] font-black uppercase tracking-widest text-white/85 hover:bg-white/10 transition-colors"
          >
            下载选中节点
          </button>
          <button
            type="button"
            onClick={onDownloadProject}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-[13px] font-black uppercase tracking-widest text-white/85 hover:bg-white/10 transition-colors"
          >
            下载工程 JSON
          </button>
          <div className="truncate text-center text-[12px] font-mono text-white/45" title={String(selectedNode.data.title)}>
            {selectedNode.data.title}
          </div>
        </div>
      ) : null}
    </motion.div>
  )
}
