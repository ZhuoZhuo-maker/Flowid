import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { useCanvasActions } from '../../context/CanvasContext'
import type { ScriptNodeData } from '../../types'
import { NodeChrome } from './NodeChrome'

/**
 * 剧本节点：承载较长脚本，对标 Flowid 脚本/分镜上游。
 */
export function ScriptNode({
  id,
  data,
  selected,
}: NodeProps<Node<ScriptNodeData, 'script'>>) {
  const { updateNodeData } = useCanvasActions()

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
      <NodeChrome
        icon={<span className="glyph">剧</span>}
        title={data.title}
        accent="#a78bfa"
        selected={selected}
        runStatus={data.runStatus}
        runProgress={data.runProgress}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: 'script', title: nextTitle })
        }
      >
        <label className="studio-field">
          <span className="studio-field__label">剧本</span>
          <textarea
            className="studio-textarea nodrag nopan nowheel"
            rows={10}
            value={data.body}
            onWheel={(e) => e.stopPropagation()}
            onChange={(e) => updateNodeData(id, { body: e.target.value, kind: 'script' })}
          />
        </label>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="studio-handle" />
    </>
  )
}
