import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { useCallback, useRef } from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import type { VideoNodeData } from '../../types'
import { setFlowidMaterialDragData } from '../../lib/materialLibrary'
import { NodeChrome } from './NodeChrome'

/**
 * 视频节点：成片或片段占位，后续可接预览播放器与关键帧。
 */
export function VideoNode({
  id,
  data,
  selected,
}: NodeProps<Node<VideoNodeData, 'video'>>) {
  const { updateNodeData } = useCanvasActions()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /**
   * 提取首个视频文件（支持拖拽/粘贴）。
   */
  const pickFirstVideoFile = useCallback((dt: DataTransfer | null): File | null => {
    if (!dt) return null
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i]
        if (it?.kind !== 'file') continue
        if (!String(it.type || '').startsWith('video/')) continue
        const f = it.getAsFile()
        if (f) return f
      }
    }
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files.item(i)
        if (f?.type.startsWith('video/')) return f
      }
    }
    return null
  }, [])

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
      <NodeChrome
        icon={<span className="glyph">映</span>}
        title={data.title}
        accent="#34d399"
        selected={selected}
        runStatus={data.runStatus}
        runProgress={data.runProgress}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: 'video', title: nextTitle })
        }
      >
        <div
          className="studio-thumb studio-thumb--video nowheel nodrag"
          tabIndex={0}
          title="可拖拽/粘贴视频到此；点击右上角上传按钮可选择本地视频"
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const f = pickFirstVideoFile(event.dataTransfer)
            if (!f) return
            updateNodeData(id, {
              kind: 'video',
              src: URL.createObjectURL(f),
              srcFileName: f.name,
            })
          }}
          onPaste={(event) => {
            const f = pickFirstVideoFile(event.clipboardData)
            if (!f) return
            event.preventDefault()
            event.stopPropagation()
            updateNodeData(id, {
              kind: 'video',
              src: URL.createObjectURL(f),
              srcFileName: f.name,
            })
          }}
        >
          {data.src ? (
            <>
              <video
                className="studio-thumb__video"
                src={data.src}
                controls
                muted
                playsInline
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  const title = String(data.title || '').trim() || '视频节点'
                  setFlowidMaterialDragData(e.dataTransfer, {
                    nodeId: id,
                    title,
                    kind: 'video',
                    src: data.src,
                  })
                }}
              />
              <div className="studio-thumb__actions">
                <button
                  type="button"
                  className="studio-thumb__action"
                  title="上传本地视频"
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="studio-thumb__placeholder"> </div>
              <div className="studio-thumb__actions">
                <button
                  type="button"
                  className="studio-thumb__action"
                  title="上传本地视频"
                  onClick={() => fileInputRef.current?.click()}
                >
                  上传
                </button>
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file && file.type.startsWith('video/')) {
                updateNodeData(id, {
                  kind: 'video',
                  src: URL.createObjectURL(file),
                  srcFileName: file.name,
                })
              }
              event.target.value = ''
            }}
          />
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="studio-handle" />
    </>
  )
}
