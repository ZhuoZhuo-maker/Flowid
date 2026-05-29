/**
 * 短剧角色 / 场景真实出图：创建 image 节点并调用画布 executeNodeIds。
 */

import type { Dispatch, SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { CloudImageAspectKey, ImageNodeData, StudioNodeData } from '../../types'
import { createStudioNode } from '../nodeFactory'
import type { DramaCharacter, DramaLocation, DramaProductionState } from './types'
import { patchDramaProductionState } from './dramaStateStore'
import { setDramaAskUserPending } from './dramaAskUserBridge'
import { pushDramaChatStep } from './dramaChatStepsBridge'
import { buildDramaNodeExecPatchForStage, describeDramaStageWorkflow } from './dramaImageGenMode'
import type { DramaGenStage } from './dramaGenStages'
import { ensureDramaStageGenChoiceOrPrompt } from './dramaStageGenChoice'
import { isDramaAutoPilot } from './dramaUiBridge'
import { notifyDramaAutoPipelineStep } from './dramaAutoPipelineHooks'
import {
  finishDramaCharacterGen,
  finishDramaSceneGen,
  patchDramaUiState,
  startDramaCharacterGen,
  startDramaSceneGen,
  tickDramaCharacterGen,
  tickDramaSceneGen,
} from './dramaUiBridge'
import { syncDramaNavFromCanvasFocus } from './dramaWorkspaceBridge'

/** 出图工具依赖（避免与 dramaToolHandlers 循环引用） */
export type DramaImageRunDeps = {
  getProjectTabId: () => string
  getNodes: () => Node<StudioNodeData>[]
  setNodes: Dispatch<SetStateAction<Node<StudioNodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  updateNodeData: (id: string, patch: Partial<StudioNodeData>) => void
  findNodeByTitleKeyword: (keyword: string) => Node<StudioNodeData> | null
  appendHistory: (label: string) => void
  runImageNodes: (nodeIds: string[]) => Promise<void>
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
  return '16:9'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 从 image 节点读取产出 URL（主图或首张缩略图） */
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

/** 执行后轮询读取（Comfy 回填可能略晚于 execute 返回） */
async function readImageSrcAfterRun(deps: DramaImageRunDeps, nodeId: string): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const s = readImageSrc(deps, nodeId)
    if (s) return s
    await sleep(300)
  }
  return readImageSrc(deps, nodeId)
}

/**
 * 确保画布存在指定标题的 image 节点并写入 prompt / 环节工作流。
 * @param stage 制片环节（决定 Comfy 工作流）
 */
