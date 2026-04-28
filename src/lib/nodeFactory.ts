import type { XYPosition } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { StudioNodeData, StudioNodeKind } from '../types'

/**
 * 在画布上新建指定类型的节点，默认放在 `position`。
 */
export function createStudioNode(
  kind: StudioNodeKind,
  id: string,
  position: XYPosition,
  titleOverride?: string,
): Node<StudioNodeData> {
  const base = {
    id,
    position,
    style: {
      width: 430,
      height: 340,
    },
  } as const

  switch (kind) {
    case 'text':
      return {
        ...base,
        type: 'text',
        data: {
          kind: 'text',
          title: titleOverride ?? '文本',
          runStatus: 'idle',
          body: '',
          model: '',
        },
      }
    case 'script':
      return {
        ...base,
        type: 'script',
        data: {
          kind: 'script',
          title: titleOverride ?? '剧本',
          runStatus: 'idle',
          body: '',
        },
      }
    case 'image':
      return {
        ...base,
        type: 'image',
        data: {
          kind: 'image',
          title: titleOverride ?? '图像',
          runStatus: 'idle',
          src: '',
          prompt: '',
          model: '',
          referenceImageSources: [],
        },
      }
    case 'video':
      return {
        ...base,
        type: 'video',
        data: {
          kind: 'video',
          title: titleOverride ?? '视频',
          runStatus: 'idle',
          src: '',
          prompt: '',
          model: '',
          referenceImageSources: [],
        },
      }
    case 'audio':
      return {
        ...base,
        type: 'audio',
        data: {
          kind: 'audio',
          title: titleOverride ?? '音频',
          runStatus: 'idle',
          src: '',
          resultSources: [],
          note: '',
          model: '',
          referenceImageSources: [],
        },
      }
    case 'music':
      return {
        ...base,
        type: 'audio',
        data: {
          kind: 'music',
          title: titleOverride ?? '音乐',
          runStatus: 'idle',
          src: '',
          resultSources: [],
          note: '',
          model: 'Comfy Music Flow A',
          referenceImageSources: [],
        },
      }
    case 'panorama':
      return {
        ...base,
        type: 'panorama',
        style: {
          width: 440,
          /** 内容区高度由预览+按钮+说明自适应，不再用过大固定值撑空白 */
          height: 'auto',
        },
        data: {
          kind: 'panorama',
          title: titleOverride ?? 'VR360 全景',
          runStatus: 'idle',
          src: '',
          exportWidth: 1024,
          exportHeight: 1024,
        },
      }
    default: {
      const _never: never = kind
      throw new Error(`未知节点类型: ${_never}`)
    }
  }
}

/**
 * 创建分组节点（用于框选节点后的可视化分组）。
 */
export function createGroupNode(
  id: string,
  position: XYPosition,
  size: { width: number; height: number },
  memberIds: string[],
  title = '分组',
): Node<StudioNodeData> {
  return {
    id,
    type: 'group',
    position,
    draggable: true,
    /**
     * 须为 true：XYDrag 在拖曳开始时若节点未选中会 `unselectNodesAndEdges()`；
     * 与 React `setNodes` 异步竞态会导致标题栏点选异常。拖曳仍仅限 `dragHandle` 标题栏。
     */
    selectable: true,
    dragHandle: '.studio-group__titleRow',
    style: {
      width: size.width,
      height: size.height,
      /** 事件穿透到下层成员节点；标题栏单独 `pointer-events: auto` */
      pointerEvents: 'none',
    },
    /** 须高于普通节点，否则标题栏永远被成员挡住无法点击 */
    zIndex: 10,
    data: {
      kind: 'group',
      title,
      runStatus: 'idle',
      memberIds,
      collapsed: false,
      borderColor: '#6fd2ff',
      backgroundColor: 'rgba(50, 90, 120, 0.08)',
      titleFontSize: 12,
      locked: false,
      expandedWidth: size.width,
      expandedHeight: size.height,
    },
  }
}
