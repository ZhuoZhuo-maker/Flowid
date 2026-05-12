import type { Edge, Node } from '@xyflow/react'
import type { PanoramaNodeData, StudioNodeData } from '../types'
import { collectUpstreamNodeIds, parseMentionRefs, resolveMentionRefToNode } from './nodeMentions'
import { workflowJsonSupportsVoiceTable8Slots } from './comfyVoiceTable8'

/**
 * TD 有参多人（`TDQwen3TTSMultiDialog` + `__REF_AUDIO_n__`）：按 LoadAudio 槽位顺序解析
 * 对应的 `TDQwen3TTSDefineSpeaker` 节点 id，用于覆盖 `inputs.name`。
 */
export function resolveTdDefineSpeakerNodeIdsForRefSlots(workflowJsonText: string): string[] | null {
  let wf: Record<string, unknown>
  try {
    wf = JSON.parse(String(workflowJsonText || '{}'))
  } catch {
    return null
  }
  const loadAudioSlot = new Map<number, string>()
  for (const [id, raw] of Object.entries(wf)) {
    const node = raw as { class_type?: string; inputs?: Record<string, unknown> }
    if (node?.class_type !== 'LoadAudio') continue
    const audio = node.inputs?.audio
    if (typeof audio !== 'string') continue
    const m = audio.match(/^__REF_AUDIO_(\d+)__$/)
    if (!m) continue
    loadAudioSlot.set(Number(m[1]), id)
  }
  if (!loadAudioSlot.size || !loadAudioSlot.has(1)) return null
  const slots = [...loadAudioSlot.keys()].sort((a, b) => a - b)
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] !== i + 1) return null
  }
  const maxSlot = slots.length
  const speakerForLoad = new Map<string, string>()
  for (const [id, raw] of Object.entries(wf)) {
    const node = raw as { class_type?: string; inputs?: { audio?: unknown } }
    if (node?.class_type !== 'TDQwen3TTSDefineSpeaker') continue
    const audioIn = node.inputs?.audio
    if (!Array.isArray(audioIn) || typeof audioIn[0] !== 'string') continue
    const loadId = audioIn[0].trim()
    if (!loadId) continue
    speakerForLoad.set(loadId, id)
  }
  const out: string[] = []
  for (let s = 1; s <= maxSlot; s += 1) {
    const loadId = loadAudioSlot.get(s)
    if (!loadId) return null
    const sp = speakerForLoad.get(loadId)
    if (!sp) return null
    out.push(sp)
  }
  return out
}

/** 与 `extractNodeInputs` 音频节点一致：含 FB 多人无参的图不启用（避免与 8 路表冲突）。 */
export function workflowJsonSupportsTdRefAudioRoleMap(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  if (workflowJsonSupportsVoiceTable8Slots(s)) return false
  if (!s.includes('TDQwen3TTSMultiDialog')) return false
  if (!/__REF_AUDIO_1__/.test(s)) return false
  const ids = resolveTdDefineSpeakerNodeIdsForRefSlots(s)
  return Boolean(ids && ids.length > 0)
}

function syncUrlFromStudioHit(hit: Node<StudioNodeData>): string {
  const kind = hit.data.kind
  if (kind === 'panorama') {
    const p = hit.data as PanoramaNodeData
    return String(p.rectilinearSrc || p.src || '').trim()
  }
  return String((hit.data as { src?: string }).src || '').trim()
}

function labelForMentionPair(hit: Node<StudioNodeData>, refLabel: string): string {
  const title = String(hit.data.title || '').trim() || '未命名'
  const kind = hit.data.kind
  const lab = String(refLabel || '').trim() || title
  if (kind === 'audio' || kind === 'music') return lab
  if (kind === 'image') return `参考图·${lab}`
  if (kind === 'panorama') return `全景·${lab}`
  return lab
}

/**
 * 合并 @ 引用与底部参考区 URL，去重保序，供槽位标签与 TD「匹配」表共用。
 */
