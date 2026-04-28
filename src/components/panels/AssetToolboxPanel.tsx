import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Upload, Search, Video, Music, User, Box } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AssetItem } from './types'

const CATEGORIES = [
  { id: 'all', label: '全部', icon: Box },
  { id: 'human', label: '人物', icon: User },
  { id: 'scene', label: '场景', icon: Box },
  { id: 'prop', label: '道具', icon: Box },
  { id: 'audio', label: '音效', icon: Music },
  { id: 'other', label: '其他', icon: Box },
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

function categoryForAsset(asset: AssetItem): Exclude<CategoryId, 'all'> {
  if (asset.kind === 'audio') return 'audio'
  if (asset.kind === 'image') return 'scene'
  if (asset.kind === 'video') return 'prop'
  return 'other'
}

/**
 * 素材库：与 @flowid (2) 同款布局/动效/拖拽上传；业务仍走上层回调。
 */
export function AssetToolboxPanel({
  assets,
  hoveredAssetId,
  setHoveredAssetId,
  onUpload,
  onUploadFiles,
  onUseAsset,
  onRemoveAsset,
  embedded = false,
}: {
  assets: AssetItem[]
  hoveredAssetId: string | null
  setHoveredAssetId: Dispatch<SetStateAction<string | null>>
  onUpload: () => void
  /** 拖拽到面板时直接走与全局上传相同的处理 */
  onUploadFiles?: (files: FileList | null) => void
  onUseAsset: (asset: AssetItem) => void
  onRemoveAsset: (assetId: string) => void
  /** 嵌入到右侧面板时去掉卡片外壳（避免双层边框/阴影）。 */
  embedded?: boolean
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredAssets = useMemo(() => {
    if (activeCategory === 'all') return assets
    return assets.filter((a) => categoryForAsset(a) === activeCategory)
  }, [activeCategory, assets])

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    if (onUploadFiles) {
      onUploadFiles(files)
      return
    }
    onUpload()
  }

  const shellClassName = embedded
    ? `flex flex-col h-full min-h-0 overflow-hidden transition-colors relative ${
        isDragging ? 'bg-orange-500/5' : ''
      }`
    : `w-80 bg-[#111114] border rounded-2xl flex flex-col shadow-2xl backdrop-blur-xl overflow-hidden min-h-[500px] transition-colors relative ${
        isDragging ? 'border-orange-500 bg-orange-500/5' : 'border-white/10'
      }`

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
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={shellClassName}
    >
      <input
        type="file"
        multiple
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*,audio/*"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50">我的素材库</div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-colors"
          title="上传素材"
        >
          <Upload size={14} />
        </button>
      </div>

      <div className="px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-white/5 shrink-0 select-none">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-[14px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
              activeCategory === cat.id
                ? 'bg-orange-500/10 border-orange-500/20 text-orange-500'
                : 'bg-white/5 border-white/5 text-white/60 hover:border-white/20'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 min-h-0">
        {filteredAssets.length === 0 ? (
          <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6 border border-white/5 opacity-40">
              <Search size={24} className="text-white/20" />
            </div>
            <h4 className="text-sm font-black text-white/50 uppercase tracking-widest mb-2">暂无素材</h4>
            <p className="text-[14px] text-white/40 uppercase tracking-widest leading-relaxed">
              点击右上方上传按钮
              <br />
              或直接拖拽文件到此处
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {filteredAssets.map((asset) => (
                <motion.div
                  key={asset.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  role="button"
                  tabIndex={0}
                  title={`使用 ${asset.name}`}
                  onClick={() => onUseAsset(asset)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onUseAsset(asset)
                    }
                  }}
                  className="group relative aspect-square bg-black/40 border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:border-orange-500/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
                  onMouseEnter={() => setHoveredAssetId(asset.id)}
                  onMouseLeave={() => setHoveredAssetId(null)}
                >
                  {asset.kind === 'image' ? (
                    <img
                      src={asset.src}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 pointer-events-none"
                      alt={asset.name}
                    />
                  ) : null}
                  {asset.kind === 'video' ? (
                    <div className="w-full h-full flex items-center justify-center bg-purple-500/10 pointer-events-none">
                      <Video className="text-purple-500/50" />
                    </div>
                  ) : null}
                  {asset.kind === 'audio' ? (
                    <div className="w-full h-full flex items-center justify-center bg-green-500/10 pointer-events-none">
                      <Music className="text-green-500/50" />
                    </div>
                  ) : null}

                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent translate-y-full group-hover:translate-y-0 transition-transform pointer-events-none">
                    <div className="text-[12px] font-black uppercase text-white/95 truncate tracking-widest">
                      {asset.name}
                    </div>
                  </div>

                  {hoveredAssetId === asset.id ? (
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 z-10 rounded-md bg-black/70 px-2 py-1 text-[11px] font-black uppercase tracking-wider text-white/90 hover:bg-red-600/90 border border-white/10"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveAsset(asset.id)
                      }}
                    >
                      删除
                    </button>
                  ) : null}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="p-3 bg-black/20 border-t border-white/5 flex items-center justify-between shrink-0">
        <div className="text-[13px] font-mono text-white/50 uppercase tracking-widest">
          {assets.length} 个素材
        </div>
        <div className="flex gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-white/5" />
          <div className="w-1.5 h-1.5 rounded-full bg-white/5" />
          <div className="w-3 h-1.5 rounded-full bg-orange-600/40" />
        </div>
      </div>

      {isDragging ? (
        <div className="absolute inset-0 bg-orange-600/10 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none border-2 border-orange-500 border-dashed rounded-2xl m-2">
          <Upload className="text-orange-500 mb-2 animate-bounce" />
          <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-500">松开上传</div>
        </div>
      ) : null}
    </Shell>
  )
}
