import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { useCallback, useRef } from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import {
  getLocalImageAssetObjectUrl,
  saveLocalImageAsset,
} from '../../lib/localImageAssetStore'
import type { ImageNodeData } from '../../types'
import { NodeChrome } from './NodeChrome'

/**
 * 图像节点：参考图 URL + 文生图提示。
 */
export function ImageNode({
  id,
  data,
  selected,
}: NodeProps<Node<ImageNodeData, 'image'>>) {
  const { updateNodeData } = useCanvasActions()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
        })
      } catch {
        updateNodeData(id, {
          kind: 'image',
          src: URL.createObjectURL(file),
          srcFileName: file.name,
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
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const file = pickFirstImageFile(event.dataTransfer)
      if (!file) return
      void applyLocalImageFile(file)
    },
    [applyLocalImageFile, pickFirstImageFile],
  )

  /**
   * 节点预览区支持 Ctrl+V 粘贴图片替换。
   */
  const onThumbPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
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

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
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
              <img src={data.src} alt="" className="studio-thumb__img" />
              <div className="studio-thumb__actions">
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
                  download
                  className="studio-thumb__action"
                  title="下载原图"
                >
                  下载
                </a>
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
      <Handle type="source" position={Position.Right} className="studio-handle" />
    </>
  )
}
