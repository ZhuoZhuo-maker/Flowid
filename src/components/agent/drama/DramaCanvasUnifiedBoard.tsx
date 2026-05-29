import type { ReactNode } from 'react'
import type { DramaCharacter, DramaProductionState, DramaShot } from '../../../lib/dramaProduction/types'
import {
  dramaOverviewStageOrder,
  listUnlockedOverviewStages,
  type DramaOverviewStage,
} from '../../../lib/dramaProduction/dramaWorkspaceProgress'
import type { DramaUiState } from '../../../lib/dramaProduction/dramaUiBridge'
import { DramaCanvasScriptCard } from './DramaCanvasScriptCard'
import { DramaCanvasCharacterGroup, DramaCanvasSceneNode } from './DramaCanvasCharacterGroup'
import { DramaCanvasStoryboardNode } from './DramaCanvasStoryboardNode'
import { DramaCanvasVideoNode } from './DramaCanvasVideoNode'

type Props = {
  projectTabId: string
  state: DramaProductionState
  uiState: DramaUiState
  onUserEdit: {
    script: (body: string) => void
    shots: (shots: DramaShot[]) => void
  }
  onScriptChange: (body: string) => void
}

/**
 * 统一制片画布：所有阶段节点纵向排列；侧栏 Tab 仅定位到对应节点。
 */
export function DramaCanvasUnifiedBoard({
  projectTabId,
  state,
  uiState,
  onUserEdit,
  onScriptChange,
}: Props) {
  const stages = dramaOverviewStageOrder().filter((s) =>
    listUnlockedOverviewStages(state).includes(s),
  )

  if (!stages.length) {
    return (
      <div className="drama-canvas-unified drama-canvas-unified--empty">
        <p className="drama-canvas-overview__empty-hint">
          制片进度将随左侧对话同步出现：确认参数 → 剧本 → 角色 → 场景 → 分镜 → 视频
        </p>
      </div>
    )
  }

  const characters = state.characters ?? []
  const locations = state.locations ?? []
  const shots = state.shots ?? []
  const loc = locations[0]

  const nodes: ReactNode[] = []
  stages.forEach((stage, idx) => {
    if (idx > 0) nodes.push(<BoardConnector key={`c-${stage}`} />)
    nodes.push(
      <BoardStageSection
        key={stage}
        stage={stage}
        projectTabId={projectTabId}
        state={state}
        uiState={uiState}
        characters={characters}
        locations={locations}
        shots={shots}
        loc={loc}
        onUserEdit={onUserEdit}
        onScriptChange={onScriptChange}
      />,
    )
  })

  return <div className="drama-canvas-unified">{nodes}</div>
}

function BoardConnector() {
  return <div className="drama-canvas-unified__connector" aria-hidden />
}

function BoardStageSection({
  stage,
  projectTabId: _projectTabId,
  state,
  uiState,
  characters,
  locations: _locations,
  shots,
  loc,
  onUserEdit,
  onScriptChange,
}: {
  stage: DramaOverviewStage
  projectTabId: string
  state: DramaProductionState
  uiState: DramaUiState
  characters: DramaCharacter[]
  locations: DramaProductionState['locations']
  shots: DramaShot[]
  loc: DramaProductionState['locations'][0] | undefined
  onUserEdit: Props['onUserEdit']
  onScriptChange: (body: string) => void
}) {
  switch (stage) {
    case 'script':
      return (
        <section data-drama-stage="script" className="drama-canvas-unified__section">
          <DramaCanvasScriptCard
            body={state.scriptBody}
            editable
            onChange={onScriptChange}
            onBlur={() => onUserEdit.script(state.scriptBody)}
          />
        </section>
      )
    case 'character':
      return (
        <section data-drama-stage="character" className="drama-canvas-unified__section">
          <DramaCanvasCharacterGroup
            variant="studio"
            scriptBody={state.scriptBody}
            characters={characters}
            imagesReady={uiState.characterGen.done}
            visualStyle={uiState.selectedVisualStyle}
          />
        </section>
      )
    case 'scene':
      return (
        <section data-drama-stage="scene" className="drama-canvas-unified__section">
          {loc ? (
            <DramaCanvasSceneNode
              location={loc}
              visualStyle={uiState.selectedSceneStyle}
              mainImageReady={uiState.sceneGen.mainImageReady || Boolean(loc.mainImageSrc)}
              multiViewReady={uiState.sceneGen.multiViewReady || (loc.multiViewSrcs?.length ?? 0) >= 4}
            />
          ) : (
            <p className="drama-agent-workspace__empty-hint">暂无场景，请在左侧对话中让场景设计师创建。</p>
          )}
        </section>
      )
    case 'storyboard':
      return (
        <section data-drama-stage="storyboard" className="drama-canvas-unified__section">
          {shots.length ? (
            <DramaCanvasStoryboardNode
              variant="board"
              shots={shots}
              location={loc}
              imagesReady={uiState.storyboardGen.imagesReady}
              onEditShot={(idx, patch) => {
                const list = shots.map((s, i) => (i === idx ? { ...s, ...patch } : s))
                onUserEdit.shots(list)
              }}
            />
          ) : (
            <article className="drama-canvas-unified__placeholder" data-drama-node-draggable>
              <h3>分镜师</h3>
              <p>
                {uiState.storyboardGen.running
                  ? '正在自动生成分镜图/视频，请稍候…'
                  : 'Agent 写入分镜表后将自动出图并合成视频；也可在左侧对话中说「继续分镜」。'}
              </p>
            </article>
          )}
        </section>
      )
    case 'video':
      return (
        <section data-drama-stage="video" className="drama-canvas-unified__section">
          <DramaCanvasVideoNode state={state} shots={shots} />
        </section>
      )
    default:
      return null
  }
}
