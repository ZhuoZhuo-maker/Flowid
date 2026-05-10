import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { useState } from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import type { TextNodeData } from '../../types'
import { NodeChrome } from './NodeChrome'

/**
 * 文本节点：短提示词、标签或衔接说明。
 */
export function TextNode({
  id,
  data,
  selected,
}: NodeProps<Node<TextNodeData, 'text'>>) {
  const { updateNodeData } = useCanvasActions()
  const [isEditingBody, setIsEditingBody] = useState(false)

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
      <NodeChrome
        icon={<span className="glyph">T</span>}
        title={data.title}
        accent="#38bdf8"
        selected={selected}
        runStatus={data.runStatus}
        runProgress={data.runProgress}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: 'text', title: nextTitle })
        }
      >
        {isEditingBody ? (
          <textarea
            className="studio-textarea studio-cardEmpty studio-cardEmpty--text studio-cardEmpty--editor nodrag nopan nowheel"
            rows={4}
            autoFocus
            value={data.body}
            placeholder=""
            onWheel={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { body: e.target.value, kind: 'text' })}
            onBlur={() => setIsEditingBody(false)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <div
            className={`studio-cardEmpty studio-cardEmpty--text studio-cardEmpty--preview nodrag nopan nowheel ${data.body?.trim() ? '' : 'studio-cardEmpty--placeholder'}`}
            onWheel={(e) => e.stopPropagation()}
            onDoubleClick={() => setIsEditingBody(true)}
            title="双击编辑"
          >
            {data.body?.trim() ? data.body : '请编写内容，开始你的创作。'}
          </div>
        )}
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="studio-handle" />
    </>
  )
}
