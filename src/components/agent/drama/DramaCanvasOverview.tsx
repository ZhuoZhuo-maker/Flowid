import type { ReactNode } from 'react'
import { Film, Palette } from 'lucide-react'
import type { DramaProductionState } from '../../../lib/dramaProduction/types'
import {
  dramaOverviewStageOrder,
  listUnlockedOverviewStages,
  type DramaOverviewStage,
} from '../../../lib/dramaProduction/dramaWorkspaceProgress'

type Props = {
  state: DramaProductionState
}

/**
 * 总览画布：仅展示已到达阶段的数据节点（随制片进度逐步出现）。
 */
export function DramaCanvasOverview({ state }: Props) {
  const unlocked = new Set(listUnlockedOverviewStages(state))
  const stages = dramaOverviewStageOrder().filter((s) => unlocked.has(s))

  if (!stages.length) {
    return (
      <div className="drama-canvas-overview drama-canvas-overview--empty">
        <p className="drama-canvas-overview__empty-hint">
          制片进度将随左侧对话同步出现：确认参数 → 剧本 → 角色 → 场景 → 分镜 → 视频
        </p>
      </div>
    )
  }

  const nodes: ReactNode[] = []
  stages.forEach((stage, idx) => {
    if (idx > 0) nodes.push(<OverviewConnector key={`c-${stage}`} />)
    nodes.push(<OverviewStageNode key={stage} stage={stage} state={state} />)
  })

  return <div className="drama-canvas-overview">{nodes}</div>
}

/** @param state 制片状态 */
function formatScriptOverviewBody(state: DramaProductionState): string {
  const body = state.scriptBody?.trim() ?? ''
  return body || '剧本尚未生成，请在左侧对话中推进。'
}

/** @param state 制片状态 */
function formatCharacterOverviewBody(state: DramaProductionState): string {
  const list = state.characters ?? []
  if (list.length === 0) return '角色设定尚未生成，请在左侧对话中推进。'
  return list
    .map((c) => {
      const lines = [c.name]
      if (c.personality?.trim()) lines.push(`性格：${c.personality.trim()}`)
      if (c.appearance?.trim()) lines.push(`外貌：${c.appearance.trim()}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** @param state 制片状态 */
function formatSceneOverviewBody(state: DramaProductionState): string {
  const loc = state.locations?.[0]
  if (!loc) return '场景设定尚未生成，请在左侧对话中推进。'
  const lines: string[] = []
  if (loc.description?.trim()) lines.push(loc.description.trim())
  if (loc.visualStyle?.trim()) lines.push(`视觉风格：${loc.visualStyle.trim()}`)
  if (loc.props?.length) lines.push(`道具：${loc.props.join('、')}`)
  return lines.length > 0 ? lines.join('\n\n') : loc.name?.trim() || '场景描述待补充'
}

/** @param state 制片状态 */
function formatStoryboardOverviewBody(state: DramaProductionState): string {
  const shots = state.shots ?? []
  if (shots.length === 0) return '分镜尚未生成，请在左侧对话中推进。'
  return shots
    .map((s) => {
      const head = `${s.index}. ${s.title || s.scene || '镜头'}`
      const detail = [s.shotType, s.action].filter(Boolean).join(' · ')
      return detail ? `${head}\n${detail}` : head
    })
    .join('\n\n')
}

function OverviewStageNode({ stage, state }: { stage: DramaOverviewStage; state: DramaProductionState }) {
  const characters = state.characters ?? []
  const loc = state.locations?.[0]
  const shots = state.shots ?? []
  const videoSrc = state.finalVideoSrc || shots.find((s) => s.videoSrc)?.videoSrc
  const characterThumbs = characters.map((c) => c.imageSrc).filter(Boolean) as string[]
  const shotThumbs = shots.flatMap((s) => s.imageSrcs?.slice(0, 1) ?? []).filter(Boolean)

  switch (stage) {
    case 'script':
      return (
        <OverviewNode
          label="编剧"
          icon={<Palette size={14} />}
          title="故事剧本"
          body={formatScriptOverviewBody(state)}
        />
      )
    case 'character':
      return (
        <OverviewNode
          label="角色设计师"
          icon={<Palette size={14} />}
          title={characters.length > 0 ? `${characters.length} 位角色` : '角色设定'}
          body={formatCharacterOverviewBody(state)}
          thumbs={characterThumbs}
        />
      )
    case 'scene':
      return (
        <OverviewNode
          label="场景设计师"
          icon={<Film size={14} />}
          title={loc?.name || '场景'}
          body={formatSceneOverviewBody(state)}
          thumbs={loc?.mainImageSrc ? [loc.mainImageSrc] : []}
        />
      )
    case 'storyboard':
      return (
        <OverviewNode
          label="分镜师"
          icon={<Film size={14} />}
          title={shots.length > 0 ? `${shots.length} 个分镜` : '分镜'}
          body={formatStoryboardOverviewBody(state)}
          thumbs={shotThumbs}
        />
      )
    case 'video':
      return (
        <OverviewNode
          label="艺术总监"
          icon={<Film size={14} />}
          title="最终视频"
          body={videoSrc ? '视频已生成，可在下方预览。' : '视频尚未合成，请在左侧对话中推进。'}
          thumbs={videoSrc ? [videoSrc] : []}
          isVideo
        />
      )
    default:
      return null
  }
}

function OverviewConnector() {
  return <div className="drama-canvas-overview__connector" aria-hidden />
}

function OverviewNode({
  label,
  icon,
  title,
  body,
  thumbs,
  isVideo,
}: {
  label: string
  icon: ReactNode
  title: string
  body?: string
  thumbs?: string[]
  isVideo?: boolean
}) {
  return (
    <article className="drama-canvas-overview__node" data-drama-node-draggable>
      <header>
        {icon}
        <span>{label}</span>
      </header>
      <strong>{title}</strong>
      {body ? (
        <pre className="drama-canvas-overview__body" data-drama-wheel-scroll="1">
          {body}
        </pre>
      ) : null}
      {thumbs?.length ? (
        <div className="drama-canvas-overview__thumbs">
          {thumbs.slice(0, 4).map((src, i) =>
            isVideo ? (
              <video key={i} src={src} className="drama-canvas-overview__thumb" muted preload="metadata" />
            ) : (
              <div
                key={i}
                className="drama-canvas-overview__thumb"
                style={{ backgroundImage: `url(${src})`, backgroundSize: 'cover' }}
              />
            ),
          )}
        </div>
      ) : null}
    </article>
  )
}
