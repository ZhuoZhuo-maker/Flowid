import { Handle, Position, type NodeProps } from '@xyflow/react'
import { STUDIO_FLOW_SOURCE_HANDLE_ID, STUDIO_FLOW_TARGET_HANDLE_ID } from '../../lib/studioFlowHandles'
import type { Node } from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import {
  getLocalImageAssetObjectUrl,
  saveLocalImageAsset,
} from '../../lib/localImageAssetStore'
import type { ImageNodeData, MattingPoint } from '../../types'
import { imageDownloadFileName, parseFlowidMaterialDragPayload, setFlowidMaterialDragData } from '../../lib/materialLibrary'
import { compactValidResultThumbnails } from '../../lib/nodeResultThumbnails'
import { NodeChrome } from './NodeChrome'
import { NodeOutputThumbnailStrip } from './NodeOutputThumbnailStrip'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * React Flow 等父级会对节点施加 `transform: scale(...)`。
 * `getBoundingClientRect()` 的宽高是视口/缩放后的值，而 `left`/`top` 叠在节点本地坐标系里，
 * 必须用 `clientWidth`/`clientHeight` 做 object-fit 几何，并把指针坐标换算到同一本地系。
 */
function viewportPointToImgLocal(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
): { lx: number; ly: number; cw: number; ch: number } | null {
  const rect = img.getBoundingClientRect()
  const cw = img.clientWidth
  const ch = img.clientHeight
  const rw = rect.width
  const rh = rect.height
  if (cw < 1 || ch < 1 || rw < 1e-4 || rh < 1e-4) return null
  const lx = (clientX - rect.left) * (cw / rw)
  const ly = (clientY - rect.top) * (ch / rh)
  return { lx, ly, cw, ch }
}

/**
 * 点击 → 原图像素归一化 0～1（object-fit: contain 时扣掉 letterbox）。
 * 全部在 img 的**布局本地**像素系中计算，与绿点 `left`/`top` 一致。
 */
function clientPointToNormalizedMatting(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const local = viewportPointToImgLocal(img, clientX, clientY)
  if (!local) return null
  const { lx, ly, cw, ch } = local
  const px = lx
  const py = ly
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return null
  const scale = Math.min(cw / iw, ch / ih)
  const sw = iw * scale
  const sh = ih * scale
  const ox = (cw - sw) / 2
  const oy = (ch - sh) / 2
  /** 仅在 object-fit 实际画区内落点，黑边上点击无效，避免「点飘到图外」 */
  if (px < ox || px > ox + sw || py < oy || py > oy + sh) return null
  const ix = (px - ox) / scale
  const iy = (py - oy) / scale
  return { x: clamp01(ix / iw), y: clamp01(iy / ih) }
}

function readMattingGeometry(img: HTMLImageElement | null): {
  ox: number
  oy: number
  scale: number
  iw: number
  ih: number
} | null {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null
  const cw = img.clientWidth
  const ch = img.clientHeight
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (cw < 1 || ch < 1) return null
  const scale = Math.min(cw / iw, ch / ih)
  const sw = iw * scale
  const sh = ih * scale
  const ox = (cw - sw) / 2
  const oy = (ch - sh) / 2
  return { ox, oy, scale, iw, ih }
}

const MATTING_DOT_RADIUS = 5.5

/** 圆点中心（translate(-50%) 前）：与 img/叠层同一矩形坐标系，并夹在 object-fit 实际画区内 */
function mattingDotCenterClamped(
  pt: MattingPoint,
  geo: NonNullable<ReturnType<typeof readMattingGeometry>>,
): { left: number; top: number } {
  const cx = geo.ox + pt.x * geo.iw * geo.scale
  const cy = geo.oy + pt.y * geo.ih * geo.scale
  const minX = geo.ox + MATTING_DOT_RADIUS
  const maxX = geo.ox + geo.iw * geo.scale - MATTING_DOT_RADIUS
  const minY = geo.oy + MATTING_DOT_RADIUS
  const maxY = geo.oy + geo.ih * geo.scale - MATTING_DOT_RADIUS
  return {
    left: maxX >= minX ? Math.min(maxX, Math.max(minX, cx)) : cx,
    top: maxY >= minY ? Math.min(maxY, Math.max(minY, cy)) : cy,
  }
}

/**
 * 图像节点：参考图 URL + 文生图提示；画布内左键绿（保留）、右键红（去掉），与 Comfy 占位符同步。
 */
