import type { Edge, Node } from '@xyflow/react'
import {
  collectUpstreamNodeIds,
  parseMentionRefs,
  resolveMentionRefToNode,
  buildMentionToken,
  mentionAlreadyReferencesNodeId,
} from './nodeMentions'
import { collectInboundTextScriptIdsForVideo } from './videoNodeInports'
import type { ImageNodeData, PanoramaNodeData, StudioNodeData, VideoNodeData } from '../types'

type RefPair = { url: string; assetId: string }

/**
 * 图片节点连线到图片/视频节点时：把上游「主图 + 多参考图」并入下游 `referenceImageSources`（去重保序），
 * 与提示词里的 `@` 令牌并行，避免仅靠 `@` 解析时 UI 参考条为空或部分模型路径不拾取。
 */
export function mergeUpstreamImageVisualRefsIntoTarget(
  targetData: ImageNodeData | VideoNodeData,
  sourceData: ImageNodeData,
): Pick<ImageNodeData, 'referenceImageSources' | 'referenceImageAssetIds'> | null {
  const upstream: RefPair[] = []
  const main = String(sourceData.src || '').trim()
  if (main) {
    upstream.push({ url: main, assetId: String(sourceData.srcAssetId || '').trim() })
  }
  const sRefs = sourceData.referenceImageSources ?? []
  const sAids = sourceData.referenceImageAssetIds ?? []
  for (let i = 0; i < sRefs.length; i++) {
    const url = String(sRefs[i] || '').trim()
    if (!url) continue
    upstream.push({ url, assetId: String(sAids[i] || '').trim() })
  }
  if (!upstream.length) return null

  const seen = new Set<string>()
  const ordered: RefPair[] = []
  const push = (p: RefPair) => {
    if (!p.url || seen.has(p.url)) return
    seen.add(p.url)
    ordered.push(p)
  }
  for (const p of upstream) push(p)

  const tRefs = targetData.referenceImageSources ?? []
  const tAids = targetData.referenceImageAssetIds ?? []
  for (let i = 0; i < tRefs.length; i++) {
    const url = String(tRefs[i] || '').trim()
    if (!url) continue
    push({ url, assetId: String(tAids[i] || '').trim() })
  }

  const prev = (targetData.referenceImageSources ?? [])
    .map((u) => String(u || '').trim())
    .filter(Boolean)
  const nextUrls = ordered.map((o) => o.url)
  if (prev.length === nextUrls.length && prev.every((u, i) => u === nextUrls[i])) {
    return null
  }

  return {
    referenceImageSources: ordered.map((o) => o.url),
    referenceImageAssetIds: ordered.map((o) => o.assetId),
  }
}

/** 与图片/配音节点相邻连线的「文本」「剧本」节点 id（双向边，按画布位置排序）。 */
function collectAdjacentTextScriptNodeIds(
  hostNodeId: string,
  edges: Edge[],
  nodes: Array<Node<StudioNodeData>>,
): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const e of edges) {
    let sid: string | undefined
    if (e.target === hostNodeId) {
      const n = nodes.find((x) => x.id === e.source)
      if (n?.data?.kind === 'text' || n?.data?.kind === 'script') sid = e.source
    } else if (e.source === hostNodeId) {
      const n = nodes.find((x) => x.id === e.target)
      if (n?.data?.kind === 'text' || n?.data?.kind === 'script') sid = e.target
    }
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    ids.push(sid)
  }
  ids.sort((a, b) => {
    const na = nodes.find((x) => x.id === a)
    const nb = nodes.find((x) => x.id === b)
    const ya = na?.position.y ?? 0
    const yb = nb?.position.y ?? 0
    if (ya !== yb) return ya - yb
    return (na?.position.x ?? 0) - (nb?.position.x ?? 0)
  })
  return ids
}

function textScriptBody(n: Node<StudioNodeData>): string {
  const k = n.data.kind
  if (k !== 'text' && k !== 'script') return ''
  return String((n.data as { body?: string }).body ?? '').trim()
}

/** 文本/剧本节点用于 @ 连线的展示名（无标题时仍须能写入 prompt2/3 槽）。 */
function textScriptMentionTitle(n: Node<StudioNodeData>, slotIndex: number): string {
  const t = String(n.data.title || '').trim()
  if (t) return t
  const k = n.data.kind === 'script' ? '剧本' : '文本'
  return `${k}${slotIndex + 1}`
}

/**
 * SVI 等模板：`（0 秒：…）` 多段以单独一行 `###` 分隔时，拆到 prompt / prompt2 / prompt3。
 * 仅在对应槽为空时写入，避免覆盖已连线的第二、三路文本。
 */
