import { Loader2, Settings2 } from 'lucide-react'
import type { DramaCharacterGenState, DramaSceneGenState, DramaStoryboardGenState } from '../../../lib/dramaProduction/dramaUiBridge'

type Props = {
  gen: DramaCharacterGenState | DramaSceneGenState | DramaStoryboardGenState
  variant?: 'character' | 'scene' | 'storyboard' | 'storyboard-video'
  thinking?: boolean
  thinkingText?: string
}

/**
 * 角色 / 场景 / 分镜图 / 分镜视频生成进度块。
 */
export function DramaGenProgressCard({ gen, variant = 'character', thinking, thinkingText }: Props) {
  const pct = gen.total > 0 ? Math.round((gen.done / gen.total) * 100) : 0
  const statLabel =
    variant === 'scene'
      ? `场景图生成中: ${gen.done}/${gen.total} (成功: ${gen.done})`
      : variant === 'storyboard'
        ? `分镜图生成中: ${gen.done}/${gen.total} (成功: ${gen.done})`
        : variant === 'storyboard-video'
          ? `任务进度: ${gen.done}/${gen.total} (成功: ${gen.done})`
          : `角色图生成中: ${gen.done}/${gen.total} (成功: ${gen.done})`

  return (
    <div className="drama-gen-progress">
      {thinking ? (
        <div className="drama-gen-progress__thinking">
          <Loader2 size={14} className="drama-agent-working__spin" aria-hidden />
          <span>思考中…</span>
          {thinkingText ? <p>{thinkingText}</p> : null}
        </div>
      ) : null}
      <div className="drama-gen-progress__card">
        <div className="drama-gen-progress__head">
          <Settings2 size={14} aria-hidden />
          <span>{gen.label}</span>
        </div>
        <p className="drama-gen-progress__stat">{statLabel}</p>
        <div className="drama-gen-progress__bar">
          <div className="drama-gen-progress__bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="drama-gen-progress__time">
          {gen.elapsedSec}s / {gen.maxSec}s
        </p>
      </div>
    </div>
  )
}
