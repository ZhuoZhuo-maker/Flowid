import type { Dispatch, SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { CloudImageAspectKey, StudioNodeData } from '../../types'
import { STUDIO_FLOW_SOURCE_HANDLE_ID, STUDIO_FLOW_TARGET_HANDLE_ID } from '../studioFlowHandles'
import { attachVideoTargetHandleForEdge } from '../videoNodeInports'
import { createStudioNode } from '../nodeFactory'
import type { DramaCharacter, DramaLocation, DramaProductionState, DramaShot } from './types'
import {
  ensureDramaProductionState,
  loadDramaProductionState,
  patchDramaProductionState,
} from './dramaStateStore'
import { advanceDramaPhase, DRAMA_PHASE_LABELS } from './dramaPhases'
import { setDramaAskUserPending } from './dramaAskUserBridge'
import {
  formatSpecForConceptNode,
  formatShotsForStoryboardNode,
  syncDramaStateToCanvasNodes,
} from './dramaWorkspaceSync'
import { dramaToolStepLabel, pushDramaChatStep } from './dramaChatStepsBridge'
import './dramaAutoPipeline'
import {
  dramaImageGenToolToPipelineTrigger,
  ensureDramaImageGenModeOrPrompt,
} from './dramaImageGenModeChoice'
import {
  inferDramaPipelineTriggerFromState,
  isDramaStageGenChoiceAsk,
  rememberDramaStageGenAsk,
} from './dramaStageGenChoice'
import { dramaTriggerToGenStage } from './dramaGenStages'
import { registerDramaPipelineDeps, scheduleDramaAutoPipeline } from './dramaAutoPipeline'
import {
  applyDramaExpertHandover,
  parseDramaExpertId,
  syncDramaExpertAfterPhaseChange,
} from './dramaOrchestrator'
import {
  runDramaCharacterImageGeneration,
  runDramaSceneImageGeneration,
  type DramaImageRunDeps,
} from './dramaImageGeneration'
import {
  runDramaStoryboardImageGeneration,
  runDramaStoryboardVideoGeneration,
  type DramaStoryboardRunDeps,
} from './dramaStoryboardGeneration'

import type { DramaProductionPhase } from './types'

/** 工具执行成功后写入聊天步骤条 */
function emitDramaStep(deps: DramaToolHandlerDeps, toolName: string): void {
  const label = dramaToolStepLabel(toolName)
  if (label) pushDramaChatStep(deps.getProjectTabId(), label)
}

export type DramaToolHandlerDeps = {
  getProjectTabId: () => string
  getNodes: () => Node<StudioNodeData>[]
  setNodes: Dispatch<SetStateAction<Node<StudioNodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  updateNodeData: (id: string, patch: Partial<StudioNodeData>) => void
  findNodeByTitleKeyword: (keyword: string) => Node<StudioNodeData> | null
  appendHistory: (label: string) => void
  /** 执行 image 节点（由 StudioApp 注入） */
  runImageNodes?: (nodeIds: string[]) => Promise<void>
  /** 执行 video 节点（由 StudioApp 注入） */
  runVideoNodes?: (nodeIds: string[]) => Promise<void>
}

function asImageRunDeps(deps: DramaToolHandlerDeps): DramaImageRunDeps | null {
  if (!deps.runImageNodes) return null
  return deps as DramaImageRunDeps
}

function asStoryboardRunDeps(deps: DramaToolHandlerDeps): DramaStoryboardRunDeps | null {
  if (!deps.runImageNodes || !deps.runVideoNodes) return null
  return deps as DramaStoryboardRunDeps
}

function parseJsonArray<T>(raw: string, label: string): T[] | { error: string } {
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return { error: `${label} 必须是 JSON 数组` }
    return arr as T[]
  } catch {
    return { error: `${label} JSON 解析失败` }
  }
}

function formatStoryboardText(state: DramaProductionState): string {
  return formatShotsForStoryboardNode(state.shots)
}

function formatConceptText(state: DramaProductionState): string {
  return formatSpecForConceptNode(state)
}