export function distributeVideoHashDelimitedPromptSlots(vd: VideoNodeData): VideoNodeData {
  const raw1 = String(vd.prompt ?? '')
  if (!raw1.includes('###')) return vd
  const parts = raw1
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*###\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return vd

  const has2 = Boolean(String(vd.prompt2 ?? '').trim())
  const has3 = Boolean(String(vd.prompt3 ?? '').trim())
  if (has2 && has3) return vd

  return {
    ...vd,
    prompt: parts[0] ?? '',
    prompt2: has2 ? String(vd.prompt2 ?? '') : (parts[1] ?? ''),
    prompt3: has3 ? String(vd.prompt3 ?? '') : (parts[2] ?? parts.slice(2).join('\n\n###\n\n')),
  }
}

/**
 * 执行前：仅图片节点——把「已连线但未写进提示框」的文字/剧本正文前插到 __PROMPT__。
 * 视频多路提示由 `prompt`～`prompt4` 与面板分隔符维护，不在此合并。
 */
export function cloneNodeWithInboundTextPromptPrepended(
  node: Node<StudioNodeData>,
  edges: Edge[] | undefined,
  allNodes: Array<Node<StudioNodeData>> | undefined,
  workflowSource?: string,
): Node<StudioNodeData> {
  if (!edges?.length || !allNodes?.length) return node
  void workflowSource

  if (node.data.kind === 'image') {
    const im = node.data as ImageNodeData
    const prompt = String(im.prompt ?? '').trim()
    const inboundIds = collectAdjacentTextScriptNodeIds(node.id, edges, allNodes)
    const inherited: string[] = []
    for (const sid of inboundIds) {
      const n = allNodes.find((x) => x.id === sid)
      if (!n) continue
      const body = textScriptBody(n)
      if (!body) continue
      if (prompt.includes(body)) continue
      inherited.push(body)
    }
    if (!inherited.length) return node
    const merged = [inherited.join('\n\n'), prompt].filter(Boolean).join('\n\n')
    return {
      ...node,
      data: {
        ...im,
        prompt: merged,
      } as StudioNodeData,
    }
  }

  return node
}

/**
 * 执行前：视频节点——按连线顺序（上→下、左→右）把 text/script 写入 prompt / prompt2 / prompt3…（空槽插入 @）。
 */
export function cloneNodeWithInboundVideoTextPromptSlots(
  node: Node<StudioNodeData>,
  edges: Edge[] | undefined,
  allNodes: Array<Node<StudioNodeData>> | undefined,
): Node<StudioNodeData> {
  if (!edges?.length || !allNodes?.length || node.data.kind !== 'video') return node
  const ids = collectInboundTextScriptIdsForVideo(node.id, edges, allNodes)
  const vd = { ...(node.data as VideoNodeData) }
  const keys = ['prompt', 'prompt2', 'prompt3', 'prompt4'] as const
  let changed = false
  for (let i = 0; i < ids.length && i < keys.length; i++) {
    const sid = ids[i]!
    const src = allNodes.find((x) => x.id === sid)
    if (!src) continue
    const title = textScriptMentionTitle(src, i)
    const mention = buildMentionToken(title, sid)
    const key = keys[i]!
    const cur = String(vd[key] ?? '').trim()
    if (mentionAlreadyReferencesNodeId(cur, sid)) continue
    vd[key] = (cur ? `${mention}\n${cur}` : mention) as string
    changed = true
  }
  if (!changed) return node
  return { ...node, data: { ...vd, kind: 'video' } as StudioNodeData }
}

/**
 * 执行前：视频节点——从连线的 image/panorama 合并首帧（src）与参考图列表。
 */
export function cloneNodeWithInboundVideoImageFromEdges(
  node: Node<StudioNodeData>,
  edges: Edge[] | undefined,
  allNodes: Array<Node<StudioNodeData>> | undefined,
): Node<StudioNodeData> {
  if (!edges?.length || !allNodes?.length || node.data.kind !== 'video') return node
  const vd = node.data as VideoNodeData
  let patch: Partial<VideoNodeData> = {}
  let touched = false
  for (const e of edges) {
    const peerId = e.target === node.id ? e.source : e.source === node.id ? e.target : ''
    if (!peerId) continue
    const peer = allNodes.find((x) => x.id === peerId)
    const k = peer?.data.kind
    if (k !== 'image' && k !== 'panorama') continue
    const im = peer!.data as ImageNodeData | PanoramaNodeData
    const merged = mergeUpstreamImageVisualRefsIntoTarget(vd, im as ImageNodeData)
    if (merged) {
      patch = { ...patch, ...merged }
      touched = true
    }
    const main =
      k === 'panorama'
        ? String((im as PanoramaNodeData).rectilinearSrc || (im as ImageNodeData).src || '').trim()
        : String((im as ImageNodeData).src || '').trim()
    if (main && !String(vd.src || '').trim()) {
      patch = {
        ...patch,
        src: main,
        srcAssetId: (im as ImageNodeData).srcAssetId,
        srcFileName: (im as ImageNodeData).srcFileName,
      }
      touched = true
    }
    break
  }
  if (!touched) return node
  return { ...node, data: { ...vd, ...patch, kind: 'video' } as StudioNodeData }
}

