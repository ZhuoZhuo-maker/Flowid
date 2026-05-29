import { useMemo, useState } from 'react'
import type { DramaAskUserPayload } from '../../../lib/dramaProduction/dramaAskUserBridge'
import { DramaKeywordGrid } from './DramaKeywordGrid'
import { DramaSatisfactionPrompt } from './DramaSatisfactionPrompt'
import { DramaStyleGrid } from './DramaStyleGrid'
import { DramaStoryboardPlanCard } from './DramaStoryboardPlanCard'

type Props = {
  payload: DramaAskUserPayload
  disabled?: boolean
  onPick: (option: string) => void
}

/** 默认参数选项（对齐截图文案） */
export const DRAMA_PARAM_OPTIONS = {
  length: ['短视频 <1min', '长视频 >=1min'],
  aspect: ['横版 16:9', '竖版 9:16'],
  language: ['英文', '中文', '日文'],
}

/** 默认情绪关键词 */
export const DRAMA_KEYWORD_OPTIONS = ['穿越', '探索', '未知', '秘密', '青春', '随机']

/**
 * 短剧 ask_user 卡片：参数 / 关键词 / 满意度 / 通用。
 */
export function DramaAskUserCard({ payload, disabled, onPick }: Props) {
  const kind = payload.kind ?? inferKind(payload)

  if (kind === 'keywords') {
    return (
      <DramaKeywordGrid
        options={payload.options.length ? payload.options : DRAMA_KEYWORD_OPTIONS}
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'satisfaction') {
    const title = payload.question || '剧本信息已完成！您满意吗？'
    if (payload.options.length >= 2) {
      return (
        <div className="drama-satisfaction">
          <p className="drama-satisfaction__title">{title}</p>
          {payload.options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              className={`drama-satisfaction__btn${idx === 0 ? ' drama-satisfaction__btn--primary' : ''}`}
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <DramaSatisfactionPrompt
        title={title}
        primaryLabel="满意，请继续角色设计"
        secondaryLabel="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'character_satisfaction') {
    const title = payload.question || '角色概念图已生成，请确认是否满意。'
    if (payload.options.length >= 2) {
      return (
        <div className="drama-satisfaction">
          <p className="drama-satisfaction__title">{title}</p>
          {payload.options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              className={`drama-satisfaction__btn${idx === 0 ? ' drama-satisfaction__btn--primary' : ''}`}
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <DramaSatisfactionPrompt
        title={title}
        primaryLabel="满意，请继续场景设计"
        secondaryLabel="需要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'scene_main_satisfaction') {
    const title = payload.question || '场景主图已生成，请确认是否满意？'
    if (payload.options.length >= 2) {
      return (
        <div className="drama-satisfaction">
          <p className="drama-satisfaction__title">{title}</p>
          {payload.options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              className={`drama-satisfaction__btn${idx === 0 ? ' drama-satisfaction__btn--primary' : ''}`}
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <DramaSatisfactionPrompt
        title={title}
        primaryLabel="满意，请继续生成场景多视图"
        secondaryLabel="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'scene_multiview_satisfaction') {
    const title = payload.question || '场景多视图已生成，请确认是否满意？'
    if (payload.options.length >= 2) {
      return (
        <div className="drama-satisfaction">
          <p className="drama-satisfaction__title">{title}</p>
          {payload.options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              className={`drama-satisfaction__btn${idx === 0 ? ' drama-satisfaction__btn--primary' : ''}`}
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <DramaSatisfactionPrompt
        title={title}
        primaryLabel="满意，请继续分镜设计"
        secondaryLabel="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'storyboard_plan') {
    return <DramaStoryboardPlanCard disabled={disabled} onConfirm={onPick} />
  }

  if (kind === 'storyboard_image_satisfaction') {
    return (
      <SatisfactionOptions
        title={payload.question || '分镜图已生成！您满意吗？'}
        options={payload.options}
        fallbackPrimary="满意，请继续生成分镜视频提示词"
        fallbackSecondary="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'storyboard_video_prompt_satisfaction') {
    return (
      <SatisfactionOptions
        title={payload.question || '分镜视频提示词已生成！您满意吗？'}
        options={payload.options}
        fallbackPrimary="满意，请先生成1个分镜视频"
        fallbackSecondary="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'storyboard_video_satisfaction') {
    return (
      <SatisfactionOptions
        title={payload.question || '分镜视频已生成！您满意吗？'}
        options={payload.options}
        fallbackPrimary="满意，完成分镜阶段"
        fallbackSecondary="我要修改"
        disabled={disabled}
        onPick={onPick}
      />
    )
  }

  if (kind === 'visual_style') {
    return <DramaStyleGrid disabled={disabled} variant="character" onPick={onPick} />
  }

  if (kind === 'scene_style') {
    return <DramaStyleGrid disabled={disabled} variant="scene" onPick={onPick} />
  }

  if (kind === 'params') {
    return <DramaParamsCard disabled={disabled} onConfirm={onPick} />
  }

  if (kind === 'stage_gen_choice' || kind === 'image_gen_mode') {
    return (
      <div className="drama-agent-ask-card drama-agent-ask-card--stage-wf">
        {payload.question ? <p className="drama-agent-ask-card__title">{payload.question}</p> : null}
        <div className="drama-agent-ask-card__options drama-agent-ask-card__options--stack">
          {payload.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="drama-agent-ask-chip drama-agent-ask-chip--wf"
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="drama-agent-ask-card">
      {payload.question ? <p className="drama-agent-ask-card__title">{payload.question}</p> : null}
      <div className="drama-agent-ask-card__options">
        {payload.options.map((opt) => (
          <button
            key={opt}
            type="button"
            className="drama-agent-ask-chip"
            disabled={disabled}
            onClick={() => onPick(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function inferKind(payload: DramaAskUserPayload) {
  if (payload.kind) return payload.kind
  if (/满意.*分镜图|分镜视频提示词|分镜视频|完成分镜/.test(payload.question)) {
    if (/视频提示词/.test(payload.question)) return 'storyboard_video_prompt_satisfaction'
    if (/分镜视频|完成分镜|剩余/.test(payload.question)) return 'storyboard_video_satisfaction'
    if (/分镜图/.test(payload.question)) return 'storyboard_image_satisfaction'
  }
  if (/满意|修改|继续角色|继续场景|概念图|多视图|分镜设计/.test(payload.question)) {
    if (/多视图/.test(payload.question)) return 'scene_main_satisfaction'
    if (/分镜/.test(payload.question)) return 'scene_multiview_satisfaction'
    if (/场景主图/.test(payload.question)) return 'scene_main_satisfaction'
    if (/角色|概念图/.test(payload.question)) return 'character_satisfaction'
    return 'satisfaction'
  }
  if (/分镜方案/.test(payload.question)) return 'storyboard_plan'
  if (/场景.*风格|风格推荐/.test(payload.question)) return 'scene_style'
  if (/风格|style/i.test(payload.question)) return 'visual_style'
  if (/关键词|情绪/.test(payload.question)) return 'keywords'
  if (/出图方式|生成方式|ComfyUI 本地|云端.*(image|Image|模型)/.test(payload.question)) return 'image_gen_mode'
  if (/参数|长度|比例|语言/.test(payload.question)) return 'params'
  return 'generic'
}

function DramaParamsCard({ disabled, onConfirm }: { disabled?: boolean; onConfirm: (msg: string) => void }) {
  const [length, setLength] = useState(DRAMA_PARAM_OPTIONS.length[0]!)
  const [aspect, setAspect] = useState(DRAMA_PARAM_OPTIONS.aspect[1]!)
  const [language, setLanguage] = useState(DRAMA_PARAM_OPTIONS.language[1]!)

  const summary = useMemo(
    () => `【用户选择】确认参数：${length} · ${aspect} · ${language}`,
    [length, aspect, language],
  )

  return (
    <div className="drama-agent-ask-card drama-agent-ask-card--params">
      <ParamRow label="影片长度" options={DRAMA_PARAM_OPTIONS.length} value={length} onChange={setLength} disabled={disabled} />
      <ParamRow label="影片比例" options={DRAMA_PARAM_OPTIONS.aspect} value={aspect} onChange={setAspect} disabled={disabled} aspect />
      <ParamRow label="对白语言" options={DRAMA_PARAM_OPTIONS.language} value={language} onChange={setLanguage} disabled={disabled} />
      <button
        type="button"
        className="drama-agent-ask-card__confirm"
        disabled={disabled}
        onClick={() => onConfirm(summary)}
      >
        确认并继续
      </button>
    </div>
  )
}

function ParamRow({
  label,
  options,
  value,
  onChange,
  disabled,
  aspect,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  aspect?: boolean
}) {
  return (
    <div className="drama-agent-ask-card__group">
      <span className="drama-agent-ask-card__group-label">{label}</span>
      <div className="drama-agent-ask-card__group-btns">
        {options.map((opt) => {
          const active = opt === value
          return (
            <button
              key={opt}
              type="button"
              className={`drama-agent-param-btn${active ? ' is-active' : ''}${aspect ? ' drama-agent-param-btn--aspect' : ''}`}
              disabled={disabled}
              onClick={() => onChange(opt)}
            >
              {aspect ? <span className="drama-agent-param-btn__icon" aria-hidden /> : null}
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 通用满意度多选项（LLM ask_user 驱动） */
function SatisfactionOptions({
  title,
  options,
  fallbackPrimary,
  fallbackSecondary,
  disabled,
  onPick,
}: {
  title: string
  options: string[]
  fallbackPrimary: string
  fallbackSecondary: string
  disabled?: boolean
  onPick: (opt: string) => void
}) {
  const list = options.length >= 2 ? options : [fallbackPrimary, fallbackSecondary]
  return (
    <div className="drama-satisfaction">
      <p className="drama-satisfaction__title">{title}</p>
      {list.map((opt, idx) => (
        <button
          key={opt}
          type="button"
          className={`drama-satisfaction__btn${idx === 0 ? ' drama-satisfaction__btn--primary' : ''}`}
          disabled={disabled}
          onClick={() => onPick(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
