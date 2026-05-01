import type { Dispatch, SetStateAction } from 'react'
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Briefcase, ChevronLeft, ChevronRight, Clock, Shield } from 'lucide-react'
import type { AssetItem, HistoryItem } from './types'
import type { FlowidMaterialDragPayload, MaterialLibraryTabId } from '../../lib/materialLibrary'
import { AssetToolboxPanel } from './AssetToolboxPanel'
import { HistoryPanel } from './HistoryPanel'
import { SystemPromptsPanel } from './SystemPromptsPanel'

export type RightPanelTab = 'assets' | 'history' | 'system-prompts'

export function RightPanel({
  isOpen,
  onToggleOpen,
  activeTab,
  onTabChange,
  assets,
  hoveredAssetId,
  setHoveredAssetId,
  onUpload,
  onUploadFiles,
  onUseAsset,
  onRemoveAsset,
  onRenameAsset,
  onFlowidMaterialDrop,
  historyItems,
  onRemoveHistoryItems,
}: {
  isOpen: boolean
  onToggleOpen: () => void
  activeTab: RightPanelTab
  onTabChange: (tab: RightPanelTab) => void
  assets: AssetItem[]
  hoveredAssetId: string | null
  setHoveredAssetId: Dispatch<SetStateAction<string | null>>
  onUpload: () => void
  onUploadFiles?: (files: FileList | null, opts?: { category?: MaterialLibraryTabId }) => void
  onUseAsset: (asset: AssetItem) => void
  onRemoveAsset: (assetId: string) => void
  onRenameAsset?: (assetId: string, nextName: string) => void | Promise<void>
  onFlowidMaterialDrop?: (payload: FlowidMaterialDragPayload, category: MaterialLibraryTabId) => void | Promise<void>
  historyItems: HistoryItem[]
  onRemoveHistoryItems: (ids: string[]) => void
}) {
  const tabs = useMemo(
    () =>
      [
        { id: 'assets' as const, icon: Briefcase },
        { id: 'history' as const, icon: Clock },
        { id: 'system-prompts' as const, icon: Shield },
      ] as const,
    [],
  )

  return (
    <div className="absolute top-24 bottom-24 right-6 flex z-50 pointer-events-none transition-all duration-500">
      <div className="flex items-center pointer-events-auto">
        <button
          type="button"
          onClick={onToggleOpen}
          className="w-6 h-24 bg-[#111114] border border-white/10 rounded-l-xl flex items-center justify-center text-white/50 hover:text-white/80 transition-colors shadow-2xl backdrop-blur-xl"
          aria-label={isOpen ? '收起右侧面板' : '展开右侧面板'}
          title={isOpen ? '收起' : '展开'}
        >
          {isOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <AnimatePresence>
          {isOpen ? (
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="w-80 h-full bg-[#111114] border border-white/10 rounded-r-2xl border-l-0 shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden"
            >
              <div className="flex border-b border-white/5 p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id)}
                    className={`flex-1 flex justify-center py-4 transition-all rounded-lg group ${
                      activeTab === tab.id
                        ? 'text-orange-500 bg-white/5'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                    aria-label={
                      tab.id === 'assets' ? '素材库' : tab.id === 'history' ? '历史' : '系统提示词'
                    }
                    title={tab.id === 'assets' ? '素材库' : tab.id === 'history' ? '历史' : '系统提示词'}
                  >
                    <tab.icon size={18} className="group-hover:scale-110 transition-transform" />
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                {activeTab === 'assets' ? (
                  <AssetToolboxPanel
                    assets={assets}
                    hoveredAssetId={hoveredAssetId}
                    setHoveredAssetId={setHoveredAssetId}
                    onUpload={onUpload}
                    onUploadFiles={onUploadFiles}
                    onUseAsset={onUseAsset}
                    onRemoveAsset={onRemoveAsset}
                    onRenameAsset={onRenameAsset}
                    onFlowidMaterialDrop={onFlowidMaterialDrop}
                    embedded
                  />
                ) : null}
                {activeTab === 'history' ? (
                  <HistoryPanel historyItems={historyItems} onRemoveHistoryItems={onRemoveHistoryItems} embedded />
                ) : null}
                {activeTab === 'system-prompts' ? <SystemPromptsPanel embedded /> : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

