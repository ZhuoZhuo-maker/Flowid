import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Node } from '@xyflow/react'
import type { StudioNodeData, StudioNodeKind } from '../types'

export type CanvasActions = {
  updateNodeData: (nodeId: string, patch: Partial<StudioNodeData>) => void
  addLinkedNode: (nodeId: string, side: 'left' | 'right', kind?: StudioNodeKind) => void
  removeHistoryBySource: (src: string) => void
  updateNodeMeta: (nodeId: string, patch: Partial<Node<StudioNodeData>>) => void
  removeNodeById: (nodeId: string) => void
  addPanoramaViewToCanvas: (
    panoramaNodeId: string,
    imageObjectUrl: string,
    gapFlow?: number,
  ) => Promise<void>
}

type CanvasContextValue = CanvasActions

const CanvasContext = createContext<CanvasContextValue | null>(null)

interface CanvasProviderProps {
  children: ReactNode
  updateNodeData: CanvasActions['updateNodeData']
  addLinkedNode: CanvasActions['addLinkedNode']
  removeHistoryBySource: CanvasActions['removeHistoryBySource']
  updateNodeMeta: CanvasActions['updateNodeMeta']
  removeNodeById: CanvasActions['removeNodeById']
  addPanoramaViewToCanvas: CanvasActions['addPanoramaViewToCanvas']
}

export function CanvasProvider({
  children,
  updateNodeData,
  addLinkedNode,
  removeHistoryBySource,
  updateNodeMeta,
  removeNodeById,
  addPanoramaViewToCanvas,
}: CanvasProviderProps) {
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
    ]
  )

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) {
    throw new Error('useCanvas must be used within CanvasProvider')
  }
  return ctx
}

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasContext)
  if (!ctx) {
    throw new Error('useCanvasActions must be used within CanvasProvider')
  }
  return ctx
}