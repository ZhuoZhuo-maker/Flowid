import { ChevronDown, ChevronUp } from 'lucide-react'
import type {
  AudioNodeData,
  ImageNodeData,
  NodeResultThumbnail,
  StudioNodeData,
  StudioNodeKind,
  VideoNodeData,
} from '../../types'
import { useCanvasActions } from '../../context/CanvasContext'
import { setFlowidMaterialDragData } from '../../lib/materialLibrary'

type StripNodeKind = Extract<StudioNodeKind, 'image' | 'video' | 'audio' | 'music'>

/**
 * 节点底部可折叠的「本次输出」缩略图行：支持拖拽到画布/其他节点、单条删除。
 */
export function NodeOutputThumbnailStrip({
  nodeId,
  nodeTitle,
  dataKind,
  items,
  expanded,
  primarySrc,
  audioResultSources,
  hasStoredAudioThumbnails = false,
}: {
  nodeId: string
  nodeTitle: string
  dataKind: StripNodeKind
  items: NodeResultThumbnail[]
  expanded: boolean
  /** 当前主预览 URL，用于删除主图时回退到条内下一项 */
  primarySrc: string
  /** 配音/音乐：与缩略条同步的 `resultSources`（含仅历史列表、无 `resultThumbnails` 时） */
  audioResultSources?: string[]
  /** 为 true 时删除会同步裁剪 `resultThumbnails`；纯 `resultSources` 展示时不要写回缩略条字段 */
  hasStoredAudioThumbnails?: boolean
}) {
  const { updateNodeData, removeHistoryBySource } = useCanvasActions()

  if (!items.length) return null

  const toggle = () => {
    updateNodeData(nodeId, { resultThumbnailsExpanded: !expanded } as Partial<StudioNodeData>)
  }

  /** 点击缩略图：把上方主预览切换为该项（与删除逻辑独立） */
  const selectPrimaryPreview = (item: NodeResultThumbnail) => {
    if (item.url === primarySrc) return
    if (dataKind === 'audio' || dataKind === 'music') {
      if (item.mediaKind !== 'audio') return
      updateNodeData(nodeId, {
        kind: dataKind,
        src: item.url,
        srcAssetId: item.assetId,
        srcFileName: item.fileName,
      } as Partial<StudioNodeData>)
      return
    }
    if (dataKind === 'image' && item.mediaKind !== 'image') return
    if (dataKind === 'video' && item.mediaKind !== 'video') return
    updateNodeData(nodeId, {
      kind: dataKind === 'video' ? 'video' : 'image',
      src: item.url,
      srcAssetId: item.assetId,
      srcFileName: item.fileName,
    } as Partial<StudioNodeData>)
  }

  const removeOne = (target: NodeResultThumbnail) => {
    removeHistoryBySource(target.url)
    const next = items.filter((i) => i.id !== target.id)

    if (dataKind === 'audio' || dataKind === 'music') {
      const prevSources = audioResultSources ?? []
      const nextSources = prevSources.filter((u) => u !== target.url)
      const audioPatch: Partial<AudioNodeData> = {
        kind: dataKind,
        src: nextSources[0] ?? '',
        resultSources: nextSources,
      }
      if (hasStoredAudioThumbnails) {
        audioPatch.resultThumbnails = next.length ? next : undefined
      }
      updateNodeData(nodeId, audioPatch as Partial<StudioNodeData>)
      return
    }

    const visualPatch: Partial<ImageNodeData> | Partial<VideoNodeData> = {
      kind: dataKind === 'video' ? 'video' : 'image',
      resultThumbnails: next.length ? next : undefined,
    }
    if (target.url === primarySrc) {
      visualPatch.src = next[0]?.url ?? ''
      visualPatch.srcAssetId = next[0]?.assetId
      visualPatch.srcFileName = next[0]?.fileName
    }
    updateNodeData(nodeId, visualPatch as Partial<StudioNodeData>)
  }

  return (
    <div className="studio-node-output-strip nodrag">
      <button type="button" className="studio-node-output-strip__toggle" onClick={toggle}>
        {expanded ? (
          <ChevronUp size={14} strokeWidth={2.25} aria-hidden />
        ) : (
          <ChevronDown size={14} strokeWidth={2.25} aria-hidden />
        )}
        <span>{expanded ? '收起输出' : '展开输出'}</span>
        <span className="studio-node-output-strip__count">{items.length}</span>
      </button>
      {expanded ? (
        <div className="studio-node-output-strip__row">
          {items.map((item) => (
            <div
              className={`studio-node-output-strip__cell studio-node-output-strip__cell--previewable${
                item.url === primarySrc ? ' is-primary-preview' : ''
              }`}
              key={item.id}
              title="点击在上方预览"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.studio-node-output-strip__del')) return
                selectPrimaryPreview(item)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if ((e.target as HTMLElement).closest('.studio-node-output-strip__del')) return
                  selectPrimaryPreview(item)
                }
              }}
            >
              <button
                type="button"
                className="studio-node-output-strip__del"
                title="从列表移除"
                aria-label="删除该输出缩略图"
                onClick={(e) => {
                  e.stopPropagation()
                  removeOne(item)
                }}
              >
                ×
              </button>
              {item.mediaKind === 'video' ? (
                <video
                  className="studio-node-output-strip__media"
                  src={item.url}
                  muted
                  playsInline
                  preload="metadata"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    const title = String(nodeTitle || '').trim() || '视频节点'
                    setFlowidMaterialDragData(e.dataTransfer, {
                      nodeId,
                      title,
                      kind: 'video',
                      src: item.url,
                    })
                  }}
                />
              ) : item.mediaKind === 'audio' ? (
                <div
                  className="studio-node-output-strip__audioGlyph"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    const title = String(nodeTitle || '').trim() || '音频'
                    setFlowidMaterialDragData(e.dataTransfer, {
                      nodeId,
                      title,
                      kind: 'audio',
                      src: item.url,
                    })
                  }}
                  title="拖到画布或其它节点"
                >
                  ♪
                </div>
              ) : (
                <img
                  src={item.url}
                  alt=""
                  className="studio-node-output-strip__media"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    const title = String(nodeTitle || '').trim() || '图片节点'
                    setFlowidMaterialDragData(e.dataTransfer, {
                      nodeId,
                      title,
                      kind: 'image',
                      src: item.url,
                    })
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
