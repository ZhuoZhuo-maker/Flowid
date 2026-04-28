import type { Node } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { StudioNodeData, StudioNodeKind } from '../../types'
import {
  fetchSystemPresetJsonText,
  fetchSystemPresetManifest,
  filterManifestByPresetTab,
  type SystemPresetManifestEntry,
} from '../../lib/systemPresets'

const PRESET_TABS = [
  { id: 'all' as const, label: '全部' },
  { id: 'image' as const, label: '图片' },
  { id: 'video' as const, label: '视频' },
]

/**
 * 系统预设 / 下载：与 @flowid (2) SystemPresetsPanel 同款外壳 + 画布原有载入与下载逻辑。
 */
export function DownloadPanel({
  selectedNode,
  onDownloadSelected,
  onDownloadProject,
  onApplySystemPreset,
}: {
  selectedNode: Node<StudioNodeData> | null
  onDownloadSelected: () => void
  onDownloadProject: () => void
  onApplySystemPreset?: (
    kind: StudioNodeKind,
    workflowJsonText: string,
    presetDisplayName: string,
  ) => void
}) {
  const [presetTab, setPresetTab] = useState<(typeof PRESET_TABS)[number]['id']>('all')
  const [manifest, setManifest] = useState<SystemPresetManifestEntry[]>([])
  const [manifestLoading, setManifestLoading] = useState(true)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setManifestLoading(true)
      const list = await fetchSystemPresetManifest()
      if (!cancelled) {
        setManifest(list)
        setManifestLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredPresets = useMemo(
    () => filterManifestByPresetTab(manifest, presetTab),
    [manifest, presetTab],
  )

  const emptyHint = useMemo(() => {
    if (manifestLoading) return '正在加载系统预设…'
    if (presetTab === 'image') return '暂无图片类系统预设'
    if (presetTab === 'video') return '暂无视频类系统预设'
    return '暂无系统预设'
  }, [manifestLoading, presetTab])

  const handleApplyPreset = useCallback(
    async (entry: SystemPresetManifestEntry) => {
      if (!onApplySystemPreset) return
      setApplyError(null)
      setApplyingId(entry.id)
      try {
        const jsonText = await fetchSystemPresetJsonText(entry.file)
        onApplySystemPreset(entry.kind, jsonText, entry.name)
      } catch (e) {
        setApplyError((e as Error)?.message || '载入预设失败')
      } finally {
        setApplyingId(null)
      }
    },
    [onApplySystemPreset],
  )

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.18 }}
      className="w-80 bg-[#111114] border border-white/10 rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px]"
    >
      <div className="p-4 border-b border-white/5 shrink-0">
        <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50">系统预设</div>
      </div>

      <div className="px-4 py-3 flex gap-4 border-b border-white/5 shrink-0">
        {PRESET_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPresetTab(tab.id)}
            className={`text-[14px] font-black uppercase tracking-widest ${
              presetTab === tab.id ? 'text-orange-500' : 'text-white/60 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 min-h-0">
        {applyError ? (
          <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
            {applyError}
          </div>
        ) : null}
        {manifestLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-[14px] font-black uppercase tracking-widest text-white/40">
            {emptyHint}
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center opacity-30">
            <h4 className="text-sm font-black text-white/40 uppercase tracking-widest mb-1">{emptyHint}</h4>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredPresets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={!onApplySystemPreset || applyingId === entry.id}
                onClick={() => handleApplyPreset(entry)}
                className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/5 disabled:opacity-50 border border-transparent hover:border-white/10"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-black uppercase text-white/90 truncate tracking-wide">
                    {entry.name}
                  </span>
                  <span className="text-[12px] font-mono text-white/40">{entry.kind}</span>
                </span>
                <span className="shrink-0 text-[12px] font-black uppercase tracking-widest text-orange-500/90">
                  {applyingId === entry.id ? '载入中…' : '载入'}
                </span>
              </button>
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
