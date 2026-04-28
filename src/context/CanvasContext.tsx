import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Node } from '@xyflow/react'
import type { StudioNodeData, StudioNodeKind } from '../types'

/**
 * 画布内子组件通过该上下文回写节点数据，避免把回调塞进 `data` 导致引用抖动。
 */
export type CanvasActions = {
  /**
   * 按节点 id 合并更新 `data` 字段。
   * @param nodeId 节点 id
   * @param patch 与 `StudioNodeData` 兼容的部分字段
   */
  updateNodeData: (nodeId: string, patch: Partial<StudioNodeData>) => void
  /**
   * 在指定节点左/右侧快速新增并自动连线一个同类型节点。
   */
  addLinkedNode: (nodeId: string, side: 'left' | 'right', kind?: StudioNodeKind) => void
  /**
   * 按资源地址删除历史记录条目（用于节点内删除时同步清理历史）。
   */
  removeHistoryBySource: (src: string) => void
  /**
   * 更新节点外层属性（如 draggable/zIndex/hidden）。
   */
  updateNodeMeta: (
    nodeId: string,
    patch: Partial<Node<StudioNodeData>>,
  ) => void
  /**
   * 删除指定节点（用于组右键菜单删除）。
   */
  removeNodeById: (nodeId: string) => void
  /**
   * 全景沉浸模式：将当前视角截图落到画布为图片节点（与全景节点流坐标间距 `gapFlow`）。
   */
  addPanoramaViewToCanvas: (
    panoramaNodeId: string,
    imageObjectUrl: string,
    gapFlow?: number,
  ) => Promise<void>
}

const CanvasContext = createContext<CanvasActions | null>(null)

/**
 * Provider：由画布根组件注入 `updateNodeData`。
 */
export function CanvasProvider({
  children,
  updateNodeData,
  addLinkedNode,
  removeHistoryBySource,
  updateNodeMeta,
  removeNodeById,
  addPanoramaViewToCanvas,
}: {
  children: ReactNode
  updateNodeData: CanvasActions['updateNodeData']
  addLinkedNode: CanvasActions['addLinkedNode']
  removeHistoryBySource: CanvasActions['removeHistoryBySource']
  updateNodeMeta: CanvasActions['updateNodeMeta']
  removeNodeById: CanvasActions['removeNodeById']
  addPanoramaViewToCanvas: CanvasActions['addPanoramaViewToCanvas']
}) {
  const value = useMemo(
    () => ({
      updateNodeData,
      addLinkedNode,
      removeHistoryBySource,
      updateNodeMeta,
      removeNodeById,
      addPanoramaViewToCanvas,
    }),
    [
      updateNodeData,
      addLinkedNode,
      removeHistoryBySource,
      updateNodeMeta,
      removeNodeById,
      addPanoramaViewToCanvas,
    ],
  )
  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  )
}

/**
 * 在自定义节点内读取画布动作；若不在 Provider 内则抛错，便于尽早发现问题。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 与 Provider 同文件便于维护；拆文件收益有限
export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasContext)
  if (!ctx) {
    throw new Error('useCanvasActions 必须在 CanvasProvider 内使用')
  }
  return ctx
}
