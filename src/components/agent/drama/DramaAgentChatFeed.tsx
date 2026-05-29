import { useMemo, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { DramaAskUserPayload } from '../../../lib/dramaProduction/dramaAskUserBridge'
import type { DramaChatHandoverEvent } from '../../../lib/dramaProduction/dramaChatEventsBridge'
import type { DramaChatStep } from '../../../lib/dramaProduction/dramaChatStepsBridge'
import type { DramaProductionState } from '../../../lib/dramaProduction/types'
import { DramaAgentPersonaBlock } from './DramaAgentPersonaBlock'
import { DramaAskUserCard } from './DramaAskUserCard'
import { DramaHandoverLine } from './DramaHandoverLine'
import { DramaScriptSynopsisCard } from './DramaScriptSynopsisCard'
import type { DramaUiState } from '../../../lib/dramaProduction/dramaUiBridge'
import { dramaHasUserTheme } from '../../../lib/dramaProduction/dramaChatSessionStorage'
import { DramaGenProgressCard } from './DramaGenProgressCard'
import { DramaWorkingPill } from './DramaWorkingPill'
import { DramaSceneStyleRecommendCard } from './DramaSceneStyleRecommendCard'
import { DramaScenePreviewCard } from './DramaScenePreviewCard'
import { DramaStoryboardPreviewCard } from './DramaStoryboardPreviewCard'
import { DramaStoryboardVideoPreviewCard } from './DramaStoryboardVideoPreviewCard'

export type DramaFeedMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts?: number
}

type Props = {
  messages: DramaFeedMessage[]
  steps: DramaChatStep[]
  events: DramaChatHandoverEvent[]
  state: DramaProductionState | null
  uiState?: DramaUiState | null
  sending?: boolean
  askUser?: DramaAskUserPayload | null
  askUserDisabled?: boolean
  onAskUserPick?: (option: string) => void
}


/**
 * 短剧 Agent 聊天 feed：按图一至图十一节点类型渲染。
 */
export function DramaAgentChatFeed({
  messages,
  steps,
  events,
  state,
  uiState,
  sending,
  askUser,
  askUserDisabled,
  onAskUserPick,
}: Props) {
  const hasUserTheme = dramaHasUserTheme(
    messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.ts ?? 0 })),
  )

  const feedMessages = hasUserTheme ? messages : []

  const characterNames = state?.characters?.map((c) => c.name).filter(Boolean).join('、') || '角色'
  const sceneName = state?.locations?.[0]?.name || '场景'
  const sceneMainSrc = state?.locations?.[0]?.mainImageSrc
  const sceneMultiSrcs = state?.locations?.[0]?.multiViewSrcs

  const { blocks, remainingSteps } = useMemo(
    () => buildFeedLayout(feedMessages, steps, events, state),
    [feedMessages, steps, events, state],
  )

  return (
    <div className="drama-agent-feed" data-drama-chat-selectable="1">
      {blocks}

      {askUser && onAskUserPick ? (
        <div className="drama-agent-feed__ask">
          <DramaAskUserCard payload={askUser} disabled={askUserDisabled} onPick={onAskUserPick} />
        </div>
      ) : null}

      {remainingSteps.length ? (
        <div className="drama-agent-feed__steps">
          {remainingSteps.map((s) => (
            <StepStatusBar key={s.id} label={s.label} />
          ))}
        </div>
      ) : null}

      {uiState?.characterGen.running ? (
        <DramaGenProgressCard
          gen={uiState.characterGen}
          variant="character"
          thinking={sending}
          thinkingText={`正在为您生成「${characterNames}」的角色主图。`}
        />
      ) : null}

      {uiState?.selectedSceneStyle && uiState.canvasFocus === 'scene' && !uiState.sceneGen.mainImageReady ? (
        <DramaSceneStyleRecommendCard styleLabel={uiState.selectedSceneStyle} />
      ) : null}

      {uiState?.sceneGen.running ? (
        <DramaGenProgressCard
          gen={uiState.sceneGen}
          variant="scene"
          thinking={sending}
          thinkingText={
            uiState.sceneGen.phase === 'multiview'
              ? `正在为场景「${sceneName}」生成多视角图。`
              : `正在为场景「${sceneName}」生成场景主图。`
          }
        />
      ) : null}

      {(uiState?.sceneGen.mainImageReady || sceneMainSrc) && uiState?.canvasFocus !== 'storyboard' ? (
        <DramaScenePreviewCard
          title={sceneName}
          showMultiview={uiState?.sceneGen.multiViewReady || (sceneMultiSrcs?.length ?? 0) >= 4}
          mainImageSrc={sceneMainSrc}
          multiViewSrcs={sceneMultiSrcs}
        />
      ) : null}

      {uiState?.storyboardGen.running && uiState.storyboardGen.phase === 'images' ? (
        <DramaGenProgressCard
          gen={uiState.storyboardGen}
          variant="storyboard"
          thinking={sending}
          thinkingText={`正在为您生成分镜 ${state?.shots?.map((s) => s.index).join('、') || '1、2、3'} 的图像。`}
        />
      ) : null}

      {uiState?.storyboardGen.running && uiState.storyboardGen.phase === 'videos' ? (
        <DramaGenProgressCard
          gen={uiState.storyboardGen}
          variant="storyboard-video"
          thinking={sending}
          thinkingText={`正在为您生成分镜 ${state?.shots?.map((s) => s.index).join('、') || '1、2、3'} 的视频。`}
        />
      ) : null}

      {(uiState?.storyboardGen.imagesReady || state?.shots?.some((s) => s.imageSrcs?.length)) &&
      uiState?.canvasFocus === 'storyboard' ? (
        <DramaStoryboardPreviewCard shots={state?.shots ?? []} />
      ) : null}

      {(uiState?.storyboardGen.videosReady || state?.shots?.some((s) => s.videoSrc?.trim())) ? (
        <DramaStoryboardVideoPreviewCard shots={state?.shots ?? []} />
      ) : null}

      {sending &&
      !uiState?.characterGen.running &&
      !uiState?.sceneGen.running &&
      !uiState?.storyboardGen.running ? (
        <DramaWorkingPill />
      ) : null}
    </div>
  )
}

