/**
 * 短剧分镜图 / 分镜视频真实生成：创建 image / video 节点并调用 executeNodeIds。
 */

import type { Node } from '@xyflow/react'
import type { CloudImageAspectKey, ImageNodeData, StudioNodeData, VideoNodeData } from '../../types'
import { createStudioNode } from '../nodeFactory'
import type { DramaProductionState, DramaShot, DramaStoryboardPlanKind } from './types'
import { patchDramaProductionState } from './dramaStateStore'
import { setDramaAskUserPending } from './dramaAskUserBridge'
import { pushDramaChatStep } from './dramaChatStepsBridge'
import type { DramaImageRunDeps } from './dramaImageGeneration'
import {
  finishDramaStoryboardGen,
  patchDramaUiState,
  startDramaStoryboardGen,
  tickDramaStoryboardGen,
} from './dramaUiBridge'
import { syncDramaNavFromCanvasFocus } from './dramaWorkspaceBridge'
import { isDramaAutoPilot } from './dramaUiBridge'
import { notifyDramaAutoPipelineStep } from './dramaAutoPipelineHooks'
import { buildDramaNodeExecPatchForStage, describeDramaStageWorkflow } from './dramaImageGenMode'
import { ensureDramaStageGenChoiceOrPrompt } from './dramaStageGenChoice'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 分镜出图 / 出视频依赖 */
export type DramaStoryboardRunDeps = DramaImageRunDeps & {
  runVideoNodes: (nodeIds: string[]) => Promise<void>
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

/** 每镜分镜图张数：宫格 9 张，多图参考 3 张 */
function panelsPerShot(plan?: DramaStoryboardPlanKind): number {
  return plan === 'grid' ? 9 : 3
}

async function ensureDramaImageNode(
  deps: DramaImageRunDeps,
  title: string,
  prompt: string,
  aspect: CloudImageAspectKey,
  tabId: string,
  extra?: Partial<ImageNodeData>,
): Promise<{ nodeId: string }> {
  const execPatch = await buildDramaNodeExecPatchForStage(tabId, 'storyboard_image')
  const existing = deps.findNodeByTitleKeyword(title)
  if (existing) {
    deps.updateNodeData(existing.id, {
      kind: 'image',
      prompt,
      comfyWorkflowAspect: aspect,
      ...execPatch,
      ...extra,
    } as Partial<StudioNodeData>)
    return { nodeId: existing.id }
  }

  let nodeId = ''
  deps.setNodes((nds) => {
    nodeId = crypto.randomUUID()
    const col = nds.length % 4
    const row = Math.floor(nds.length / 4)
    const node = createStudioNode('image', nodeId, { x: 480 + col * 420, y: 520 + row * 320 }, title) as Node<StudioNodeData>
    node.data = {
      ...node.data,
      kind: 'image',
      prompt,
      comfyWorkflowAspect: aspect,
      ...execPatch,
      ...extra,
    } as StudioNodeData
    return [...nds, node]
  })
  return { nodeId }
}

async function ensureDramaVideoNode(
  deps: DramaStoryboardRunDeps,
  title: string,
  prompt: string,
  aspect: CloudImageAspectKey,
  tabId: string,
  model?: string,
): Promise<{ nodeId: string }> {
  const execPatch = await buildDramaNodeExecPatchForStage(tabId, 'storyboard_video')
  const existing = deps.findNodeByTitleKeyword(title)
  if (existing) {
    deps.updateNodeData(existing.id, {
      kind: 'video',
      prompt,
      comfyWorkflowAspect: aspect,
      model: model || undefined,
      ...execPatch,
    } as Partial<StudioNodeData>)
    return { nodeId: existing.id }
  }

  let nodeId = ''
  deps.setNodes((nds) => {
    nodeId = crypto.randomUUID()
    const col = nds.length % 3
    const row = Math.floor(nds.length / 3)
    const node = createStudioNode('video', nodeId, { x: 920 + col * 480, y: 520 + row * 360 }, title) as Node<StudioNodeData>
    node.data = {
      ...node.data,
      kind: 'video',
      prompt,
      comfyWorkflowAspect: aspect,
      model: model || undefined,
      ...execPatch,
    } as StudioNodeData
    return [...nds, node]
  })
  return { nodeId }
}

function readImageSrc(deps: DramaImageRunDeps, nodeId: string): string {
  const n = deps.getNodes().find((x) => x.id === nodeId)
  if (!n || n.data.kind !== 'image') return ''
  const d = n.data as ImageNodeData
  const src = String(d.src || '').trim()
  if (src) return src
  for (const t of d.resultThumbnails ?? []) {
    const u = String(t.url || '').trim()
    if (t.mediaKind === 'image' && u) return u
  }
  return ''
}

async function readImageSrcAfterRun(deps: DramaImageRunDeps, nodeId: string): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const s = readImageSrc(deps, nodeId)
    if (s) return s
    await sleep(300)
  }
  return readImageSrc(deps, nodeId)
}

