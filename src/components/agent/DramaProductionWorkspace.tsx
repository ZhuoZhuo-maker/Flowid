import { useCallback, useEffect, useMemo, useState } from 'react'
import { Film, LayoutGrid, Network, Users } from 'lucide-react'
import type { DramaRailTab } from './DramaAgentSideRail'
import { loadDramaProductionState } from '../../lib/dramaProduction/dramaStateStore'
import type { DramaCharacter, DramaProductionState, DramaShot } from '../../lib/dramaProduction/types'
import { DRAMA_PHASE_LABELS } from '../../lib/dramaProduction/dramaPhases'
import {
  getDramaRightViewMode,
  setDramaRightViewMode,
  subscribeDramaRightViewMode,
  type DramaRightViewMode,
} from '../../lib/dramaProduction/dramaWorkspaceSync'
import {
  getDramaWorkspaceTab,
  subscribeDramaStateChanged,
  subscribeDramaWorkspaceTab,
} from '../../lib/dramaProduction/dramaWorkspaceBridge'

type Props = {
  projectTabId: string
  /** 用户编辑后同步到画布节点 */
  onUserEdit: {
    script: (body: string) => void
    characters: (characters: DramaCharacter[]) => void
    shots: (shots: DramaShot[]) => void
    concept: (concept: string) => void
  }
  /** 切换到节点画布并定位关键词 */
  onFocusNodes?: (keyword: string) => void
}

/**
 * 智剧通式右侧制片工作台：剧本摘要 / 角色 / 分镜 / 视频（可手改，与 Agent、画布节点同步）。
 */
