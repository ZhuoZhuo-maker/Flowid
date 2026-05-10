import type { XYPosition } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { ImageCompareNodeData, StudioNodeData, StudioNodeKind } from '../types'

/** 与 `createStudioNode` / `createGroupNode` 默认标题一致，供侧栏等与画布展示对齐 */
export function defaultStudioNodeTitle(kind: StudioNodeKind | string): string {
  switch (kind) {
    case 'text':
      return '文本'
    case 'script':
      return '剧本'
    case 'image':
      return '图像'
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    case 'music':
      return '音乐'
    case 'panorama':
      return 'VR360 全景'
    case 'imageCompare':
      return '图像对比'
    case 'group':
      return '分组'
    default:
      return typeof kind === 'string' && kind ? kind : '节点'
  }
}

export function createImageCompareStudioNode(
  id: string,
  position: XYPosition,
  titleOverride: string | undefined,
  payload: Pick<ImageCompareNodeData, 'compareSrcA' | 'compareSrcB'> &
    Partial<Pick<ImageCompareNodeData, 'compareLabelA' | 'compareLabelB'>>,
): Node<StudioNodeData> {
  return {
    id,
    type: 'imageCompare',
    position,
    draggable: true,
    selectable: true,
    /** 仅标题栏拖节点；预览区内拖中线不再被整节点拖拽抢走 */
    dragHandle: '.studio-node__head',
    style: {
      width: 520,
      /** 数值高度以便 NodeResizer 缩放；预览区在节点内 flex 撑满 */
      height: 420,
    },
    data: {
      kind: 'imageCompare',
      title: titleOverride ?? defaultStudioNodeTitle('imageCompare'),
      runStatus: 'idle',
      compareSrcA: payload.compareSrcA,
      compareSrcB: payload.compareSrcB,
      compareLabelA: payload.compareLabelA,
      compareLabelB: payload.compareLabelB,
    },
  }
}

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
          title: titleOverride ?? defaultStudioNodeTitle('text'),
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
          title: titleOverride ?? defaultStudioNodeTitle('script'),
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
          title: titleOverride ?? defaultStudioNodeTitle('image'),
          runStatus: 'idle',
          src: '',
          prompt: '',
          model: '',
          referenceImageSources: [],
          mattingPoints: [],
          cloudImageAspect: 'auto',
          cloudImageResolutionTier: '1k',
          comfyWorkflowWidth: 1024,
          comfyWorkflowHeight: 1024,
          comfyWorkflowAspect: '1:1',
          comfyWorkflowUseCustomPixels: false,
        },
      }
    case 'video':
      return {
        ...base,
        type: 'video',
        data: {
          kind: 'video',
          title: titleOverride ?? defaultStudioNodeTitle('video'),
          runStatus: 'idle',
          src: '',
          prompt: '',
          prompt2: '',
          prompt3: '',
          prompt4: '',
          model: '',
          referenceImageSources: [],
          comfyWorkflowWidth: 1280,
          comfyWorkflowHeight: 720,
          comfyWorkflowAspect: '16:9',
          comfyWorkflowUseCustomPixels: false,
        },
      }
    case 'audio':
      return {
        ...base,
        type: 'audio',
        data: {
          kind: 'audio',
          title: titleOverride ?? defaultStudioNodeTitle('audio'),
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
          title: titleOverride ?? defaultStudioNodeTitle('music'),
          runStatus: 'idle',
          src: '',
          resultSources: [],
          note: '',
          model: 'Comfy Music Flow A',
          referenceImageSources: [],
          comfyMusicDurationMinutes: 3,
          comfyMusicBpm: 98,
          comfyMusicTimesignature: '4',
          comfyMusicLanguage: 'zh',
          comfyMusicKeyscale: 'D major',
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
          title: titleOverride ?? defaultStudioNodeTitle('panorama'),
          runStatus: 'idle',
          src: '',
          exportWidth: 1024,
          exportHeight: 1024,
        },
      }
    case 'imageCompare':
      return createImageCompareStudioNode(id, position, titleOverride, {
        compareSrcA: '',
        compareSrcB: '',
      })
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
  title = defaultStudioNodeTitle('group'),
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