function readVideoSrc(deps: DramaStoryboardRunDeps, nodeId: string): string {
  const n = deps.getNodes().find((x) => x.id === nodeId)
  if (!n || n.data.kind !== 'video') return ''
  return String((n.data as VideoNodeData).src || '').trim()
}

function buildStoryboardImagePrompt(shot: DramaShot, state: DramaProductionState, panelIdx: number, total: number): string {
  const style = state.spec.visualStyle || 'anime storyboard panel'
  const base = shot.imagePrompt || shot.action
  const angleHints = ['wide establishing', 'medium shot', 'close-up detail', 'over-shoulder', 'low angle', 'high angle']
  const hint = angleHints[panelIdx % angleHints.length]
  return [
    `storyboard frame ${shot.index}, panel ${panelIdx + 1}/${total}`,
    base,
    shot.dialogue ? `dialogue context: ${shot.dialogue}` : '',
    `camera: ${hint}`,
    `style: ${style}`,
    'consistent characters, cinematic lighting',
  ]
    .filter(Boolean)
    .join(', ')
}

function buildStoryboardVideoPrompt(shot: DramaShot): string {
  const parts = [shot.videoPrompt || shot.action]
  if (shot.audioPrompt?.trim()) parts.push(`audio: ${shot.audioPrompt}`)
  if (shot.dialogue?.trim()) parts.push(`dialogue: ${shot.dialogue}`)
  return parts.filter(Boolean).join('\n')
}

/**
 * 为全部分镜镜头生成宫格 / 多图参考分镜图（真实执行 image 节点）。
 */
export async function runDramaStoryboardImageGeneration(
  deps: DramaStoryboardRunDeps,
): Promise<{ ok: boolean; done: number; total: number; error?: string }> {
  const tabId = deps.getProjectTabId()
  if (!tabId) return { ok: false, done: 0, total: 0, error: '无活动项目' }
  const state = patchDramaProductionState(tabId, {})
  const shots = state.shots
  if (!shots.length) {
    return { ok: false, done: 0, total: 0, error: '分镜表为空，请先 flowid_drama_set_shots' }
  }

  const aspect = normalizeAspect(state.spec.aspect === 'custom' ? '9:16' : state.spec.aspect)
  const perShot = panelsPerShot(state.spec.storyboardPlan)
  const totalTasks = shots.length * perShot
  startDramaStoryboardGen(tabId, 'images', totalTasks)
  patchDramaUiState(tabId, { canvasFocus: 'storyboard' })
  syncDramaNavFromCanvasFocus('storyboard')
  patchDramaProductionState(tabId, { phase: 'storyboard_images' })

  const nextShots: DramaShot[] = shots.map((s) => ({ ...s }))
  let done = 0

  try {
    if (ensureDramaStageGenChoiceOrPrompt(tabId, 'storyboard_image', 'shots_written')) {
      return { ok: true, done: 0, total: totalTasks }
    }
    deps.appendHistory(`短剧 Agent：分镜图 → ${describeDramaStageWorkflow(tabId, 'storyboard_image')}`)

    const refImages = [
      ...state.characters.map((c) => c.imageSrc).filter(Boolean),
      ...state.locations.map((l) => l.mainImageSrc).filter(Boolean),
    ] as string[]

    for (let si = 0; si < shots.length; si += 1) {
      const shot = shots[si]!
      const nodeIds: string[] = []
      const srcs: string[] = []

      for (let pi = 0; pi < perShot; pi += 1) {
        const title = `短剧·分镜·镜头${shot.index}·${pi + 1}`
        const prompt = buildStoryboardImagePrompt(shot, state, pi, perShot)
        const { nodeId } = await ensureDramaImageNode(deps, title, prompt, aspect, tabId, {
          ...(refImages.length ? { referenceImageSources: refImages.slice(0, 6) } : {}),
        })
        nodeIds.push(nodeId)
        await deps.runImageNodes([nodeId])
        srcs.push(await readImageSrcAfterRun(deps, nodeId))
        done += 1
        tickDramaStoryboardGen(tabId, done, Math.min(done * 8, 280))
      }

      nextShots[si] = {
        ...shot,
        imageNodeIds: nodeIds,
        imageSrcs: srcs.filter(Boolean),
      }
      patchDramaProductionState(tabId, { shots: [...nextShots] })
    }

    finishDramaStoryboardGen(tabId, 'images')
    pushDramaChatStep(tabId, '生成分镜图像')
    if (isDramaAutoPilot(tabId)) {
      notifyDramaAutoPipelineStep(tabId, 'storyboard_images_done')
    } else {
      setDramaAskUserPending({
        kind: 'storyboard_image_satisfaction',
        question: '分镜图已生成！您满意吗？',
        options: ['满意，请继续生成分镜视频提示词', '我要修改'],
        expertRole: '分镜师',
      })
    }
    deps.appendHistory(`短剧 Agent：已生成 ${shots.length} 镜分镜图`)
    return { ok: true, done, total: totalTasks }
  } catch (e) {
    finishDramaStoryboardGen(tabId, 'images')
    patchDramaProductionState(tabId, { shots: nextShots })
    return { ok: false, done, total: totalTasks, error: (e as Error)?.message || String(e) }
  }
}