/**
 * 执行前：配音/音乐节点——把「已连线但未写进台本框」的文字/剧本正文前插到 __NOTE__（与图片侧 `__PROMPT__` 合并策略一致）。
 */
export function cloneNodeWithInboundTextNotePrepended(
  node: Node<StudioNodeData>,
  edges: Edge[] | undefined,
  allNodes: Array<Node<StudioNodeData>> | undefined,
  _workflowSource?: string,
): Node<StudioNodeData> {
  if (!edges?.length || !allNodes?.length) return node
  if (node.data.kind !== 'audio' && node.data.kind !== 'music') return node
  /** 无 __NOTE__ 的 TD 无参多人等模板仍合并连线正文到 note，供后置写入 MultiDialog（见 applyNoteToTdMultiSpeakerTemplatePrompt）。 */

  const note = String((node.data as { note?: string }).note ?? '').trim()
  const inboundIds = collectAdjacentTextScriptNodeIds(node.id, edges, allNodes)
  const inherited: string[] = []
  for (const sid of inboundIds) {
    const n = allNodes.find((x) => x.id === sid)
    if (!n) continue
    const body = textScriptBody(n)
    if (!body) continue
    if (note.includes(body)) continue
    inherited.push(body)
  }
  if (!inherited.length) return node
  const merged = [inherited.join('\n\n'), note].filter(Boolean).join('\n\n')
  return {
    ...node,
    data: {
      ...node.data,
      note: merged,
    } as StudioNodeData,
  }
}

/** 视频节点 @ 引用：按上游文本节点标题/正文判断写入 prompt2（画面）或 prompt3（分段）。 */
function routeVideoMentionTextSlot(title: string, body: string): 'global' | 'local' | 'generic' {
  const t = String(title || '')
  const b = String(body || '')
  if (/分段|剧情|动作|local/i.test(t) || (b.includes('|') && b.length > 40)) return 'local'
  if (/画面|场景|总描述|人设|global/i.test(t)) return 'global'
  return 'generic'
}

/**
 * 视频提示框里只写 @ 时：把文本/剧本正文拆到 prompt2（画面）/ prompt3（分段），避免整段进 prompt 却无法写入 LTX 数字人节点 61/81。
 */
export function expandVideoPromptMentionsIntoSlots(
  vd: VideoNodeData,
  allNodes: Array<Node<StudioNodeData>>,
  nodeId: string,
  edges?: Edge[],
): VideoNodeData {
  const rawPrompt = String(vd.prompt || '')
  if (!rawPrompt.includes('@')) return vd
  const restrict = edges?.length ? collectUpstreamNodeIds(nodeId, edges) : undefined
  const refs = parseMentionRefs(rawPrompt)
  const globals: string[] = []
  const locals: string[] = []
  const generics: string[] = []
  for (const ref of refs) {
    const hit = resolveMentionRefToNode(ref, allNodes, nodeId, undefined, restrict)
    if (!hit) continue
    const k = hit.data.kind
    if (k !== 'text' && k !== 'script') continue
    const body = textScriptBody(hit)
    if (!body) continue
    const slot = routeVideoMentionTextSlot(String(hit.data.title || ''), body)
    if (slot === 'global') globals.push(body)
    else if (slot === 'local') locals.push(body)
    else generics.push(body)
  }
  if (!globals.length && !locals.length && !generics.length) return vd
  const raw2 = String(vd.prompt2 || '').trim()
  const raw3 = String(vd.prompt3 || '').trim()
  return {
    ...vd,
    prompt: generics.join('\n\n').trim() || (globals.length || locals.length ? '' : rawPrompt),
    prompt2: [raw2, ...globals].filter(Boolean).join('\n\n').trim() || raw2,
    /** LTX PromptRelay 以 ` | ` 分段；多个 @ 分段剧本须用同一分隔符，不能用空行。 */
    prompt3: [raw3, ...locals].filter(Boolean).join(' | ').trim() || raw3,
  }
}
