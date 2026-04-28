import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { useCallback, useMemo, useRef } from 'react'
import type { AudioNodeData } from '../../types'
import { useCanvasActions } from '../../context/CanvasContext'
import { NodeChrome } from './NodeChrome'

/**
 * 音频节点：配音、配乐或音效占位。
 */
export function AudioNode({
  id,
  data,
  selected,
}: NodeProps<Node<AudioNodeData, 'audio'>>) {
  const { updateNodeData, removeHistoryBySource } = useCanvasActions()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isMusic = data.kind === 'music'
  const accentColor = isMusic ? '#8b5cf6' : '#fbbf24'
  const glyph = isMusic ? '乐' : '音'
  const resultSources = useMemo(() => {
    const fromList = data.resultSources?.filter(Boolean) ?? []
    if (fromList.length) return fromList
    return data.src ? [data.src] : []
  }, [data.resultSources, data.src])

  /**
   * 提取首个音频文件（支持拖拽/粘贴）。
   */
  const pickFirstAudioFile = useCallback((dt: DataTransfer | null): File | null => {
    if (!dt) return null
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i]
        if (it?.kind !== 'file') continue
        if (!String(it.type || '').startsWith('audio/')) continue
        const f = it.getAsFile()
        if (f) return f
      }
    }
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files.item(i)
        if (f?.type.startsWith('audio/')) return f
      }
    }
    return null
  }, [])

  /**
   * 写入节点音频结果列表（最新在前，去重）。
   */
  const pushAudioResult = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file)
      updateNodeData(id, {
        kind: data.kind,
        src: url,
        srcFileName: file.name,
        resultSources: [url, ...(data.resultSources ?? []).filter((item) => item !== url)],
      })
    },
    [data.kind, data.resultSources, id, updateNodeData],
  )

  /**
   * 节点内删除资源：同步删除历史中的同源记录。
   * 说明：这是单向同步；历史面板删除不会反向影响节点。
   */
  const removeNodeResult = (targetSrc: string) => {
    const nextSources = resultSources.filter((item) => item !== targetSrc)
    updateNodeData(id, {
      kind: data.kind,
      resultSources: nextSources,
      src: nextSources[0] ?? '',
    })
    removeHistoryBySource(targetSrc)
  }

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
      <NodeChrome
        icon={<span className="glyph">{glyph}</span>}
        title={data.title}
        accent={accentColor}
        selected={selected}
        runStatus={data.runStatus}
        runProgress={data.runProgress}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: data.kind, title: nextTitle })
        }
        showStatusBadge={!isMusic}
      >
        <div
          className="studio-thumb studio-thumb--audio nowheel nodrag"
          tabIndex={0}
          title="可拖拽/粘贴音频到此；点击上传按钮可选择本地音频"
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const f = pickFirstAudioFile(event.dataTransfer)
            if (!f) return
            pushAudioResult(f)
          }}
          onPaste={(event) => {
            const f = pickFirstAudioFile(event.clipboardData)
            if (!f) return
            event.preventDefault()
            event.stopPropagation()
            pushAudioResult(f)
          }}
        >
          {resultSources.length ? (
            <div className="studio-audio-result-list">
              {resultSources.map((src, index) => (
                <div className="studio-audio-preview__bar" key={`${src}-${index}`}>
                  <div className="studio-audio-preview__head">
                    <div className="studio-audio-preview__name">
                      {index === 0 ? `${data.title}` : `${data.title}（${index}）`}
                    </div>
                    <div className="studio-audio-preview__actions">
                      <button
                        type="button"
                        className="studio-audio-preview__download"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        上传
                      </button>
                      <a className="studio-audio-preview__download" href={src} download>
                        下载
                      </a>
                      <button
                        type="button"
                        className="studio-audio-preview__download"
                        onClick={() => removeNodeResult(src)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <audio controls src={src} className="studio-audio-preview__player" />
                </div>
              ))}
            </div>
          ) : (
            <div className="studio-thumb__placeholder">
              <button
                type="button"
                className="studio-audio-preview__download"
                onClick={() => fileInputRef.current?.click()}
              >
                上传
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file && file.type.startsWith('audio/')) {
                  pushAudioResult(file)
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