/**
 * 生成分镜视频（真实执行 video 节点）。
 * @param limit 仅生成前 N 镜；undefined 表示全部
 */
export async function runDramaStoryboardVideoGeneration(
  deps: DramaStoryboardRunDeps,
  limit?: number,
): Promise<{ ok: boolean; done: number; total: number; error?: string }> {
  const tabId = deps.getProjectTabId()
  if (!tabId) return { ok: false, done: 0, total: 0, error: '无活动项目' }

  const state = patchDramaProductionState(tabId, {})
  const shots = state.shots
  if (!shots.length) {
    return { ok: false, done: 0, total: 0, error: '分镜表为空' }
  }

  const targetShots = limit && limit > 0 ? shots.slice(0, limit) : shots
  const aspect = normalizeAspect(state.spec.aspect === 'custom' ? '9:16' : state.spec.aspect)
  const model = state.spec.videoModel

  startDramaStoryboardGen(tabId, 'videos', targetShots.length)
  patchDramaUiState(tabId, { canvasFocus: 'storyboard' })
  syncDramaNavFromCanvasFocus('storyboard')
  patchDramaProductionState(tabId, { phase: 'video_audio' })

  const nextShots: DramaShot[] = shots.map((s) => ({ ...s }))
  let done = 0

  try {
    if (ensureDramaStageGenChoiceOrPrompt(tabId, 'storyboard_video', 'storyboard_images_done')) {
      return { ok: true, done: 0, total: targetShots.length }
    }
    deps.appendHistory(`短剧 Agent：分镜视频 → ${describeDramaStageWorkflow(tabId, 'storyboard_video')}`)

    for (const shot of targetShots) {
      const si = shots.findIndex((s) => s.index === shot.index)
      if (si < 0) continue

      const title = `短剧·分镜·镜头${shot.index}·成片`
      const prompt = buildStoryboardVideoPrompt(shot)
      const gridRef = shot.imageSrcs?.filter(Boolean).slice(0, 9) ?? []
      const { nodeId } = await ensureDramaVideoNode(deps, title, prompt, aspect, tabId, model)
      if (gridRef.length) {
        deps.updateNodeData(nodeId, {
          kind: 'video',
          referenceImageSources: gridRef,
        } as Partial<StudioNodeData>)
      }
      await deps.runVideoNodes([nodeId])
      const src = readVideoSrc(deps, nodeId)

      nextShots[si] = {
        ...nextShots[si]!,
        videoNodeId: nodeId,
        videoSrc: src || nextShots[si]!.videoSrc,
      }
      done += 1
      tickDramaStoryboardGen(tabId, done, Math.min(done * 30, 280))
      patchDramaProductionState(tabId, { shots: [...nextShots] })
    }

    finishDramaStoryboardGen(tabId, 'videos')
    pushDramaChatStep(tabId, '生成分镜视频')
    if (!isDramaAutoPilot(tabId)) {
      const allDone = done >= shots.length
      setDramaAskUserPending({
        kind: 'storyboard_video_satisfaction',
        question: allDone
          ? '分镜视频已生成！您满意吗？'
          : `已生成 ${done} 个分镜视频，是否继续生成剩余镜头？`,
        options: allDone
          ? ['满意，完成分镜阶段', '我要修改']
          : ['满意，请继续生成剩余分镜视频', '我要修改'],
        expertRole: '分镜师',
      })
    }
    deps.appendHistory(`短剧 Agent：已生成 ${done}/${targetShots.length} 个分镜视频`)
    return { ok: true, done, total: targetShots.length }
  } catch (e) {
    finishDramaStoryboardGen(tabId, 'videos')
    patchDramaProductionState(tabId, { shots: nextShots })
    return { ok: false, done, total: targetShots.length, error: (e as Error)?.message || String(e) }
  }
}