function buildFeedLayout(
  messages: DramaFeedMessage[],
  steps: DramaChatStep[],
  events: DramaChatHandoverEvent[],
  state: DramaProductionState | null,
): { blocks: ReactNode[]; remainingSteps: DramaChatStep[] } {
  const blocks: ReactNode[] = []
  let eventIdx = 0
  let lastPersonaId: string | null = null
  let synopsisShown = false
  const seenStepLabels = new Set<string>()

  messages.forEach((msg, msgIdx) => {
    if (msg.role === 'user') {
      const raw = msg.content
      const isChoice = /【用户选择】/.test(raw)
      const userText = raw.replace(/^【用户选择】/, '').replace(/^确认参数：/, '确认参数 · ').trim()

      if (!isChoice) {
        blocks.push(<UserPromptBubble key={msg.id} text={userText} />)
      } else if (/确认参数/.test(raw)) {
        blocks.push(<ConfirmedPill key={`ok-${msg.id}`} />)
      } else if (/满意/.test(raw)) {
        blocks.push(<UserPromptBubble key={msg.id} text={userText} />)
      } else if (!/满意|修改|确认参数/.test(raw)) {
        blocks.push(<UserPromptBubble key={msg.id} text={userText} />)
      }

      while (eventIdx < events.length && msg.ts != null && events[eventIdx]!.ts <= msg.ts + 500) {
        const ev = events[eventIdx]!
        blocks.push(<DramaHandoverLine key={ev.id} from={ev.from} to={ev.to} />)
        eventIdx += 1
      }
      return
    }

    const persona = detectPersona(msg.content)
    if (persona) {
      if (persona.id !== lastPersonaId) {
        blocks.push(
          <DramaAgentPersonaBlock
            key={`persona-${msg.id}`}
            personaId={persona.id}
            status={persona.status}
            body={persona.body}
            collapsible
            showMascot={persona.showMascot}
          />,
        )
        lastPersonaId = persona.id
      }
    } else if (msg.content.length >= 60) {
      blocks.push(<ThinkingBlock key={`think-${msg.id}`} text={msg.content} defaultOpen={msgIdx === messages.length - 1} />)
    }

    if (state?.scriptBody && !synopsisShown && /剧本|梗概/.test(msg.content)) {
      blocks.push(
        <DramaScriptSynopsisCard
          key="synopsis-once"
          synopsis={state.scriptBody}
          hasScriptBody={state.scriptBody.length > 80}
        />,
      )
      synopsisShown = true
    }

    if (!persona && msg.content.length < 200) {
      blocks.push(<AssistantBody key={msg.id} text={msg.content} />)
    }

    while (eventIdx < events.length) {
      const ev = events[eventIdx]!
      blocks.push(<DramaHandoverLine key={ev.id} from={ev.from} to={ev.to} />)
      eventIdx += 1
    }
  })

  if (state?.scriptBody && !synopsisShown && state.scriptBody.trim().length >= 40) {
    blocks.push(
      <DramaScriptSynopsisCard
        key="synopsis-once"
        synopsis={state.scriptBody}
        hasScriptBody={state.scriptBody.length > 80}
      />,
    )
  }

  const uniqueSteps = steps.filter((s) => {
    if (seenStepLabels.has(s.label)) return false
    seenStepLabels.add(s.label)
    return true
  })

  return { blocks, remainingSteps: uniqueSteps }
}

