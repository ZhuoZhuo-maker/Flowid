import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Upload, Search, Video, Music, User, Box } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AssetItem } from './types'
import {
  imageMimeTypeFromPath,
  parseFlowidMaterialDragPayload,
  type FlowidMaterialDragPayload,
  type MaterialLibraryTabId,
} from '../../lib/materialLibrary'

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
  if (asset.materialCategory) return asset.materialCategory
  if (asset.kind === 'audio') return 'audio'
  if (asset.kind === 'image') return 'scene'
  if (asset.kind === 'video') return 'prop'
  return 'other'
}

/**
 * 桌面端：页面多为 http(s) 来源时，直接用 file:// 作 img src 会被浏览器拦截；
 * 经主进程读盘再生成 blob: URL 可正常显示（含中文/特殊字符路径）。
 */
function DiskBackedLibraryImage({
  diskPath,
  alt,
  className,
}: {
  diskPath: string
  alt: string
  className?: string
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const blobRef = useRef<string | null>(null)

  useEffect(() => {
    const desk = window.flowidDesktop
    setObjectUrl(null)
    setFailed(false)
    const readBinary = desk?.readBinaryFile
    if (!readBinary) {
      setFailed(true)
      return
    }
    let cancelled = false
    void (async () => {
      const r = await readBinary(diskPath)
      if (cancelled) return
      if (!r?.ok || !r.data?.byteLength) {
        setFailed(true)
        return
      }
      const blob = new Blob([r.data], { type: imageMimeTypeFromPath(diskPath) })
      const url = URL.createObjectURL(blob)
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      blobRef.current = url
      setObjectUrl(url)
    })()
    return () => {
      cancelled = true
      const u = blobRef.current
      blobRef.current = null
      if (u) URL.revokeObjectURL(u)
    }
  }, [diskPath])

  if (objectUrl) {
    return <img src={objectUrl} className={className} alt={alt} />
  }
  if (failed) {
    return (
      <div
        className={`${className || ''} flex items-center justify-center bg-white/5 text-[10px] text-white/35 text-center px-1`}
      >
        预览失败
      </div>
    )
  }
  return <div className={`${className || ''} bg-white/5 animate-pulse`} aria-hidden />
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
  onRenameAsset,
  onFlowidMaterialDrop,
  embedded = false,
}: {
  assets: AssetItem[]
  hoveredAssetId: string | null
  setHoveredAssetId: Dispatch<SetStateAction<string | null>>
  onUpload: () => void
  /** 拖拽到面板时直接走与全局上传相同的处理；第二个参数为当前分类标签 */
  onUploadFiles?: (files: FileList | null, opts?: { category?: MaterialLibraryTabId }) => void
  onUseAsset: (asset: AssetItem) => void
  onRemoveAsset: (assetId: string) => void
  /** 双击重命名（桌面磁盘素材） */
  onRenameAsset?: (assetId: string, nextName: string) => void | Promise<void>
  /** 从画布节点拖入的媒体 */
  onFlowidMaterialDrop?: (payload: FlowidMaterialDragPayload, category: CategoryId) => void | Promise<void>
  /** 嵌入到右侧面板时去掉卡片外壳（避免双层边框/阴影）。 */
  embedded?: boolean
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all')
  const [isDragging, setIsDragging] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredAssets = useMemo(() => {
    if (activeCategory === 'all') return assets
    return assets.filter((a) => categoryForAsset(a) === activeCategory)
  }, [activeCategory, assets])

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    if (onUploadFiles) {
      onUploadFiles(files, { category: activeCategory })
      return
    }
    onUpload()
  }

  const beginRename = (asset: AssetItem) => {
    if (!asset.diskPath || !onRenameAsset) return
    setRenamingId(asset.id)
    setRenameDraft(asset.name.replace(/(\.[^.]+)$/, ''))
  }

  const commitRename = () => {
    if (!renamingId || !onRenameAsset) {
      setRenamingId(null)
      return
    }
    const next = renameDraft.trim()
    if (next) void onRenameAsset(renamingId, next)
    setRenamingId(null)
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
        const payload = parseFlowidMaterialDragPayload(e.dataTransfer)
        if (payload && onFlowidMaterialDrop) {
          void onFlowidMaterialDrop(payload, activeCategory)
          return
        }
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
                  onClick={() => {
                    if (renamingId === asset.id) return
                    onUseAsset(asset)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (renamingId !== asset.id) onUseAsset(asset)
                    }
                  }}
                  className="group relative aspect-square bg-black/40 border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:border-orange-500/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
                  onMouseEnter={() => setHoveredAssetId(asset.id)}
                  onMouseLeave={() => setHoveredAssetId(null)}
                >
                  {asset.kind === 'image' ? (
                    asset.diskPath && window.flowidDesktop?.readBinaryFile ? (
                      <DiskBackedLibraryImage
                        diskPath={asset.diskPath}
                        alt={asset.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 pointer-events-none"
                      />
                    ) : (
                      <img
                        src={asset.src}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 pointer-events-none"
                        alt={asset.name}
                      />
                    )
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

                  <div
                    className="absolute inset-x-0 bottom-0 z-[5] border-t border-white/10 bg-black/70 px-1.5 py-1 pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {renamingId === asset.id ? (
                      <input
                        className="w-full bg-black/50 border border-orange-500/40 rounded px-1 py-0.5 text-[11px] font-mono text-white"
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setRenamingId(null)
                          }
                        }}
                      />
                    ) : (
                      <div
                        className="text-[11px] font-mono text-white/75 truncate cursor-text select-text"
                        title={asset.diskPath ? '双击重命名（同步磁盘文件名）' : asset.name}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          beginRename(asset)
                        }}
                      >
                        {asset.name}
                      </div>
                    )}
                  </div>

                  {hoveredAssetId === asset.id && renamingId !== asset.id ? (
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