function syncCanvas(deps: DramaToolHandlerDeps, state: DramaProductionState): void {
  syncDramaStateToCanvasNodes(state, {
    projectTabId: deps.getProjectTabId(),
    getNodes: deps.getNodes,
    updateNodeData: deps.updateNodeData,
  })
}


function normalizeAspect(raw: string | undefined): CloudImageAspectKey {
  const allowed: CloudImageAspectKey[] = [
    'auto',
    '1:1',
    '16:9',
    '9:16',
    '4:5',
    '3:2',
    '2:3',
    '4:3',
    '3:4',
    '21:9',
  ]
  if (raw && allowed.includes(raw as CloudImageAspectKey)) return raw as CloudImageAspectKey
  return '9:16'
}

/**
 * 执行短剧制片专用 Agent 工具。
 */
export async function handleDramaAgentTool(
  name: string,
  args: Record<string, unknown>,
  deps: DramaToolHandlerDeps,
): Promise<string | null> {
  const tabId = deps.getProjectTabId()
  if (!tabId) return JSON.stringify({ ok: false, error: '无活动项目标签' })

  if (deps.runImageNodes) {
    registerDramaPipelineDeps(deps as import('./dramaAutoPipeline').DramaPipelineDeps)
  }

  if (name === 'flowid_drama_generate_character_images') {
    const resume = dramaImageGenToolToPipelineTrigger(name)
    if (resume && ensureDramaImageGenModeOrPrompt(tabId, resume)) {
      return JSON.stringify({ ok: true, awaiting_user: true, message: '已询问用户出图方式' })
    }
    const imgDeps = asImageRunDeps(deps)
    if (!imgDeps) {
      return JSON.stringify({ ok: false, error: '出图执行器未就绪，请在工作区内重试' })
    }
    const styleHint = typeof args.visual_style === 'string' ? args.visual_style : undefined
    const out = await runDramaCharacterImageGeneration(imgDeps, styleHint)
    emitDramaStep(deps, name)
    return JSON.stringify(out)
  }

  if (name === 'flowid_drama_generate_scene_images') {
    const resume = dramaImageGenToolToPipelineTrigger(name)
    if (resume && ensureDramaImageGenModeOrPrompt(tabId, resume)) {
      return JSON.stringify({ ok: true, awaiting_user: true, message: '已询问用户出图方式' })
    }
    const imgDeps = asImageRunDeps(deps)
    if (!imgDeps) {
      return JSON.stringify({ ok: false, error: '出图执行器未就绪，请在工作区内重试' })
    }
    const phase = args.phase === 'multiview' ? 'multiview' : 'main'
    const locationId = typeof args.location_id === 'string' ? args.location_id : undefined
    const out = await runDramaSceneImageGeneration(imgDeps, phase, locationId)
    emitDramaStep(deps, name)
    return JSON.stringify(out)
  }

  if (name === 'flowid_drama_generate_storyboard_images') {
    const resume = dramaImageGenToolToPipelineTrigger(name)
    if (resume && ensureDramaImageGenModeOrPrompt(tabId, resume)) {
      return JSON.stringify({ ok: true, awaiting_user: true, message: '已询问用户出图方式' })
    }
    const sbDeps = asStoryboardRunDeps(deps)
    if (!sbDeps) {
      return JSON.stringify({ ok: false, error: '分镜出图执行器未就绪，请在工作区内重试' })
    }
    const out = await runDramaStoryboardImageGeneration(sbDeps)
    emitDramaStep(deps, name)
    return JSON.stringify(out)
  }

  if (name === 'flowid_drama_generate_storyboard_videos') {
    const sbDeps = asStoryboardRunDeps(deps)
    if (!sbDeps) {
      return JSON.stringify({ ok: false, error: '分镜视频执行器未就绪，请在工作区内重试' })
    }
    const limit =
      typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : undefined
    const out = await runDramaStoryboardVideoGeneration(sbDeps, limit)
    emitDramaStep(deps, name)
    return JSON.stringify(out)
  }

  if (name === 'flowid_drama_ask_user') {
    const question = String(args.question ?? '').trim()
    const options = Array.isArray(args.options)
      ? args.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 12)
      : []
    if (!question || options.length < 2) {
      return JSON.stringify({ ok: false, error: 'question 与至少 2 个 options 必填' })
    }
    const stageGenAsk = isDramaStageGenChoiceAsk(question, options)
    if (stageGenAsk) {
      const trigger = inferDramaPipelineTriggerFromState(tabId)
      rememberDramaStageGenAsk(tabId, dramaTriggerToGenStage(trigger), trigger)
    }
    setDramaAskUserPending({
      question,
      options,
      expertRole: typeof args.expert_role === 'string' ? args.expert_role : undefined,
      kind: stageGenAsk
        ? 'stage_gen_choice'
        : /关键词|情绪/.test(question)
        ? 'keywords'
        : /满意.*分镜视频|完成分镜阶段|剩余分镜视频/.test(question)
          ? 'storyboard_video_satisfaction'
          : /满意.*视频提示词|先生成1个分镜视频|生成全部分镜视频/.test(question)
            ? 'storyboard_video_prompt_satisfaction'
            : /满意.*分镜视频提示词|继续生成分镜视频提示词/.test(question)
              ? 'storyboard_image_satisfaction'
              : /满意.*多视图|继续生成场景多视图/.test(question)
                ? 'scene_main_satisfaction'
                : /满意.*分镜|继续分镜设计/.test(question)
                  ? 'scene_multiview_satisfaction'
                  : /满意.*场景设计|继续场景设计/.test(question)
                    ? 'character_satisfaction'
                    : /满意|修改|继续角色/.test(question)
                      ? 'satisfaction'
                      : /参数|长度|比例|语言/.test(question)
                        ? 'params'
                        : /分镜方案|Sora|Seedance|宫格|多图参考/.test(question)
                          ? 'storyboard_plan'
                          : /风格|style/i.test(question)
                            ? /场景/.test(question)
                              ? 'scene_style'
                              : 'visual_style'
                            : 'generic',
    })
    const roleRaw = typeof args.expert_role === 'string' ? args.expert_role : ''
    const expert = parseDramaExpertId(roleRaw)
    if (expert) applyDramaExpertHandover(tabId, expert)
    return JSON.stringify({ ok: true, awaiting_user: true, question, options })
  }

  if (name === 'flowid_drama_get_state') {
    const state = ensureDramaProductionState(tabId)
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, state })
  }

  if (name === 'flowid_drama_set_spec') {
    const cur = ensureDramaProductionState(tabId)
    const aspectRaw = String(args.aspect ?? cur.spec.aspect)
    const aspect = aspectRaw === 'custom' ? '9:16' : normalizeAspect(aspectRaw)
    const nextSpec = {
      ...cur.spec,
      concept: typeof args.concept === 'string' ? args.concept : cur.spec.concept,
      targetPlatform:
        typeof args.target_platform === 'string' ? args.target_platform : cur.spec.targetPlatform,
      visualStyle: typeof args.visual_style === 'string' ? args.visual_style : cur.spec.visualStyle,
      aspect,
      customWidth:
        typeof args.custom_width === 'number' ? args.custom_width : cur.spec.customWidth,
      customHeight:
        typeof args.custom_height === 'number' ? args.custom_height : cur.spec.customHeight,
      shotCount:
        typeof args.shot_count === 'number' && args.shot_count > 0
          ? Math.min(60, Math.floor(args.shot_count))
          : cur.spec.shotCount,
      toneNotes: typeof args.tone_notes === 'string' ? args.tone_notes : cur.spec.toneNotes,
      storyboardPlan:
        args.storyboard_plan === 'grid' || args.storyboard_plan === 'multi-ref'
          ? args.storyboard_plan
          : cur.spec.storyboardPlan,
      videoModel: typeof args.video_model === 'string' ? args.video_model : cur.spec.videoModel,
      videoTier:
        args.video_tier === 'pro' || args.video_tier === 'fast' ? args.video_tier : cur.spec.videoTier,
      videoResolution:
        args.video_resolution === '720p' || args.video_resolution === '480p'
          ? args.video_resolution
          : cur.spec.videoResolution,
    }
    const next = patchDramaProductionState(tabId, { spec: nextSpec })
    syncCanvas(deps, next)
    deps.appendHistory('短剧 Agent：已更新制作参数')
    emitDramaStep(deps, name)
    /** 参数齐备后自动进入剧本阶段并邀请编剧 */
    if (
      cur.phase === 'intake' &&
      nextSpec.concept.trim() &&
      nextSpec.targetPlatform.trim() &&
      nextSpec.visualStyle.trim()
    ) {
      const advanced = patchDramaProductionState(tabId, {
        phase: 'script_draft',
        activeExpertId: undefined,
      })
      syncDramaExpertAfterPhaseChange(tabId, next, advanced)
      applyDramaExpertHandover(tabId, 'screenwriter')
      return JSON.stringify({
        ok: true,
        spec: nextSpec,
        phase: 'script_draft',
        invited_expert: 'screenwriter',
      })
    }
    return JSON.stringify({ ok: true, spec: next.spec })
  }

  if (name === 'flowid_drama_set_script') {
    const body = String(args.body ?? '')
    if (!body.trim()) return JSON.stringify({ ok: false, error: 'body 不能为空' })
    const next = patchDramaProductionState(tabId, { scriptBody: body })
    syncCanvas(deps, next)
    deps.appendHistory('短剧 Agent：已写入剧本')
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, length: body.length })
  }

  if (name === 'flowid_drama_set_characters') {
    const parsed = parseJsonArray<Record<string, unknown>>(
      String(args.characters_json ?? '[]'),
      'characters',
    )
    if ('error' in parsed) return JSON.stringify({ ok: false, error: parsed.error })
    const characters: DramaCharacter[] = parsed.map((c, i) => ({
      id: String(c.id ?? `char-${i + 1}`),
      name: String(c.name ?? `角色${i + 1}`),
      personality: String(c.personality ?? ''),
      appearance: String(c.appearance ?? ''),
      background: String(c.background ?? ''),
    }))
    patchDramaProductionState(tabId, { characters })
    deps.appendHistory(`短剧 Agent：已设定 ${characters.length} 个角色`)
    emitDramaStep(deps, name)
    scheduleDramaAutoPipeline(tabId, 'characters_written')
    return JSON.stringify({ ok: true, count: characters.length })
  }

  if (name === 'flowid_drama_set_locations') {
    const parsed = parseJsonArray<Record<string, unknown>>(
      String(args.locations_json ?? '[]'),
      'locations',
    )
    if ('error' in parsed) return JSON.stringify({ ok: false, error: parsed.error })
    const locations: DramaLocation[] = parsed.map((c, i) => ({
      id: String(c.id ?? `loc-${i + 1}`),
      name: String(c.name ?? `场景${i + 1}`),
      description: String(c.description ?? ''),
      visualStyle: String(c.visualStyle ?? c.visual_style ?? ''),
      props: Array.isArray(c.props) ? c.props.map(String) : [],
    }))
    patchDramaProductionState(tabId, { locations })
    deps.appendHistory(`短剧 Agent：已设定 ${locations.length} 个场景`)
    emitDramaStep(deps, name)
    scheduleDramaAutoPipeline(tabId, 'locations_written')
    return JSON.stringify({ ok: true, count: locations.length })
  }

  if (name === 'flowid_drama_set_review') {
    const review = {
      compliance: String(args.compliance ?? ''),
      plotRhythm: String(args.plot_rhythm ?? ''),
      passed: args.passed === true,
    }
    patchDramaProductionState(tabId, { review })
    deps.appendHistory(`短剧 Agent：合规审核 ${review.passed ? '通过' : '待改'}`)
    return JSON.stringify({ ok: true, review })
  }

  if (name === 'flowid_drama_set_shots') {
    const parsed = parseJsonArray<Record<string, unknown>>(String(args.shots_json ?? '[]'), 'shots')
    if ('error' in parsed) return JSON.stringify({ ok: false, error: parsed.error })
    const shots: DramaShot[] = parsed.map((s, i) => ({
      index: typeof s.index === 'number' ? s.index : i + 1,
      title: String(s.title ?? `镜头${i + 1}`),
      scene: String(s.scene ?? ''),
      shotType: String(s.shotType ?? s.shot_type ?? '中景'),
      action: String(s.action ?? ''),
      dialogue: String(s.dialogue ?? ''),
      imagePrompt: String(s.imagePrompt ?? s.image_prompt ?? ''),
      videoPrompt: String(s.videoPrompt ?? s.video_prompt ?? s.action ?? ''),
      audioPrompt: String(s.audioPrompt ?? s.audio_prompt ?? ''),
      characterIds: Array.isArray(s.characterIds) ? s.characterIds.map(String) : [],
      locationId: String(s.locationId ?? s.location_id ?? ''),
      imageSrcs: Array.isArray(s.imageSrcs) ? s.imageSrcs.map(String) : Array.isArray(s.image_srcs) ? s.image_srcs.map(String) : undefined,
      videoSrc: typeof s.videoSrc === 'string' ? s.videoSrc : typeof s.video_src === 'string' ? s.video_src : undefined,
    }))
    const next = patchDramaProductionState(tabId, { shots })
    syncCanvas(deps, next)
    deps.appendHistory(`短剧 Agent：已写入 ${shots.length} 条分镜`)
    emitDramaStep(deps, name)
    scheduleDramaAutoPipeline(tabId, 'shots_written')
    return JSON.stringify({ ok: true, count: shots.length })
  }

  if (name === 'flowid_drama_sync_storyboard_node') {
    const state = ensureDramaProductionState(tabId)
    const node = deps.findNodeByTitleKeyword('分镜表')
    if (!node) return JSON.stringify({ ok: false, error: '未找到「分镜表」节点' })
    deps.updateNodeData(node.id, { kind: 'text', body: formatStoryboardText(state) })
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true })
  }

  if (name === 'flowid_drama_sync_concept_node') {
    const state = ensureDramaProductionState(tabId)
    const node = deps.findNodeByTitleKeyword('项目设定')
    if (!node) return JSON.stringify({ ok: false, error: '未找到「项目设定」节点' })
    deps.updateNodeData(node.id, { kind: 'text', body: formatConceptText(state) })
    return JSON.stringify({ ok: true })
  }

  if (name === 'flowid_drama_invite_expert') {
    const raw =
      typeof args.expert_id === 'string'
        ? args.expert_id
        : typeof args.expert_role === 'string'
          ? args.expert_role
          : ''
    const expert = parseDramaExpertId(raw)
    if (!expert) return JSON.stringify({ ok: false, error: '无效 expert_id / expert_role' })
    applyDramaExpertHandover(tabId, expert)
    deps.appendHistory(`短剧 Agent：${expert} 加入群聊`)
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, expert_id: expert })
  }

  if (name === 'flowid_drama_advance_phase') {
    const state = ensureDramaProductionState(tabId)
    const phase = advanceDramaPhase(state.phase)
    const next = patchDramaProductionState(tabId, { phase, activeExpertId: undefined })
    syncDramaExpertAfterPhaseChange(tabId, state, next)
    deps.appendHistory(`短剧 Agent：进入阶段 ${DRAMA_PHASE_LABELS[phase]}`)
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, phase: next.phase, label: DRAMA_PHASE_LABELS[phase] })
  }

  if (name === 'flowid_drama_set_phase') {
    const phase = String(args.phase ?? '') as DramaProductionPhase
    const valid: DramaProductionPhase[] = [
      'intake',
      'script_draft',
      'character_location',
      'compliance_review',
      'storyboard',
      'storyboard_images',
      'video_audio',
      'export',
      'done',
    ]
    if (!valid.includes(phase)) return JSON.stringify({ ok: false, error: '无效 phase' })
    const prev = ensureDramaProductionState(tabId)
    const expertRaw =
      typeof args.active_expert === 'string' ? parseDramaExpertId(args.active_expert) : null
    const next = patchDramaProductionState(tabId, {
      phase,
      activeExpertId: expertRaw ?? undefined,
    })
    if (!expertRaw) syncDramaExpertAfterPhaseChange(tabId, prev, { ...next, activeExpertId: undefined })
    else applyDramaExpertHandover(tabId, expertRaw)
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, phase, label: DRAMA_PHASE_LABELS[phase] })
  }

  if (name === 'flowid_drama_apply_shot_list') {
    const state = loadDramaProductionState(tabId) ?? ensureDramaProductionState(tabId)
    if (!state.shots.length) {
      return JSON.stringify({ ok: false, error: '分镜表为空，请先 flowid_drama_set_shots' })
    }
    const aspectRaw = state.spec.aspect ?? '9:16'
    const aspect: CloudImageAspectKey = aspectRaw === 'custom' ? '9:16' : aspectRaw
    const replace = args.replace_existing === true

    if (replace) {
      const removeIds = new Set(
        deps
          .getNodes()
          .filter((n) => /镜头/.test(String(n.data.title || '')))
          .map((n) => n.id),
      )
      if (removeIds.size) {
        deps.setNodes((nds) => nds.filter((n) => !removeIds.has(n.id)))
        deps.setEdges((eds) =>
          eds.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
        )
      }
    }

    const scriptNode = deps.findNodeByTitleKeyword('剧本')
    const baseX = 420
    const baseY = 420
    const colW = 480
    const rowH = 380
    const cols = 3

    const newNodes: Node<StudioNodeData>[] = []
    const newEdges: Edge[] = []

    state.shots.forEach((shot, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const imageId = crypto.randomUUID()
      const videoId = crypto.randomUUID()
      const imageTitle = `镜头${shot.index} · 分镜图`
      const videoTitle = `镜头${shot.index} · 成片`
      const x = baseX + col * colW
      const y = baseY + row * rowH

      const imageNode = createStudioNode('image', imageId, { x, y }, imageTitle) as Node<StudioNodeData>
      imageNode.data = {
        ...imageNode.data,
        kind: 'image',
        prompt: shot.imagePrompt || shot.action,
        comfyWorkflowAspect: aspect,
      } as StudioNodeData
      const videoNode = createStudioNode(
        'video',
        videoId,
        { x: x + colW * 0.55, y: y + 40 },
        videoTitle,
      ) as Node<StudioNodeData>
      videoNode.data = {
        ...videoNode.data,
        kind: 'video',
        prompt: shot.videoPrompt || shot.action,
        comfyWorkflowAspect: aspect,
      } as StudioNodeData

      newNodes.push(imageNode, videoNode)

      if (scriptNode) {
        newEdges.push({
          id: crypto.randomUUID(),
          source: scriptNode.id,
          target: imageId,
          sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID,
          targetHandle: STUDIO_FLOW_TARGET_HANDLE_ID,
          animated: true,
        })
      }
      newEdges.push(
        attachVideoTargetHandleForEdge(
          {
            id: crypto.randomUUID(),
            source: imageId,
            target: videoId,
            animated: true,
            style: { strokeWidth: 2 },
          },
          'image',
          'video',
        ) as Edge,
      )
    })

    deps.setNodes((nds) => [...nds, ...newNodes])
    deps.setEdges((eds) => [...eds, ...newEdges])

    patchDramaProductionState(tabId, { phase: 'storyboard_images' })
    deps.appendHistory(`短剧 Agent：已展开 ${state.shots.length} 个镜头节点`)
    emitDramaStep(deps, name)
    return JSON.stringify({ ok: true, created: state.shots.length * 2, aspect })
  }

  return null
}