function detectPersona(
  text: string,
): { id: 'art_director' | 'screenwriter' | 'character_designer' | 'scene_designer' | 'storyboard_designer'; status: 'planning' | 'done' | 'working'; body: string; showMascot?: boolean } | null {
  const bracket = text.match(/^【(艺术总监|编剧|角色设计师|场景设计师|分镜师)】\s*\n?([\s\S]*)/)
  if (bracket) {
    const name = bracket[1]!
    const body = bracket[2]?.trim() || text
    const idMap: Record<string, 'art_director' | 'screenwriter' | 'character_designer' | 'scene_designer' | 'storyboard_designer'> = {
      艺术总监: 'art_director',
      编剧: 'screenwriter',
      角色设计师: 'character_designer',
      场景设计师: 'scene_designer',
      分镜师: 'storyboard_designer',
    }
    const id = idMap[name] ?? 'art_director'
    return {
      id,
      status: /规划完成|已完成|主图已成功|多视角/.test(body) ? 'done' : 'planning',
      body,
    }
  }
  if (/^【分镜师】|分镜方案|分镜表|storyboard_plan|宫格图|多图参考|Sora|Seedance/.test(text)) {
    return { id: 'storyboard_designer', status: /规划完成/.test(text) ? 'done' : 'planning', body: text }
  }
  if (/场景设计|寻找灵感|异世界.*教室|generate_image|场景主图|多视角/.test(text)) {
    return {
      id: 'scene_designer',
      status: /规划完成|主图已成功|多视角图/.test(text) ? 'done' : 'planning',
      body: text,
    }
  }
  if (/角色设计|调配颜料|角色提取|Kine-Graphic|rariatto/.test(text)) {
    return {
      id: 'character_designer',
      status: 'planning',
      body: text,
    }
  }
  if (/编剧|剧本|场景\d|写剧本/.test(text)) {
    return {
      id: 'screenwriter',
      status: /规划完成/.test(text) ? 'done' : 'planning',
      body: text,
      showMascot: /规划完成/.test(text),
    }
  }
  if (/艺术总监|规划完成|前期规划|情绪关键词/.test(text)) {
    return {
      id: 'art_director',
      status: 'done',
      body: text,
    }
  }
  return null
}

function UserPromptBubble({ text }: { text: string }) {
  return (
    <div className="drama-agent-node drama-agent-node--user">
      <p>{text}</p>
    </div>
  )
}

function ConfirmedPill() {
  return <div className="drama-agent-node drama-agent-node--confirmed">信息已确认</div>
}

function StepStatusBar({ label }: { label: string }) {
  return (
    <div className="drama-agent-node drama-agent-node--step">
      <Check size={14} strokeWidth={2.5} aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function ThinkingBlock({ text, defaultOpen }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const summary = text.split('\n').find((l) => l.trim().length > 20)?.trim() ?? text.slice(0, 200)

  return (
    <div className="drama-agent-node drama-agent-node--thinking">
      <button type="button" className="drama-agent-node--thinking__head" onClick={() => setOpen((v) => !v)}>
        <Bot size={16} className="drama-agent-feed__thinking-icon" aria-hidden />
        <span>思考完成</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open ? <div className="drama-agent-node--thinking__body">{summary}</div> : null}
    </div>
  )
}

function AssistantBody({ text }: { text: string }) {
  const cleaned = text.replace(/^·\s.+$/gm, '').trim()
  if (!cleaned) return null
  return (
    <div className="drama-agent-node drama-agent-node--assistant">
      <div className="drama-agent-node--assistant__md aw-markdown">
        <ReactMarkdown>{cleaned}</ReactMarkdown>
      </div>
    </div>
  )
}