export function DramaProductionWorkspace({ projectTabId, onUserEdit, onFocusNodes }: Props) {
  const [tab, setTab] = useState<DramaRailTab>(() => getDramaWorkspaceTab())
  const [viewMode, setViewMode] = useState<DramaRightViewMode>(() => getDramaRightViewMode())
  const [state, setState] = useState<DramaProductionState | null>(() =>
    projectTabId ? loadDramaProductionState(projectTabId) : null,
  )

  const reload = useCallback(() => {
    if (!projectTabId) return
    setState(loadDramaProductionState(projectTabId))
  }, [projectTabId])

  useEffect(() => subscribeDramaWorkspaceTab(() => setTab(getDramaWorkspaceTab())), [])
  useEffect(() => subscribeDramaStateChanged(reload), [reload])
  useEffect(() => subscribeDramaRightViewMode(() => setViewMode(getDramaRightViewMode())), [])

  const spec = state?.spec
  const phaseLabel = state ? DRAMA_PHASE_LABELS[state.phase] : ''
  const shotRows = useMemo(() => state?.shots ?? [], [state?.shots])

  if (!projectTabId) {
    return (
      <div className="drama-workspace drama-workspace--empty">
        <p>请先打开短剧制片项目</p>
      </div>
    )
  }

  if (viewMode === 'nodes') {
    return null
  }

  return (
    <div className="drama-workspace" data-drama-workspace="1">
      <header className="drama-workspace__header">
        <div className="drama-workspace__header-main">
          <h2 className="drama-workspace__title">制片工作台</h2>
          {phaseLabel ? <span className="drama-workspace__phase">{phaseLabel}</span> : null}
        </div>
        <div className="drama-workspace__view-toggle" role="tablist" aria-label="右侧视图">
          <button
            type="button"
            role="tab"
            aria-selected
            className="is-active"
            onClick={() => setDramaRightViewMode('cards')}
            title="卡片视图（智剧通）"
          >
            <LayoutGrid size={14} aria-hidden />
            卡片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            onClick={() => {
              setDramaRightViewMode('nodes')
              onFocusNodes?.(tab === 'video' ? '镜头' : tab === 'storyboard' ? '分镜' : '剧本')
            }}
            title="节点画布（Comfy 执行）"
          >
            <Network size={14} aria-hidden />
            节点
          </button>
        </div>
      </header>

      <div className="drama-workspace__body">
        {tab === 'script' ? (
          <section className="drama-workspace__section">
            <h3>剧本摘要</h3>
            {spec ? (
              <div className="drama-workspace__spec-grid">
                <SpecChip label="画幅" value={String(spec.aspect)} />
                <SpecChip label="镜数" value={`${spec.shotCount} 镜`} />
                <SpecChip label="风格" value={spec.visualStyle || '待设定'} />
                <SpecChip label="平台" value={spec.targetPlatform || '待设定'} />
              </div>
            ) : null}
            <textarea
              className="drama-workspace__textarea"
              placeholder="Agent 将在此写入完整剧本；也可直接粘贴或修改…"
              value={state?.scriptBody ?? ''}
              onChange={(e) => {
                const body = e.target.value
                setState((prev) => (prev ? { ...prev, scriptBody: body } : prev))
              }}
              onBlur={(e) => onUserEdit.script(e.target.value)}
            />
            <button
              type="button"
              className="drama-workspace__link-btn"
              onClick={() => onFocusNodes?.('剧本')}
            >
              在节点画布中打开「剧本」节点
            </button>
          </section>
        ) : null}

        {tab === 'character' ? (
          <section className="drama-workspace__section">
            <h3>
              <Users size={16} aria-hidden /> 角色列表
            </h3>
            {!state?.characters.length ? (
              <p className="drama-workspace__empty">Agent 尚未写入角色；对话中描述故事后会自动生成。</p>
            ) : (
              <div className="drama-workspace__char-grid">
                {state.characters.map((c, idx) => (
                  <CharacterCard
                    key={c.id}
                    character={c}
                    onChange={(next) => {
                      const list = [...(state?.characters ?? [])]
                      list[idx] = next
                      setState((prev) => (prev ? { ...prev, characters: list } : prev))
                      onUserEdit.characters(list)
                    }}
                  />
                ))}
              </div>
            )}
            <label className="drama-workspace__field">
              <span>故事概念 / 梗概</span>
              <textarea
                className="drama-workspace__textarea drama-workspace__textarea--sm"
                value={spec?.concept ?? ''}
                placeholder="如：郭昕与安西白发军…"
                onChange={(e) => {
                  const concept = e.target.value
                  setState((prev) => (prev ? { ...prev, spec: { ...prev.spec, concept } } : prev))
                }}
                onBlur={(e) => onUserEdit.concept(e.target.value)}
              />
            </label>
          </section>
        ) : null}

        {tab === 'storyboard' ? (
          <section className="drama-workspace__section">
            <h3>
              <Film size={16} aria-hidden /> 分镜描述
            </h3>
            {!shotRows.length ? (
              <p className="drama-workspace__empty">
                分镜表为空。在左侧对话中让 Agent 写分镜并展开镜头节点。
              </p>
            ) : (
              <ul className="drama-workspace__shot-list">
                {shotRows.map((shot, idx) => (
                  <ShotCard
                    key={`${shot.index}-${idx}`}
                    shot={shot}
                    onChange={(next) => {
                      const list = [...shotRows]
                      list[idx] = next
                      setState((prev) => (prev ? { ...prev, shots: list } : prev))
                      onUserEdit.shots(list)
                    }}
                  />
                ))}
              </ul>
            )}
            <button
              type="button"
              className="drama-workspace__link-btn"
              onClick={() => onFocusNodes?.('分镜')}
            >
              在节点画布中打开「分镜表」
            </button>
          </section>
        ) : null}

        {tab === 'video' ? (
          <section className="drama-workspace__section">
            <h3>视频 / 镜头节点</h3>
            <p className="drama-workspace__hint">
              Agent 展开镜头后，每个镜头会生成「分镜图 + 成片」节点。点「节点」可绑定 Comfy 工作流并执行。
            </p>
            {shotRows.length ? (
              <ul className="drama-workspace__video-list">
                {shotRows.map((s) => (
                  <li key={s.index}>
                    <button
                      type="button"
                      className="drama-workspace__video-row"
                      onClick={() => {
                        setDramaRightViewMode('nodes')
                        onFocusNodes?.(`镜头${s.index}`)
                      }}
                    >
                      <span className="drama-workspace__video-index">镜头 {s.index}</span>
                      <span className="drama-workspace__video-title">{s.title || s.action.slice(0, 40)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drama-workspace__empty">尚无镜头节点</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function SpecChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="drama-workspace__spec-chip">
      <span className="drama-workspace__spec-label">{label}</span>
      <span className="drama-workspace__spec-value">{value}</span>
    </div>
  )
}

function CharacterCard({
  character,
  onChange,
}: {
  character: DramaCharacter
  onChange: (c: DramaCharacter) => void
}) {
  return (
    <article className="drama-workspace__char-card">
      <input
        className="drama-workspace__char-name"
        value={character.name}
        onChange={(e) => onChange({ ...character, name: e.target.value })}
        aria-label="角色名"
      />
      <textarea
        className="drama-workspace__char-body"
        value={[character.personality, character.appearance, character.background]
          .filter(Boolean)
          .join('\n')}
        onChange={(e) => {
          const lines = e.target.value.split('\n')
          onChange({
            ...character,
            personality: lines[0] ?? '',
            appearance: lines[1] ?? '',
            background: lines.slice(2).join('\n'),
          })
        }}
        placeholder="性格 / 外貌 / 背景"
      />
    </article>
  )
}

function ShotCard({ shot, onChange }: { shot: DramaShot; onChange: (s: DramaShot) => void }) {
  return (
    <li className="drama-workspace__shot-card">
      <div className="drama-workspace__shot-head">
        <span className="drama-workspace__shot-index">镜头 {shot.index}</span>
        <input
          className="drama-workspace__shot-title"
          value={shot.title}
          onChange={(e) => onChange({ ...shot, title: e.target.value })}
          aria-label="镜头标题"
        />
      </div>
      <label className="drama-workspace__field">
        <span>动作 / 画面</span>
        <textarea
          className="drama-workspace__textarea drama-workspace__textarea--sm"
          value={shot.action}
          onChange={(e) => onChange({ ...shot, action: e.target.value })}
        />
      </label>
      <label className="drama-workspace__field">
        <span>对白</span>
        <textarea
          className="drama-workspace__textarea drama-workspace__textarea--sm"
          value={shot.dialogue}
          onChange={(e) => onChange({ ...shot, dialogue: e.target.value })}
        />
      </label>
      <label className="drama-workspace__field">
        <span>生图提示词</span>
        <textarea
          className="drama-workspace__textarea drama-workspace__textarea--sm"
          value={shot.imagePrompt}
          onChange={(e) => onChange({ ...shot, imagePrompt: e.target.value })}
        />
      </label>
    </li>
  )
}