export function ImageNode({
  id,
  data,
  selected,
}: NodeProps<Node<ImageNodeData, 'image'>>) {
  const { updateNodeData, runNodeFromCanvas } = useCanvasActions()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const mattingStackRef = useRef<HTMLDivElement | null>(null)
  const [, setLayoutTick] = useState(0)
  const [mattingMode, setMattingMode] = useState(false)

  const bumpLayout = useCallback(() => {
    setLayoutTick((n) => n + 1)
  }, [])

  const onImgLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const el = event.currentTarget
      bumpLayout()
      updateNodeData(id, {
        kind: 'image',
        mattingRefWidth: el.naturalWidth || undefined,
        mattingRefHeight: el.naturalHeight || undefined,
      })
    },
    [bumpLayout, id, updateNodeData],
  )

  useEffect(() => {
    window.addEventListener('resize', bumpLayout)
    return () => window.removeEventListener('resize', bumpLayout)
  }, [bumpLayout])

  /** 节点缩放 / 容器尺寸变化后重算打点叠层与 img 对齐 */
  useLayoutEffect(() => {
    const el = mattingStackRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => bumpLayout())
    ro.observe(el)
    return () => ro.disconnect()
  }, [bumpLayout, data.src])

  /**
   * 将本地文件写入 IndexedDB，并更新节点主图。
   */
  const applyLocalImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return
      try {
        const srcAssetId = await saveLocalImageAsset(file)
        const restored = await getLocalImageAssetObjectUrl(srcAssetId)
        updateNodeData(id, {
          kind: 'image',
          src: restored || URL.createObjectURL(file),
          srcAssetId,
          srcFileName: file.name,
          srcDiskPath: undefined,
          mattingPoints: [],
          mattingRefWidth: undefined,
          mattingRefHeight: undefined,
        })
      } catch {
        updateNodeData(id, {
          kind: 'image',
          src: URL.createObjectURL(file),
          srcFileName: file.name,
          srcDiskPath: undefined,
          mattingPoints: [],
          mattingRefWidth: undefined,
          mattingRefHeight: undefined,
        })
      }
    },
    [id, updateNodeData],
  )

  /**
   * 从拖拽/粘贴数据中提取首张图片文件。
   */
  const pickFirstImageFile = useCallback((dt: DataTransfer | null): File | null => {
    if (!dt) return null
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i]
        if (it?.kind !== 'file') continue
        if (!String(it.type || '').startsWith('image/')) continue
        const f = it.getAsFile()
        if (f) return f
      }
    }
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files.item(i)
        if (f?.type.startsWith('image/')) return f
      }
    }
    return null
  }, [])

  /**
   * 节点预览区支持拖拽图片替换。
   */
  const onThumbDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const material = parseFlowidMaterialDragPayload(event.dataTransfer)
      if (material?.kind === 'image' && material.src) {
        updateNodeData(id, {
          kind: 'image',
          src: material.src,
          srcDiskPath: undefined,
          mattingPoints: [],
          mattingRefWidth: undefined,
          mattingRefHeight: undefined,
        })
        return
      }
      const file = pickFirstImageFile(event.dataTransfer)
      if (!file) return
      void applyLocalImageFile(file)
    },
    [applyLocalImageFile, id, pickFirstImageFile, updateNodeData],
  )

  /**
   * 节点预览区支持 Ctrl+V 粘贴图片替换。
   */
  const onThumbPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const file = pickFirstImageFile(event.clipboardData)
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      void applyLocalImageFile(file)
    },
    [applyLocalImageFile, pickFirstImageFile],
  )

  /**
   * 点击预览区可选择本地图片文件替换。
   */
  const onPickFile = useCallback(
    (list: FileList | null) => {
      const file = list?.[0]
      if (!file) return
      void applyLocalImageFile(file)
    },
    [applyLocalImageFile],
  )

  const mattingPoints = useMemo(() => data.mattingPoints ?? [], [data.mattingPoints])

  const onMattingLayerPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!mattingMode) return
      if (event.button !== 0 && event.button !== 2) return
      const polarity: 0 | 1 = event.button === 2 ? 0 : 1
      const img = imgRef.current
      if (!img) return
      // 必须用 viewport 坐标 + img 的 getBoundingClientRect，与绘制几何一致
      const p = clientPointToNormalizedMatting(img, event.clientX, event.clientY)
      if (!p) return
      event.preventDefault()
      event.stopPropagation()
      const next: MattingPoint[] = [...mattingPoints, { x: p.x, y: p.y, t: polarity }]
      updateNodeData(id, { kind: 'image', mattingPoints: next })
    },
    [id, mattingMode, mattingPoints, updateNodeData],
  )

  const clearMattingPoints = useCallback(() => {
    updateNodeData(id, { kind: 'image', mattingPoints: [] })
  }, [id, updateNodeData])

  const imageDownloadName =
    data.src ? imageDownloadFileName(data.title, data.src, data.srcFileName) : '图片.png'

  const stripItems = useMemo(
    () => compactValidResultThumbnails(data.resultThumbnails),
    [data.resultThumbnails],
  )

  useEffect(() => {
    const raw = data.resultThumbnails
    if (!raw?.length) return
    const compacted = compactValidResultThumbnails(raw)
    const same =
      compacted.length === raw.length &&
      compacted.every((t, i) => t.id === raw[i]?.id && t.url === raw[i]?.url)
    if (same) return
    updateNodeData(id, {
      kind: 'image',
      resultThumbnails: compacted.length ? compacted : undefined,
    })
  }, [id, data.resultThumbnails, updateNodeData])

  const geo = readMattingGeometry(imgRef.current)

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id={STUDIO_FLOW_TARGET_HANDLE_ID}
        className="studio-handle"
      />
      <NodeChrome
        icon={<span className="glyph">图</span>}
        title={data.title}
        accent="#f472b6"
        selected={selected}
        runStatus={data.runStatus}
        runProgress={data.runProgress}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: 'image', title: nextTitle })
        }
        footer={
          stripItems.length > 0 ? (
            <NodeOutputThumbnailStrip
              nodeId={id}
              nodeTitle={data.title}
              dataKind="image"
              items={stripItems}
              expanded={data.resultThumbnailsExpanded === true}
              primarySrc={data.src}
            />
          ) : null
        }
      >
        <div
          className="studio-thumb nowheel nodrag"
          tabIndex={0}
          title="可拖拽图片到此，或聚焦后 Ctrl+V 粘贴图片"
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={onThumbDrop}
          onPaste={onThumbPaste}
        >
          {data.src ? (
            <>
              <div className="studio-thumb__previewHoverZone">
              <div ref={mattingStackRef} className="studio-thumb__imgMattingStack">
                <img
                  ref={imgRef}
                  src={data.src}
                  alt=""
                  className={`studio-thumb__img${mattingMode ? ' studio-thumb__img--mattingPassthrough' : ''}`}
                  draggable={!mattingMode}
                  onLoad={onImgLoad}
                  onDragStart={(e) => {
                    if (mattingMode) {
                      e.preventDefault()
                      return
                    }
                    e.stopPropagation()
                    const title = String(data.title || '').trim() || '图片节点'
                    setFlowidMaterialDragData(e.dataTransfer, {
                      nodeId: id,
                      title,
                      kind: 'image',
                      src: data.src,
                    })
                  }}
                />
                {mattingMode || mattingPoints.length > 0 ? (
                  <div
                    className={`studio-thumb__mattingDots nodrag${mattingMode ? ' is-interactive' : ''}`}
                    title={mattingMode ? '左键：绿（保留）　右键：红（去掉）' : undefined}
                    onPointerDown={onMattingLayerPointerDown}
                    onContextMenu={(e) => {
                      if (mattingMode) {
                        e.preventDefault()
                        e.stopPropagation()
                      }
                    }}
                  >
                    {geo
                      ? mattingPoints.map((pt, idx) => {
                          const { left, top } = mattingDotCenterClamped(pt, geo)
                          return (
                            <span
                              key={`${idx}-${pt.x}-${pt.y}-${pt.t}`}
                              className={`studio-thumb__mattingDot ${
                                pt.t === 1 ? 'studio-thumb__mattingDot--keep' : 'studio-thumb__mattingDot--remove'
                              }`}
                              style={{ left, top }}
                              title={pt.t === 1 ? '保留' : '去掉'}
                            />
                          )
                        })
                      : null}
                  </div>
                ) : null}
              </div>
              <div className="studio-thumb__actions nodrag">
                <button
                  type="button"
                  className={`studio-thumb__action${mattingMode ? ' is-active' : ''}`}
                  title="开启后：图上左键绿点（保留）、右键红点（去掉）。Comfy 可用 __MATTING_FRAME_INFO_JSON__ / __MATTING_POSITIVE_COORDS_JSON__ / __MATTING_NEGATIVE_COORDS_JSON__"
                  onClick={(event) => {
                    event.stopPropagation()
                    setMattingMode((v) => !v)
                  }}
                >
                  抠点
                </button>
                {mattingMode || mattingPoints.length > 0 ? (
                  <button
                    type="button"
                    className="studio-thumb__action"
                    title="清空所有抠图点"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearMattingPoints()
                    }}
                  >
                    清
                  </button>
                ) : null}
                <button
                  type="button"
                  className="studio-thumb__action"
                  title="执行当前节点工作流（与底部面板一致，会带上抠图点）"
                  onClick={(event) => {
                    event.stopPropagation()
                    void runNodeFromCanvas(id)
                  }}
                >
                  执行
                </button>
                <button
                  type="button"
                  className="studio-thumb__action"
                  title="上传本地图片"
                  onClick={(event) => {
                    event.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                >
                  上传
                </button>
                <a
                  href={data.src}
                  target="_blank"
                  rel="noreferrer"
                  className="studio-thumb__action"
                  title="预览原图"
                >
                  预览
                </a>
                <a
                  href={data.src}
                  download={imageDownloadName}
                  className="studio-thumb__action"
                  title="下载原图"
                >
                  下载
                </a>
              </div>
              </div>
            </>
          ) : (
            <div className="studio-thumb__placeholder"> </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(event) => {
              onPickFile(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      </NodeChrome>
      <Handle
        type="source"
        position={Position.Right}
        id={STUDIO_FLOW_SOURCE_HANDLE_ID}
        className="studio-handle"
      />
    </>
  )
}