function mergeAudioRefUrlLabelPairs(args: {
  noteText: string
  hostNodeId: string
  referenceImageSources: string[]
  allNodes: Array<Node<StudioNodeData>>
  /** 有边时：无 uuid 的 @ 仅在上游祖先中解析（与 `extractNodeInputs` / 侧栏一致） */
  studioEdges?: Edge[]
}): Array<{ url: string; label: string }> {
  const restrict =
    args.hostNodeId && args.studioEdges?.length
      ? collectUpstreamNodeIds(args.hostNodeId, args.studioEdges)
      : undefined
  const pairEntries: Array<{ url: string; label: string }> = []
  if (args.allNodes.length && args.noteText.includes('@')) {
    for (const ref of parseMentionRefs(args.noteText)) {
      const hit = resolveMentionRefToNode(ref, args.allNodes, args.hostNodeId, undefined, restrict)
      if (!hit) continue
      const kind = hit.data.kind
      if (kind !== 'image' && kind !== 'panorama' && kind !== 'audio' && kind !== 'music') continue
      const u = syncUrlFromStudioHit(hit)
      if (!u) continue
      pairEntries.push({ url: u, label: labelForMentionPair(hit, ref.label) })
    }
  }
  const refs = args.referenceImageSources?.filter(Boolean) ?? []
  let panelN = 0
  for (let i = 0; i < refs.length; i += 1) {
    const url = String(refs[i] || '').trim()
    if (!url) continue
    panelN += 1
    pairEntries.push({ url, label: `本地上传 ${panelN}` })
  }
  const mergedPairs: Array<{ url: string; label: string }> = []
  for (const p of pairEntries) {
    if (mergedPairs.some((x) => x.url === p.url)) continue
    mergedPairs.push(p)
  }
  return mergedPairs
}

/**
 * 与运行时 `orderedInputAudioUrls` 槽位顺序一致：主槽 + @ 与底部参考区（去重后）的展示标签。
 */
export function buildAudioRefSlotDisplayLabels(args: {
  noteText: string
  hostNodeId: string
  selfTitle: string
  primarySrc: string
  referenceImageSources: string[]
  allNodes: Array<Node<StudioNodeData>>
  studioEdges?: Edge[]
  /**
   * 默认 true：含「第1路·主预览」行（与 `__REF_AUDIO_1__` 一致，可为生成结果或上传参考）。
   * 传 false：只列与主槽 URL 不同的 @/本地上传（与 TD「匹配」表一致）。
   */
  includePrimarySlotLabel?: boolean
}): string[] {
  const mergedPairs = mergeAudioRefUrlLabelPairs(args)
  let primarySrc = String(args.primarySrc || '').trim()
  if (!primarySrc && mergedPairs[0]?.url) primarySrc = mergedPairs[0]!.url
  const purePairs = mergedPairs.filter((p) => p.url && p.url !== primarySrc)
  if (args.includePrimarySlotLabel === false) {
    return purePairs.map((p) => p.label)
  }
  const head = `第1路·主预览（${String(args.selfTitle || '').trim() || '本节点'}）`
  return [head, ...purePairs.map((p) => p.label)]
}

/**
 * TD「匹配」表：仅列 **@ / 底部上传** 等与节点主预览 URL 不同的路（主预览常为上一段生成结果，不参与角色名匹配）。
 * 与 `__REF_AUDIO_2__` 起的 DefineSpeaker 顺序一致；执行时须 `applyComfyTdRefAudioRoleRowsToPrompt(..., { skipLeadingSlots: 1 })`。
 */
export function buildTdRefAudioRoleMatchSlotLabels(args: {
  noteText: string
  hostNodeId: string
  primarySrc: string
  referenceImageSources: string[]
  allNodes: Array<Node<StudioNodeData>>
  studioEdges?: Edge[]
}): string[] {
  const mergedPairs = mergeAudioRefUrlLabelPairs(args)
  let primaryUrl = String(args.primarySrc || '').trim()
  if (!primaryUrl && mergedPairs[0]?.url) primaryUrl = mergedPairs[0]!.url
  if (!primaryUrl && mergedPairs.length === 0) return []
  const purePairs = mergedPairs.filter((p) => p.url && p.url !== primaryUrl)
  return purePairs.map((p) => p.label)
}

export function applyComfyTdRefAudioRoleRowsToPrompt(
  prompt: Record<string, unknown>,
  rows: Array<{ roleName?: string }> | undefined,
  speakerNodeIdsInSlotOrder: string[],
  opts?: { /** 前几路 DefineSpeaker 不写入（例如 1=跳过主槽 `__REF_AUDIO_1__`） */ skipLeadingSlots?: number },
): void {
  const skip = Math.max(0, Math.floor(opts?.skipLeadingSlots ?? 0))
  if (!rows?.length || !speakerNodeIdsInSlotOrder.length) return
  const maxRows = speakerNodeIdsInSlotOrder.length - skip
  if (maxRows <= 0) return
  const n = Math.min(rows.length, maxRows)
  for (let i = 0; i < n; i += 1) {
    const name = String(rows[i]?.roleName ?? '').trim()
    if (!name) continue
    const id = speakerNodeIdsInSlotOrder[i + skip]!
    const raw = prompt[id] as { class_type?: string; inputs?: Record<string, unknown> } | undefined
    if (raw?.class_type !== 'TDQwen3TTSDefineSpeaker' || !raw.inputs) continue
    raw.inputs.name = name
  }
}