async function ensureDramaImageNode(
  deps: DramaImageRunDeps,
  title: string,
  prompt: string,
  aspect: CloudImageAspectKey,
  stage: DramaGenStage,
  extra?: Partial<ImageNodeData>,
): Promise<{ nodeId: string; title: string }> {
  const tabId = deps.getProjectTabId()
  const execPatch = tabId ? await buildDramaNodeExecPatchForStage(tabId, stage) : { promptPickerMode: 'workflow' as const }

  const existing = deps.findNodeByTitleKeyword(title)
  if (existing) {
    deps.updateNodeData(existing.id, {
      kind: 'image',
      prompt,
      comfyWorkflowAspect: aspect,
      ...execPatch,
      ...extra,
    } as Partial<StudioNodeData>)
    return { nodeId: existing.id, title: String(existing.data.title || title) }
  }

  let nodeId = ''
  deps.setNodes((nds) => {
    nodeId = crypto.randomUUID()
    const col = nds.length % 4
    const row = Math.floor(nds.length / 4)
    const position = { x: 420 + col * 420, y: 280 + row * 320 }
    const node = createStudioNode('image', nodeId, position, title) as Node<StudioNodeData>
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
  return { nodeId, title }
}

function buildCharacterDesignPrompt(c: DramaCharacter, state: DramaProductionState, styleHint?: string): string {
  const style = styleHint || state.spec.visualStyle || 'anime illustration'
  return [
    `character portrait, ${c.name}`,
    c.appearance,
    c.personality,
    `visual style: ${style}`,
    'single character, clean background, high quality character design',
  ]
    .filter(Boolean)
    .join(', ')
}

function buildCharacterConceptPrompt(
  c: DramaCharacter,
  state: DramaProductionState,
  styleHint?: string,
): string {
  const style = styleHint || state.spec.visualStyle || 'anime illustration'
  return [
    `character turnaround sheet, ${c.name}, front view side view back view`,
    c.appearance,
    `visual style: ${style}`,
    'three views, character concept art, white background, consistent design',
  ]
    .filter(Boolean)
    .join(', ')
}

function buildScenePrompt(loc: DramaLocation, state: DramaProductionState, variant?: string): string {
  const style = loc.visualStyle || state.spec.visualStyle || 'cinematic environment'
  return [
    `environment concept art, ${loc.name}`,
    loc.description,
    variant ? `camera: ${variant}` : 'establishing shot',
    `style: ${style}`,
    'no characters, detailed background',
  ]
    .filter(Boolean)
    .join(', ')
}

function charactersNeedDesign(state: DramaProductionState): boolean {
  return state.characters.some((c) => !c.designImageSrc?.trim())
}

function charactersNeedConcept(state: DramaProductionState): boolean {
  return state.characters.some((c) => !c.imageSrc?.trim())
}

/**
 * 为全部角色生成设计图 + 概念图（两阶段，各选一次工作流）。
 */
export async function runDramaCharacterImageGeneration(
  deps: DramaImageRunDeps,
  styleHint?: string,
): Promise<{ ok: boolean; done: number; total: number; error?: string }> {
  const tabId = deps.getProjectTabId()
  if (!tabId) return { ok: false, done: 0, total: 0, error: '无活动项目' }
  const state = patchDramaProductionState(tabId, {})
  const characters = state.characters
  if (!characters.length) {
    return { ok: false, done: 0, total: 0, error: '角色列表为空，请先 flowid_drama_set_characters' }
  }

  const aspect = normalizeAspect(state.spec.aspect === 'custom' ? '16:9' : state.spec.aspect)
  const total = characters.length * 2
  startDramaCharacterGen(tabId, total)
  patchDramaUiState(tabId, { canvasFocus: 'character' })
  syncDramaNavFromCanvasFocus('character')

  const nextChars: DramaCharacter[] = [...characters]
  let done = 0

  try {
    if (charactersNeedDesign(state)) {
      if (ensureDramaStageGenChoiceOrPrompt(tabId, 'character_design', 'characters_written')) {
        return { ok: true, done: 0, total, error: undefined }
      }
      const wfLabel = describeDramaStageWorkflow(tabId, 'character_design')
      deps.appendHistory(`短剧 Agent：角色设计图 → ${wfLabel}`)

      for (let i = 0; i < characters.length; i += 1) {
        const c = characters[i]!
        const title = `短剧·角色设计·${c.name}`
        const prompt = buildCharacterDesignPrompt(c, state, styleHint)
        const { nodeId } = await ensureDramaImageNode(deps, title, prompt, aspect, 'character_design')
        await deps.runImageNodes([nodeId])
        const src = await readImageSrcAfterRun(deps, nodeId)
        nextChars[i] = {
          ...c,
          designImageNodeId: nodeId,
          designImageSrc: src || c.designImageSrc,
        }
        done += 1
        tickDramaCharacterGen(tabId, done, done * 6)
        patchDramaProductionState(tabId, { characters: [...nextChars] })
      }
    }

    if (charactersNeedConcept({ ...state, characters: nextChars })) {
      if (ensureDramaStageGenChoiceOrPrompt(tabId, 'character_concept', 'characters_written')) {
        return { ok: true, done, total, error: undefined }
      }
      const wfLabel = describeDramaStageWorkflow(tabId, 'character_concept')
      deps.appendHistory(`短剧 Agent：角色概念图 → ${wfLabel}`)

      for (let i = 0; i < nextChars.length; i += 1) {
        const c = nextChars[i]!
        if (c.imageSrc?.trim()) {
          done += 1
          continue
        }
        const title = `短剧·角色概念·${c.name}`
        const prompt = buildCharacterConceptPrompt(c, state, styleHint)
        const ref = c.designImageSrc?.trim()
        const { nodeId } = await ensureDramaImageNode(deps, title, prompt, aspect, 'character_concept', {
          ...(ref ? { referenceImageSources: [ref], src: ref } : {}),
        })
        await deps.runImageNodes([nodeId])
        const src = await readImageSrcAfterRun(deps, nodeId)
        nextChars[i] = {
          ...c,
          imageNodeId: nodeId,
          imageSrc: src || c.imageSrc,
          appearance: c.appearance.replace(/\s*\[image:ready\]/gi, ''),
        }
        done += 1
        tickDramaCharacterGen(tabId, done, done * 6)
        patchDramaProductionState(tabId, { characters: [...nextChars] })
      }
    }

    finishDramaCharacterGen(tabId)
    pushDramaChatStep(tabId, '生成角色图')
    if (isDramaAutoPilot(tabId)) {
      notifyDramaAutoPipelineStep(tabId, 'character_images_done')
    } else {
      setDramaAskUserPending({
        kind: 'character_satisfaction',
        question: '角色概念图已生成，请确认是否满意。',
        options: ['满意，请继续场景设计', '需要修改'],
        expertRole: '角色设计师',
      })
    }
    deps.appendHistory(`短剧 Agent：已生成 ${done}/${total} 张角色图（设计 + 概念）`)
    return { ok: true, done, total }
  } catch (e) {
    finishDramaCharacterGen(tabId)
    patchDramaProductionState(tabId, { characters: nextChars })
    return { ok: false, done, total, error: (e as Error)?.message || String(e) }
  }
}

/**
 * 生成场景主图或多视图（真实执行 image 节点）。
 */
export async function runDramaSceneImageGeneration(
  deps: DramaImageRunDeps,
  phase: 'main' | 'multiview',
  locationId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const tabId = deps.getProjectTabId()
  if (!tabId) return { ok: false, error: '无活动项目' }

  const state = patchDramaProductionState(tabId, {})
  const loc =
    state.locations.find((l) => l.id === locationId) ?? state.locations[0]
  if (!loc) {
    return { ok: false, error: '场景列表为空，请先 flowid_drama_set_locations' }
  }

  const aspect = normalizeAspect(state.spec.aspect === 'custom' ? '16:9' : state.spec.aspect)
  startDramaSceneGen(tabId, phase)
  patchDramaUiState(tabId, { canvasFocus: 'scene', selectedSceneStyle: loc.visualStyle || state.spec.visualStyle })
  syncDramaNavFromCanvasFocus('scene')

  try {
    if (phase === 'main') {
      if (ensureDramaStageGenChoiceOrPrompt(tabId, 'scene', 'character_images_done')) {
        finishDramaSceneGen(tabId, { mainOk: false })
        return { ok: true }
      }
      const wfLabel = describeDramaStageWorkflow(tabId, 'scene')
      deps.appendHistory(`短剧 Agent：场景主图 → ${wfLabel}`)

      const title = `短剧·场景·${loc.name}`
      const prompt = buildScenePrompt(loc, state)
      const { nodeId } = await ensureDramaImageNode(deps, title, prompt, aspect, 'scene')
      await deps.runImageNodes([nodeId])
      const src = await readImageSrcAfterRun(deps, nodeId)
      const locations = state.locations.map((l) =>
        l.id === loc.id ? { ...l, mainImageNodeId: nodeId, mainImageSrc: src || l.mainImageSrc } : l,
      )
      patchDramaProductionState(tabId, { locations })
      tickDramaSceneGen(tabId, 1, 12)
      finishDramaSceneGen(tabId, { mainOk: Boolean(src?.trim()) })
      pushDramaChatStep(tabId, '生成场景图')
      if (isDramaAutoPilot(tabId)) {
        notifyDramaAutoPipelineStep(tabId, 'scene_main_done')
      } else {
        setDramaAskUserPending({
          kind: 'scene_main_satisfaction',
          question: '场景主图已生成，请确认是否满意？',
          options: ['满意，请继续生成场景多视图', '我要修改'],
          expertRole: '场景设计师',
        })
      }
    } else {
      const variants = ['wide front view', 'left angle', 'right angle', 'detail corner']
      const srcs: string[] = []
      const nodeIds: string[] = []
      for (let i = 0; i < variants.length; i += 1) {
        const title = `短剧·场景·${loc.name}·视图${i + 1}`
        const prompt = buildScenePrompt(loc, state, variants[i])
        const { nodeId } = await ensureDramaImageNode(deps, title, prompt, aspect, 'scene')
        nodeIds.push(nodeId)
      }
      for (let i = 0; i < nodeIds.length; i += 1) {
        await deps.runImageNodes([nodeIds[i]!])
        srcs.push(await readImageSrcAfterRun(deps, nodeIds[i]!))
        tickDramaSceneGen(tabId, i + 1, (i + 1) * 10)
      }
      const locations = state.locations.map((l) =>
        l.id === loc.id ? { ...l, multiViewSrcs: srcs.filter(Boolean) } : l,
      )
      patchDramaProductionState(tabId, { locations })
      finishDramaSceneGen(tabId, { multiOk: srcs.some(Boolean) })
      pushDramaChatStep(tabId, '生成场景图')
      if (isDramaAutoPilot(tabId)) {
        notifyDramaAutoPipelineStep(tabId, 'scene_multiview_done')
      } else {
        setDramaAskUserPending({
          kind: 'scene_multiview_satisfaction',
          question: '场景多视图已生成，请确认是否满意？',
          options: ['满意，请继续分镜设计', '我要修改'],
          expertRole: '场景设计师',
        })
      }
    }

    deps.appendHistory(`短剧 Agent：场景${phase === 'main' ? '主图' : '多视图'}已生成`)
    return { ok: true }
  } catch (e) {
    finishDramaSceneGen(tabId, { mainOk: false })
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
}
