import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadDramaProductionState } from '../../../lib/dramaProduction/dramaStateStore'
import type { DramaCharacter, DramaProductionState, DramaShot } from '../../../lib/dramaProduction/types'
import {
  getDramaWorkspaceNavTab,
  setDramaWorkspaceNavTab,
  subscribeDramaStateChanged,
  subscribeDramaWorkspaceTab,
} from '../../../lib/dramaProduction/dramaWorkspaceBridge'
import { resolveDramaNavTab } from '../../../lib/dramaProduction/dramaWorkspaceProgress'
import { DramaAgentSideNav, type DramaNavTab } from './DramaAgentSideNav'
import { subscribeDramaUiState, getDramaUiState, type DramaUiState } from '../../../lib/dramaProduction/dramaUiBridge'
import { DramaPanZoomCanvas } from './DramaPanZoomCanvas'
import { DramaCanvasUnifiedBoard } from './DramaCanvasUnifiedBoard'

type Props = {
  projectTabId: string
  projectTitle?: string
  onUserEdit: {
    script: (body: string) => void
    characters: (characters: DramaCharacter[]) => void
    shots: (shots: DramaShot[]) => void
    concept: (concept: string) => void
  }
}

/**
 * 短剧 Agent 右侧工作区：统一总览画布 + 侧栏 Tab 定位节点。
 */
export function DramaAgentWorkspace({ projectTabId, onUserEdit }: Props) {
  const [navTab, setNavTab] = useState<DramaNavTab>(() => getDramaWorkspaceNavTab())
  const [focusStage, setFocusStage] = useState<DramaNavTab>(() => getDramaWorkspaceNavTab())
  const [state, setState] = useState<DramaProductionState | null>(() =>
    projectTabId ? loadDramaProductionState(projectTabId) : null,
  )
  const [uiState, setUiState] = useState<DramaUiState>(() =>
    projectTabId ? getDramaUiState(projectTabId) : getDramaUiState(''),
  )

  const reload = useCallback(() => {
    if (!projectTabId) return
    const nextState = loadDramaProductionState(projectTabId)
    setState(nextState)
    setUiState(getDramaUiState(projectTabId))
    if (nextState) {
      setNavTab((prev) => resolveDramaNavTab(prev, nextState))
    }
  }, [projectTabId])

  useEffect(
    () =>
      subscribeDramaWorkspaceTab(() => {
        const tab = getDramaWorkspaceNavTab()
        setNavTab(tab)
        setFocusStage(tab)
      }),
    [],
  )
  useEffect(() => subscribeDramaStateChanged(reload), [reload])
  useEffect(() => {
    if (!projectTabId) return
    return subscribeDramaUiState(() => setUiState(getDramaUiState(projectTabId)))
  }, [projectTabId])

  const onNavChange = useCallback(
    (next: DramaNavTab) => {
      const resolved = resolveDramaNavTab(next, state)
      setNavTab(resolved)
      setFocusStage(resolved)
      setDramaWorkspaceNavTab(resolved)
    },
    [state],
  )

  const canvasContent = useMemo(() => {
    if (!state) return null
    return (
      <DramaCanvasUnifiedBoard
        projectTabId={projectTabId}
        state={state}
        uiState={uiState}
        onUserEdit={onUserEdit}
        onScriptChange={(body) => {
          setState((prev) => (prev ? { ...prev, scriptBody: body } : prev))
        }}
      />
    )
  }, [state, uiState, projectTabId, onUserEdit])

  if (!projectTabId) {
    return (
      <div className="drama-agent-workspace drama-agent-workspace--empty">
        <p>请先打开短剧制片项目</p>
      </div>
    )
  }

  return (
    <div className="drama-agent-workspace">
      <DramaAgentSideNav activeTab={navTab} state={state} onTabChange={onNavChange} />
      <div className="drama-agent-workspace__main">
        <DramaPanZoomCanvas initialZoom={0.92} focusStage={focusStage}>
          {canvasContent}
        </DramaPanZoomCanvas>
      </div>
    </div>
  )
}
