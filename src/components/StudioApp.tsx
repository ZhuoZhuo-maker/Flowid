import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type OnConnectStartParams,
  type Node,
  type OnSelectionChangeParams,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence, motion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Box, Map as MapIcon, Plus, Settings } from 'lucide-react'
import type {
  AudioNodeData,
  ImageNodeData,
  PanoramaNodeData,
  ProjectSnapshot,
  ScriptNodeData,
  StudioNodeData,
  StudioNodeKind,
  TextNodeData,
  VideoNodeData,
} from '../types'
import { loadCloudModelPresets } from '../lib/cloudModelPresets'
import { CanvasProvider } from '../context/CanvasContext'
import { AudioNode } from './nodes/AudioNode'
import { GhostNode } from './nodes/GhostNode'
import { GroupNode } from './nodes/GroupNode'
import { ImageNode } from './nodes/ImageNode'
import { PanoramaNode } from './nodes/PanoramaNode'
import { ScriptNode } from './nodes/ScriptNode'
import { TextNode } from './nodes/TextNode'
import { VideoNode } from './nodes/VideoNode'
import { AddNodePanel } from './panels/AddNodePanel'
import { DownloadPanel } from './panels/DownloadPanel'
import { LocalProjectsPanel } from './panels/LocalProjectsPanel'
import { RightPanel, type RightPanelTab } from './panels/RightPanel'
import { AiAssistantPanel, type AiAssistantMessage } from './panels/AiAssistantPanel'
import { WorkflowSettingsPanel } from './panels/WorkflowSettingsPanel'
import { AuthModal } from './panels/AuthModal'
import { useAssetsHistory } from '../hooks/useAssetsHistory'
import { useWorkflowRunner } from '../hooks/useWorkflowRunner'
import { useWorkflowIntegration } from '../hooks/useWorkflowIntegration'
import { loadAuthSession, saveAuthSession, type AuthSession } from '../lib/auth'
import {
  getLicenseSubmitBlockMessage,
  isLicenseReadOnly,
  loadLocalLicenseSnapshot,
  saveLocalLicenseSnapshot,
} from '../lib/license'
import type {
  AddNodeMenuItem,
  AssetItem,
  LeftPanelType,
} from './panels/types'
import { createGroupNode, createStudioNode } from '../lib/nodeFactory'
import {
  findWorkflowEntryByPreferredName,
  matchStudioNodeWorkflow,
} from '../lib/matchStudioNodeWorkflow'
import {
  loadStoredProject,
  parseProjectFile,
  saveStoredProject,
  serializeProject,
} from '../lib/persistence'
import { persistProjectSnapshotToExternalStores, tryLoadExternalProjectSnapshot } from '../lib/projectDiskMirror'
import {
  persistAiAssistantConfigToExternalPath,
  tryLoadAiAssistantConfigFromExternalPath,
} from '../lib/aiAssistantConfigMirror'
import {
  chatReplyWithModel,
  loadAiAssistantConfig,
  planActionsWithModel,
  planActionsWithRules,
  saveAiAssistantConfig,
  type AiAssistantAction,
  type AiAssistantConfig,
} from '../lib/aiAssistantAgent'
import {
  buildMentionToken,
  collectMentionImageSources,
  listMentionImageAttachments,
  mentionAlreadyReferencesNodeId,
  parseDefaultNodeTitleIndex,
  parseMentionRefs,
  refreshMentionLabelsInText,
  resolveMentionRefToNode,
  resolveNodeMentionsInText,
} from '../lib/nodeMentions'
import { DEFAULT_WORKSPACE_LIBRARY_ID, writeLibraryProject } from '../lib/localProjectLibrary'
import {
  getLocalImageAssetObjectUrl,
  saveLocalImageAsset,
} from '../lib/localImageAssetStore'
import { mirrorComfyOutputToDisk } from '../lib/localAssetDiskMirror'
import {
  ICON_NODE_AUDIO,
  ICON_NODE_IMAGE,
  ICON_NODE_MUSIC,
  ICON_NODE_PANORAMA,
  ICON_NODE_TEXT,
  ICON_NODE_VIDEO,
  ICON_TOP_HOME,
  ICON_TOP_STAR,
} from '../assets/studioIcons'

const nodeTypes = {
  text: TextNode,
  script: ScriptNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  panorama: PanoramaNode,
  ghost: GhostNode,
  group: GroupNode,
}

const AI_ASSISTANT_AVATAR_MEDIA = {
  listening: '/src/assets/ai-assistant/倾听 listening（用户输入中）.webm',
  thinking: '/src/assets/ai-assistant/思考 thinking（请求模型中）.webm',
  acting: '/src/assets/ai-assistant/执行 acting（调用工具中）.webm',
  talking: '/src/assets/ai-assistant/说话 talking（回复中）.webm',
  success: '/src/assets/ai-assistant/成功 success.webm',
  error: '/src/assets/ai-assistant/失败报错 error_但不吓人.webm',
} as const

type AssistantAvatarState = keyof typeof AI_ASSISTANT_AVATAR_MEDIA
type AvatarDockPointerAction =
  | {
      mode: 'drag'
      startX: number
      startY: number
      startLeft: number
      startTop: number
    }
  | {
      mode: 'resize'
      startX: number
      startY: number
      startWidth: number
      startHeight: number
      aspectRatio: number
    }

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildTtsEndpointCandidates(rawEndpoint: string): string[] {
  const endpoint = rawEndpoint.trim()
  if (!endpoint) return []
  const normalizedBase = endpoint.replace(/\/+$/, '')
  const lower = normalizedBase.toLowerCase()
  const hasApiPath =
    lower.endsWith('/v1/audio/speech') ||
    lower.endsWith('/tts') ||
    lower.endsWith('/api/tts') ||
    lower.endsWith('/api/tts/generate')
  if (hasApiPath) return [normalizedBase]
  return [
    `${normalizedBase}/v1/audio/speech`,
    `${normalizedBase}/api/tts`,
    `${normalizedBase}/tts`,
    `${normalizedBase}/api/tts/generate`,
    normalizedBase,
  ]
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function isLikelyGradioTtsEndpoint(rawEndpoint: string): boolean {
  const lower = rawEndpoint.toLowerCase()
  return (
    lower.includes(':7860') ||
    lower.includes('/gradio_api') ||
    lower.includes('indextts')
  )
}

function fileDataFromPath(path: string): { path: string; meta: { _type: 'gradio.FileData' } } {
  return {
    path,
    meta: { _type: 'gradio.FileData' },
  }
}

/**
 * 模型不可用时的本地闲聊兜底，避免反复输出同一条功能说明。
 */
function buildLocalSmallTalkReply(text: string): string {
  const raw = text.trim()
  if (!raw) return '我在，想聊什么都可以。'
  if (/(吃饭|吃了吗|午饭|晚饭|早餐)/.test(raw)) {
    return '还没呢，我是数字生命，主打一个陪你聊和帮你把流程跑顺。你今天吃了什么？'
  }
  if (/(你好|在吗|哈喽|嗨)/.test(raw)) {
    return '在的在的，我在这。你可以闲聊，也可以直接让我操作节点。'
  }
  if (/(干嘛|做什么|会什么|能做什么)/.test(raw)) {
    return '我能聊日常，也能帮你新建节点、连线、执行节点。你说一句我就动手。'
  }
  return '我能继续陪你聊，也能直接帮你操作画布。你可以说具体目标，或者继续随便聊聊。'
}

function pickFirstPathLikeValue(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = pickFirstPathLikeValue(item)
      if (found) return found
    }
    return ''
  }
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>
    const direct =
      pickFirstPathLikeValue(record.path) ||
      pickFirstPathLikeValue(record.file_path) ||
      pickFirstPathLikeValue(record.name) ||
      pickFirstPathLikeValue(record.url)
    if (direct) return direct
    for (const value of Object.values(record)) {
      const found = pickFirstPathLikeValue(value)
      if (found) return found
    }
  }
  return ''
}

function pickAudioAddressFromUnknown(input: unknown): { url: string; path: string } {
  if (!input) return { url: '', path: '' }
  if (typeof input === 'string') {
    const v = input.trim()
    if (/^https?:\/\//i.test(v)) return { url: v, path: '' }
    if (/\.(mp3|wav|flac|ogg|m4a)(\?|$)/i.test(v) || v.includes('/tmp/') || v.includes('\\tmp\\')) {
      return { url: '', path: v }
    }
    return { url: '', path: '' }
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const got = pickAudioAddressFromUnknown(item)
      if (got.url || got.path) return got
    }
    return { url: '', path: '' }
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const directUrl = String(obj.url || obj.audio_url || '').trim()
    const directPath = String(obj.path || obj.file_path || obj.name || '').trim()
    if (directUrl || /\.(mp3|wav|flac|ogg|m4a)(\?|$)/i.test(directPath) || directPath.includes('/tmp/')) {
      return { url: directUrl, path: directPath }
    }
    for (const value of Object.values(obj)) {
      const got = pickAudioAddressFromUnknown(value)
      if (got.url || got.path) return got
    }
  }
  return { url: '', path: '' }
}

/**
 * 右下角虚拟人状态推导：与 AI 助手消息流保持一致。
 */
function resolveDockAssistantAvatarState(params: {
  busy: boolean
  messages: AiAssistantMessage[]
}): AssistantAvatarState {
  const { busy, messages } = params
  const lastMessage = messages[messages.length - 1]
  const lastText = String(lastMessage?.text || '')
  if (busy) {
    if (lastMessage?.role === 'assistant' && lastText.includes('已生成')) return 'acting'
    return 'thinking'
  }
  if (!lastMessage) return 'talking'
  if (lastMessage.role === 'system' && lastText.includes('执行失败')) return 'error'
  if (lastMessage.role === 'assistant' && lastText.startsWith('已')) return 'success'
  if (lastMessage.role === 'assistant') return 'talking'
  return 'listening'
}

/** 默认节点标题前缀；若改文案需同步 `src/lib/nodeMentions.ts` 中 `DEFAULT_NODE_TITLE_INDEX_PREFIXES`。 */
const NODE_KIND_LABEL: Record<StudioNodeKind, string> = {
  text: '文字',
  script: '剧本',
  image: '图片',
  video: '视频',
  audio: '音频',
  music: '音乐',
  panorama: 'VR360全景',
}

/**
 * 生成某类型节点的默认标题序号：始终取当前可用的最小正整数，避免出现“只剩两个却是节点3”。
 */
function getNextNodeTitleIndex(
  nodes: Array<Node<StudioNodeData>>,
  kind: StudioNodeKind,
): number {
  const used = new Set<number>()
  const prefix = `${NODE_KIND_LABEL[kind]}节点`
  nodes.forEach((node) => {
    if (node.data.kind !== kind) return
    const title = String(node.data.title ?? '')
    if (!title.startsWith(prefix)) return
    const rest = title.slice(prefix.length).trim()
    const match = rest.match(/^(\d+)/)
    const parsed = match ? Number(match[1]) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      used.add(parsed)
    }
  })
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

/**
 * 在已有节点标题 + 本次已占用标题集合上，取某类型「默认节点名」的下一个序号（任意节点标题匹配 `文字节点N` 形式即占用序号）。
 */
function getNextNodeTitleIndexConsideringAllocated(
  nodeList: Array<Node<StudioNodeData>>,
  kind: StudioNodeKind,
  allocatedTitles: Set<string>,
): number {
  const used = new Set<number>()
  const prefix = `${NODE_KIND_LABEL[kind]}节点`
  const consume = (raw: string) => {
    const title = String(raw ?? '').trim()
    if (!title.startsWith(prefix)) return
    const rest = title.slice(prefix.length).trim()
    const match = rest.match(/^(\d+)/)
    const parsed = match ? Number(match[1]) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      used.add(parsed)
    }
  }
  nodeList.forEach((node) => consume(String(node.data.title ?? '')))
  allocatedTitles.forEach((t) => consume(t))
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

/**
 * 在集合中登记并返回不与画布冲突的标题；冲突时按“文件夹式”尾号递增（`模特图1`→`模特图2`）。
 */
function allocateUniqueNodeTitle(allocated: Set<string>, base: string): string {
  const trimmed = String(base || '').trim() || '节点'
  if (!allocated.has(trimmed)) {
    allocated.add(trimmed)
    return trimmed
  }
  const m = trimmed.match(/^(.*?)(\d+)$/)
  const head = (m ? m[1] : trimmed).trim() || trimmed
  let n = m ? Number.parseInt(m[2], 10) + 1 : 2
  for (;;) {
    const candidate = `${head}${n}`
    if (!allocated.has(candidate)) {
      allocated.add(candidate)
      return candidate
    }
    n += 1
  }
}

/**
 * 用于「图-xxx」派生命名的标题清洗（避免路径非法字符）。
 */
function sanitizeTitleForImageDerivedName(raw: string): string {
  return String(raw ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\u3000/g, ' ')
    .trim()
}

/**
 * 判断标题是否仍为「图片节点 + 纯数字」的自动命名形态。
 */
function isDefaultStyledImageNodeTitle(title: string): boolean {
  const t = String(title ?? '').trim()
  const prefix = `${NODE_KIND_LABEL.image}节点`
  if (!t.startsWith(prefix)) return false
  const rest = t.slice(prefix.length).trim()
  return /^\d+$/.test(rest)
}

/**
 * 由锚点推导「右键/批量/分支」新建图片节点的基础标题：`图-锚点标题`。
 * 锚点无标题或标题仍为「图片节点N」时返回空串，由外层生成「图片节点」顺延序号。
 */
function buildImageLinkedNewNodeBaseTitle(anchor: Node<StudioNodeData>): string {
  const t = String(anchor.data.title ?? '').trim()
  if (!t || isDefaultStyledImageNodeTitle(t)) return ''
  const safe = sanitizeTitleForImageDerivedName(t).slice(0, 120)
  return safe ? `图-${safe}` : ''
}

type SplitCategory = 'role' | 'scene' | 'asset'

const SPLIT_CATEGORY_LABEL: Record<SplitCategory, string> = {
  role: '角色',
  scene: '场景',
  asset: '资产',
}

/**
 * 将文本按“角色/场景/资产”分组，并进一步拆成单条记录。
 */
function splitTextByCategory(raw: string): Array<{
  category: SplitCategory
  title: string
  body: string
}> {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Array<{ category: SplitCategory; lines: string[] }> = []

  const normalizeLine = (line: string): string =>
    line.replace(/^[\s\u3000]*[-*?·\d.、）)]+\s*/u, '').trim()

  const detectCategory = (line: string): SplitCategory | null => {
    if (/^(角色|人物)(\s*[：:]\s*|\s*$)/u.test(line)) return 'role'
    if (/^场景(\s*[：:]\s*|\s*$)/u.test(line)) return 'scene'
    if (/^(资产|道具)(\s*[：:]\s*|\s*$)/u.test(line)) return 'asset'
    return null
  }

  let currentCategory: SplitCategory | null = null
  let currentLines: string[] = []
  const flushBlock = () => {
    if (!currentCategory) return
    const compact = currentLines.map((line) => line.trim()).filter((line) => line !== '')
    if (!compact.length) return
    blocks.push({ category: currentCategory, lines: compact })
  }

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)
    if (!line) continue
    const found = detectCategory(line)
    if (found) {
      flushBlock()
      currentCategory = found
      const inline = line.replace(/^(角色|人物|场景|资产|道具)\s*[：:]?\s*/u, '').trim()
      currentLines = inline ? [inline] : []
      continue
    }
    if (currentCategory) {
      currentLines.push(line)
    }
  }
  flushBlock()

  const extractTitleHint = (category: SplitCategory, linesOfEntry: string[]): string => {
    // 优先取中文标题行（角色/人物/场景/资产），其次取 @ 标签内容。
    for (const line of linesOfEntry) {
      if (category === 'role') {
        const role = line.match(/^(?:角色|人物|姓名)\s*[：:]\s*(.+)$/u)
        if (role?.[1]) return role[1].trim().slice(0, 24)
      } else if (category === 'scene') {
        const scene = line.match(/^(?:场景|镜头|地点)\s*[：:]\s*(.+)$/u)
        if (scene?.[1]) return scene[1].trim().slice(0, 24)
      } else {
        const asset = line.match(/^(?:资产|道具)\s*[：:]\s*(.+)$/u)
        if (asset?.[1]) return asset[1].trim().slice(0, 24)
      }
    }
    for (const line of linesOfEntry) {
      const tag = line.match(/^@\w+\s*[：:]\s*(.+)$/u)
      if (tag?.[1]) return tag[1].trim().slice(0, 24)
    }
    return ''
  }

  const results: Array<{ category: SplitCategory; title: string; body: string }> = []
  blocks.forEach((block) => {
    const items: Array<{ titleHint?: string; body: string }> = []
    let currLines: string[] = []
    const pushItem = () => {
      const body = currLines.join('\n').trim()
      if (!body) return
      items.push({ titleHint: extractTitleHint(block.category, currLines), body })
      currLines = []
    }

    block.lines.forEach((line) => {
      currLines.push(line)
      // 新规则：每个资产/角色/场景实体以 @ 行收尾（例如 @character:小石头）。
      if (/^@\w+/.test(line)) {
        pushItem()
      }
    })
    // 若末尾没有 @ 结尾，也保留最后一段，避免内容丢失。
    pushItem()

    const finalItems = items.length
      ? items
      : [{ body: block.lines.join('\n').trim(), titleHint: undefined }]
    finalItems.forEach((entry, idx) => {
      results.push({
        category: block.category,
        title:
          entry.titleHint?.slice(0, 24) ||
          `${SPLIT_CATEGORY_LABEL[block.category]}${idx + 1}`,
        body: entry.body,
      })
    })
  })

  return results
}

type TextSplitMode = 'asset' | 'storyboard' | 'symbol'

/**
 * 按「分镜 + 序号 + 提示词卡」锚点拆成多段（与资产拆分同样产出 `title` / `body`，便于落画布节点）。
 * - 锚点示例：`分镜 01 提示词卡`、`分镜01 提示词卡`、`分镜 1 提示词卡`；
 * - 首段锚点之前的正文会合并进第一段，避免丢失前言。
 */
function splitTextByStoryboard(raw: string): Array<{ title: string; body: string }> {
  const text = raw.replace(/\r\n?/g, '\n')
  const anchorRe = /分镜\s*(\d+)\s*提示词卡/giu
  const hits: Array<{ index: number; len: number; num: string }> = []
  let m: RegExpExecArray | null
  const re = new RegExp(anchorRe.source, anchorRe.flags)
  while ((m = re.exec(text)) !== null) {
    hits.push({ index: m.index, len: m[0].length, num: m[1] })
  }
  if (!hits.length) return []

  const preamble = hits[0].index > 0 ? text.slice(0, hits[0].index).trim() : ''
  const out: Array<{ title: string; body: string }> = []
  for (let i = 0; i < hits.length; i += 1) {
    const h = hits[i]
    const after = h.index + h.len
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length
    let body = text.slice(after, end).trim()
    if (i === 0 && preamble) {
      body = body ? `${preamble}\n\n${body}` : preamble
    }
    const n = Number.parseInt(h.num, 10)
    const nn = Number.isFinite(n) ? String(n).padStart(2, '0') : h.num
    const title = `分镜 ${nn} 提示词卡`
    if (!body.trim()) continue
    out.push({ title, body: body.trim() })
  }
  return out
}

/**
 * 按固定分隔符拆分文本段落：`###` / `---` / `@@`。
 * - 分隔符可单独成行，也可出现在行内；
 * - 连续分隔符会自动忽略空段；
 * - 每段标题默认按「段落N」生成。
 */
function splitTextByFixedDelimiters(raw: string): Array<{ title: string; body: string }> {
  const text = String(raw || '').replace(/\r\n?/g, '\n')
  const chunks = text
    .split(/(?:###|---|@@)/g)
    .map((part) => part.trim())
    .filter(Boolean)
  return chunks.map((body, idx) => ({ title: `段落${idx + 1}`, body }))
}

/**
 * 按目标节点类型构造“引用继承”补丁：写入 `@[标题](上游节点id)`，绑定具体节点而非标题猜测。
 */
function buildInheritedPatchForTarget(
  target: StudioNodeData,
  sourceTitle: string,
  sourceNodeId: string,
): Partial<StudioNodeData> | null {
  const cleanTitle = sourceTitle.trim()
  if (!cleanTitle || !sourceNodeId) return null
  const mention = buildMentionToken(cleanTitle, sourceNodeId)
  const injectMention = (value: string | undefined): string => {
    const raw = value || ''
    if (mentionAlreadyReferencesNodeId(raw, sourceNodeId)) return raw
    return raw.trim() ? `${mention}\n${raw}` : mention
  }
  if (target.kind === 'text') return { kind: 'text', body: injectMention(target.body) }
  if (target.kind === 'script') return { kind: 'script', body: injectMention(target.body) }
  if (target.kind === 'image') return { kind: 'image', prompt: injectMention(target.prompt) }
  if (target.kind === 'video') return { kind: 'video', prompt: injectMention(target.prompt) }
  if (target.kind === 'audio') return { kind: 'audio', note: injectMention(target.note) }
  if (target.kind === 'music') return { kind: 'music', note: injectMention(target.note) }
  return null
}

type MentionMatch = {
  start: number
  end: number
  query: string
}

/**
 * 检测光标前是否处于 @ 引用输入中（支持 @节点名 与 @[节点名] 两种语法）。
 */
function detectMentionAtCaret(value: string, caret: number): MentionMatch | null {
  const before = value.slice(0, caret)
  const bracket = before.match(/@\[(?<q>[^\]]*)$/u)
  if (bracket?.groups?.q != null) {
    return {
      start: before.lastIndexOf('@['),
      end: caret,
      query: bracket.groups.q,
    }
  }
  const plain = before.match(/@(?<q>[^\s@，。！？；;：:,]*)$/u)
  if (plain?.groups?.q != null) {
    return {
      start: before.lastIndexOf('@'),
      end: caret,
      query: plain.groups.q,
    }
  }
  return null
}

function insertTextAtCaret(
  el: HTMLTextAreaElement,
  textToInsert: string,
  fallbackCaret?: number,
): { nextValue: string; nextCaret: number } {
  const v = el.value ?? ''
  const start = Number.isFinite(el.selectionStart) ? (el.selectionStart ?? v.length) : (fallbackCaret ?? v.length)
  const end = Number.isFinite(el.selectionEnd) ? (el.selectionEnd ?? start) : start
  const before = v.slice(0, start)
  const after = v.slice(end)
  const insert = String(textToInsert || '')
  const nextValue = `${before}${insert}${after}`
  const nextCaret = before.length + insert.length
  return { nextValue, nextCaret }
}

/**
 * 若文本开头是连续 `@[节点](id)` 行，则按参考图顺序重排这些行。
 * 仅调整“开头引用块”，正文内容保持不变。
 */
function reorderLeadingMentionLinesByReferenceOrder(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId: string,
  referenceOrderUrls: string[],
): string {
  const normalized = String(text || '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  let end = 0
  while (end < lines.length) {
    const t = lines[end].trim()
    if (!t) {
      if (end === 0) return text
      break
    }
    if (!/^@\[[^\]]+\]\([0-9a-fA-F-]{36}\)$/.test(t)) break
    end += 1
  }
  if (end < 2) return text
  const headBlock = lines.slice(0, end).join('\n')
  const attachments = listMentionImageAttachments(headBlock, nodes, currentNodeId)
  if (attachments.length < 2) return text
  const order = new Map<string, number>()
  referenceOrderUrls.forEach((u, idx) => {
    const key = String(u || '').trim()
    if (!key || order.has(key)) return
    order.set(key, idx)
  })
  const sortedMentions = [...attachments]
    .sort((a, b) => {
      const ai = order.get(String(a.url || '').trim())
      const bi = order.get(String(b.url || '').trim())
      const ah = ai != null
      const bh = bi != null
      if (ah && bh && ai !== bi) return (ai as number) - (bi as number)
      if (ah && !bh) return -1
      if (!ah && bh) return 1
      return 0
    })
    .map((x) => x.mention.trim())
  const dedup = Array.from(new Set(sortedMentions))
  if (dedup.length < 2) return text
  const rest = lines.slice(end).join('\n')
  return rest ? `${dedup.join('\n')}\n${rest}` : dedup.join('\n')
}

/**
 * 按“开头 @ 引用行”索引重排，仅改写开头引用块，正文保持不变。
 */
function reorderLeadingMentionLinesByIndex(text: string, fromIndex: number, toIndex: number): string {
  const normalized = String(text || '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  let end = 0
  while (end < lines.length) {
    const t = lines[end].trim()
    if (!t) {
      if (end === 0) return text
      break
    }
    if (!/^@\[[^\]]+\]\([0-9a-fA-F-]{36}\)$/.test(t)) break
    end += 1
  }
  if (end < 2) return text
  const head = [...lines.slice(0, end)]
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= head.length || toIndex >= head.length || fromIndex === toIndex) {
    return text
  }
  const [picked] = head.splice(fromIndex, 1)
  head.splice(toIndex, 0, picked)
  const rest = lines.slice(end).join('\n')
  return rest ? `${head.join('\n')}\n${rest}` : head.join('\n')
}

/**
 * 按「@ 引用解析出的 URL 顺序」重排参考图数组，并保持未被引用的项在末尾原相对顺序。
 */
function syncReferenceOrderByMentionUrls(
  refs: string[],
  ids: string[],
  mentionUrls: string[],
): { refs: string[]; ids: string[] } {
  const normalizedMentions = mentionUrls.map((u) => String(u || '').trim()).filter(Boolean)
  if (!normalizedMentions.length || !refs.length) return { refs, ids }
  const used = new Array(refs.length).fill(false)
  const nextRefs: string[] = []
  const nextIds: string[] = []
  for (const mentionUrl of normalizedMentions) {
    const hit = refs.findIndex((u, i) => !used[i] && String(u || '').trim() === mentionUrl)
    if (hit < 0) continue
    used[hit] = true
    nextRefs.push(refs[hit])
    if (ids.length > hit) nextIds.push(ids[hit])
  }
  refs.forEach((u, i) => {
    if (used[i]) return
    nextRefs.push(u)
    if (ids.length > i) nextIds.push(ids[i])
  })
  return { refs: nextRefs, ids: nextIds }
}

/**
 * 执行前解析当前节点中的 @ 引用：文本类仍展开为被引用节点的正文；
 * @ 图片/视频等仅合并其产出 URL 到参考图，主图优先用 @ 到的第一张，不把上游生成用的长提示词写进本节点文案。
 */
function withResolvedNodeMentions(
  node: Node<StudioNodeData>,
  allNodes: Array<Node<StudioNodeData>>,
): Node<StudioNodeData> {
  const data = node.data
  if (data.kind === 'text' || data.kind === 'script') {
    const nextBody = resolveNodeMentionsInText(data.body || '', allNodes, node.id)
    return {
      ...node,
      data: { ...data, body: nextBody } as StudioNodeData,
    }
  }
  if (data.kind === 'image' || data.kind === 'video') {
    const referencedImages = collectMentionImageSources(data.prompt || '', allNodes, node.id)
    const nextPrompt = resolveNodeMentionsInText(data.prompt || '', allNodes, node.id)
    const prevRefs = data.referenceImageSources?.filter(Boolean) ?? []
    const mergedRefs = Array.from(new Set([...prevRefs, ...referencedImages]))
    /** 保留用户已选主图；仅在主图为空时，才回退到提示里 @ 到的第一张图。 */
    const nextSrc =
      String(data.src || '').trim() ||
      (referencedImages.length > 0 ? referencedImages[0] : '')
    return {
      ...node,
      data: {
        ...data,
        prompt: nextPrompt,
        src: nextSrc,
        referenceImageSources: mergedRefs,
      } as StudioNodeData,
    }
  }
  if (data.kind === 'panorama') {
    return node
  }
  if (data.kind === 'group') {
    return node
  }
  if (data.kind === 'audio' || data.kind === 'music') {
    const referencedImages = collectMentionImageSources(data.note || '', allNodes, node.id)
    const nextNote = resolveNodeMentionsInText(data.note || '', allNodes, node.id)
    const prevRefs = data.referenceImageSources?.filter(Boolean) ?? []
    const mergedRefs = Array.from(new Set([...prevRefs, ...referencedImages]))
    const nextSrc =
      String(data.src || '').trim() ||
      (referencedImages.length > 0 ? referencedImages[0] : '')
    return {
      ...node,
      data: {
        ...data,
        note: nextNote,
        src: nextSrc,
        referenceImageSources: mergedRefs,
      } as StudioNodeData,
    }
  }
  const nextNote = resolveNodeMentionsInText(data.note || '', allNodes, node.id)
  return {
    ...node,
    data: { ...data, note: nextNote } as StudioNodeData,
  }
}

/**
 * 粘贴节点时重写文本里的 `@[标题](节点id)`：
 * 若被引用目标也在本次粘贴集合内，则把旧 id 映射到新 id，并同步为新标题。
 */
function remapMentionIdsInTextForPaste(
  text: string,
  oldToNewIdMap: Map<string, string>,
  pastedNodeTitleById: Map<string, string>,
): string {
  const raw = String(text || '')
  if (!raw.includes('@')) return raw
  const refs = parseMentionRefs(raw)
  if (!refs.length) return raw
  let next = raw
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const ref = refs[i]
    const oldId = String(ref.nodeId || '').trim()
    if (!oldId) continue
    const newId = oldToNewIdMap.get(oldId)
    if (!newId) continue
    const newLabel = String(pastedNodeTitleById.get(newId) || ref.label || '').trim() || ref.label
    const token = buildMentionToken(newLabel, newId)
    next = `${next.slice(0, ref.start)}${token}${next.slice(ref.end)}`
  }
  return next
}

type LocalProjectTab = {
  id: string
  name: string
  snapshot: Omit<ProjectSnapshot, 'version' | 'name'>
  /** 本地项目库中的条目 id；存在时 Ctrl+S / 保存会同步写入库。 */
  libraryId?: string | null
  /** 从首页（工程目录）打开时记录来源文件路径，用于去重与删除联动。 */
  filePath?: string | null
}

function normalizeWindowsPathKey(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  // Normalize slashes and casing to avoid duplicate tabs for the same file.
  // Examples that should be treated as identical:
  // - D:\proj\a.json  vs  d:/proj/a.json
  // - Mixed separators from different sources
  const s = raw.replace(/\//g, '\\').replace(/\\+/g, '\\')
  return s.toLowerCase()
}

type CanvasClipboard = {
  nodes: Node<StudioNodeData>[]
  edges: Edge[]
}

type PendingConnectContext = {
  nodeId: string
  handleType: 'source' | 'target'
}

type PendingConnectPreview = {
  ghostNodeId: string
  edgeId: string
}

/**
 * 根据节点类型返回小地图配色。
 */
function minimapColor(node: Node<StudioNodeData>): string {
  if (node.selected) {
    return '#b6becd'
  }
  return '#6f7786'
}

/**
 * 创建一个全新的空白画布快照。
 */
function createEmptyCanvasSnapshot(): Omit<ProjectSnapshot, 'version' | 'name'> {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

/**
 * 判断快照是否包含用户实际编辑内容（非空白初始画布）。
 */
function hasMeaningfulSnapshotContent(snapshot: {
  nodes?: Array<unknown>
  edges?: Array<unknown>
}): boolean {
  const nodeCount = Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0
  const edgeCount = Array.isArray(snapshot.edges) ? snapshot.edges.length : 0
  return nodeCount > 0 || edgeCount > 0
}

/**
 * 判断主图/视频地址是否为远端或 Comfy `/view` 链（不应再被本地 IndexedDB 主图 id 覆盖）。
 */
function isRemoteOrComfyViewSrc(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  if (s.startsWith('http://') || s.startsWith('https://')) return true
  if (s.includes('/view?') || s.startsWith('/__comfy')) return true
  return false
}

/**
 * 将节点数据中的本地图片资产 id（IndexedDB）还原为可显示 URL。
 * 仅做“显示态修复”，不改动既有业务字段逻辑。
 */
async function hydrateNodesLocalImageAssets(
  nodeList: Array<Node<StudioNodeData>>,
): Promise<Array<Node<StudioNodeData>>> {
  let mutated = false
  const nextNodes: Array<Node<StudioNodeData>> = []
  for (const node of nodeList) {
    const data = node.data
    const normalizedRunStatus =
      data.runStatus === 'queued' || data.runStatus === 'running'
        ? 'idle'
        : data.runStatus
    const runtimeChanged =
      normalizedRunStatus !== data.runStatus || data.runProgress != null
    const normalizedData = runtimeChanged
      ? ({
          ...data,
          runStatus: normalizedRunStatus,
          runProgress: undefined,
        } as StudioNodeData)
      : data
    if (data.kind === 'image' || data.kind === 'video' || data.kind === 'audio' || data.kind === 'music') {
      const srcAssetId = String(normalizedData.srcAssetId || '').trim()
      const persistedSrc = String(normalizedData.src || '').trim()
      let nextSrc = persistedSrc
      /** Comfy 回写后的远端 URL 若仍挂着旧的 srcAssetId，hydrate 时不得用本地图盖掉 */
      if (srcAssetId && !isRemoteOrComfyViewSrc(nextSrc)) {
        const restored = await getLocalImageAssetObjectUrl(srcAssetId)
        if (restored) {
          nextSrc = restored
        }
      }
      const shouldClearStaleMainAssetId = Boolean(srcAssetId) && isRemoteOrComfyViewSrc(persistedSrc)
      const refIds = normalizedData.referenceImageAssetIds ?? []
      const oldRefs = normalizedData.referenceImageSources ?? []
      const nextRefs = [...oldRefs]
      for (let i = 0; i < refIds.length; i += 1) {
        const aid = String(refIds[i] || '').trim()
        if (!aid) continue
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (!restored) continue
        nextRefs[i] = restored
      }
      const srcChanged = nextSrc !== persistedSrc
      const refsChanged = nextRefs.some((item, idx) => item !== oldRefs[idx])
      if (srcChanged || refsChanged || shouldClearStaleMainAssetId || runtimeChanged) {
        mutated = true
        nextNodes.push({
          ...node,
          data: {
            ...normalizedData,
            src: nextSrc,
            ...(shouldClearStaleMainAssetId ? { srcAssetId: undefined } : {}),
            referenceImageSources: nextRefs,
          } as StudioNodeData,
        })
      } else {
        nextNodes.push(node)
      }
      continue
    }
    if (data.kind === 'panorama') {
      const aid = String(normalizedData.srcAssetId || '').trim()
      if (!aid) {
        if (runtimeChanged) {
          mutated = true
          nextNodes.push({
            ...node,
            data: normalizedData,
          })
        } else {
          nextNodes.push(node)
        }
        continue
      }
      const restored = await getLocalImageAssetObjectUrl(aid)
      if (restored && restored !== String(normalizedData.src || '').trim()) {
        mutated = true
        nextNodes.push({
          ...node,
          data: {
            ...normalizedData,
            src: restored,
          } as StudioNodeData,
        })
      } else if (runtimeChanged) {
        mutated = true
        nextNodes.push({
          ...node,
          data: normalizedData,
        })
      } else {
        nextNodes.push(node)
      }
      continue
    }
    if (runtimeChanged) {
      mutated = true
      nextNodes.push({
        ...node,
        data: normalizedData,
      })
    } else {
      nextNodes.push(node)
    }
  }
  return mutated ? nextNodes : nodeList
}

/** 画布上浮动「添加节点」卡片的预估宽高，用于贴近视口边缘时钳位。 */
const CANVAS_ADD_MENU_EST_W = 172
const CANVAS_ADD_MENU_EST_H = 300
/** 多选右键菜单（主菜单）预估尺寸：用于贴边钳位 */
const MULTI_SELECT_CTX_MENU_EST_W = 168
const MULTI_SELECT_CTX_MENU_EST_H = 168
/** 「添加节点」子菜单预估尺寸：用于贴边钳位 */
const MULTI_SELECT_SYNC_SUBMENU_EST_W = CANVAS_ADD_MENU_EST_W
const NODE_APPEND_GAP = 60
const DEFAULT_NODE_WIDTH = 430
const DEFAULT_NODE_HEIGHT = 340
const PROMPT_PANEL_MIN_ZOOM_PERCENT = 0
const GROUP_PADDING = 24

type DomMouseEvent = globalThis.MouseEvent

/**
 * 右键菜单：「添加节点」子菜单项（与左侧面板/画布添加节点入口的类型集合保持一致）。
 */
const SYNC_ADD_MENU_ITEMS: ReadonlyArray<{
  id: 'text' | 'image' | 'video' | 'audio' | 'music' | 'panorama'
  title: string
  icon: string
  kind: StudioNodeKind
}> = [
  { id: 'text', title: '文本', icon: ICON_NODE_TEXT, kind: 'text' },
  { id: 'image', title: '图片', icon: ICON_NODE_IMAGE, kind: 'image' },
  { id: 'panorama', title: 'VR360 全景', icon: ICON_NODE_PANORAMA, kind: 'panorama' },
  { id: 'video', title: '视频', icon: ICON_NODE_VIDEO, kind: 'video' },
  { id: 'audio', title: '配音', icon: ICON_NODE_AUDIO, kind: 'audio' },
  { id: 'music', title: '音乐', icon: ICON_NODE_MUSIC, kind: 'music' },
]

/**
 * 读取节点当前尺寸（优先实时测量值），用于计算“后接新增”的精确间距。
 */
function getNodeSize(node: Node<StudioNodeData>): { width: number; height: number } {
  const width = Number(node.measured?.width ?? node.width ?? node.style?.width ?? DEFAULT_NODE_WIDTH)
  const height = Number(
    node.measured?.height ?? node.height ?? node.style?.height ?? DEFAULT_NODE_HEIGHT,
  )
  return {
    width: Number.isFinite(width) ? width : DEFAULT_NODE_WIDTH,
    height: Number.isFinite(height) ? height : DEFAULT_NODE_HEIGHT,
  }
}

/**
 * 计算一组节点在画布中的包围盒（基于节点位置和尺寸）。
 */
function getNodesBounds(nodes: Array<Node<StudioNodeData>>): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  if (!nodes.length) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  nodes.forEach((node) => {
    const { width, height } = getNodeSize(node)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  })
  return { minX, minY, maxX, maxY }
}

/**
 * 将弹出位置限制在视口内，避免卡片被裁切。
 */
function clampCanvasAddMenuPosition(
  clientX: number,
  clientY: number,
): { left: number; top: number } {
  const pad = 8
  let left = clientX + pad
  let top = clientY + pad
  const maxLeft = Math.max(
    pad,
    window.innerWidth - CANVAS_ADD_MENU_EST_W - pad,
  )
  const maxTop = Math.max(
    pad,
    window.innerHeight - CANVAS_ADD_MENU_EST_H - pad,
  )
  left = Math.min(Math.max(pad, left), maxLeft)
  top = Math.min(Math.max(pad, top), maxTop)
  return { left, top }
}

/**
 * 将多选右键菜单限制在视口内，避免被裁切。
 */
function clampMultiSelectContextMenuPosition(
  clientX: number,
  clientY: number,
): { left: number; top: number } {
  const pad = 8
  let left = clientX + pad
  let top = clientY + pad
  const maxLeft = Math.max(
    pad,
    window.innerWidth - MULTI_SELECT_CTX_MENU_EST_W - pad,
  )
  const maxTop = Math.max(
    pad,
    window.innerHeight - MULTI_SELECT_CTX_MENU_EST_H - pad,
  )
  left = Math.min(Math.max(pad, left), maxLeft)
  top = Math.min(Math.max(pad, top), maxTop)
  return { left, top }
}

/**
 * 查找包含指定成员节点 id 的分组框节点 id（无则返回 null）。
 */
function findGroupIdContainingMember(
  allNodes: Array<Node<StudioNodeData>>,
  memberId: string,
): string | null {
  const group = allNodes.find(
    (n) =>
      n.type === 'group' &&
      n.data.kind === 'group' &&
      (n.data.memberIds ?? []).includes(memberId),
  )
  return group?.id ?? null
}

/** 「本地项目」弹层与顶栏触发按钮下边界的间距（像素）。 */
const LOCAL_PROJECTS_POPOVER_GAP_PX = 20

type PromptPanelDropdownOption = { value: string; label: string; disabled?: boolean }

function PromptPanelDropdown({
  value,
  placeholder,
  options,
  onChange,
  className,
  ariaLabel,
  title,
}: {
  value?: string
  placeholder: string
  options: PromptPanelDropdownOption[]
  onChange: (value: string) => void
  className: string
  ariaLabel?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const activeLabel = useMemo(() => {
    const picked = options.find((o) => o.value === value)
    return picked?.label || placeholder
  }, [options, placeholder, value])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent | TouchEvent) => {
      const el = rootRef.current
      if (!el) return
      if (event.target instanceof Node && el.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('touchstart', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('touchstart', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className="pp-select" data-open={open ? '1' : '0'}>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {activeLabel}
      </button>
      {open ? (
        <div className="pp-select__menu" role="listbox" aria-label={ariaLabel || placeholder}>
          {options.map((opt) => {
            const selected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={opt.disabled}
                className={`pp-select__item ${selected ? 'is-selected' : ''}`}
                onClick={() => {
                  if (opt.disabled) return
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 画布与顶栏、节点面板的组合体（需在 ReactFlowProvider 内）。
 */
function StudioCanvasInner({ onGoHome }: { onGoHome?: () => void }) {
  const loaded = useMemo(() => loadStoredProject(), [])
  const initialProjectId = useMemo<string>(() => crypto.randomUUID(), [])
  const [projectTabs, setProjectTabs] = useState<LocalProjectTab[]>([
    {
      id: initialProjectId,
      name: loaded.name || '项目一',
      snapshot: {
        nodes: loaded.nodes,
        edges: loaded.edges,
        viewport: loaded.viewport,
      },
      /** 首标签与浏览器默认存档绑定，本地项目列表可立即读到当前工程 */
      libraryId: DEFAULT_WORKSPACE_LIBRARY_ID,
    },
  ])
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProjectId)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [nodes, setNodes] = useNodesState(loaded.nodes)
  /** 执行时读取最新画布节点，避免下拉刚改工作流仍拿到旧闭包里的 `nodes` */
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  /**
   * 当任意节点标题变更时，刷新画布中所有 `@[标题](节点id)` 的标题部分：
   * - 解析仍按 id 绑定；
   * - 只改写 label，避免出现“节点改名了但提示框继承还是旧标题”的错觉。
   */
  const titleByIdRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const nextMap = new Map<string, string>()
    for (const n of nodes) {
      nextMap.set(String(n.id || ''), String((n.data as StudioNodeData)?.title ?? '').trim())
    }
    const prevMap = titleByIdRef.current
    let anyTitleChanged = false
    if (prevMap.size !== nextMap.size) {
      anyTitleChanged = true
    } else {
      for (const [id, t] of nextMap) {
        if (prevMap.get(id) !== t) {
          anyTitleChanged = true
          break
        }
      }
    }
    titleByIdRef.current = nextMap
    if (!anyTitleChanged) return

    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        const kind = String((node.data as StudioNodeData)?.kind || '')
        if (!kind) return node

        const rewrite = (value: string | undefined) => {
          const res = refreshMentionLabelsInText(String(value || ''), prev as any)
          return res
        }

        if (kind === 'text') {
          const d = node.data as TextNodeData
          const r = rewrite(d.body)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, body: r.text } as any }
        }
        if (kind === 'script') {
          const d = node.data as ScriptNodeData
          const r = rewrite(d.body)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, body: r.text } as any }
        }
        if (kind === 'image') {
          const d = node.data as ImageNodeData
          const r = rewrite(d.prompt)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, prompt: r.text } as any }
        }
        if (kind === 'video') {
          const d = node.data as VideoNodeData
          const r = rewrite(d.prompt)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, prompt: r.text } as any }
        }
        if (kind === 'audio') {
          const d = node.data as AudioNodeData
          const r = rewrite(d.note)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, note: r.text } as any }
        }
        if (kind === 'music') {
          const d = node.data as AudioNodeData
          const r = rewrite(d.note)
          if (!r.changed) return node
          changed = true
          return { ...node, data: { ...d, note: r.text } as any }
        }
        return node
      })
      return changed ? next : prev
    })
  }, [nodes, setNodes])
  /**
   * 节点标题全局唯一约束：任意时刻都不允许画布上出现重名。
   * 规则与文件夹一致：同名时按尾号递增（如 `模特图1` → `模特图2`）。
   */
  useEffect(() => {
    setNodes((prev) => {
      const allocated = new Set<string>()
      let changed = false
      const next = prev.map((node) => {
        if (node.type === 'ghost' || node.type === 'group') return node
        const rawTitle = String(node.data.title ?? '').trim()
        const k = String(node.data.kind || '') as StudioNodeKind
        const fallback = `${NODE_KIND_LABEL[k] || '节点'}节点`
        const unique = allocateUniqueNodeTitle(allocated, rawTitle || fallback)
        if (unique === rawTitle) return node
        changed = true
        return {
          ...node,
          data: { ...node.data, title: unique } as StudioNodeData,
        }
      })
      return changed ? next : prev
    })
  }, [setNodes])
  /** 为 true 时表示正在拖动画布节点：撤销记录跳过中间帧，松手后再压一条 */
  const nodeCanvasDragActiveRef = useRef(false)
  const altDragCloneRef = useRef<{
    active: boolean
    sourceNodeIds: string[]
    sourceNodesAtDragStart: Array<Node<StudioNodeData>>
  }>({
    active: false,
    sourceNodeIds: [],
    sourceNodesAtDragStart: [],
  })
  const [edges, setEdges, onEdgesChange] = useEdgesState(loaded.edges)
  const [viewportVersion, setViewportVersion] = useState(0)
  /** 节点拖动结束后递增，配合 `nodeCanvasDragActiveRef` 在撤销栈中合并为一步 */
  const [postDragUndoTick, setPostDragUndoTick] = useState(0)
  const [leftPanel, setLeftPanel] = useState<LeftPanelType>(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('system-prompts')
  const [aiAssistantDialogOpen, setAiAssistantDialogOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<AiAssistantMessage[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiConfig, setAiConfig] = useState<AiAssistantConfig>(() => loadAiAssistantConfig())
  /**
   * 桌面端：优先从工程目录恢复 AI 配置，避免切换入口后丢失 TTS 与模型参数。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ext = await tryLoadAiAssistantConfigFromExternalPath()
      if (cancelled || !ext) return
      setAiConfig((prev) => {
        const next = { ...prev, ...ext }
        saveAiAssistantConfig(next)
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 仅提示一次：当前进入离线兜底聊天模式，避免重复刷屏。 */
  const aiOfflineFallbackHintShownRef = useRef(false)
  const aiLastSpokenMessageIdRef = useRef<string | null>(null)
  const aiTtsAudioRef = useRef<HTMLAudioElement | null>(null)
  const aiTtsAudioUrlRef = useRef<string | null>(null)
  const [avatarDockRect, setAvatarDockRect] = useState(() => {
    const fallback = { left: 1180, top: 520, width: 120, height: 200 }
    if (typeof window === 'undefined') return fallback
    const width = 120
    const height = 200
    return {
      left: window.innerWidth - width - 20,
      top: window.innerHeight - height - 76,
      width,
      height,
    }
  })
  const avatarDockActionRef = useRef<AvatarDockPointerAction | null>(null)
  /** 本地模型在工作流执行期间的挂起命令队列。 */
  const aiDeferredQueueRef = useRef<string[]>([])
  /** 顶栏「本地项目」按钮：用于将弹层定位到按钮正下方 */
  const localProjectsTopBtnRef = useRef<HTMLButtonElement | null>(null)
  /**
   * 「本地项目」弹层在视口中的 `position:fixed` 坐标（`right` 与按钮右缘对齐）。
   * 垂直方向：按钮 `bottom + 20px`。
   */
  const [localProjectsPopoverLayout, setLocalProjectsPopoverLayout] = useState<{
    top: number
    right: number
  } | null>(null)
  const updateLocalProjectsPopoverLayout = useCallback(() => {
    const el = localProjectsTopBtnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setLocalProjectsPopoverLayout({
      top: rect.bottom + LOCAL_PROJECTS_POPOVER_GAP_PX,
      right: document.documentElement.clientWidth - rect.right,
    })
  }, [])

  useLayoutEffect(() => {
    if (leftPanel !== 'local-projects') {
      setLocalProjectsPopoverLayout(null)
      return
    }
    updateLocalProjectsPopoverLayout()
    const onWin = () => updateLocalProjectsPopoverLayout()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [leftPanel, updateLocalProjectsPopoverLayout])

  /** 启动时把当前已载入工程写入本地项目库，保证「本地项目」列表里能读到（与 flowid.project.v1 同步）。 */
  useEffect(() => {
    const snap: ProjectSnapshot = {
      version: 1,
      name: loaded.name || '项目一',
      nodes: loaded.nodes,
      edges: loaded.edges,
      viewport: loaded.viewport,
    }
    writeLibraryProject(snap, DEFAULT_WORKSPACE_LIBRARY_ID)
  }, [loaded])

  const [canvasAddMenu, setCanvasAddMenu] = useState<{
    left: number
    top: number
  } | null>(null)
  const [connectAddMenu, setConnectAddMenu] = useState<{
    left: number
    top: number
  } | null>(null)
  /** 节点右键菜单：复制、粘贴、（多选）编组、执行/全部执行、新增节点、删除（单选隐藏编组；删除始终在最下） */
  const [multiSelectContextMenu, setMultiSelectContextMenu] = useState<{
    left: number
    top: number
    submenuMode: 'linked' | 'common' | null
    /** true：子菜单在主菜单右侧；false：子菜单在主菜单左侧（贴边自适应） */
    preferSubmenuRight: boolean
  } | null>(null)
  /** 子菜单 hover 关闭延迟：避免主菜单与子菜单之间的缝隙触发误关 */
  const submenuCloseTimerRef = useRef<number | null>(null)

  const cancelSubmenuHoverCloseTimer = useCallback(() => {
    if (submenuCloseTimerRef.current != null) {
      window.clearTimeout(submenuCloseTimerRef.current)
      submenuCloseTimerRef.current = null
    }
  }, [])

  const scheduleSubmenuHoverCloseTimer = useCallback(() => {
    cancelSubmenuHoverCloseTimer()
    submenuCloseTimerRef.current = window.setTimeout(() => {
      submenuCloseTimerRef.current = null
      setMultiSelectContextMenu((prev) => (prev ? { ...prev, submenuMode: null } : prev))
    }, 220)
  }, [cancelSubmenuHoverCloseTimer])

  const pendingCanvasNodePositionRef = useRef<XYPosition | null>(null)
  const pendingConnectRef = useRef<PendingConnectContext | null>(null)
  const pendingConnectPreviewRef = useRef<PendingConnectPreview | null>(null)

  const clearPendingConnectPreview = useCallback(() => {
    const preview = pendingConnectPreviewRef.current
    if (!preview) return
    setEdges((eds) => eds.filter((edge) => edge.id !== preview.edgeId))
    setNodes((nds) => nds.filter((node) => node.id !== preview.ghostNodeId))
    pendingConnectPreviewRef.current = null
  }, [setEdges, setNodes])

  const dismissMultiSelectContextMenu = useCallback(() => {
    cancelSubmenuHoverCloseTimer()
    setMultiSelectContextMenu(null)
  }, [cancelSubmenuHoverCloseTimer])

  useEffect(() => () => cancelSubmenuHoverCloseTimer(), [cancelSubmenuHoverCloseTimer])

  const dismissCanvasAddMenu = useCallback(() => {
    setCanvasAddMenu(null)
    pendingCanvasNodePositionRef.current = null
  }, [])

  const dismissConnectAddMenu = useCallback(() => {
    setConnectAddMenu(null)
    pendingConnectRef.current = null
    pendingCanvasNodePositionRef.current = null
    clearPendingConnectPreview()
  }, [clearPendingConnectPreview])

  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadAuthSession())
  const [licenseSnapshotState, setLicenseSnapshotState] = useState(() => loadLocalLicenseSnapshot())
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null)
  const {
    executionMode,
    executionProvider,
    randomizeKsamplerSeedsOnRun,
    localConfig,
    cloudConfig,
    cloudEndpoints,
    nodeConfigs,
    shortcuts,
    lastExecutionMessage,
    updateExecutionProvider,
    setRandomizeKsamplerSeedsOnRun,
    updateProviderConfig,
    updateNodeConfig,
    saveNodeWorkflow,
    selectNodeWorkflow,
    removeNodeWorkflow,
    updateNodeWorkflowEntry,
    clearNodeWorkflows,
    pinNodeWorkflowToTop,
    addCloudEndpoint,
    updateCloudEndpoint,
    removeCloudEndpoint,
    updateShortcutConfig,
    updateShortcutBinding,
    connectionTestMessage,
    officialTemplates,
    updateExecutionMode,
    refreshOfficialTemplates,
    testProviderConnection,
    runNodeWorkflow,
  } = useWorkflowIntegration()
  const {
    assets,
    historyItems,
    appendHistory,
    onUploadFiles,
    removeAsset,
    removeHistoryItems,
  } =
    useAssetsHistory({
      onAfterUpload: () => {
        dismissCanvasAddMenu()
        dismissConnectAddMenu()
        setLeftPanel('my-assets')
      },
    })
  /**
   * 按资源地址删除历史中的对应条目。
   * 仅用于“节点内删除同步历史”场景；历史面板删除不会反向影响节点。
   */
  const removeHistoryBySource = useCallback(
    (src: string) => {
      if (!src) return
      const matchedIds = historyItems
        .filter((item) => item.src === src)
        .map((item) => item.id)
      if (!matchedIds.length) return
      removeHistoryItems(matchedIds)
    },
    [historyItems, removeHistoryItems],
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const { screenToFlowPosition, fitView, getViewport, setViewport, zoomIn, zoomOut, getZoom } =
    useReactFlow()
  const viewport = useViewport()

  /**
   * 启动顺序：若存在「桌面 JSON 路径 / 浏览器绑定工程文件」则优先加载并写回默认槽；
   * 否则仅对 localStorage 工程做 IndexedDB 图片恢复。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ext = await tryLoadExternalProjectSnapshot()
      if (cancelled) return

      const localHasContent = hasMeaningfulSnapshotContent(loaded)
      if (ext && !localHasContent) {
        const hydratedExt = await hydrateNodesLocalImageAssets(ext.nodes)
        if (cancelled) return
        setNodes(hydratedExt)
        setEdges(ext.edges)
        setViewport(ext.viewport, { duration: 0 })
        const snap: ProjectSnapshot = {
          version: 1,
          name: ext.name || '项目一',
          nodes: hydratedExt,
          edges: ext.edges,
          viewport: ext.viewport,
        }
        setProjectTabs((prev) =>
          prev.map((tab) =>
            tab.id === initialProjectId
              ? {
                  ...tab,
                  name: snap.name,
                  snapshot: {
                    nodes: hydratedExt,
                    edges: ext.edges,
                    viewport: ext.viewport,
                  },
                }
              : tab,
          ),
        )
        saveStoredProject(snap)
        void writeLibraryProject(snap, DEFAULT_WORKSPACE_LIBRARY_ID)
        return
      }

      const restoredNodes = await hydrateNodesLocalImageAssets(loaded.nodes)
      if (cancelled || restoredNodes === loaded.nodes) return
      setNodes(restoredNodes)
      setProjectTabs((prev) =>
        prev.map((tab) =>
          tab.id === initialProjectId
            ? {
                ...tab,
                snapshot: {
                  ...tab.snapshot,
                  nodes: restoredNodes,
                },
              }
            : tab,
        ),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [initialProjectId, loaded, setEdges, setNodes, setViewport])

  const [zoomPercent, setZoomPercent] = useState(100)
  const [showMiniPreview, setShowMiniPreview] = useState(false)
  /** 底部提示框是否放大布局（参考外部产品的大输入区）。 */
  const [promptPanelExpanded, setPromptPanelExpanded] = useState(false)
  /** 文本节点「自动拆分」下拉：选完后重置 key，便于再次选择同一项。 */
  const [textSplitSelectKey, setTextSplitSelectKey] = useState(0)
  /**
   * 底部面板同一节点可多次排队执行：按节点递增代数，旧任务完成时不再写回节点/进度，避免覆盖较新任务。
   */
  const promptPanelRunGenerationByNodeIdRef = useRef(new Map<string, number>())
  const [clipboard, setClipboard] = useState<CanvasClipboard | null>(null)
  const undoStackRef = useRef<Omit<ProjectSnapshot, 'version' | 'name'>[]>([])
  const redoStackRef = useRef<Omit<ProjectSnapshot, 'version' | 'name'>[]>([])
  const isRestoringHistoryRef = useRef(false)

  /**
   * 组框拖动时，同步移动组内成员节点位置。
   */
  const onNodesChange = useCallback((changes: NodeChange<Node<StudioNodeData>>[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges<Node<StudioNodeData>>(changes, prev)
      const groupDelta = new Map<string, { dx: number; dy: number }>()
      next.forEach((node) => {
        if (node.data.kind !== 'group') return
        const before = prev.find((item) => item.id === node.id)
        if (!before) return
        const dx = node.position.x - before.position.x
        const dy = node.position.y - before.position.y
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return
        groupDelta.set(node.id, { dx, dy })
      })
      if (!groupDelta.size) return next
      const memberDelta = new Map<string, { dx: number; dy: number }>()
      next.forEach((node) => {
        if (node.data.kind !== 'group') return
        const delta = groupDelta.get(node.id)
        if (!delta) return
        const members = node.data.memberIds ?? []
        members.forEach((memberId: string) => {
          const prevDelta = memberDelta.get(memberId)
          if (!prevDelta) {
            memberDelta.set(memberId, { dx: delta.dx, dy: delta.dy })
            return
          }
          memberDelta.set(memberId, {
            dx: prevDelta.dx + delta.dx,
            dy: prevDelta.dy + delta.dy,
          })
        })
      })
      if (!memberDelta.size) return next
      return next.map((node) => {
        if (node.data.kind === 'group') return node
        const delta = memberDelta.get(node.id)
        if (!delta) return node
        return {
          ...node,
          position: {
            x: node.position.x + delta.dx,
            y: node.position.y + delta.dy,
          },
        }
      })
    })
  }, [setNodes])
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  /** 需要底部浮动面板的节点类型（与音乐节点同交互） */
  type PromptPanelKind = 'music' | 'text' | 'image' | 'video' | 'audio'

  const promptPanel = useMemo(() => {
    if (!selectedNode) return null
    const k = selectedNode.data.kind
    if (k === 'music' || k === 'text' || k === 'image' || k === 'video' || k === 'audio') {
      return { node: selectedNode, kind: k } as { node: Node<StudioNodeData>; kind: PromptPanelKind }
    }
    return null
  }, [selectedNode])

  const promptPanelLayout = useMemo(() => {
    if (!promptPanel) return null
    const n = promptPanel.node
    const viewport = getViewport()
    const zoom = viewport.zoom || 1
    const nodeWidth = n.measured?.width ?? n.width ?? n.style?.width ?? 430
    const nodeHeight = n.measured?.height ?? n.height ?? n.style?.height ?? 340
    const nodeScreenWidth = Number(nodeWidth) * zoom
    const maxByViewport = Math.max(320, window.innerWidth - 120)
    const minPanelWidth = Math.min(520, maxByViewport)
    const targetWidth = nodeScreenWidth * 1.2
    const panelWidth = Math.min(maxByViewport, Math.max(minPanelWidth, targetWidth))
    const gap = 12
    const centerX = n.position.x * zoom + viewport.x + (Number(nodeWidth) * zoom) / 2
    const topY = n.position.y * zoom + viewport.y + Number(nodeHeight) * zoom + gap
    const minLeft = 16
    const maxLeft = Math.max(minLeft, window.innerWidth - panelWidth - 16)
    const left = Math.min(Math.max(minLeft, centerX - panelWidth / 2), maxLeft)
    const top = Math.max(16, topY)
    return { left, top, width: panelWidth }
  }, [getViewport, promptPanel, viewportVersion])

  /**
   * 画布缩放过小时隐藏底部提示词框，避免遮挡大视角浏览。
   */
  const shouldShowPromptPanel = useMemo(() => {
    return Boolean(
      promptPanel && promptPanelLayout && zoomPercent >= PROMPT_PANEL_MIN_ZOOM_PERCENT,
    )
  }, [promptPanel, promptPanelLayout, zoomPercent])
  const visiblePromptPanel = shouldShowPromptPanel ? promptPanel : null
  const visiblePromptPanelLayout = shouldShowPromptPanel ? promptPanelLayout : null

  const promptPanelMentionImages = useMemo(() => {
    if (!visiblePromptPanel) return []
    const { node, kind } = visiblePromptPanel
    const sortByRefOrder = (items: Array<{ mention: string; url: string }>) => {
      if (!(kind === 'image' || kind === 'video' || kind === 'audio')) return items
      const refs =
        kind === 'image'
          ? (node.data as ImageNodeData).referenceImageSources ?? []
          : kind === 'video'
            ? (node.data as VideoNodeData).referenceImageSources ?? []
            : (node.data as AudioNodeData).referenceImageSources ?? []
      const order = new Map<string, number>()
      refs.filter(Boolean).forEach((u, idx) => {
        const key = String(u || '').trim()
        if (!key) return
        if (!order.has(key)) order.set(key, idx)
      })
      return [...items].sort((a, b) => {
        const ai = order.get(String(a.url || '').trim())
        const bi = order.get(String(b.url || '').trim())
        const ah = ai != null
        const bh = bi != null
        if (ah && bh && ai !== bi) return (ai as number) - (bi as number)
        if (ah && !bh) return -1
        if (!ah && bh) return 1
        return 0
      })
    }
    if (kind === 'image' || kind === 'video') {
      return sortByRefOrder(
        listMentionImageAttachments(
        (node.data as ImageNodeData | VideoNodeData).prompt || '',
        nodes,
        node.id,
        ),
      )
    }
    if (kind === 'audio' || kind === 'music') {
      return sortByRefOrder(
        listMentionImageAttachments((node.data as AudioNodeData).note || '', nodes, node.id),
      )
    }
    if (kind === 'text') {
      return listMentionImageAttachments((node.data as TextNodeData).body || '', nodes, node.id)
    }
    return []
  }, [visiblePromptPanel, nodes])

  const promptPanelWrapStyle = useMemo(() => {
    if (!visiblePromptPanelLayout) return null
    if (!promptPanelExpanded) return visiblePromptPanelLayout
    const w = Math.min(960, Math.max(visiblePromptPanelLayout.width, window.innerWidth - 48))
    const left = Math.min(
      Math.max(16, visiblePromptPanelLayout.left),
      Math.max(16, window.innerWidth - w - 16),
    )
    return { ...visiblePromptPanelLayout, width: w, left }
  }, [visiblePromptPanelLayout, promptPanelExpanded])

  useEffect(() => {
    if (!promptPanel) setPromptPanelExpanded(false)
  }, [promptPanel])

  const promptPanelWorkflowOptions = useMemo(() => {
    if (!promptPanel) return [] as string[]
    const kind = promptPanel.kind
    const names = nodeConfigs[kind].workflows.map((item) => item.name).filter(Boolean)
    if (names.length) return names
    if (kind === 'music') return ['Comfy Music Flow A']
    if (kind === 'text') return ['默认文本工作流']
    if (kind === 'image') return ['默认图片工作流']
    if (kind === 'video') return ['默认视频工作流']
    return ['默认配音工作流']
  }, [nodeConfigs, promptPanel])

  const promptPanelModelOptions = useMemo(() => {
    if (!promptPanel) return [] as PromptPanelDropdownOption[]
    const presets = loadCloudModelPresets()
    const base = presets.map((item) => ({ value: item.id, label: item.name }))
    const current = String(nodeConfigs[promptPanel.kind].cloudModelName || '').trim()
    if (current && !base.some((i) => i.label === current)) {
      base.unshift({ value: 'custom-current', label: current })
    }
    // 不展示“自定义”入口：只显示预设模型 +（若当前值不在预设中）当前模型名
    return base
  }, [nodeConfigs, promptPanel])

  const promptPanelModelSelectValue = useMemo(() => {
    if (!promptPanel) return ''
    const current = String(nodeConfigs[promptPanel.kind].cloudModelName || '').trim()
    const found = loadCloudModelPresets().find((i) => i.name === current)
    if (found) return found.id
    if (current) return 'custom-current'
    return loadCloudModelPresets()[0]?.id || ''
  }, [nodeConfigs, promptPanel])

  /** 底部提示框：节点级切换「工作流」还是「模型」 */
  const promptPanelPickerMode = useMemo(() => {
    if (!promptPanel) return 'workflow' as const
    const mode = (promptPanel.node.data as any)?.promptPickerMode
    return mode === 'model' ? 'model' : 'workflow'
  }, [promptPanel])

  /** 与 `matchStudioNodeWorkflow` / 执行逻辑一致的下拉展示值，避免 model 为空时显示第一项却跑全局选中 */
  const promptPanelWorkflowSelectValue = useMemo(() => {
    if (!promptPanel) return ''
    const picked = matchStudioNodeWorkflow(
      promptPanel.node.data as { model?: string; workflowEntryId?: string },
      nodeConfigs[promptPanel.kind],
    ).picked
    return picked?.name ?? promptPanelWorkflowOptions[0] ?? ''
  }, [nodeConfigs, promptPanel, promptPanelWorkflowOptions])

  const promptPanelText = useMemo(() => {
    if (!promptPanel) return ''
    if (promptPanel.kind === 'music' || promptPanel.kind === 'audio') {
      return (promptPanel.node.data as AudioNodeData).note || ''
    }
    if (promptPanel.kind === 'text') {
      return (promptPanel.node.data as TextNodeData).body || ''
    }
    if (promptPanel.kind === 'image') {
      return (promptPanel.node.data as ImageNodeData).prompt || ''
    }
    return (promptPanel.node.data as VideoNodeData).prompt || ''
  }, [promptPanel])

  const unresolvedMentions = useMemo(() => {
    if (!promptPanel) return [] as string[]
    return parseMentionRefs(promptPanelText)
      .filter((ref) => {
        const label = String(ref.label || '').trim()
        // `@系统提示词(标题)` 不是节点引用，不应触发“未匹配到节点”的提示。
        if (/^系统提示词[\(（]/u.test(label)) return false
        return true
      })
      .filter((ref) => !resolveMentionRefToNode(ref, nodes, promptPanel.node.id))
      .map((ref) => ref.label)
  }, [nodes, promptPanel, promptPanelText])

  const panelRefImagesInputRef = useRef<HTMLInputElement | null>(null)
  const panelPromptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<Array<{ id: string; title: string }>>(
    [],
  )
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null)
  /** 拖拽进入参考图区域的嵌套层数，避免子元素触发误闪 */
  const refImageDropDepthRef = useRef(0)
  const [refImageDropActive, setRefImageDropActive] = useState(false)
  /** 参考图条内部拖拽：记录被拖动的参考图索引。 */
  const refChipDragIndexRef = useRef<number | null>(null)
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  )

  /**
   * 画布右键菜单：当前选中里可作为操作目标的业务节点数量（不含 ghost / group）。
   * 为 1 时隐藏「编组」；≥2 时显示「编组」。
   */
  const batchContextMenuEligibleCount = useMemo(
    () =>
      nodes.filter((node) => node.selected && node.type !== 'ghost' && node.type !== 'group').length,
    [nodes],
  )

  useEffect(() => {
    const collapsedMemberIds = new Set<string>()
    nodes.forEach((node) => {
      if (node.data.kind !== 'group') return
      const memberIds = node.data.memberIds ?? []
      if (!node.data.collapsed) return
      memberIds.forEach((id) => collapsedMemberIds.add(id))
    })
    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        if (node.data.kind === 'group') return node
        const shouldHidden = collapsedMemberIds.has(node.id)
        if (Boolean(node.hidden) === shouldHidden) return node
        changed = true
        return { ...node, hidden: shouldHidden }
      })
      return changed ? next : prev
    })
    setEdges((prev) => {
      let changed = false
      const next = prev.map((edge) => {
        const shouldHidden =
          collapsedMemberIds.has(edge.source) || collapsedMemberIds.has(edge.target)
        if (Boolean(edge.hidden) === shouldHidden) return edge
        changed = true
        return { ...edge, hidden: shouldHidden }
      })
      return changed ? next : prev
    })
  }, [nodes, setEdges, setNodes])

  /**
   * 组框在展开态被手动缩放后，同步记住最新尺寸，供下次折叠恢复。
   */
  useEffect(() => {
    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        if (node.data.kind !== 'group') return node
        if (node.data.collapsed) return node
        const curr = getNodeSize(node)
        const savedW = Number(node.data.expandedWidth || 0)
        const savedH = Number(node.data.expandedHeight || 0)
        if (Math.abs(curr.width - savedW) < 1 && Math.abs(curr.height - savedH) < 1) {
          return node
        }
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            expandedWidth: curr.width,
            expandedHeight: curr.height,
          },
        }
      })
      return changed ? next : prev
    })
  }, [nodes, setNodes])

  /**
   * 迁移旧存档：分组曾强制 zIndex:-1 导致标题栏被成员完全挡住；
   * 统一为上层级 + 事件穿透（与 `createGroupNode` 一致）。
   */
  useEffect(() => {
    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        if (node.type !== 'group') return node
        const prevStyle = { ...((node.style ?? {}) as Record<string, unknown>) }
        const needPointer = prevStyle.pointerEvents !== 'none'
        const needZ = node.zIndex === -1 || node.zIndex === undefined
        const needSelectable = node.selectable === false
        if (!needPointer && !needZ && !needSelectable) return node
        changed = true
        const nextZ = needZ ? 10 : node.zIndex
        return {
          ...node,
          zIndex: nextZ,
          selectable: true,
          style: { ...prevStyle, pointerEvents: 'none' as const },
        }
      })
      return changed ? next : prev
    })
  }, [setNodes])

  /**
   * 将当前框选节点创建为一个可重命名、可缩放的分组框。
   */
  const createGroupFromSelection = useCallback(() => {
    const selected = nodes.filter(
      (node) => node.selected && node.type !== 'ghost' && node.type !== 'group',
    )
    if (!selected.length) {
      window.alert('请先框选至少一个节点')
      return
    }
    const bounds = getNodesBounds(selected)
    if (!bounds) return
    const id = crypto.randomUUID()
    const groupCount = nodes.filter((node) => node.type === 'group').length
    const groupNode = createGroupNode(
      id,
      {
        x: bounds.minX - GROUP_PADDING,
        y: bounds.minY - GROUP_PADDING - 10,
      },
      {
        width: bounds.maxX - bounds.minX + GROUP_PADDING * 2,
        height: bounds.maxY - bounds.minY + GROUP_PADDING * 2 + 10,
      },
      selected.map((node) => node.id),
      `分组${groupCount + 1}`,
    )
    setNodes((prev) => [...prev, groupNode])
    appendHistory(`创建分组：${groupNode.data.title}`)
  }, [appendHistory, nodes, setNodes])

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<StudioNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: { ...n.data, ...patch } as StudioNodeData,
              }
            : n,
        ),
      )
    },
    [setNodes],
  )

  /**
   * 全景沉浸导出：更新 `rectilinearSrc`，并在画布新建图片节点（与全景横向间距 `gapFlow`）。
   * 画布图片使用独立 blob，避免下次覆盖 rectilinear 时撤销旧 URL 导致已插入节点破图。
   */
  const addPanoramaViewToCanvas = useCallback(
    async (panoramaNodeId: string, captureObjectUrl: string, gapFlow = 20) => {
      let imageNodeSrc = captureObjectUrl
      try {
        const res = await fetch(captureObjectUrl)
        const blob = await res.blob()
        imageNodeSrc = URL.createObjectURL(blob)
      } catch {
        /* 克隆失败时与 rectilinear 共用同一 URL（多次导出可能影响旧图节点） */
      }

      setNodes((prev) => {
        const self = prev.find((n) => n.id === panoramaNodeId)
        if (!self || self.type !== 'panorama' || self.data.kind !== 'panorama') {
          if (imageNodeSrc !== captureObjectUrl) {
            URL.revokeObjectURL(imageNodeSrc)
          }
          return prev
        }

        const pdata = self.data as PanoramaNodeData
        const prevRect = String(pdata.rectilinearSrc || '').trim()
        if (prevRect.startsWith('blob:') && prevRect !== captureObjectUrl) {
          URL.revokeObjectURL(prevRect)
        }

        const measuredW = self.measured?.width
        const styleW = self.style && typeof self.style === 'object' ? self.style.width : undefined
        const parseNum = (v: unknown) => {
          if (typeof v === 'number' && Number.isFinite(v)) return v
          if (typeof v === 'string') {
            const n = parseFloat(v)
            return Number.isFinite(n) ? n : NaN
          }
          return NaN
        }
        const nodeW =
          (typeof measuredW === 'number' && Number.isFinite(measuredW) ? measuredW : NaN) ||
          parseNum(styleW) ||
          440

        const newId = crypto.randomUUID()
        const titleBase = pdata.title || '全景'

        const updated = prev.map((n) => {
          if (n.id !== panoramaNodeId) return n
          return {
            ...n,
            data: {
              ...(n.data as PanoramaNodeData),
              kind: 'panorama',
              rectilinearSrc: captureObjectUrl,
            } as StudioNodeData,
          }
        })

        return [
          ...updated,
          {
            id: newId,
            type: 'image',
            position: {
              x: self.position.x + nodeW + gapFlow,
              y: self.position.y,
            },
            style: { width: 430, height: 340 },
            data: {
              kind: 'image',
              title: `${titleBase} · 视角导出`,
              src: imageNodeSrc,
              prompt: '',
              referenceImageSources: [],
              referenceImageAssetIds: [],
              runStatus: 'idle',
            },
          } as Node<StudioNodeData>,
        ]
      })

      appendHistory('全景：导出当前视角到画布')
    },
    [appendHistory, setNodes],
  )

  /**
   * 设置里增删改工作流列表后，同步画布节点上的 `workflowEntryId` / `model`：
   * - 删除条目：节点仍引用该 id 时清空绑定；仅有名称且列表中已不存在时同样清空；
   * - 名称仍能匹配列表：补写 `workflowEntryId`，执行与下拉以条目 id 为真源；
   * - 有效 id：将 `model` 写成设置里当前名称（重命名后与列表一致）。
   */
  useEffect(() => {
    const normId = (v: string | undefined) => (typeof v === 'string' ? v.trim() : '')
    const normModel = (v: string | undefined) => (typeof v === 'string' ? v.trim() : '')
    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        const nk = node.data.kind
        if (nk !== 'text' && nk !== 'image' && nk !== 'video' && nk !== 'audio' && nk !== 'music') {
          return node
        }
        const kind = nk
        const list = nodeConfigs[kind].workflows
        const data = node.data as { model?: string; workflowEntryId?: string }
        const idSet = new Set(list.map((w) => w.id))
        let nextModel: string | undefined = data.model
        let nextWid: string | undefined = data.workflowEntryId

        const entryIdTrim = normId(nextWid)
        const modelTrim = normModel(nextModel)

        if (entryIdTrim && !idSet.has(entryIdTrim)) {
          nextModel = undefined
          nextWid = undefined
        } else if (entryIdTrim && idSet.has(entryIdTrim)) {
          const entry = list.find((w) => w.id === entryIdTrim)
          if (entry && entry.name.trim() !== modelTrim) {
            nextModel = entry.name
          }
        }

        const eid2 = normId(nextWid)
        const mid2 = normModel(nextModel)
        if (!eid2 && mid2) {
          const hit = findWorkflowEntryByPreferredName(list, mid2)
          if (!hit) {
            nextModel = undefined
            nextWid = undefined
          } else {
            nextModel = hit.name
            nextWid = hit.id
          }
        }

        const modelSame = normModel(data.model) === normModel(nextModel)
        const widSame = normId(data.workflowEntryId) === normId(nextWid)
        if (modelSame && widSame) return node
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            model: nextModel,
            workflowEntryId: nextWid,
          } as StudioNodeData,
        }
      })
      return changed ? next : prev
    })
  }, [nodeConfigs, setNodes])

  /**
   * 底部面板打开时：若节点尚未写入 `model`，则把当前解析到的工作流写回节点，与下拉展示/执行一致。
   */
  useEffect(() => {
    if (!promptPanel) return
    const { node, kind } = promptPanel
    const data = node.data as { model?: string; workflowEntryId?: string }
    const list = nodeConfigs[kind].workflows
    const modelTrim = (data.model ?? '').trim()
    if (!modelTrim) {
      const picked = matchStudioNodeWorkflow(data, nodeConfigs[kind]).picked
      if (!picked) return
      updateNodeData(node.id, {
        kind,
        model: picked.name,
        workflowEntryId: picked.id,
      } as Partial<StudioNodeData>)
      return
    }
    /** 节点存「三视图」、列表为「三视图 (1)」时写回全名与 id，避免执行时按旧名抛「未找到工作流」 */
    const entry = findWorkflowEntryByPreferredName(list, modelTrim)
    if (entry && entry.name !== modelTrim) {
      updateNodeData(node.id, {
        kind,
        model: entry.name,
        workflowEntryId: entry.id,
      } as Partial<StudioNodeData>)
    }
  }, [nodeConfigs, promptPanel, updateNodeData])

  const updateNodeMeta = useCallback(
    (nodeId: string, patch: Partial<Node<StudioNodeData>>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      )
    },
    [setNodes],
  )

  const removeNodeById = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((node) => node.id !== nodeId))
      setEdges((prev) =>
        prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      )
    },
    [setEdges, setNodes],
  )

  const updatePromptPanelText = useCallback(
    (nextText: string) => {
      if (!promptPanel) return
      const nid = promptPanel.node.id
      if (promptPanel.kind === 'music' || promptPanel.kind === 'audio') {
        updateNodeData(nid, {
          kind: promptPanel.kind,
          note: nextText,
        } as Partial<StudioNodeData>)
      } else if (promptPanel.kind === 'text') {
        updateNodeData(nid, { kind: 'text', body: nextText })
      } else if (promptPanel.kind === 'image') {
        updateNodeData(nid, { kind: 'image', prompt: nextText })
      } else {
        updateNodeData(nid, { kind: 'video', prompt: nextText })
      }
    },
    [promptPanel, updateNodeData],
  )

  const closeMentionMenu = useCallback(() => {
    setMentionCandidates([])
    setMentionActiveIndex(0)
    mentionRangeRef.current = null
  }, [])

  useEffect(() => {
    closeMentionMenu()
  }, [closeMentionMenu, promptPanel?.node.id, promptPanel?.kind])

  /**
   * 底部面板：追加多张参考图（仅图片/视频/配音节点；仅接受图片 MIME）。
   */
  const appendPanelReferenceImages = useCallback(
    async (list: FileList | readonly File[] | null) => {
      if (!promptPanel) return
      const files = list
        ? Array.from(list as ArrayLike<File>).filter((f) => f.type.startsWith('image/'))
        : []
      if (!files.length) return
      const { node, kind } = promptPanel
      const id = node.id
      const persisted = await Promise.all(
        files.map(async (file) => {
          try {
            const assetId = await saveLocalImageAsset(file)
            const restored = await getLocalImageAssetObjectUrl(assetId)
            return {
              url: restored || URL.createObjectURL(file),
              assetId,
            }
          } catch {
            return {
              url: URL.createObjectURL(file),
              assetId: '',
            }
          }
        }),
      )
      const urls = persisted.map((item) => item.url)
      const assetIds = persisted.map((item) => item.assetId)
      if (kind === 'image') {
        const d = node.data as ImageNodeData
        updateNodeData(id, {
          kind: 'image',
          referenceImageSources: [...(d.referenceImageSources ?? []), ...urls],
          referenceImageAssetIds: [...(d.referenceImageAssetIds ?? []), ...assetIds],
        })
      } else if (kind === 'video') {
        const d = node.data as VideoNodeData
        updateNodeData(id, {
          kind: 'video',
          referenceImageSources: [...(d.referenceImageSources ?? []), ...urls],
          referenceImageAssetIds: [...(d.referenceImageAssetIds ?? []), ...assetIds],
        })
      } else if (kind === 'audio') {
        const d = node.data as AudioNodeData
        updateNodeData(id, {
          kind: 'audio',
          referenceImageSources: [...(d.referenceImageSources ?? []), ...urls],
          referenceImageAssetIds: [...(d.referenceImageAssetIds ?? []), ...assetIds],
        })
      }
    },
    [promptPanel, updateNodeData],
  )

  const onRefImageDragEnter = useCallback((event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    refImageDropDepthRef.current += 1
    if (refImageDropDepthRef.current === 1) {
      setRefImageDropActive(true)
    }
  }, [])

  const onRefImageDragLeave = useCallback((event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    refImageDropDepthRef.current -= 1
    if (refImageDropDepthRef.current <= 0) {
      refImageDropDepthRef.current = 0
      setRefImageDropActive(false)
    }
  }, [])

  const onRefImageDragOver = useCallback((event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onRefImageDrop = useCallback(
    (event: ReactDragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      refImageDropDepthRef.current = 0
      setRefImageDropActive(false)
      void appendPanelReferenceImages(event.dataTransfer.files)
    },
    [appendPanelReferenceImages],
  )

  useEffect(() => {
    refImageDropDepthRef.current = 0
    setRefImageDropActive(false)
  }, [promptPanel?.node.id, promptPanel?.kind])

  /**
   * 从剪贴板或 DataTransfer 中收集图片文件（支持多图）。
   */
  const collectImageFilesFromClipboard = useCallback((dt: DataTransfer | null): File[] => {
    if (!dt) return []
    const out: File[] = []
    const items = dt.items
    if (items?.length) {
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]
        if (it?.kind === 'file' && typeof it.type === 'string' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) out.push(f)
        }
      }
    }
    if (!out.length && dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files.item(i)
        if (f?.type.startsWith('image/')) out.push(f)
      }
    }
    return out
  }, [])

  /**
   * 在画布指定流坐标处创建图片节点（拖入/粘贴系统图片文件）。
   */
  const addImageFilesAtFlowPosition = useCallback(
    async (files: readonly File[], base: XYPosition) => {
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      if (!imageFiles.length) return
      const persisted = await Promise.all(
        imageFiles.map(async (file) => {
          try {
            const srcAssetId = await saveLocalImageAsset(file)
            const restored = await getLocalImageAssetObjectUrl(srcAssetId)
            return { file, src: restored || URL.createObjectURL(file), srcAssetId }
          } catch {
            return { file, src: URL.createObjectURL(file), srcAssetId: '' }
          }
        }),
      )
      setNodes((prev) => {
        const extra: Array<Node<StudioNodeData>> = []
        persisted.forEach(({ file, src, srcAssetId }, idx) => {
          const id = crypto.randomUUID()
          const stem = file.name.replace(/\.[^.]+$/, '').trim() || '未命名'
          extra.push({
            id,
            type: 'image',
            position: { x: base.x + idx * 48, y: base.y + idx * 48 },
            style: { width: 430, height: 340 },
            data: {
              kind: 'image',
              title: `图片 · ${stem}`,
              src,
              srcAssetId,
              srcFileName: file.name,
              prompt: '',
              referenceImageSources: [],
              referenceImageAssetIds: [],
              runStatus: 'idle',
            },
          })
        })
        return [...prev, ...extra]
      })
      appendHistory(`拖入/粘贴图片：${imageFiles.length} 个`)
    },
    [appendHistory, setNodes],
  )

  /**
   * 将图片文件直接写入指定节点（拖到节点框内时使用）。
   */
  const applyImageFileToNode = useCallback(
    async (nodeId: string, file: File) => {
      if (!file.type.startsWith('image/')) return
      let src = URL.createObjectURL(file)
      let srcAssetId = ''
      try {
        srcAssetId = await saveLocalImageAsset(file)
        const restored = await getLocalImageAssetObjectUrl(srcAssetId)
        if (restored) {
          src = restored
        }
      } catch {
        srcAssetId = ''
      }
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          const d = n.data
          if (d.kind === 'image') {
            return {
              ...n,
              data: {
                ...d,
                src,
                srcAssetId,
                srcFileName: file.name,
              } as StudioNodeData,
            }
          }
          if (d.kind === 'video') {
            return {
              ...n,
              data: {
                ...d,
                src,
                srcAssetId,
                srcFileName: file.name,
              } as StudioNodeData,
            }
          }
          if (d.kind === 'audio' || d.kind === 'music') {
            return {
              ...n,
              data: {
                ...d,
                src,
                srcAssetId,
                srcFileName: file.name,
              } as StudioNodeData,
            }
          }
          if (d.kind === 'panorama') {
            return {
              ...n,
              data: {
                ...d,
                src,
                srcAssetId,
                srcFileName: file.name,
              } as StudioNodeData,
            }
          }
          return n
        }),
      )
      appendHistory(`已写入节点：${file.name}`)
    },
    [appendHistory, setNodes],
  )

  /**
   * 批量把图片文件填充到一组节点（框选优先）：
   * - 一张图对应一个节点；
   * - 节点顺序按画布位置（先上后下、再左到右）；
   * - 若指定 `preferredFirstNodeId`，则该节点优先吃第一张图。
   */
  const applyImageFilesToNodes = useCallback(
    async (files: readonly File[], nodeIds: readonly string[], preferredFirstNodeId?: string | null) => {
      const cleanFiles = files.filter((f) => f.type.startsWith('image/'))
      if (!cleanFiles.length || !nodeIds.length) return
      const dedupIds = Array.from(new Set(nodeIds.filter(Boolean)))
      if (!dedupIds.length) return
      const orderedIds = [...dedupIds]
      if (preferredFirstNodeId && orderedIds.includes(preferredFirstNodeId)) {
        const rest = orderedIds.filter((id) => id !== preferredFirstNodeId)
        orderedIds.splice(0, orderedIds.length, preferredFirstNodeId, ...rest)
      }
      const count = Math.min(cleanFiles.length, orderedIds.length)
      for (let i = 0; i < count; i += 1) {
        const file = cleanFiles[i]
        const nodeId = orderedIds[i]
        if (!file || !nodeId) continue
        await applyImageFileToNode(nodeId, file)
      }
      appendHistory(`批量填充节点：${count} 个`)
    },
    [appendHistory, applyImageFileToNode],
  )

  /**
   * 底部提示框：在文本框内 Ctrl+V 粘贴截图/图片时写入参考图（图片/视频/配音节点）。
   */
  const onPromptPanelTextareaPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (!visiblePromptPanel) return
      const k = visiblePromptPanel.kind
      if (k !== 'image' && k !== 'video' && k !== 'audio') return
      const files = collectImageFilesFromClipboard(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      void appendPanelReferenceImages(files)
    },
    [appendPanelReferenceImages, collectImageFilesFromClipboard, visiblePromptPanel],
  )

  /**
   * 画布空白处拖入外部图片文件：在落点创建图片节点。
   */
  const onCanvasDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer?.types?.length) return
    const types = Array.from(event.dataTransfer.types)
    if (!types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const list = event.dataTransfer?.files
      if (!list?.length) return
      const droppedFiles = Array.from(list)
      const files = droppedFiles.filter((f) => f.type.startsWith('image/'))
      /**
       * 画布支持直接拖入 Flowid 工程 JSON：行为等同「本地项目 -> 从 JSON 导入」。
       */
      const projectJsonFiles = droppedFiles.filter((f) => {
        const lower = f.name.toLowerCase()
        if (lower.endsWith('.json')) return true
        const t = String(f.type || '').toLowerCase()
        return t === 'application/json' || t === 'text/json'
      })
      if (!files.length && projectJsonFiles.length) {
        const first = projectJsonFiles[0]
        if (!first) return
        void (async () => {
          try {
            const text = await first.text()
            const snap = parseProjectFile(text)
            openImportedProjectInNewTab(snap)
            appendHistory(`已从画布拖拽导入工程：${first.name}`)
          } catch (error) {
            window.alert(`导入工作流 JSON 失败：${String((error as Error)?.message || error || '未知错误')}`)
          }
        })()
        return
      }
      if (!files.length) return

      /** 框选优先：若已有可接图节点被选中，按框选顺序进行批量填充。 */
      const selectedFillNodes = nodes
        .filter((n) => n.selected)
        .filter((n) => {
          const kind = n.data.kind
          return (
            kind === 'image' ||
            kind === 'video' ||
            kind === 'audio' ||
            kind === 'music' ||
            kind === 'panorama'
          )
        })
        .sort((a, b) => {
          const dy = a.position.y - b.position.y
          if (Math.abs(dy) > 1) return dy
          return a.position.x - b.position.x
        })

      const target = event.target as HTMLElement | null
      const nodeEl = target?.closest('.react-flow__node[data-id]') as HTMLElement | null
      const nodeId = nodeEl?.getAttribute('data-id')?.trim() || ''

      if (selectedFillNodes.length > 0) {
        const selectedIds = selectedFillNodes.map((n) => n.id)
        const preferred = selectedIds.includes(nodeId) ? nodeId : null
        void applyImageFilesToNodes(files, selectedIds, preferred)
        return
      }

      if (nodeId) {
        const targetNode = nodes.find((n) => n.id === nodeId)
        const kind = targetNode?.data.kind
        if (
          kind === 'image' ||
          kind === 'video' ||
          kind === 'audio' ||
          kind === 'music' ||
          kind === 'panorama'
        ) {
          const first = files[0]
          if (!first) return
          void applyImageFileToNode(nodeId, first)
          return
        }
      }
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void addImageFilesAtFlowPosition(files, pos)
    },
    [
      addImageFilesAtFlowPosition,
      applyImageFileToNode,
      applyImageFilesToNodes,
      appendHistory,
      nodes,
      openImportedProjectInNewTab,
      parseProjectFile,
      screenToFlowPosition,
    ],
  )

  /**
   * 焦点不在输入控件上时，将系统剪贴板中的图片粘贴到画布中心。
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const t = event.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (t?.closest('.studio-music-prompt-panel-wrap')) return
      if (t?.closest('[data-studio-settings-modal="1"]')) return
      const files = collectImageFilesFromClipboard(event.clipboardData)
      if (!files.length) return

      /** 框选优先：全局粘贴时若已框选可接图节点，按顺序批量填充到选中节点。 */
      const selectedFillNodes = nodes
        .filter((n) => n.selected)
        .filter((n) => {
          const kind = n.data.kind
          return (
            kind === 'image' ||
            kind === 'video' ||
            kind === 'audio' ||
            kind === 'music' ||
            kind === 'panorama'
          )
        })
        .sort((a, b) => {
          const dy = a.position.y - b.position.y
          if (Math.abs(dy) > 1) return dy
          return a.position.x - b.position.x
        })

      event.preventDefault()
      if (selectedFillNodes.length > 0) {
        void applyImageFilesToNodes(
          files,
          selectedFillNodes.map((n) => n.id),
        )
        return
      }
      const pos = screenToFlowPosition({
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.42,
      })
      void addImageFilesAtFlowPosition(files, pos)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [
    addImageFilesAtFlowPosition,
    applyImageFilesToNodes,
    collectImageFilesFromClipboard,
    nodes,
    screenToFlowPosition,
  ])

  /**
   * 底部面板：移除单张参考图并释放 blob URL。
   */
  const removePanelReferenceImage = useCallback(
    (url: string, index: number) => {
      if (!promptPanel) return
      const { node, kind } = promptPanel
      const id = node.id
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url)
      }
      if (kind === 'image') {
        const d = node.data as ImageNodeData
        updateNodeData(id, {
          kind: 'image',
          referenceImageSources: (d.referenceImageSources ?? []).filter((_, i) => i !== index),
          referenceImageAssetIds: (d.referenceImageAssetIds ?? []).filter((_, i) => i !== index),
        })
      } else if (kind === 'video') {
        const d = node.data as VideoNodeData
        updateNodeData(id, {
          kind: 'video',
          referenceImageSources: (d.referenceImageSources ?? []).filter((_, i) => i !== index),
          referenceImageAssetIds: (d.referenceImageAssetIds ?? []).filter((_, i) => i !== index),
        })
      } else if (kind === 'audio') {
        const d = node.data as AudioNodeData
        updateNodeData(id, {
          kind: 'audio',
          referenceImageSources: (d.referenceImageSources ?? []).filter((_, i) => i !== index),
          referenceImageAssetIds: (d.referenceImageAssetIds ?? []).filter((_, i) => i !== index),
        })
      }
    },
    [promptPanel, updateNodeData],
  )

  /**
   * 基于“当前最新 nodes 状态”重排参考图，避免闭包里拿到旧顺序导致拖拽看似无效。
   */
  const reorderPanelReferenceByIndex = useCallback(
    (nodeId: string, kind: PromptPanelKind, fromIndex: number, toIndex: number) => {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return n
          const d = n.data as ImageNodeData | VideoNodeData | AudioNodeData
          const refs = Array.isArray(d.referenceImageSources) ? [...d.referenceImageSources] : []
          const ids = Array.isArray(d.referenceImageAssetIds) ? [...d.referenceImageAssetIds] : []
          if (fromIndex < 0 || toIndex < 0 || fromIndex >= refs.length || toIndex >= refs.length || fromIndex === toIndex) return n
          const [refPicked] = refs.splice(fromIndex, 1)
          refs.splice(toIndex, 0, refPicked)
          if (ids.length) {
            const [idPicked] = ids.splice(fromIndex, 1)
            ids.splice(toIndex, 0, idPicked)
          }
          const payloadBase = {
            ...d,
            referenceImageSources: refs,
            referenceImageAssetIds: ids,
          } as ImageNodeData | VideoNodeData | AudioNodeData
          if (kind === 'image') {
            return {
              ...n,
              data: {
                ...(payloadBase as ImageNodeData),
                prompt: reorderLeadingMentionLinesByReferenceOrder(
                  String((d as ImageNodeData).prompt || ''),
                  prev,
                  nodeId,
                  refs.filter(Boolean),
                ),
              } as StudioNodeData,
            }
          }
          if (kind === 'video') {
            return {
              ...n,
              data: {
                ...(payloadBase as VideoNodeData),
                prompt: reorderLeadingMentionLinesByReferenceOrder(
                  String((d as VideoNodeData).prompt || ''),
                  prev,
                  nodeId,
                  refs.filter(Boolean),
                ),
              } as StudioNodeData,
            }
          }
          return {
            ...n,
            data: {
              ...(payloadBase as AudioNodeData),
              note: reorderLeadingMentionLinesByReferenceOrder(
                String((d as AudioNodeData).note || ''),
                prev,
                nodeId,
                refs.filter(Boolean),
              ),
            } as StudioNodeData,
          }
        }),
      )
    },
    [setNodes],
  )

  const movePanelReferenceImage = useCallback(
    (fromIndex: number, direction: -1 | 1, toIndex?: number) => {
      if (!promptPanel) return
      const finalTo = typeof toIndex === 'number' ? toIndex : fromIndex + direction
      reorderPanelReferenceByIndex(promptPanel.node.id, promptPanel.kind, fromIndex, finalTo)
    },
    [promptPanel, reorderPanelReferenceByIndex],
  )

  /**
   * 上方 @ 引用缩略图：按索引重排开头的 @ 引用行。
   */
  const movePanelMentionImageByIndex = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!promptPanel) return
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== promptPanel.node.id) return n
          if (promptPanel.kind === 'image') {
            const d = n.data as ImageNodeData
            const nextPrompt = reorderLeadingMentionLinesByIndex(String(d.prompt || ''), fromIndex, toIndex)
            const mentionUrls = listMentionImageAttachments(nextPrompt, prev, promptPanel.node.id)
              .map((item) => String(item.url || '').trim())
              .filter(Boolean)
            const refs = Array.isArray(d.referenceImageSources) ? [...d.referenceImageSources] : []
            const ids = Array.isArray(d.referenceImageAssetIds) ? [...d.referenceImageAssetIds] : []
            const synced = syncReferenceOrderByMentionUrls(refs, ids, mentionUrls)
            return {
              ...n,
              data: {
                ...d,
                prompt: nextPrompt,
                referenceImageSources: synced.refs,
                referenceImageAssetIds: synced.ids,
              } as StudioNodeData,
            }
          }
          if (promptPanel.kind === 'video') {
            const d = n.data as VideoNodeData
            const nextPrompt = reorderLeadingMentionLinesByIndex(String(d.prompt || ''), fromIndex, toIndex)
            const mentionUrls = listMentionImageAttachments(nextPrompt, prev, promptPanel.node.id)
              .map((item) => String(item.url || '').trim())
              .filter(Boolean)
            const refs = Array.isArray(d.referenceImageSources) ? [...d.referenceImageSources] : []
            const ids = Array.isArray(d.referenceImageAssetIds) ? [...d.referenceImageAssetIds] : []
            const synced = syncReferenceOrderByMentionUrls(refs, ids, mentionUrls)
            return {
              ...n,
              data: {
                ...d,
                prompt: nextPrompt,
                referenceImageSources: synced.refs,
                referenceImageAssetIds: synced.ids,
              } as StudioNodeData,
            }
          }
          if (promptPanel.kind === 'audio' || promptPanel.kind === 'music') {
            const d = n.data as AudioNodeData
            const nextNote = reorderLeadingMentionLinesByIndex(String(d.note || ''), fromIndex, toIndex)
            if (promptPanel.kind === 'music') {
              return {
                ...n,
                data: {
                  ...d,
                  note: nextNote,
                } as StudioNodeData,
              }
            }
            const mentionUrls = listMentionImageAttachments(nextNote, prev, promptPanel.node.id)
              .map((item) => String(item.url || '').trim())
              .filter(Boolean)
            const refs = Array.isArray(d.referenceImageSources) ? [...d.referenceImageSources] : []
            const ids = Array.isArray(d.referenceImageAssetIds) ? [...d.referenceImageAssetIds] : []
            const synced = syncReferenceOrderByMentionUrls(refs, ids, mentionUrls)
            return {
              ...n,
              data: {
                ...d,
                note: nextNote,
                referenceImageSources: synced.refs,
                referenceImageAssetIds: synced.ids,
              } as StudioNodeData,
            }
          }
          return n
        }),
      )
    },
    [promptPanel, setNodes],
  )

  /**
   * 参考图条：拖拽开始时记录源索引。
   */
  const onRefChipDragStart = useCallback((index: number, event: ReactDragEvent<HTMLDivElement>) => {
    refChipDragIndexRef.current = index
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }, [])

  /**
   * 参考图条：拖放到目标索引时，按目标位置重排。
   */
  const onRefChipDropToIndex = useCallback(
    (targetIndex: number, event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const from = refChipDragIndexRef.current
      if (from == null || from === targetIndex) return
      movePanelReferenceImage(from, from < targetIndex ? 1 : -1, targetIndex)
      refChipDragIndexRef.current = targetIndex
    },
    [movePanelReferenceImage],
  )

  /**
   * 参考图条：拖动经过目标项时实时重排，确保“拖着就能看到顺序变化”。
   */
  const onRefChipDragOverIndex = useCallback(
    (targetIndex: number, event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      const from = refChipDragIndexRef.current
      if (from == null || from === targetIndex) return
      movePanelReferenceImage(from, from < targetIndex ? 1 : -1, targetIndex)
      refChipDragIndexRef.current = targetIndex
    },
    [movePanelReferenceImage],
  )

  /** @ 引用缩略图拖拽：记录来源索引（用于上方条排序）。 */
  const mentionDragIndexRef = useRef<number | null>(null)
  /** 记录加载失败的 @ 引用缩略图 key，便于给出明确失效提示。 */
  const [brokenMentionChipKeys, setBrokenMentionChipKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    setBrokenMentionChipKeys(new Set())
  }, [promptPanel?.node.id, promptPanelMentionImages.length])

  /**
   * 移除提示词中的某一条 @ 引用（按 token 首次出现移除），用于“引用失效”快速清理。
   */
  const removePanelMentionByToken = useCallback(
    (mentionToken: string) => {
      if (!promptPanel) return
      const token = String(mentionToken || '').trim()
      if (!token) return
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== promptPanel.node.id) return n
          if (promptPanel.kind === 'image') {
            const d = n.data as ImageNodeData
            const text = String(d.prompt || '')
            const idx = text.indexOf(token)
            if (idx < 0) return n
            const next = `${text.slice(0, idx)}${text.slice(idx + token.length)}`.replace(/\n{3,}/g, '\n\n')
            return { ...n, data: { ...d, prompt: next } as StudioNodeData }
          }
          if (promptPanel.kind === 'video') {
            const d = n.data as VideoNodeData
            const text = String(d.prompt || '')
            const idx = text.indexOf(token)
            if (idx < 0) return n
            const next = `${text.slice(0, idx)}${text.slice(idx + token.length)}`.replace(/\n{3,}/g, '\n\n')
            return { ...n, data: { ...d, prompt: next } as StudioNodeData }
          }
          if (promptPanel.kind === 'audio' || promptPanel.kind === 'music') {
            const d = n.data as AudioNodeData
            const text = String(d.note || '')
            const idx = text.indexOf(token)
            if (idx < 0) return n
            const next = `${text.slice(0, idx)}${text.slice(idx + token.length)}`.replace(/\n{3,}/g, '\n\n')
            return { ...n, data: { ...d, note: next } as StudioNodeData }
          }
          return n
        }),
      )
    },
    [promptPanel, setNodes],
  )

  /**
   * 尝试修复失效的 @ 引用图片：
   * 1) 若来源节点有本地资产 id，优先从本地资产恢复可读 URL；
   * 2) 否则回退到来源节点的首个参考图 URL；
   * 3) 修复成功后清除该 chip 的失效标记。
   */
  const repairPanelMentionByToken = useCallback(
    async (mentionToken: string, chipKey: string): Promise<boolean> => {
      if (!promptPanel) return false
      const refs = parseMentionRefs(String(mentionToken || '').trim())
      const ref = refs[0]
      if (!ref) return false
      const hit = resolveMentionRefToNode(ref, nodes, promptPanel.node.id)
      if (!hit) return false
      const kind = hit.data.kind
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio' && kind !== 'music') return false
      const data = hit.data as ImageNodeData | VideoNodeData | AudioNodeData
      let repaired = String(data.src || '').trim()
      const aid = String(data.srcAssetId || '').trim()
      if (aid) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) repaired = restored
      }
      if (!repaired) {
        repaired = String((data.referenceImageSources ?? []).find(Boolean) || '').trim()
      }
      if (!repaired) return false
      updateNodeData(hit.id, { kind: kind as 'image' | 'video' | 'audio' | 'music', src: repaired } as Partial<StudioNodeData>)
      setBrokenMentionChipKeys((prev) => {
        const next = new Set(prev)
        next.delete(chipKey)
        return next
      })
      return true
    },
    [nodes, promptPanel, updateNodeData],
  )

  /**
   * 读取当前画布状态，作为项目快照。
   */
  const getCanvasSnapshot = useCallback((): Omit<ProjectSnapshot, 'version' | 'name'> => {
    return {
      nodes,
      edges,
      viewport: getViewport(),
    }
  }, [nodes, edges, getViewport])

  /**
   * 深拷贝画布快照，避免引用导致历史栈污染。
   */
  const cloneCanvasSnapshot = useCallback(
    (snapshot: Omit<ProjectSnapshot, 'version' | 'name'>): Omit<ProjectSnapshot, 'version' | 'name'> =>
      structuredClone(snapshot),
    [],
  )

  /**
   * 应用指定快照到当前画布。
   */
  const applyCanvasSnapshot = useCallback(
    (snapshot: Omit<ProjectSnapshot, 'version' | 'name'>) => {
      setNodes(snapshot.nodes)
      setEdges(snapshot.edges)
      setViewport(snapshot.viewport, { duration: 0 })
      setSelectedNodeId(null)
    },
    [setEdges, setNodes, setViewport],
  )

  /**
   * 应用快照前先恢复本地图片资产，确保跨重启后图片可见。
   */
  const applySnapshotWithLocalAssetHydration = useCallback(
    async (snapshot: Omit<ProjectSnapshot, 'version' | 'name'>) => {
      const restoredNodes = await hydrateNodesLocalImageAssets(snapshot.nodes)
      setNodes(restoredNodes)
      setEdges(snapshot.edges)
      setViewport(snapshot.viewport, { duration: 0 })
      setSelectedNodeId(null)
      return {
        ...snapshot,
        nodes: restoredNodes,
      }
    },
    [setEdges, setNodes, setViewport],
  )

  /**
   * 轻量持久化：仅写浏览器默认槽并同步当前标签快照。
   * 说明：该函数会被高频触发（如视口变化防抖），因此不做外部磁盘镜像，避免重复读写 input/output/workflow。
   */
  const persist = useCallback(() => {
    const activeTab = projectTabs.find((tab) => tab.id === activeProjectId)
    const activeProjectName = activeTab?.name || '未命名项目'
    const activeSnapshot = getCanvasSnapshot()
    const snapshot: ProjectSnapshot = {
      version: 1,
      name: activeProjectName,
      nodes: activeSnapshot.nodes,
      edges: activeSnapshot.edges,
      viewport: activeSnapshot.viewport,
    }
    saveStoredProject(snapshot)
    setProjectTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeProjectId ? { ...tab, snapshot: activeSnapshot } : tab,
      ),
    )
    const lid = projectTabs.find((t) => t.id === activeProjectId)?.libraryId
    if (lid) {
      writeLibraryProject(snapshot, lid)
    }
  }, [activeProjectId, getCanvasSnapshot, projectTabs])

  /**
   * 完整保存：默认槽 + 若已关联本地库条目则更新库（Ctrl+S / 顶栏保存 / 关闭前确认）。
   */
  const saveProjectFull = useCallback(() => {
    const activeTab = projectTabs.find((tab) => tab.id === activeProjectId)
    const activeProjectName = activeTab?.name || '未命名项目'
    const activeSnapshot = getCanvasSnapshot()
    const snapshot: ProjectSnapshot = {
      version: 1,
      name: activeProjectName,
      nodes: activeSnapshot.nodes,
      edges: activeSnapshot.edges,
      viewport: activeSnapshot.viewport,
    }
    saveStoredProject(snapshot)
    setProjectTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeProjectId ? { ...tab, snapshot: activeSnapshot } : tab,
      ),
    )
    if (activeTab?.libraryId) {
      writeLibraryProject(snapshot, activeTab.libraryId)
    }
    void persistProjectSnapshotToExternalStores(snapshot)
    appendHistory(`已保存：${activeProjectName}`)
  }, [activeProjectId, appendHistory, getCanvasSnapshot, projectTabs])

  /**
   * 激活某个项目标签，并加载该项目对应的画布。
   */
  const activateProjectTab = useCallback(
    (nextTabId: string) => {
      if (nextTabId === activeProjectId) return
      const currentSnapshot = getCanvasSnapshot()
      const currentId = activeProjectId
      const nextTab = projectTabs.find((tab) => tab.id === nextTabId)
      if (!nextTab) return

      setProjectTabs((prev) =>
        prev.map((tab) =>
          tab.id === currentId
            ? { ...tab, snapshot: currentSnapshot }
            : tab,
        ),
      )
      void applySnapshotWithLocalAssetHydration(nextTab.snapshot)
      setActiveProjectId(nextTabId)
      setSelectedNodeId(null)
    },
    [activeProjectId, applySnapshotWithLocalAssetHydration, getCanvasSnapshot, projectTabs],
  )

  /**
   * 生成不重复的项目名称，重复时自动追加 -1/-2。
   */
  const makeUniqueProjectName = useCallback(
    (rawName: string, excludeTabId?: string) => {
      const base = rawName.trim() || '新项目'
      const existing = new Set(
        projectTabs
          .filter((tab) => tab.id !== excludeTabId)
          .map((tab) => tab.name.toLowerCase()),
      )
      if (!existing.has(base.toLowerCase())) {
        return base
      }
      let index = 1
      while (existing.has(`${base}-${index}`.toLowerCase())) {
        index += 1
      }
      return `${base}-${index}`
    },
    [projectTabs],
  )

  /**
   * 新建项目标签并切换到新标签。
   */
  const createProjectLabel = useCallback(() => {
    const currentSnapshot = getCanvasSnapshot()
    const nextId = crypto.randomUUID()
    const nextName = makeUniqueProjectName('新项目')
    setProjectTabs((prev) => [
      ...prev.map((tab) =>
        tab.id === activeProjectId ? { ...tab, snapshot: currentSnapshot } : tab,
      ),
      { id: nextId, name: nextName, snapshot: createEmptyCanvasSnapshot() },
    ])
    setNodes([])
    setEdges([])
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
    setSelectedNodeId(null)
    setActiveProjectId(nextId)
  }, [activeProjectId, getCanvasSnapshot, makeUniqueProjectName, setEdges, setNodes, setViewport])

  /**
   * 双击标签进入原位重命名。
   */
  const startRenameProjectLabel = useCallback((tabId: string) => {
    const current = projectTabs.find((tab) => tab.id === tabId)
    if (!current) return
    setEditingTabId(tabId)
    setEditingName(current.name)
  }, [projectTabs])

  /**
   * 提交原位重命名，名称重复时自动顺延。
   */
  const commitRenameProjectLabel = useCallback((tabId: string) => {
    const nextName = makeUniqueProjectName(editingName, tabId)
    setProjectTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, name: nextName } : tab)),
    )
    setEditingTabId(null)
    setEditingName('')
  }, [editingName, makeUniqueProjectName])

  /**
   * 关闭项目标签，关闭前询问是否保存当前画布。
   */
  const closeProjectLabel = useCallback((tabId: string) => {
    const shouldSave = window.confirm('关闭项目前是否保存当前内容？')
    if (shouldSave) {
      saveProjectFull()
    }
    if (projectTabs.length <= 1) {
      const nextId = crypto.randomUUID()
      setProjectTabs([
        {
          id: nextId,
          name: '未命名项目',
          snapshot: createEmptyCanvasSnapshot(),
          libraryId: DEFAULT_WORKSPACE_LIBRARY_ID,
        },
      ])
      setNodes([])
      setEdges([])
      setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
      setSelectedNodeId(null)
      setActiveProjectId(nextId)
      return
    }
    const nextTabs = projectTabs.filter((tab) => tab.id !== tabId)
    setProjectTabs(nextTabs)
    if (tabId === activeProjectId) {
      const nextActive = nextTabs[0]
      void applySnapshotWithLocalAssetHydration(nextActive.snapshot)
      setSelectedNodeId(null)
      setActiveProjectId(nextActive.id)
    }
  }, [activeProjectId, applySnapshotWithLocalAssetHydration, projectTabs, saveProjectFull])

  /**
   * App 首页（档案管理）打开/删除工程时，通过 window 事件与工作区同步：
   * - 打开：新增一个标签（若已打开同路径则直接激活）
   * - 删除：若该工程已在标签中打开，则关闭对应标签
   */
  useEffect(() => {
    const onOpenFromArchive = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail as
        | {
            name?: string
            snapshot?: Omit<ProjectSnapshot, 'version' | 'name'>
            filePath?: string
          }
        | undefined
      if (!detail?.snapshot) return
      const fp = String(detail.filePath || '').trim()
      const fpKey = normalizeWindowsPathKey(fp)
      if (fpKey) {
        const existing = projectTabs.find((t) => normalizeWindowsPathKey(String(t.filePath || '')) === fpKey)
        if (existing) {
          activateProjectTab(existing.id)
          return
        }
      }

      const currentSnapshot = getCanvasSnapshot()
      const nextName = String(detail.name || '').trim() || '未命名项目'
      const nextSnapshot = cloneCanvasSnapshot(detail.snapshot)

      // 若当前仅有一个“未绑定文件”的占位标签，则直接复用它（避免同一工程被打开成两个标签）。
      const activeTab = projectTabs.find((t) => t.id === activeProjectId)
      const canReuseActive =
        !!fpKey && projectTabs.length === 1 && !!activeTab && !normalizeWindowsPathKey(String(activeTab.filePath || ''))
      if (canReuseActive) {
        setProjectTabs((prev) =>
          prev.map((t) =>
            t.id === activeProjectId
              ? {
                  ...t,
                  name: nextName,
                  snapshot: nextSnapshot,
                  libraryId: DEFAULT_WORKSPACE_LIBRARY_ID,
                  filePath: fp || null,
                }
              : t,
          ),
        )
        void applySnapshotWithLocalAssetHydration(nextSnapshot)
        setSelectedNodeId(null)
        saveStoredProject({
          version: 1,
          name: nextName,
          nodes: nextSnapshot.nodes,
          edges: nextSnapshot.edges,
          viewport: nextSnapshot.viewport,
        })
        return
      }

      const tabId = crypto.randomUUID()

      setProjectTabs((prev) => [
        ...prev.map((t) => (t.id === activeProjectId ? { ...t, snapshot: currentSnapshot } : t)),
        {
          id: tabId,
          name: nextName,
          snapshot: nextSnapshot,
          libraryId: DEFAULT_WORKSPACE_LIBRARY_ID,
          filePath: fp || null,
        },
      ])
      void applySnapshotWithLocalAssetHydration(nextSnapshot)
      setActiveProjectId(tabId)
      setSelectedNodeId(null)

      // 更新默认槽，便于刷新/崩溃恢复时从“最后一次打开的项目”进入
      saveStoredProject({
        version: 1,
        name: nextName,
        nodes: nextSnapshot.nodes,
        edges: nextSnapshot.edges,
        viewport: nextSnapshot.viewport,
      })
    }

    const onDeletedFromArchive = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail as { filePath?: string } | undefined
      const fp = String(detail?.filePath || '').trim()
      const fpKey = normalizeWindowsPathKey(fp)
      if (!fpKey) return
      const hit = projectTabs.find((t) => normalizeWindowsPathKey(String(t.filePath || '')) === fpKey)
      if (!hit) return
      closeProjectLabel(hit.id)
    }

    window.addEventListener('flowid:archive-open-project', onOpenFromArchive as EventListener)
    window.addEventListener('flowid:archive-deleted-project', onDeletedFromArchive as EventListener)
    return () => {
      window.removeEventListener('flowid:archive-open-project', onOpenFromArchive as EventListener)
      window.removeEventListener('flowid:archive-deleted-project', onDeletedFromArchive as EventListener)
    }
  }, [
    activateProjectTab,
    activeProjectId,
    applySnapshotWithLocalAssetHydration,
    cloneCanvasSnapshot,
    closeProjectLabel,
    getCanvasSnapshot,
    projectTabs,
  ])

  const activeProjectName = useMemo(() => {
    return projectTabs.find((tab) => tab.id === activeProjectId)?.name || '未命名项目'
  }, [projectTabs, activeProjectId])

  const getCurrentSnapshotForLibrary = useCallback((): ProjectSnapshot => {
    const s = getCanvasSnapshot()
    return {
      version: 1,
      name: activeProjectName,
      nodes: s.nodes,
      edges: s.edges,
      viewport: s.viewport,
    }
  }, [activeProjectName, getCanvasSnapshot])

  const registerCurrentToLibrary = useCallback(
    (libraryId: string, snapshot: ProjectSnapshot) => {
      setProjectTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeProjectId ? { ...tab, libraryId, name: snapshot.name || tab.name } : tab,
        ),
      )
    },
    [activeProjectId],
  )

  const openLibraryProjectInNewTab = useCallback(
    (snap: ProjectSnapshot, libraryId: string) => {
      const currentSnapshot = getCanvasSnapshot()
      const tabId = crypto.randomUUID()
      setProjectTabs((prev) => [
        ...prev.map((tab) =>
          tab.id === activeProjectId ? { ...tab, snapshot: currentSnapshot } : tab,
        ),
        {
          id: tabId,
          name: snap.name || '本地项目',
          snapshot: {
            nodes: snap.nodes,
            edges: snap.edges,
            viewport: snap.viewport,
          },
          libraryId,
        },
      ])
      void applySnapshotWithLocalAssetHydration({
        nodes: snap.nodes,
        edges: snap.edges,
        viewport: snap.viewport,
      })
      setActiveProjectId(tabId)
      setSelectedNodeId(null)
    },
    [activeProjectId, applySnapshotWithLocalAssetHydration, getCanvasSnapshot],
  )

  function openImportedProjectInNewTab(snap: ProjectSnapshot) {
    const currentSnapshot = getCanvasSnapshot()
    const tabId = crypto.randomUUID()
    setProjectTabs((prev) => [
      ...prev.map((tab) =>
        tab.id === activeProjectId ? { ...tab, snapshot: currentSnapshot } : tab,
      ),
      {
        id: tabId,
        name: snap.name || '导入项目',
        snapshot: {
          nodes: snap.nodes,
          edges: snap.edges,
          viewport: snap.viewport,
        },
        libraryId: null,
      },
    ])
    void applySnapshotWithLocalAssetHydration({
      nodes: snap.nodes,
      edges: snap.edges,
      viewport: snap.viewport,
    })
    setActiveProjectId(tabId)
    setSelectedNodeId(null)
  }

  /**
   * 初始化历史栈，并在节点/连线变化时记录快照。
   */
  useEffect(() => {
    if (!undoStackRef.current.length) {
      undoStackRef.current = [cloneCanvasSnapshot(getCanvasSnapshot())]
      redoStackRef.current = []
      return
    }
    if (isRestoringHistoryRef.current) return
    if (nodeCanvasDragActiveRef.current) return
    const next = cloneCanvasSnapshot(getCanvasSnapshot())
    const last = undoStackRef.current[undoStackRef.current.length - 1]
    if (JSON.stringify(last) === JSON.stringify(next)) return
    undoStackRef.current.push(next)
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift()
    }
    redoStackRef.current = []
  }, [nodes, edges, viewportVersion, postDragUndoTick, cloneCanvasSnapshot, getCanvasSnapshot])

  /**
   * 判断快捷键是否应忽略（如输入框编辑中）。
   */
  const shouldIgnoreHotkey = useCallback((event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement | null
    if (!target) return false
    const tag = target.tagName.toLowerCase()
    /**
     * 仅在真实表单控件上忽略画布快捷键，让 Ctrl+Z 等交给浏览器做「输入撤销」。
     * 不再整块屏蔽 `.studio-music-prompt-panel-wrap`，否则点在面板按钮上也会抢走画布撤销。
     */
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      return true
    }
    if (target.closest('[data-studio-settings-modal="1"]')) return true
    return false
  }, [])

  /**
   * 删除当前选中的节点，并同步清理关联连线。
   */
  const deleteSelectedNodes = useCallback(() => {
    if (!selectedNodeIds.length) return
    const selected = new Set(selectedNodeIds)
    setNodes((prev) => prev.filter((node) => !selected.has(node.id)))
    setEdges((prev) =>
      prev.filter((edge) => !selected.has(edge.source) && !selected.has(edge.target)),
    )
    setSelectedNodeId(null)
    appendHistory(`删除节点：${selectedNodeIds.length} 个`)
  }, [appendHistory, selectedNodeIds, setEdges, setNodes])

  const matchesShortcut = useCallback((event: KeyboardEvent, binding: string) => {
    const rawKey = event.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(rawKey)) return false
    const key =
      rawKey === ' '
        ? 'Space'
        : rawKey.length === 1
          ? rawKey.toUpperCase()
          : rawKey
    const combo = [
      event.ctrlKey || event.metaKey ? 'Ctrl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      key,
    ]
      .filter(Boolean)
      .join('+')
    return combo === binding
  }, [])

  /**
   * 复制当前选中内容到内存剪贴板。
   */
  const copySelectedNodes = useCallback(() => {
    if (!selectedNodeIds.length) return
    const selected = new Set(selectedNodeIds)
    const selectedNodes = nodes.filter((node) => selected.has(node.id))
    const selectedEdges = edges.filter(
      (edge) => selected.has(edge.source) && selected.has(edge.target),
    )
    setClipboard({
      nodes: structuredClone(selectedNodes),
      edges: structuredClone(selectedEdges),
    })
    appendHistory(`复制节点：${selectedNodes.length} 个`)
  }, [appendHistory, edges, nodes, selectedNodeIds])

  /**
   * 粘贴剪贴板内容到当前画布，并按固定纵向间距错开避免重叠。
   */
  const pasteClipboardNodes = useCallback(() => {
    if (!clipboard || !clipboard.nodes.length) return
    const bounds = getNodesBounds(clipboard.nodes)
    const verticalGap = 20
    const pasteOffset = {
      x: 0,
      y: bounds ? bounds.maxY - bounds.minY + verticalGap : verticalGap,
    }
    const allocatedTitles = new Set(
      nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
    )
    const idMap = new Map<string, string>()
    const pastedNodes = clipboard.nodes.map((node) => {
      const nextId = crypto.randomUUID()
      idMap.set(node.id, nextId)
      const rawTitle = String(node.data.title ?? '').trim()
      const kind = String(node.data.kind || '') as StudioNodeKind
      const fallbackTitle = `${NODE_KIND_LABEL[kind] || '节点'}节点`
      const uniqueTitle =
        node.type === 'ghost' || node.type === 'group'
          ? rawTitle || fallbackTitle
          : allocateUniqueNodeTitle(allocatedTitles, rawTitle || fallbackTitle)
      return {
        ...structuredClone(node),
        id: nextId,
        selected: true,
        data: {
          ...node.data,
          title: uniqueTitle,
        } as StudioNodeData,
        position: {
          x: node.position.x + pasteOffset.x,
          y: node.position.y + pasteOffset.y,
        },
      }
    })
    const pastedEdges = clipboard.edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...structuredClone(edge),
        id: crypto.randomUUID(),
        source: idMap.get(edge.source) as string,
        target: idMap.get(edge.target) as string,
        selected: false,
      }))
    const pastedNodeTitleById = new Map<string, string>(
      pastedNodes.map((n) => [n.id, String(n.data.title || '').trim()]),
    )
    const pastedNodesWithRemappedMentions = pastedNodes.map((node) => {
      const data = node.data
      if (data.kind === 'text' || data.kind === 'script') {
        const nextBody = remapMentionIdsInTextForPaste(String(data.body || ''), idMap, pastedNodeTitleById)
        if (nextBody === String(data.body || '')) return node
        return { ...node, data: { ...data, body: nextBody } as StudioNodeData }
      }
      if (data.kind === 'image' || data.kind === 'video') {
        const nextPrompt = remapMentionIdsInTextForPaste(
          String(data.prompt || ''),
          idMap,
          pastedNodeTitleById,
        )
        if (nextPrompt === String(data.prompt || '')) return node
        return { ...node, data: { ...data, prompt: nextPrompt } as StudioNodeData }
      }
      if (data.kind === 'audio' || data.kind === 'music') {
        const nextNote = remapMentionIdsInTextForPaste(String(data.note || ''), idMap, pastedNodeTitleById)
        if (nextNote === String(data.note || '')) return node
        return { ...node, data: { ...data, note: nextNote } as StudioNodeData }
      }
      return node
    })
    setNodes((prev) =>
      prev.map((node) => ({ ...node, selected: false })).concat(pastedNodesWithRemappedMentions),
    )
    setEdges((prev) => prev.concat(pastedEdges))
    setSelectedNodeId(pastedNodesWithRemappedMentions[0]?.id ?? null)
    appendHistory(`粘贴节点：${pastedNodesWithRemappedMentions.length} 个`)
  }, [appendHistory, clipboard, nodes, setEdges, setNodes])

  /**
   * 复制并删除当前选中内容（剪切）。
   */
  const cutSelectedNodes = useCallback(() => {
    if (!selectedNodeIds.length) return
    copySelectedNodes()
    deleteSelectedNodes()
    appendHistory(`剪切节点：${selectedNodeIds.length} 个`)
  }, [appendHistory, copySelectedNodes, deleteSelectedNodes, selectedNodeIds.length])

  /**
   * 统一平移选中节点（方向键微调）。
   */
  const moveSelectedNodes = useCallback(
    (dx: number, dy: number) => {
      if (!selectedNodeIds.length) return
      const selected = new Set(selectedNodeIds)
      setNodes((prev) =>
        prev.map((node) =>
          selected.has(node.id)
            ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
            : node,
        ),
      )
    },
    [selectedNodeIds, setNodes],
  )

  /**
   * 撤销：回退到上一个画布快照。
   */
  const undoCanvas = useCallback(() => {
    if (undoStackRef.current.length <= 1) return
    const current = undoStackRef.current.pop()
    if (!current) return
    redoStackRef.current.push(cloneCanvasSnapshot(current))
    const prev = undoStackRef.current[undoStackRef.current.length - 1]
    if (!prev) return
    isRestoringHistoryRef.current = true
    applyCanvasSnapshot(cloneCanvasSnapshot(prev))
    /** 须在记录历史的 useEffect 之后再把标记清掉；queueMicrotask 过早会导致恢复态被误压入栈 */
    window.setTimeout(() => {
      isRestoringHistoryRef.current = false
    }, 0)
    appendHistory('撤销一步')
  }, [appendHistory, applyCanvasSnapshot, cloneCanvasSnapshot])

  /**
   * 重做：恢复最近一次撤销的画布快照。
   */
  const redoCanvas = useCallback(() => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(cloneCanvasSnapshot(next))
    isRestoringHistoryRef.current = true
    applyCanvasSnapshot(cloneCanvasSnapshot(next))
    window.setTimeout(() => {
      isRestoringHistoryRef.current = false
    }, 0)
    appendHistory('重做一步')
  }, [appendHistory, applyCanvasSnapshot, cloneCanvasSnapshot])

  /**
   * 注册全局快捷键：复制/粘贴/删除/撤销重做/移动等。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /** Ctrl+S 保存工程须始终生效，不能受「关闭全局快捷键」影响，否则外部 input 镜像等落盘永远不会触发 */
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveProjectFull()
        return
      }
      if (!shortcuts.enableGlobalHotkeys) return
      if (shouldIgnoreHotkey(event)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        createGroupFromSelection()
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.selectAll)) {
        event.preventDefault()
        setNodes((prev) => prev.map((node) => ({ ...node, selected: true })))
        return
      }
      if (event.key === 'Escape') {
        setNodes((prev) => prev.map((node) => ({ ...node, selected: false })))
        setSelectedNodeId(null)
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.copy)) {
        event.preventDefault()
        copySelectedNodes()
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.cut)) {
        event.preventDefault()
        cutSelectedNodes()
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.paste)) {
        /** 仅在有「复制过的节点」时才拦截 Ctrl+V，否则把系统剪贴板交给 paste 事件（画布贴图/输入框粘贴） */
        if (clipboard?.nodes?.length) {
          event.preventDefault()
          pasteClipboardNodes()
        }
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.duplicate)) {
        event.preventDefault()
        copySelectedNodes()
        pasteClipboardNodes()
        return
      }
      /**
       * 画布撤销/重做：仅在非输入控件上触发（输入框内 Ctrl+Z 交给浏览器做逐字撤销）。
       * 自动拆分后会对提示框 textarea 执行 blur，便于下一步直接撤画布。
       */
      if (matchesShortcut(event, shortcuts.bindings.redo)) {
        event.preventDefault()
        redoCanvas()
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.undo)) {
        event.preventDefault()
        undoCanvas()
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.resetZoom)) {
        event.preventDefault()
        const v = getViewport()
        setViewport({ x: v.x, y: v.y, zoom: 1 }, { duration: 180 })
        setZoomPercent(100)
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.fitView)) {
        event.preventDefault()
        setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })
        return
      }
      if (matchesShortcut(event, shortcuts.bindings.delete)) {
        event.preventDefault()
        deleteSelectedNodes()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelectedNodes(0, event.shiftKey ? -shortcuts.fastMoveStep : -shortcuts.moveStep)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelectedNodes(0, event.shiftKey ? shortcuts.fastMoveStep : shortcuts.moveStep)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveSelectedNodes(event.shiftKey ? -shortcuts.fastMoveStep : -shortcuts.moveStep, 0)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveSelectedNodes(event.shiftKey ? shortcuts.fastMoveStep : shortcuts.moveStep, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    copySelectedNodes,
    cutSelectedNodes,
    deleteSelectedNodes,
    getViewport,
    moveSelectedNodes,
    matchesShortcut,
    pasteClipboardNodes,
    redoCanvas,
    setNodes,
    setViewport,
    setZoomPercent,
    shortcuts.enableGlobalHotkeys,
    shortcuts.bindings,
    shortcuts.fastMoveStep,
    shortcuts.moveStep,
    shouldIgnoreHotkey,
    createGroupFromSelection,
    undoCanvas,
    saveProjectFull,
    clipboard,
  ])

  /**
   * 固定 UI 比例：阻止浏览器页面缩放快捷键（Ctrl/? + +/-/0 与 Ctrl/? + 滚轮）。
   * 若用户尝试调整，给出明确提醒。
   */
  useEffect(() => {
    const remind = () => {
      appendHistory(
        '已拦截浏览器对本页的缩放快捷键（Ctrl/Cmd + +/- / 0 / 滚轮）。界面比例由工作台 CSS（--ui-scale，当前约 1.3）控制；右下角百分比是「画布视口」缩放。',
      )
    }
    const onZoomHotkey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
        event.preventDefault()
        remind()
      }
    }
    const onZoomWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      remind()
    }
    window.addEventListener('keydown', onZoomHotkey, { passive: false })
    window.addEventListener('wheel', onZoomWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onZoomHotkey as EventListener)
      window.removeEventListener('wheel', onZoomWheel as EventListener)
    }
  }, [appendHistory])

  useEffect(() => {
    const timer = window.setTimeout(() => persist(), 450)
    return () => window.clearTimeout(timer)
  }, [persist, viewportVersion])

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceId = connection.source
      const targetId = connection.target
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { strokeWidth: 2 },
          },
          eds,
        ),
      )
      if (!sourceId || !targetId) return
      setNodes((prev) => {
        const source = prev.find((n) => n.id === sourceId)
        const target = prev.find((n) => n.id === targetId)
        if (!source || !target) return prev
        const sourceTitle = String(source.data.title || '').trim()
        const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id)
        if (!patch) return prev
        return prev.map((node) =>
          node.id === targetId
            ? {
                ...node,
                data: { ...node.data, ...patch } as StudioNodeData,
              }
            : node,
        )
      })
    },
    [setEdges, setNodes],
  )

  const onMoveEnd = useCallback(() => {
    setViewportVersion((v) => v + 1)
    setZoomPercent(Math.round(getZoom() * 100))
  }, [getZoom])

  /**
   * 节点拖动：拖动过程中不往撤销栈写入中间位置，松手后合并为一步。
   */
  const onNodeDragStart = useCallback((event: DomMouseEvent | ReactMouseEvent, node: Node<StudioNodeData>) => {
    nodeCanvasDragActiveRef.current = true
    if (!event.altKey) {
      altDragCloneRef.current = {
        active: false,
        sourceNodeIds: [],
        sourceNodesAtDragStart: [],
      }
      return
    }
    const selected = new Set(selectedNodeIds)
    const dragSet =
      selected.has(node.id) && selected.size > 0 ? selected : new Set<string>([node.id])
    const sourceNodes = nodes
      .filter((n) => dragSet.has(n.id))
      .map((n) => structuredClone(n))
    altDragCloneRef.current = {
      active: sourceNodes.length > 0,
      sourceNodeIds: sourceNodes.map((n) => n.id),
      sourceNodesAtDragStart: sourceNodes,
    }
  }, [nodes, selectedNodeIds])

  const onNodeDragStop = useCallback(() => {
    const altDragState = altDragCloneRef.current
    if (altDragState.active && altDragState.sourceNodeIds.length > 0) {
      const sourceIdSet = new Set(altDragState.sourceNodeIds)
      const sourceStartById = new Map(
        altDragState.sourceNodesAtDragStart.map((n) => [n.id, n]),
      )
      const movedNodes = nodes.filter((n) => sourceIdSet.has(n.id))
      if (movedNodes.length > 0) {
        const allocatedTitles = new Set(
          nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
        )
        const idMap = new Map<string, string>()
        const duplicatedNodes = movedNodes.map((node) => {
          const nextId = crypto.randomUUID()
          idMap.set(node.id, nextId)
          const rawTitle = String(node.data.title ?? '').trim()
          const kind = String(node.data.kind || '') as StudioNodeKind
          const fallbackTitle = `${NODE_KIND_LABEL[kind] || '节点'}节点`
          const uniqueTitle =
            node.type === 'ghost' || node.type === 'group'
              ? rawTitle || fallbackTitle
              : allocateUniqueNodeTitle(allocatedTitles, rawTitle || fallbackTitle)
          return {
            ...structuredClone(node),
            id: nextId,
            selected: true,
            data: {
              ...node.data,
              title: uniqueTitle,
            } as StudioNodeData,
          }
        })
        const duplicatedNodeTitleById = new Map<string, string>(
          duplicatedNodes.map((n) => [n.id, String(n.data.title || '').trim()]),
        )
        const duplicatedNodesWithRemappedMentions = duplicatedNodes.map((node) => {
          const data = node.data
          if (data.kind === 'text' || data.kind === 'script') {
            const nextBody = remapMentionIdsInTextForPaste(
              String(data.body || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            if (nextBody === String(data.body || '')) return node
            return { ...node, data: { ...data, body: nextBody } as StudioNodeData }
          }
          if (data.kind === 'image' || data.kind === 'video') {
            const nextPrompt = remapMentionIdsInTextForPaste(
              String(data.prompt || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            if (nextPrompt === String(data.prompt || '')) return node
            return { ...node, data: { ...data, prompt: nextPrompt } as StudioNodeData }
          }
          if (data.kind === 'audio' || data.kind === 'music') {
            const nextNote = remapMentionIdsInTextForPaste(
              String(data.note || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            if (nextNote === String(data.note || '')) return node
            return { ...node, data: { ...data, note: nextNote } as StudioNodeData }
          }
          return node
        })
        const duplicatedEdges = edges
          .filter((edge) => sourceIdSet.has(edge.source) && sourceIdSet.has(edge.target))
          .map((edge) => ({
            ...structuredClone(edge),
            id: crypto.randomUUID(),
            source: idMap.get(edge.source) as string,
            target: idMap.get(edge.target) as string,
            selected: false,
          }))
        setNodes((prev) =>
          prev
            .map((n) => {
              if (!sourceIdSet.has(n.id)) return { ...n, selected: false }
              const startNode = sourceStartById.get(n.id)
              return startNode
                ? { ...structuredClone(startNode), selected: false }
                : { ...n, selected: false }
            })
            .concat(duplicatedNodesWithRemappedMentions),
        )
        setEdges((prev) => prev.concat(duplicatedEdges))
        setSelectedNodeId(duplicatedNodesWithRemappedMentions[0]?.id ?? null)
        appendHistory(`Alt拖动复制节点：${duplicatedNodesWithRemappedMentions.length} 个`)
      }
    }
    altDragCloneRef.current = {
      active: false,
      sourceNodeIds: [],
      sourceNodesAtDragStart: [],
    }
    nodeCanvasDragActiveRef.current = false
    setPostDragUndoTick((n) => n + 1)
  }, [appendHistory, edges, nodes, setEdges, setNodes])

  /**
   * 画布空白处右键：关闭自定义菜单并抑制浏览器默认菜单（避免与画布交互冲突）。
   */
  const onPaneContextMenu = useCallback(
    (event: DomMouseEvent | ReactMouseEvent) => {
      dismissMultiSelectContextMenu()
      event.preventDefault()
    },
    [dismissMultiSelectContextMenu],
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const eligibleSelected = params.nodes.filter(
      (node) => node.type !== 'ghost' && node.type !== 'group',
    )
    /**
     * 仅单选业务节点时展示底部提示框；框选/多选时不弹，避免批量操作被遮挡。
     */
    if (eligibleSelected.length === 1) {
      setSelectedNodeId(eligibleSelected[0]!.id)
    } else {
      setSelectedNodeId(null)
    }
    if (eligibleSelected.length < 1) {
      dismissMultiSelectContextMenu()
    }
  }, [dismissMultiSelectContextMenu])

  /**
   * 从字符串中提取「分镜」编号（支持 `分镜12`、`分镜5-1` 等）。
   * @returns 形如 `[主序号, 子序号]`；解析失败返回 null。
   */
  const parseStoryboardRankFromText = useCallback((raw: string): [number, number] | null => {
    const s = String(raw || '').trim()
    if (!s) return null
    const m = s.match(/分镜\s*(\d+)(?:\s*[-–]\s*(\d+))?/u)
    if (!m) return null
    const major = Number(m[1])
    const minor = m[2] != null ? Number(m[2]) : 0
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
    return [major, minor]
  }, [])

  /**
   * 从节点提取用于排序的「分镜号」：优先标题，其次本地文件名，再其次 URL 末段。
   */
  const getStoryboardRankForSort = useCallback((node: Node<StudioNodeData>): [number, number] | null => {
    const data = node.data
    const title = String(data.title || '').trim()
    const fromTitle = parseStoryboardRankFromText(title)
    if (fromTitle) return fromTitle

    const pickNameFromUrl = (raw: string): string => {
      const u = String(raw || '').trim()
      if (!u) return ''
      const noQuery = u.split(/[?#]/)[0] ?? u
      const seg = noQuery.split('/').pop() ?? noQuery
      try {
        return decodeURIComponent(seg).trim()
      } catch {
        return seg.trim()
      }
    }

    if (data.kind === 'audio' || data.kind === 'music') {
      const explicit = String(data.srcFileName || '').trim()
      const fromExplicit = parseStoryboardRankFromText(explicit)
      if (fromExplicit) return fromExplicit
      const first = data.resultSources?.[0] || data.src || ''
      const fromUrl = parseStoryboardRankFromText(pickNameFromUrl(first))
      if (fromUrl) return fromUrl
      return null
    }
    if (data.kind === 'image' || data.kind === 'video' || data.kind === 'panorama') {
      const explicit = String(data.srcFileName || '').trim()
      const fromExplicit = parseStoryboardRankFromText(explicit)
      if (fromExplicit) return fromExplicit
      const fromUrl = parseStoryboardRankFromText(pickNameFromUrl(data.src || ''))
      if (fromUrl) return fromUrl
      return null
    }
    return null
  }, [parseStoryboardRankFromText])

  /**
   * 多选右键：按标题中的分镜号排序并纵向排布（间距 20）；无分镜号时回退到标题/文件名。
   */
  const sortSelectedNodesByFileNameVertical = useCallback(() => {
    const selected = nodes.filter(
      (node) =>
        node.selected &&
        node.type !== 'ghost' &&
        node.type !== 'group' &&
        (
          node.data.kind === 'text' ||
          node.data.kind === 'script' ||
          node.data.kind === 'image' ||
          node.data.kind === 'video' ||
          node.data.kind === 'audio' ||
          node.data.kind === 'music' ||
          node.data.kind === 'panorama'
        ),
    )
    if (selected.length < 2) {
      window.alert('请至少框选 2 个可排序节点（文字/剧本/图/视频/音频/音乐/全景）')
      return
    }
    const pickFallbackKey = (node: Node<StudioNodeData>): string => {
      const data = node.data
      if (data.kind === 'audio' || data.kind === 'music') {
        return String(data.srcFileName || data.title || '').trim()
      }
      if (data.kind === 'image' || data.kind === 'video' || data.kind === 'panorama') {
        return String(data.srcFileName || data.title || '').trim()
      }
      return String(data.title || '').trim()
    }

    const sorted = [...selected].sort((a, b) => {
      const ra = getStoryboardRankForSort(a)
      const rb = getStoryboardRankForSort(b)
      if (ra && rb) {
        if (ra[0] !== rb[0]) return ra[0] - rb[0]
        if (ra[1] !== rb[1]) return ra[1] - rb[1]
      } else if (ra && !rb) {
        return -1
      } else if (!ra && rb) {
        return 1
      }
      return pickFallbackKey(a).localeCompare(pickFallbackKey(b), 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      })
    })
    const baseX = Math.min(...sorted.map((n) => n.position.x))
    const baseY = Math.min(...sorted.map((n) => n.position.y))
    let cursorY = baseY
    const nextPos = new Map<string, XYPosition>()
    sorted.forEach((node) => {
      nextPos.set(node.id, { x: baseX, y: cursorY })
      const h = getNodeSize(node).height
      cursorY += h + 20
    })
    setNodes((prev) =>
      prev.map((node) => {
        const p = nextPos.get(node.id)
        if (!p) return node
        return {
          ...node,
          position: p,
        }
      }),
    )
    setPostDragUndoTick((n) => n + 1)
    appendHistory('已按标题分镜号纵向排序选中节点')
    dismissMultiSelectContextMenu()
  }, [appendHistory, dismissMultiSelectContextMenu, getStoryboardRankForSort, nodes, setNodes])

  /**
   * 新增节点；若传入 `flowPosition` 则在指定画布坐标落点，否则落在屏幕偏中位置。
   */
  const addNode = useCallback(
    (kind: StudioNodeKind, flowPosition?: XYPosition) => {
      const id = crypto.randomUUID()
      const position =
        flowPosition ??
        pendingCanvasNodePositionRef.current ??
        screenToFlowPosition({
          x: window.innerWidth * 0.46,
          y: window.innerHeight * 0.38,
        })
      pendingCanvasNodePositionRef.current = null
      setCanvasAddMenu(null)
      setNodes((nds) => {
        const index = getNextNodeTitleIndex(nds, kind)
        const title = `${NODE_KIND_LABEL[kind]}节点${index}`
        return [...nds, createStudioNode(kind, id, position, title)]
      })
      appendHistory(`新增节点：${kind}`)
    },
    [screenToFlowPosition, setNodes, appendHistory],
  )

  /**
   * 从“拖线未命中”上下文创建节点，并将连接补全到新节点。
   */
  const addNodeFromPendingConnect = useCallback(
    (kind: StudioNodeKind) => {
      const pending = pendingConnectRef.current
      if (!pending) {
        addNode(kind)
        return
      }
      const id = crypto.randomUUID()
      const anchorNode = nodes.find((node) => node.id === pending.nodeId)
      const anchorSize = anchorNode ? getNodeSize(anchorNode) : null
      const position =
        pendingCanvasNodePositionRef.current ??
        (anchorNode
          ? {
              x:
                pending.handleType === 'source'
                  ? anchorNode.position.x + (anchorSize?.width ?? DEFAULT_NODE_WIDTH) + NODE_APPEND_GAP
                  : anchorNode.position.x - DEFAULT_NODE_WIDTH - NODE_APPEND_GAP,
              y: anchorNode.position.y,
            }
          : screenToFlowPosition({
              x: window.innerWidth * 0.52,
              y: window.innerHeight * 0.42,
            }))
      const allocatedTitles = new Set(
        nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
      )
      let baseTitle: string
      if (kind === 'image' && anchorNode) {
        const derived = buildImageLinkedNewNodeBaseTitle(anchorNode)
        if (derived) {
          baseTitle = derived
        } else {
          const index = getNextNodeTitleIndexConsideringAllocated(nodes, 'image', allocatedTitles)
          baseTitle = `${NODE_KIND_LABEL.image}节点${index}`
        }
      } else {
        const index = getNextNodeTitleIndexConsideringAllocated(nodes, kind, allocatedTitles)
        baseTitle = `${NODE_KIND_LABEL[kind]}节点${index}`
      }
      const title = allocateUniqueNodeTitle(allocatedTitles, baseTitle)
      setNodes((nds) => [...nds, createStudioNode(kind, id, position, title)])
      const preview = pendingConnectPreviewRef.current
      if (preview) {
        setEdges((eds) =>
          eds.map((edge) =>
            edge.id === preview.edgeId
              ? {
                  ...edge,
                  source: pending.handleType === 'source' ? pending.nodeId : id,
                  target: pending.handleType === 'source' ? id : pending.nodeId,
                }
              : edge,
          ),
        )
        setNodes((nds) => nds.filter((node) => node.id !== preview.ghostNodeId))
        pendingConnectPreviewRef.current = null
      } else {
        setEdges((eds) =>
          addEdge(
            {
              id: crypto.randomUUID(),
              source: pending.handleType === 'source' ? pending.nodeId : id,
              target: pending.handleType === 'source' ? id : pending.nodeId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            eds,
          ),
        )
      }
      if (pending.handleType === 'source') {
        setNodes((prev) => {
          const source = prev.find((node) => node.id === pending.nodeId)
          const target = prev.find((node) => node.id === id)
          if (!source || !target) return prev
          const sourceTitle = String(source.data.title || '').trim()
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id)
          if (!patch) return prev
          return prev.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: { ...node.data, ...patch } as StudioNodeData,
                }
              : node,
          )
        })
      }
      setNodes((prev) => {
        const gid = findGroupIdContainingMember(prev, pending.nodeId)
        if (!gid) return prev
        return prev.map((node) => {
          if (node.id !== gid || node.data.kind !== 'group') return node
          const existing = new Set(node.data.memberIds ?? [])
          existing.add(id)
          return {
            ...node,
            data: { ...node.data, kind: 'group', memberIds: Array.from(existing) },
          }
        })
      })
      appendHistory(`连接并新增节点：${kind}`)
      dismissConnectAddMenu()
    },
    [addNode, appendHistory, dismissConnectAddMenu, nodes, screenToFlowPosition, setEdges, setNodes],
  )

  /**
   * 节点左右分支按钮：新增同类型节点并自动连线，交互贴近 ComfyUI。
   */
  const addLinkedNode = useCallback(
    (nodeId: string, side: 'left' | 'right', kind?: StudioNodeKind) => {
      const anchor = nodes.find((node) => node.id === nodeId)
      if (!anchor) return
      const baseKind = (kind ?? anchor.data.kind) as StudioNodeKind
      const id = crypto.randomUUID()
      const allocatedTitles = new Set(
        nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
      )
      let baseTitle: string
      if (baseKind === 'image') {
        const derived = buildImageLinkedNewNodeBaseTitle(anchor)
        if (derived) {
          baseTitle = derived
        } else {
          const index = getNextNodeTitleIndexConsideringAllocated(nodes, 'image', allocatedTitles)
          baseTitle = `${NODE_KIND_LABEL.image}节点${index}`
        }
      } else {
        const index = getNextNodeTitleIndexConsideringAllocated(nodes, baseKind, allocatedTitles)
        baseTitle = `${NODE_KIND_LABEL[baseKind]}节点${index}`
      }
      const title = allocateUniqueNodeTitle(allocatedTitles, baseTitle)
      const anchorSize = getNodeSize(anchor)
      const position = {
        x:
          side === 'right'
            ? anchor.position.x + anchorSize.width + NODE_APPEND_GAP
            : anchor.position.x - DEFAULT_NODE_WIDTH - NODE_APPEND_GAP,
        y: anchor.position.y,
      }
      setNodes((nds) => [...nds, createStudioNode(baseKind, id, position, title)])
      setEdges((eds) =>
        addEdge(
          {
            id: crypto.randomUUID(),
            source: side === 'right' ? nodeId : id,
            target: side === 'right' ? id : nodeId,
            animated: true,
            style: { strokeWidth: 2 },
          },
          eds,
        ),
      )
      if (side === 'right') {
        setNodes((prev) => {
          const source = prev.find((node) => node.id === nodeId)
          const target = prev.find((node) => node.id === id)
          if (!source || !target) return prev
          const sourceTitle = String(source.data.title || '').trim()
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id)
          if (!patch) return prev
          return prev.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: { ...node.data, ...patch } as StudioNodeData,
                }
              : node,
          )
        })
      }
      setNodes((prev) => {
        const gid = findGroupIdContainingMember(prev, nodeId)
        if (!gid) return prev
        return prev.map((node) => {
          if (node.id !== gid || node.data.kind !== 'group') return node
          const existing = new Set(node.data.memberIds ?? [])
          existing.add(id)
          return {
            ...node,
            data: { ...node.data, kind: 'group', memberIds: Array.from(existing) },
          }
        })
      })
      appendHistory(`分支新增节点：${baseKind}`)
    },
    [appendHistory, nodes, setEdges, setNodes],
  )

  /**
   * 在指针位置打开「节点右键菜单」（依赖当前 nodes 里的 `selected` 标记）。
   *
   * 说明：框选/多选时，React Flow 会在节点上方渲染选择矩形（`react-flow__nodesselection-rect`），
   * 右键通常命中该层并触发 `onSelectionContextMenu`，而不是 `onNodeContextMenu`。
   */
  const openMultiSelectBatchMenuFromPointer = useCallback(
    (event: DomMouseEvent | ReactMouseEvent) => {
      const eligibleCount = nodes.filter(
        (n) => n.selected && n.type !== 'ghost' && n.type !== 'group',
      ).length
      if (eligibleCount < 1) {
        dismissMultiSelectContextMenu()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      dismissConnectAddMenu()
      dismissCanvasAddMenu()
      setLeftPanel(null)
      const main = clampMultiSelectContextMenuPosition(event.clientX, event.clientY)
      const roomRight = window.innerWidth - (main.left + MULTI_SELECT_CTX_MENU_EST_W + 8)
      const preferSubmenuRight = roomRight >= MULTI_SELECT_SYNC_SUBMENU_EST_W + 10
      cancelSubmenuHoverCloseTimer()
      setMultiSelectContextMenu({
        left: main.left,
        top: main.top,
        submenuMode: null,
        preferSubmenuRight,
      })
    },
    [
      cancelSubmenuHoverCloseTimer,
      dismissCanvasAddMenu,
      dismissConnectAddMenu,
      dismissMultiSelectContextMenu,
      nodes,
      setLeftPanel,
    ],
  )

  /**
   * 选中矩形上右键：打开节点菜单（主路径）。
   */
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      openMultiSelectBatchMenuFromPointer(event)
    },
    [openMultiSelectBatchMenuFromPointer],
  )

  /**
   * 右键「新增节点」：为每个当前选中的业务节点在右侧新增指定类型节点并自动连线（单选 1 个、多选多个；语义对齐 `addLinkedNode` 右侧分支）。
   * 图片节点：标题为 `图-锚点标题`（锚点仍为「图片节点N」时顺延默认序号）；与画布重名时按尾号递增。
   */
  const addLinkedNodesViaContextMenuSelection = useCallback(
    (kind: StudioNodeKind) => {
      const anchorIds = nodes
        .filter((node) => node.selected && node.type !== 'ghost' && node.type !== 'group')
        .map((node) => node.id)
      if (anchorIds.length < 1) {
        window.alert('请先选中至少一个可用节点（分组框/占位节点不计入）')
        return
      }

      const creations = anchorIds.map((anchorId) => {
        const anchor = nodes.find((node) => node.id === anchorId)
        if (!anchor) return null
        const anchorSize = getNodeSize(anchor)
        const newId = crypto.randomUUID()
        return { anchorId, anchor, anchorSize, newId }
      }).filter(Boolean) as Array<{
        anchorId: string
        anchor: Node<StudioNodeData>
        anchorSize: { width: number; height: number }
        newId: string
      }>

      const allocatedTitles = new Set(
        nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
      )

      const newNodes: Array<Node<StudioNodeData>> = []
      const newEdges: Array<Edge> = []

      creations.forEach(({ anchorId, anchor, anchorSize, newId }) => {
        let baseTitle: string
        if (kind === 'image') {
          const derived = buildImageLinkedNewNodeBaseTitle(anchor)
          if (derived) {
            baseTitle = derived
          } else {
            const index = getNextNodeTitleIndexConsideringAllocated(nodes, 'image', allocatedTitles)
            baseTitle = `${NODE_KIND_LABEL.image}节点${index}`
          }
        } else {
          const index = getNextNodeTitleIndexConsideringAllocated(nodes, kind, allocatedTitles)
          baseTitle = `${NODE_KIND_LABEL[kind]}节点${index}`
        }
        const title = allocateUniqueNodeTitle(allocatedTitles, baseTitle)
        const position = {
          x: anchor.position.x + anchorSize.width + NODE_APPEND_GAP,
          y: anchor.position.y,
        }
        newNodes.push(createStudioNode(kind, newId, position, title))
        newEdges.push({
          id: crypto.randomUUID(),
          source: anchorId,
          target: newId,
          animated: true,
          style: { strokeWidth: 2 },
        })
      })

      setNodes((prev) => [...prev, ...newNodes])
      setEdges((prev) => [...prev, ...newEdges])

      setNodes((prev) => {
        let next = prev
        creations.forEach(({ anchorId, newId }) => {
          const source = next.find((node) => node.id === anchorId)
          const target = next.find((node) => node.id === newId)
          if (!source || !target) return
          const sourceTitle = String(source.data.title || '').trim()
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id)
          if (!patch) return
          next = next.map((node) =>
            node.id === newId
              ? {
                  ...node,
                  data: { ...node.data, ...patch } as StudioNodeData,
                }
              : node,
          )
        })
        return next
      })

      setNodes((prev) => {
        const byGroup = new Map<string, Set<string>>()
        creations.forEach(({ anchorId, newId }) => {
          const gid = findGroupIdContainingMember(prev, anchorId)
          if (!gid) return
          const bucket = byGroup.get(gid) ?? new Set()
          bucket.add(newId)
          byGroup.set(gid, bucket)
        })
        if (!byGroup.size) return prev
        return prev.map((node) => {
          if (node.type !== 'group' || node.data.kind !== 'group') return node
          const add = byGroup.get(node.id)
          if (!add?.size) return node
          const existing = new Set(node.data.memberIds ?? [])
          add.forEach((nid) => existing.add(nid))
          return {
            ...node,
            data: { ...node.data, kind: 'group', memberIds: Array.from(existing) },
          }
        })
      })

      dismissMultiSelectContextMenu()
      appendHistory(`新增节点：${kind}（${creations.length} 个）`)
    },
    [appendHistory, dismissMultiSelectContextMenu, nodes, setEdges, setNodes],
  )

  /**
   * 右键「新增共同节点」：只新增 1 个节点，并将当前所有选中业务节点连向该节点。
   */
  const addCommonNodeViaContextMenuSelection = useCallback(
    (kind: StudioNodeKind) => {
      const anchors = nodes.filter(
        (node) => node.selected && node.type !== 'ghost' && node.type !== 'group',
      )
      if (anchors.length < 1) {
        window.alert('请先选中至少一个可用节点（分组框/占位节点不计入）')
        return
      }
      const orderedAnchors = [...anchors].sort((a, b) => {
        const ia = parseDefaultNodeTitleIndex(String(a.data.title || ''))
        const ib = parseDefaultNodeTitleIndex(String(b.data.title || ''))
        const hasA = ia != null
        const hasB = ib != null
        if (hasA && hasB && ia !== ib) return (ia as number) - (ib as number)
        if (hasA && !hasB) return -1
        if (!hasA && hasB) return 1
        return String(a.data.title || '').localeCompare(String(b.data.title || ''), 'zh-CN', {
          numeric: true,
          sensitivity: 'base',
        })
      })
      const allocatedTitles = new Set(
        nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
      )
      const index = getNextNodeTitleIndexConsideringAllocated(nodes, kind, allocatedTitles)
      const title = allocateUniqueNodeTitle(allocatedTitles, `${NODE_KIND_LABEL[kind]}节点${index}`)
      const rightMostX = Math.max(...orderedAnchors.map((n) => n.position.x + getNodeSize(n).width))
      const topY = Math.min(...orderedAnchors.map((n) => n.position.y))
      const newId = crypto.randomUUID()
      const newPos = {
        x: rightMostX + NODE_APPEND_GAP,
        y: topY,
      }
      const newNode = createStudioNode(kind, newId, newPos, title)
      let inheritedData = newNode.data as StudioNodeData
      ;[...orderedAnchors].reverse().forEach((source) => {
        const sourceTitle = String(source.data.title || '').trim()
        const patch = buildInheritedPatchForTarget(inheritedData, sourceTitle, source.id)
        if (!patch) return
        inheritedData = {
          ...inheritedData,
          ...patch,
        } as StudioNodeData
      })
      const newNodeWithInherited: Node<StudioNodeData> = {
        ...newNode,
        data: inheritedData,
      }
      const newEdges: Array<Edge> = orderedAnchors.map((source) => ({
        id: crypto.randomUUID(),
        source: source.id,
        target: newId,
        animated: true,
        style: { strokeWidth: 2 },
      }))
      setNodes((prev) => [...prev, newNodeWithInherited])
      setEdges((prev) => [...prev, ...newEdges])
      dismissMultiSelectContextMenu()
      appendHistory(`新增共同节点：${kind}（连接 ${orderedAnchors.length} 个）`)
    },
    [appendHistory, dismissMultiSelectContextMenu, nodes, setEdges, setNodes],
  )

  /**
   * 节点上右键：未选中时先单选该节点再打开菜单；已选中则走统一打开逻辑（见 `onSelectionContextMenu`）。
   */
  const onNodeContextMenu = useCallback(
    (event: DomMouseEvent | ReactMouseEvent, node: Node<StudioNodeData>) => {
      if (node.type === 'ghost') return
      if (node.type === 'group') {
        dismissMultiSelectContextMenu()
        return
      }

      if (!node.selected) {
        event.preventDefault()
        event.stopPropagation()
        dismissConnectAddMenu()
        dismissCanvasAddMenu()
        setLeftPanel(null)
        setNodes((prev) =>
          prev.map((n) => ({
            ...n,
            selected: n.id === node.id,
          })),
        )
        // 等待 RF 同步选区后再开菜单，避免 onSelectionChange 仍见「0 个业务选中」把菜单立刻关掉
        queueMicrotask(() => {
          const main = clampMultiSelectContextMenuPosition(event.clientX, event.clientY)
          const roomRight = window.innerWidth - (main.left + MULTI_SELECT_CTX_MENU_EST_W + 8)
          const preferSubmenuRight = roomRight >= MULTI_SELECT_SYNC_SUBMENU_EST_W + 10
          cancelSubmenuHoverCloseTimer()
          setMultiSelectContextMenu({
            left: main.left,
            top: main.top,
            submenuMode: null,
            preferSubmenuRight,
          })
        })
        return
      }

      openMultiSelectBatchMenuFromPointer(event)
    },
    [
      cancelSubmenuHoverCloseTimer,
      dismissCanvasAddMenu,
      dismissConnectAddMenu,
      dismissMultiSelectContextMenu,
      openMultiSelectBatchMenuFromPointer,
      setLeftPanel,
      setNodes,
    ],
  )

  /** 用于在画布空白处用「两次单击间隔」识别双击（React Flow 未提供 onPaneDoubleClick）。 */
  const paneClickForDblRef = useRef({ t: 0, x: 0, y: 0 })

  /**
   * 画布空白处双击：弹出与左侧一致的「添加节点」操作面板（卡片浮在点击附近）。
   */
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      dismissMultiSelectContextMenu()
      const now = Date.now()
      const prev = paneClickForDblRef.current
      const isDouble =
        now - prev.t < 320 &&
        Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 12
      paneClickForDblRef.current = {
        t: now,
        x: event.clientX,
        y: event.clientY,
      }
      if (!isDouble) return
      event.preventDefault()
      const flowPos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      pendingCanvasNodePositionRef.current = flowPos
      dismissConnectAddMenu()
      setLeftPanel(null)
      setCanvasAddMenu(clampCanvasAddMenuPosition(event.clientX, event.clientY))
    },
    [dismissConnectAddMenu, dismissMultiSelectContextMenu, screenToFlowPosition],
  )

  /**
   * 开始拖线时记录起点，供“未命中时补选节点”使用。
   */
  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      clearPendingConnectPreview()
      if (!params.nodeId) return
      if (!params.handleType) return
      pendingConnectRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
      }
    },
    [clearPendingConnectPreview],
  )

  /**
   * 拖线结束：若未连接到目标节点，则弹出添加节点菜单，用户选择后自动补连。
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const pending = pendingConnectRef.current
      if (!pending) return
      const target = event.target as HTMLElement | null
      const endedOnHandle = Boolean(target?.closest('.react-flow__handle'))
      if (endedOnHandle) {
        pendingConnectRef.current = null
        clearPendingConnectPreview()
        return
      }
      const clientX = 'clientX' in event ? event.clientX : 0
      const clientY = 'clientY' in event ? event.clientY : 0
      const flowPos = screenToFlowPosition({
        x: clientX,
        y: clientY,
      })
      pendingCanvasNodePositionRef.current = flowPos
      const ghostNodeId = crypto.randomUUID()
      const edgeId = crypto.randomUUID()
      clearPendingConnectPreview()
      setNodes((nds) => [
        ...nds,
        {
          id: ghostNodeId,
          type: 'ghost',
          position: flowPos,
          draggable: false,
          selectable: false,
          data: {
            kind: 'text',
            title: '__ghost__',
            body: '',
            runStatus: 'idle',
          },
        } as Node<StudioNodeData>,
      ])
      setEdges((eds) =>
        addEdge(
          {
            id: edgeId,
            source: pending.handleType === 'source' ? pending.nodeId : ghostNodeId,
            target: pending.handleType === 'source' ? ghostNodeId : pending.nodeId,
            animated: true,
            style: { strokeWidth: 2 },
          },
          eds,
        ),
      )
      pendingConnectPreviewRef.current = { ghostNodeId, edgeId }
      dismissCanvasAddMenu()
      setLeftPanel(null)
      setConnectAddMenu(clampCanvasAddMenuPosition(clientX, clientY))
    },
    [clearPendingConnectPreview, dismissCanvasAddMenu, screenToFlowPosition, setEdges, setNodes],
  )

  /**
   * 兼容“视频合成 / 脚本(Beta)”入口：先映射为可编辑节点占位。
   */
  const addSpecialNode = useCallback(
    (type: 'compose-video') => {
      if (type === 'compose-video') {
        addNode('video')
      }
    },
    [addNode],
  )

  /**
   * 将素材插入画布并自动填充 URL。
   */
  const addAssetToCanvas = useCallback(
    (asset: AssetItem) => {
      const id = crypto.randomUUID()
      const position = screenToFlowPosition({
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.42,
      })

      if (asset.kind === 'image') {
        setNodes((nds) => [
          ...nds,
          {
            id,
            type: 'image',
            position,
            data: {
              kind: 'image',
              title: `图片 · ${asset.name}`,
              src: asset.src,
              prompt: '',
            },
          },
        ])
      } else if (asset.kind === 'video') {
        setNodes((nds) => [
          ...nds,
          {
            id,
            type: 'video',
            position,
            data: {
              kind: 'video',
              title: `视频 · ${asset.name}`,
              src: asset.src,
              prompt: '',
            },
          },
        ])
      } else {
        setNodes((nds) => [
          ...nds,
          {
            id,
            type: 'audio',
            position,
            data: {
              kind: 'audio',
              title: `音频 · ${asset.name}`,
              src: asset.src,
              resultSources: [asset.src],
              note: '',
            },
          },
        ])
      }

      appendHistory(`素材入画布：${asset.name}`)
      dismissCanvasAddMenu()
      setLeftPanel(null)
    },
    [appendHistory, dismissCanvasAddMenu, screenToFlowPosition, setNodes],
  )

  const addNodeItems = useMemo<AddNodeMenuItem[]>(
    () => [
      {
        id: 'text',
        title: '文本',
        subtitle: '剧本、广告词、品牌文案',
        icon: '?',
        action: () => addNode('text'),
      },
      {
        id: 'image',
        title: '图片',
        subtitle: '海报、分镜、角色设计',
        icon: '??',
        action: () => addNode('image'),
      },
      {
        id: 'panorama',
        title: 'VR360 全景',
        subtitle: '全景浏览 · 导出当前视角',
        icon: '?',
        action: () => addNode('panorama'),
      },
      {
        id: 'video',
        title: '视频',
        subtitle: '创广告、动画、电影',
        icon: '?',
        action: () => addNode('video'),
      },
      {
        id: 'compose-video',
        title: '视频合成',
        subtitle: '多个视频片段合为一个',
        badge: 'Beta',
        icon: '?',
        action: () => addSpecialNode('compose-video'),
      },
      {
        id: 'audio',
        title: '配音',
        subtitle: '旁白、人声、解说',
        icon: '∣∣∣',
        action: () => addNode('audio'),
      },
      {
        id: 'music',
        title: '音乐',
        subtitle: '配乐、BGM、氛围音轨',
        icon: '?',
        action: () => addNode('music'),
      },
    ],
    [addNode, addSpecialNode],
  )

  const connectAddNodeItems = useMemo<AddNodeMenuItem[]>(
    () =>
      addNodeItems.map((item) => ({
        ...item,
        action: () => {
          if (item.id === 'compose-video') {
            addNodeFromPendingConnect('video')
            return
          }
          addNodeFromPendingConnect(item.id as StudioNodeKind)
        },
      })),
    [addNodeFromPendingConnect, addNodeItems],
  )

  const exportJson = useCallback(() => {
    const snapshot: ProjectSnapshot = {
      version: 1,
      name: activeProjectName,
      nodes,
      edges,
      viewport: getViewport(),
    }
    const blob = new Blob([serializeProject(snapshot)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeProjectName || 'project'}.Flowid.json`
    a.click()
    URL.revokeObjectURL(url)
    appendHistory('导出工程 JSON')
  }, [appendHistory, activeProjectName, nodes, edges, getViewport])

  const triggerUpload = useCallback(() => {
    uploadInputRef.current?.click()
  }, [])

  /**
   * 双击小地图时回到有内容的画布区域。
   */
  const focusCanvasContent = useCallback(() => {
    if (nodes.length > 0) {
      fitView({ padding: 0.18, duration: 220 })
      return
    }
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 220 })
  }, [fitView, nodes.length, setViewport])

  /**
   * 下载选中节点（优先媒体资源，其次节点 JSON）。
   */
  const downloadSelectedNode = useCallback(() => {
    if (!selectedNode) {
      window.alert('请先选中一个节点')
      return
    }

    const data = selectedNode.data
    const kind = (data as StudioNodeData).kind
    if (kind === 'panorama') {
      const pd = data as PanoramaNodeData
      const href = String(pd.rectilinearSrc || pd.src || '').trim()
      if (href) {
        const a = document.createElement('a')
        a.href = href
        a.download = `${pd.title || selectedNode.id}.png`
        a.click()
        appendHistory(`下载节点资源：${data.title || selectedNode.id}`)
        return
      }
    }
    if (
      (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'music') &&
      'src' in data &&
      data.src
    ) {
      const a = document.createElement('a')
      a.href = data.src
      a.download = `${data.title || selectedNode.id}`
      a.click()
      appendHistory(`下载节点资源：${data.title || selectedNode.id}`)
      return
    }

    const blob = new Blob([JSON.stringify(selectedNode, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedNode.id}.node.json`
    a.click()
    URL.revokeObjectURL(url)
    appendHistory(`下载节点 JSON：${selectedNode.id}`)
  }, [appendHistory, selectedNode])

  /**
   * 从节点标题中去掉类型前缀（如“图片·”“视频-”“图像节点”），用于下载文件名。
   */
  const getDownloadBaseNameFromTitle = useCallback((title: string, fallbackId: string): string => {
    const raw = String(title || '').trim() || fallbackId
    const stripped = raw
      .replace(/^\s*(图片|图像|视频|音频|音乐|全景|VR360全景|VR360)\s*[·\-—_:：\s]+/u, '')
      .replace(/^\s*(图片|图像|视频|音频|音乐|全景|VR360全景|VR360)\s*节点\s*/u, '')
      .trim()
    const cleaned = (stripped || raw)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
    return cleaned || fallbackId
  }, [])

  /**
   * 从 URL 推断扩展名；若无法推断则按节点类型给默认扩展名。
   */
  const inferDownloadExt = useCallback((href: string, kind: StudioNodeKind): string => {
    const raw = String(href || '').trim()
    try {
      const u = new URL(raw, window.location.origin)
      const filename = u.searchParams.get('filename') || u.pathname.split('/').pop() || ''
      const m = filename.match(/\.([a-zA-Z0-9]{2,5})$/)
      if (m) return `.${m[1].toLowerCase()}`
    } catch {
      const noQuery = raw.split(/[?#]/)[0] ?? raw
      const seg = noQuery.split('/').pop() || ''
      const m = seg.match(/\.([a-zA-Z0-9]{2,5})$/)
      if (m) return `.${m[1].toLowerCase()}`
    }
    if (kind === 'video') return '.mp4'
    if (kind === 'audio' || kind === 'music') return '.mp3'
    return '.png'
  }, [])

  /**
   * 从节点提取可下载媒体地址；无媒体则返回空字符串。
   */
  const getNodeDownloadHref = useCallback((node: Node<StudioNodeData>): string => {
    const data = node.data
    const kind = data.kind
    if (kind === 'panorama') {
      const pd = data as PanoramaNodeData
      return String(pd.rectilinearSrc || pd.src || '').trim()
    }
    if (
      (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'music') &&
      'src' in data
    ) {
      return String(data.src || '').trim()
    }
    return ''
  }, [])

  /**
   * 框选右键：批量下载选中节点媒体。
   * 下载路径由浏览器设置决定（默认下载目录或“每次询问”）。
   */
  const downloadSelectedNodesMedia = useCallback(() => {
    const selected = nodes.filter((node) => node.selected && node.type !== 'ghost' && node.type !== 'group')
    if (!selected.length) {
      window.alert('请先框选至少一个节点')
      return
    }
    let count = 0
    selected.forEach((node) => {
      const href = getNodeDownloadHref(node)
      if (!href) return
      const kind = node.data.kind
      const baseName = getDownloadBaseNameFromTitle(node.data.title || node.id, node.id)
      const extKind: StudioNodeKind =
        kind === 'video' || kind === 'audio' || kind === 'music' || kind === 'panorama'
          ? kind
          : 'image'
      const ext = inferDownloadExt(href, extKind)
      const a = document.createElement('a')
      a.href = href
      a.download = `${baseName}${ext}`
      a.click()
      count += 1
    })
    if (!count) {
      window.alert('选中节点里没有可下载的媒体内容')
      return
    }
    appendHistory(`批量下载节点媒体 ${count} 个`)
    dismissMultiSelectContextMenu()
  }, [
    appendHistory,
    dismissMultiSelectContextMenu,
    getDownloadBaseNameFromTitle,
    getNodeDownloadHref,
    inferDownloadExt,
    nodes,
  ])

  /**
   * 从系统预设载入工作流：写入用户本地配置（localStorage），不修改 `public/system-presets/` 下只读文件。
   */
  const applySystemPresetFromLibrary = useCallback(
    (kind: StudioNodeKind, workflowJsonText: string, presetDisplayName: string) => {
      updateNodeConfig(kind, {
        workflowJsonText,
        workflowName: `[系统预设] ${presetDisplayName}`,
        selectedWorkflowId: undefined,
      })
      appendHistory(
        `已从系统预设载入「${presetDisplayName}」到${NODE_KIND_LABEL[kind]}工作流，可在设置中继续微调`,
      )
    },
    [appendHistory, updateNodeConfig],
  )

  /**
   * 将工作流执行结果回填到节点并写入历史（供顶部执行入口与底部面板入口共用）。
   */
  const applyWorkflowResultToNode = useCallback(
    (
      fresh: Node<StudioNodeData>,
      kind: StudioNodeKind,
      result: { previewUrl: string | null; audioUrl: string | null; resultUrl: string | null; textResult?: string | null },
    ) => {
      const id = fresh.id
      const mediaUrl = result.audioUrl || result.previewUrl || result.resultUrl || null

      if (kind === 'music') {
        if (!result.audioUrl) {
          throw new Error(
            '执行完成但未检测到音频输出，请确认工作流包含 SaveAudio 节点且输出字段为 audio/audios',
          )
        }
        const data = fresh.data as AudioNodeData
        const previousSources = data.resultSources?.filter(Boolean) ?? (data.src ? [data.src] : [])
        const nextSources = [
          result.audioUrl,
          ...previousSources.filter((item) => item !== result.audioUrl),
        ]
        updateNodeData(id, {
          kind: 'music',
          src: nextSources[0],
          resultSources: nextSources,
        })
        appendHistory({
          text: '音乐生成成功',
          kind: 'music',
          src: result.audioUrl,
          title: fresh.data.title,
        })
        appendHistory(`音乐节点执行成功：${(fresh.data as AudioNodeData).model || '未命名工作流'}`)
        void mirrorComfyOutputToDisk({
          url: result.audioUrl,
          mediaKind: 'music',
          title: fresh.data.title,
        })
        return
      }

      if (kind === 'audio') {
        if (!result.audioUrl) {
          throw new Error(
            '执行完成但未检测到音频输出，请确认工作流包含 SaveAudio 节点且输出字段为 audio/audios',
          )
        }
        const data = fresh.data as AudioNodeData
        const previousSources = data.resultSources?.filter(Boolean) ?? (data.src ? [data.src] : [])
        const nextSources = [
          result.audioUrl,
          ...previousSources.filter((item) => item !== result.audioUrl),
        ]
        updateNodeData(id, {
          kind: 'audio',
          src: nextSources[0],
          resultSources: nextSources,
        })
        appendHistory({
          text: '配音生成成功',
          kind: 'audio',
          src: result.audioUrl,
          title: fresh.data.title,
        })
        appendHistory(`配音节点执行成功：${(fresh.data as AudioNodeData).model || '未命名工作流'}`)
        void mirrorComfyOutputToDisk({
          url: result.audioUrl,
          mediaKind: 'audio',
          title: fresh.data.title,
        })
        return
      }

      if (kind === 'image' || kind === 'video') {
        if (!mediaUrl) {
          throw new Error('执行完成但未检测到图片或视频输出，请检查工作流输出节点')
        }
        /** 清除本地主图资产 id，避免下次 hydrate 用旧本地图覆盖 Comfy 返回的 URL */
        updateNodeData(id, {
          kind,
          src: mediaUrl,
          srcAssetId: undefined,
          srcFileName: undefined,
        } as Partial<StudioNodeData>)
        appendHistory({
          text: kind === 'image' ? '图片生成成功' : '视频生成成功',
          kind,
          src: mediaUrl,
          title: fresh.data.title,
        })
        void mirrorComfyOutputToDisk({
          url: mediaUrl,
          mediaKind: kind === 'video' ? 'video' : 'image',
          title: fresh.data.title,
        })
        return
      }

      if (kind === 'text') {
        const textResult = String(result.textResult || '').trim()
        if (textResult) {
          updateNodeData(id, {
            kind: 'text',
            body: textResult,
          } as Partial<StudioNodeData>)
        }
        appendHistory({
          text: textResult ? '文本工作流执行完成，已回填结果' : '文本工作流执行完成',
          kind: 'action',
        })
        if (result.previewUrl) {
          appendHistory({
            text: '文本节点附带图像输出',
            kind: 'image',
            src: result.previewUrl,
            title: fresh.data.title,
          })
        }
        return
      }

      // 其它节点：若模型返回了文本结果，按节点类型回填到提示框字段（用于“模型模式”生成提示词/描述）
      const textResult = String(result.textResult || '').trim()
      if (!textResult) return
      if (kind === 'image' || kind === 'video') {
        updateNodeData(id, {
          kind,
          prompt: textResult,
        } as any)
        appendHistory({ text: '模型已生成提示词并回填', kind: 'action' })
        return
      }
      if (kind === 'audio' || kind === 'music') {
        updateNodeData(id, {
          kind,
          note: textResult,
        } as any)
        appendHistory({ text: '模型已生成描述并回填', kind: 'action' })
        return
      }
    },
    [appendHistory, updateNodeData],
  )

  const { isRunning: isWorkflowRunnerRunning, runAllWorkflow, executeNodeIds } = useWorkflowRunner({
    nodes,
    edges,
    selectedNodeId,
    setNodes,
    appendHistory,
    executeSingleNode: async (node) => {
      const kind = node.data.kind
      if (kind === 'group') return
      const latest = nodes.find((n) => n.id === node.id) ?? node
      const prepared = withResolvedNodeMentions(latest, nodes)
      const result = await runNodeWorkflow(prepared, {
        allNodes: nodes,
        runNodeTitle: String(latest.data.title || latest.id),
        executionTarget: promptPanelPickerMode,
        rawPromptText:
          latest.data.kind === 'image' || latest.data.kind === 'video'
            ? String((latest.data as ImageNodeData | VideoNodeData).prompt || '')
            : undefined,
        rawNoteText:
          latest.data.kind === 'audio' || latest.data.kind === 'music'
            ? String((latest.data as AudioNodeData).note || '')
            : undefined,
        onPreflightMessage: (message) => appendHistory(message),
        onProgress: (info) =>
          setNodes((prev) =>
            prev.map((n) =>
              n.id === node.id
                ? {
                    ...n,
                    data: { ...n.data, kind, runProgress: info } as StudioNodeData,
                  }
                : n,
            ),
          ),
      })
      applyWorkflowResultToNode(latest, kind, result)
    },
  })

  const licenseReadOnly = isLicenseReadOnly(licenseSnapshotState)
  const ensureLicenseCanSubmit = useCallback((): boolean => {
    const message = getLicenseSubmitBlockMessage(loadLocalLicenseSnapshot())
    if (!message) return true
    window.alert(message)
    return false
  }, [])

  const runAllWorkflowGuarded = useCallback(() => {
    if (!ensureLicenseCanSubmit()) return
    void runAllWorkflow()
  }, [ensureLicenseCanSubmit, runAllWorkflow])

  const handleAuthSuccess = useCallback((session: AuthSession | null) => {
    setAuthSession(session)
    if (session) {
      saveAuthSession(session)
      const nextSnapshot = {
        status: session.licenseStatus,
        expiresAtMs: session.expiresAtMs,
        lastNoticeAtMs: undefined,
      } as const
      saveLocalLicenseSnapshot(nextSnapshot)
      setLicenseSnapshotState(nextSnapshot)
      return
    }
    setLicenseSnapshotState(loadLocalLicenseSnapshot())
  }, [])

  /**
   * 双击节点主体（非标题/输入区）快捷执行当前节点，等价于右键菜单「执行」单选。
   * 右键本身只负责打开菜单，不会直接发 Comfy 任务。
   */
  const onNodeDoubleClick = useCallback(
    (event: ReactMouseEvent, node: Node<StudioNodeData>) => {
      if (!ensureLicenseCanSubmit()) return
      if (node.type === 'ghost' || node.type === 'group') return
      const t = event.target as HTMLElement | null
      if (t?.closest('.studio-node__title, textarea, input, a, button')) return
      const kind = node.data.kind
      // 文本节点双击由 TextNode 自身用于进入编辑，不在此触发执行
      if (
        kind !== 'image' &&
        kind !== 'video' &&
        kind !== 'audio' &&
        kind !== 'music'
      ) {
        return
      }
      void executeNodeIds([node.id], `双击执行：${node.data.title || node.id}`)
    },
    [ensureLicenseCanSubmit, executeNodeIds],
  )

  /**
   * 右键菜单批量执行：按当前选中业务节点 id 调用 `executeNodeIds`（拓扑顺序、串行）。
   * 与 `batchContextMenuEligibleCount` 一致，不含 ghost / group；单选时菜单文案为「执行」，多选为「全部执行」。
   */
  const runBatchExecuteFromContextMenuSelection = useCallback(async () => {
    if (!ensureLicenseCanSubmit()) return
    const ids = nodes
      .filter((node) => node.selected && node.type !== 'ghost' && node.type !== 'group')
      .map((node) => node.id)
    if (!ids.length) {
      window.alert('没有可执行节点')
      return
    }
    dismissMultiSelectContextMenu()
    const runName = ids.length === 1 ? '执行选中节点' : '全部执行选中节点'
    await executeNodeIds(ids, runName)
  }, [dismissMultiSelectContextMenu, ensureLicenseCanSubmit, executeNodeIds, nodes])

  /**
   * 按标题关键字或 id 定位节点（优先精确匹配，再模糊包含）。
   */
  const findNodeByLabelOrId = useCallback((query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const exact = nodes.find((n) => n.id.toLowerCase() === q || String(n.data.title || '').trim().toLowerCase() === q)
    if (exact) return exact
    return nodes.find((n) => String(n.data.title || '').toLowerCase().includes(q)) ?? null
  }, [nodes])

  const describeAiAction = useCallback((action: AiAssistantAction) => {
    if (action.type === 'create_node') return `新建节点：${action.kind}`
    if (action.type === 'connect_nodes') return `连接节点：${action.sourceQuery} -> ${action.targetQuery}`
    return `执行节点：${action.current ? '当前选中' : action.targetQuery || '未指定'}`
  }, [])

  const workflowBusyForAiPlanning = isWorkflowRunnerRunning

  /**
   * MVP：解析自然语言并映射到本地工具调用（建节点/连线/执行）。
   */
  const executeAiAssistantCommand = useCallback(async (text: string, queued = false) => {
    setAiBusy(true)
    const reply = (msg: string, role: 'assistant' | 'system' = 'assistant') =>
      setAiMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text: msg }])
    try {
      const raw = text.trim()
      if (!raw) {
        reply('请输入要执行的指令。', 'system')
        return
      }
      if (queued) {
        reply(`工作流已空闲，继续处理缓存指令：${raw}`, 'system')
      }
      const modelActions = await planActionsWithModel(raw, nodes, aiConfig)
      const actions = modelActions.length ? modelActions : planActionsWithRules(raw)
      if (!actions.length) {
        const chatText = await chatReplyWithModel(raw, aiConfig)
        if (chatText) {
          reply(chatText)
        } else {
          if (!aiOfflineFallbackHintShownRef.current) {
            aiOfflineFallbackHintShownRef.current = true
            reply('提示：当前本地模型未连接，已切换为离线兜底聊天模式。', 'system')
          }
          reply(buildLocalSmallTalkReply(raw))
        }
        return
      }
      reply(`已生成 ${actions.length} 条动作：${actions.map(describeAiAction).join('；')}`)
      for (const action of actions) {
        if (aiConfig.confirmBeforeRun) {
          const ok = window.confirm(`AI 助手准备执行：${describeAiAction(action)}\n是否继续？`)
          if (!ok) {
            reply(`已取消：${describeAiAction(action)}`, 'system')
            continue
          }
        }
        if (action.type === 'create_node') {
          addNode(action.kind)
          appendHistory(`AI 助手创建节点：${action.kind}`)
          reply(`已创建节点：${action.kind}`)
          continue
        }
        if (action.type === 'connect_nodes') {
          const s = findNodeByLabelOrId(action.sourceQuery)
          const t = findNodeByLabelOrId(action.targetQuery)
          if (!s || !t) {
            reply(`未找到节点：${!s ? action.sourceQuery : ''}${!s && !t ? ' / ' : ''}${!t ? action.targetQuery : ''}`)
            continue
          }
          if (s.id === t.id) {
            reply('同一个节点不能连接到自身。')
            continue
          }
          setEdges((eds) =>
            addEdge(
              {
                id: crypto.randomUUID(),
                source: s.id,
                target: t.id,
                animated: true,
                style: { strokeWidth: 2 },
              },
              eds,
            ),
          )
          appendHistory(`AI 助手连线：${s.data.title} -> ${t.data.title}`)
          reply(`已连线：${s.data.title} -> ${t.data.title}`)
          continue
        }
        if (action.type === 'run_node') {
          if (!ensureLicenseCanSubmit()) continue
          let targetId = selectedNodeId
          if (!action.current && action.targetQuery) {
            const node = findNodeByLabelOrId(action.targetQuery)
            targetId = node?.id ?? null
          }
          if (!targetId) {
            reply('请先选中一个节点，或在命令中指定节点名。')
            continue
          }
          await executeNodeIds([targetId], 'AI 助手执行节点')
          const n = nodes.find((x) => x.id === targetId)
          reply(`已触发执行：${n?.data.title || targetId}`)
        }
      }
    } catch (error) {
      reply(`执行失败：${(error as Error)?.message || '未知错误'}`, 'system')
    } finally {
      setAiBusy(false)
    }
  }, [addNode, aiConfig, appendHistory, describeAiAction, ensureLicenseCanSubmit, executeNodeIds, findNodeByLabelOrId, nodes, selectedNodeId, setEdges])

  /**
   * 用户发送入口：工作流繁忙时，本地模型改为排队，避免与主工作流争抢本地 GPU。
   */
  const handleAiAssistantSend = useCallback(async (text: string) => {
    const raw = text.trim()
    if (!raw) return
    const userMsg: AiAssistantMessage = { id: crypto.randomUUID(), role: 'user', text: raw }
    setAiMessages((prev) => [...prev, userMsg])
    const shouldQueueLocalModel =
      aiConfig.provider === 'ollama' &&
      aiConfig.pauseLocalModelWhenWorkflowRunning &&
      workflowBusyForAiPlanning
    if (shouldQueueLocalModel) {
      aiDeferredQueueRef.current.push(raw)
      setAiMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: '检测到工作流正在运行：本地模型指令已进入缓存队列，待空闲后自动执行。若需立即执行，可临时切换到云端模型。',
        },
      ])
      return
    }
    await executeAiAssistantCommand(raw, false)
  }, [aiConfig, executeAiAssistantCommand, workflowBusyForAiPlanning])

  useEffect(() => {
    if (workflowBusyForAiPlanning || aiBusy) return
    const next = aiDeferredQueueRef.current.shift()
    if (!next) return
    void executeAiAssistantCommand(next, true)
  }, [aiBusy, executeAiAssistantCommand, workflowBusyForAiPlanning])

  /**
   * 将助手文本通过 OpenAI 兼容 TTS 接口转为语音并播放。
   */
  const speakAssistantText = useCallback(async (text: string) => {
    const endpoint = aiConfig.ttsEndpoint.trim()
    if (!endpoint) throw new Error('未配置 TTS endpoint')

    const cloneAudioDataUrl = aiConfig.ttsCloneAudioDataUrl.trim()
    if (!cloneAudioDataUrl) {
      throw new Error('请先在 AI 助手设置上传克隆音色参考音频')
    }

    let blob: Blob | null = null
    let lastError = ''

    if (isLikelyGradioTtsEndpoint(endpoint)) {
      try {
        const baseUrl = normalizeBaseUrl(endpoint)
        const uploadId = crypto.randomUUID()
        const uploadForm = new FormData()
        const uploadBlob = await (await fetch(cloneAudioDataUrl)).blob()
        const uploadName = aiConfig.ttsCloneAudioName.trim() || 'clone_reference.wav'
        uploadForm.append('files', new File([uploadBlob], uploadName, { type: uploadBlob.type || 'audio/wav' }))
        const uploadRes = await fetch(`${baseUrl}/gradio_api/upload?upload_id=${encodeURIComponent(uploadId)}`, {
          method: 'POST',
          body: uploadForm,
        })
        if (!uploadRes.ok) {
          throw new Error(`上传参考音频失败（${uploadRes.status}）`)
        }
        const uploadJson = (await uploadRes.json()) as unknown
        const uploadedPath = pickFirstPathLikeValue(uploadJson)
        if (!uploadedPath) {
          throw new Error('上传参考音频成功，但未返回文件路径')
        }

        const runPayload = {
          data: [
            '与音色参考音频相同',
            fileDataFromPath(uploadedPath),
            text,
            null,
            0.65,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            '',
            false,
            60,
            true,
            0.8,
            30,
            0.8,
            0,
            3,
            10,
            1500,
          ],
        }
        const runRes = await fetch(`${baseUrl}/gradio_api/run/gen_single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(runPayload),
        })
        if (!runRes.ok) {
          throw new Error(`调用 gen_single 失败（${runRes.status}）`)
        }
        const runJson = (await runRes.json()) as {
          data?: Array<{ path?: string; url?: string } | null>
          error?: string
        }
        if (runJson.error) {
          throw new Error(runJson.error)
        }
        let audioRef = pickAudioAddressFromUnknown(runJson)
        if (!audioRef.url && !audioRef.path) {
          const callRes = await fetch(`${baseUrl}/gradio_api/call/gen_single`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(runPayload),
          })
          if (!callRes.ok) {
            throw new Error(`gen_single 返回中未找到音频地址，且 call 接口失败（${callRes.status}）`)
          }
          const callJson = (await callRes.json()) as { event_id?: string }
          const eventId = String(callJson.event_id || '').trim()
          if (!eventId) {
            throw new Error('gen_single 返回中未找到音频地址')
          }
          const eventRes = await fetch(`${baseUrl}/gradio_api/call/gen_single/${encodeURIComponent(eventId)}`)
          if (!eventRes.ok) {
            throw new Error(`读取 call 结果失败（${eventRes.status}）`)
          }
          const eventText = await eventRes.text()
          const lines = eventText.split('\n').map((line) => line.trim()).filter(Boolean)
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const payloadText = line.slice(5).trim()
            if (!payloadText || payloadText === '[DONE]') continue
            try {
              const item = JSON.parse(payloadText) as unknown
              audioRef = pickAudioAddressFromUnknown(item)
              if (audioRef.url || audioRef.path) break
            } catch {
              // ignore non-json frames
            }
          }
        }
        const audioUrl = audioRef.url
        const audioPath = audioRef.path
        if (!audioUrl && !audioPath) {
          throw new Error('gen_single 返回中未找到音频地址')
        }
        const fetchAudioUrl = audioUrl || `${baseUrl}/gradio_api/file=${encodeURIComponent(audioPath)}`
        const audioRes = await fetch(fetchAudioUrl)
        if (!audioRes.ok) {
          throw new Error(`读取生成音频失败（${audioRes.status}）`)
        }
        blob = await audioRes.blob()
      } catch (error) {
        lastError = `Gradio TTS -> ${(error as Error)?.message || '请求失败'}`
      }
    } else {
      const endpointCandidates = buildTtsEndpointCandidates(endpoint)
      const model = aiConfig.ttsModel.trim()
      const voice = aiConfig.ttsVoice.trim() || 'alloy'
      const cloneAudioBase64 = cloneAudioDataUrl.includes(',')
        ? cloneAudioDataUrl.slice(cloneAudioDataUrl.indexOf(',') + 1)
        : ''
      for (const item of endpointCandidates) {
        try {
          const payload: Record<string, unknown> = {
            input: text,
            voice,
            format: 'mp3',
          }
          if (model) payload.model = model
          payload.reference_audio = cloneAudioDataUrl
          payload.reference_audio_base64 = cloneAudioBase64
          payload.clone_audio = cloneAudioDataUrl
          payload.prompt_audio = cloneAudioDataUrl

          const res = await fetch(item, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(aiConfig.ttsApiKey.trim() ? { Authorization: `Bearer ${aiConfig.ttsApiKey.trim()}` } : {}),
            },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            lastError = `${item} -> HTTP ${res.status}`
            continue
          }
          const contentType = String(res.headers.get('content-type') || '').toLowerCase()
          if (contentType.includes('application/json')) {
            const data = (await res.json()) as { url?: string; audioUrl?: string; data?: string }
            const audioUrl = String(data.url || data.audioUrl || '').trim()
            if (audioUrl) {
              const audioRes = await fetch(audioUrl)
              if (!audioRes.ok) {
                lastError = `${item} -> 音频 URL 无法读取（${audioRes.status}）`
                continue
              }
              blob = await audioRes.blob()
              break
            }
            if (data.data && typeof data.data === 'string') {
              const bytes = atob(data.data)
              const arr = new Uint8Array(bytes.length)
              for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
              blob = new Blob([arr], { type: 'audio/mpeg' })
              break
            }
            lastError = `${item} -> JSON 响应不含音频字段`
            continue
          }
          blob = await res.blob()
          break
        } catch (error) {
          lastError = `${item} -> ${(error as Error)?.message || '请求失败'}`
        }
      }
    }

    if (!blob) throw new Error(lastError || '未匹配到可用 TTS 接口')
    if (blob.size <= 1024) {
      throw new Error(`TTS 返回音频过小（${blob.size} bytes）`)
    }
    if (aiTtsAudioRef.current) {
      aiTtsAudioRef.current.pause()
      aiTtsAudioRef.current = null
    }
    if (aiTtsAudioUrlRef.current) {
      URL.revokeObjectURL(aiTtsAudioUrlRef.current)
      aiTtsAudioUrlRef.current = null
    }
    const audioUrl = URL.createObjectURL(blob)
    aiTtsAudioUrlRef.current = audioUrl
    const audio = new Audio(audioUrl)
    audio.volume = 1
    audio.muted = false
    aiTtsAudioRef.current = audio
    await audio.play()
    return { size: blob.size }
  }, [aiConfig.ttsApiKey, aiConfig.ttsCloneAudioDataUrl, aiConfig.ttsCloneAudioName, aiConfig.ttsEndpoint, aiConfig.ttsModel, aiConfig.ttsVoice])

  /**
   * 监听助手最新回复：启用 TTS 时自动播报。
   */
  useEffect(() => {
    const last = aiMessages[aiMessages.length - 1]
    if (!last) return
    if (aiLastSpokenMessageIdRef.current == null) {
      aiLastSpokenMessageIdRef.current = last.id
      return
    }
    if (!aiConfig.ttsEnabled) return
    if (last.role !== 'assistant') return
    if (aiLastSpokenMessageIdRef.current === last.id) return
    aiLastSpokenMessageIdRef.current = last.id
    void speakAssistantText(last.text)
      .then(() => {
        // 语音播报成功后不在聊天流插入调试提示，避免干扰对话阅读。
      })
      .catch((error) => {
        const msg = `语音播报失败：${(error as Error)?.message || '未知错误'}`
        console.warn(msg)
        window.alert(msg)
      })
  }, [aiConfig.ttsEnabled, aiMessages, speakAssistantText])

  useEffect(
    () => () => {
      if (aiTtsAudioRef.current) {
        aiTtsAudioRef.current.pause()
        aiTtsAudioRef.current = null
      }
      if (aiTtsAudioUrlRef.current) {
        URL.revokeObjectURL(aiTtsAudioUrlRef.current)
        aiTtsAudioUrlRef.current = null
      }
    },
    [],
  )

  const dockAvatarState = useMemo(
    () =>
      resolveDockAssistantAvatarState({
        busy: aiBusy,
        messages: aiMessages,
      }),
    [aiBusy, aiMessages],
  )
  const dockAvatarMedia = AI_ASSISTANT_AVATAR_MEDIA[dockAvatarState]
  const aiAssistantDockStyle = useMemo(() => {
    const panelWidth = 360
    const panelHeight = 520
    const gap = 20
    if (typeof window === 'undefined') {
      return { left: 0, top: 0, width: panelWidth, height: panelHeight }
    }
    const desiredLeft = avatarDockRect.left - gap - panelWidth
    const desiredTop = avatarDockRect.top + Math.round(avatarDockRect.height * 0.08)
    const maxLeft = Math.max(0, window.innerWidth - panelWidth)
    const maxTop = Math.max(0, window.innerHeight - panelHeight)
    return {
      left: clampNumber(desiredLeft, 0, maxLeft),
      top: clampNumber(desiredTop, 0, maxTop),
      width: panelWidth,
      height: panelHeight,
    }
  }, [avatarDockRect.height, avatarDockRect.left, avatarDockRect.top])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const action = avatarDockActionRef.current
      if (!action) return
      if (action.mode === 'drag') {
        const nextLeft = action.startLeft + (event.clientX - action.startX)
        const nextTop = action.startTop + (event.clientY - action.startY)
        setAvatarDockRect((prev) => ({
          ...prev,
          left: clampNumber(nextLeft, 0, Math.max(0, window.innerWidth - prev.width)),
          top: clampNumber(nextTop, 0, Math.max(0, window.innerHeight - prev.height)),
        }))
        return
      }
      const dx = event.clientX - action.startX
      const dy = event.clientY - action.startY
      setAvatarDockRect((prev) => {
        let nextWidth = action.startWidth + dx
        let nextHeight = action.startHeight + dy
        if (Math.abs(dx) >= Math.abs(dy)) {
          nextHeight = nextWidth / Math.max(action.aspectRatio, 0.0001)
        } else {
          nextWidth = nextHeight * action.aspectRatio
        }
        const clampedWidth = Math.max(1, nextWidth)
        const clampedHeight = Math.max(1, nextHeight)
        return {
          ...prev,
          width: clampedWidth,
          height: clampedHeight,
          left: clampNumber(prev.left, 0, Math.max(0, window.innerWidth - clampedWidth)),
          top: clampNumber(prev.top, 0, Math.max(0, window.innerHeight - clampedHeight)),
        }
      })
    }
    const onMouseUp = () => {
      avatarDockActionRef.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setAvatarDockRect((prev) => ({
        ...prev,
        left: clampNumber(prev.left, 0, Math.max(0, window.innerWidth - prev.width)),
        top: clampNumber(prev.top, 0, Math.max(0, window.innerHeight - prev.height)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleAvatarDockMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      if (target.closest('.studio-ai-avatar-dock__resizeHandle')) return
      event.preventDefault()
      avatarDockActionRef.current = {
        mode: 'drag',
        startX: event.clientX,
        startY: event.clientY,
        startLeft: avatarDockRect.left,
        startTop: avatarDockRect.top,
      }
    },
    [avatarDockRect.left, avatarDockRect.top],
  )

  const handleAvatarDockResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      avatarDockActionRef.current = {
        mode: 'resize',
        startX: event.clientX,
        startY: event.clientY,
        startWidth: avatarDockRect.width,
        startHeight: avatarDockRect.height,
        aspectRatio: avatarDockRect.width / Math.max(avatarDockRect.height, 1),
      }
    },
    [avatarDockRect.height, avatarDockRect.width],
  )

  /**
   * 底部面板执行入口：音乐/文字/图片/视频/配音与音乐相同交互（回车发送）。
   */
  const executePromptPanelFromPanel = useCallback(async (
    panelArg?: { node: Node<StudioNodeData>; kind: PromptPanelKind } | null,
  ) => {
    if (!ensureLicenseCanSubmit()) return
    try {
      let panel = panelArg ?? promptPanel
      if (!panel && selectedNodeId) {
        const selected = nodes.find((n) => n.id === selectedNodeId) ?? null
        if (selected) {
          const k = selected.data.kind
          if (k === 'music' || k === 'text' || k === 'image' || k === 'video' || k === 'audio') {
            panel = { node: selected, kind: k }
          }
        }
      }
      if (!panel) {
        appendHistory('执行失败：未找到可执行节点上下文')
        window.alert('请先选中节点')
        return
      }
      const { node: panelNode, kind } = panel
      const latestNodes = nodesRef.current
      const fresh = latestNodes.find((n) => n.id === panelNode.id) ?? panelNode
      const prepared = withResolvedNodeMentions(fresh, latestNodes)
      const id = fresh.id
      const prevGen = promptPanelRunGenerationByNodeIdRef.current.get(id) ?? 0
      const runSeq = prevGen + 1
      promptPanelRunGenerationByNodeIdRef.current.set(id, runSeq)
      appendHistory(`开始执行：${fresh.data.title || fresh.id}`)
      updateNodeData(id, {
        kind,
        runStatus: 'queued',
        runProgress: undefined,
      } as Partial<StudioNodeData>)
      try {
        updateNodeData(id, { kind, runStatus: 'running' } as Partial<StudioNodeData>)
        const result = await runNodeWorkflow(prepared, {
          allNodes: latestNodes,
          runNodeTitle: String(fresh.data.title || fresh.id),
          executionTarget:
            (fresh.data as any)?.promptPickerMode === 'model' ? 'model' : 'workflow',
          rawPromptText:
            fresh.data.kind === 'image' || fresh.data.kind === 'video'
              ? String((fresh.data as ImageNodeData | VideoNodeData).prompt || '')
              : undefined,
          rawNoteText:
            fresh.data.kind === 'audio' || fresh.data.kind === 'music'
              ? String((fresh.data as AudioNodeData).note || '')
              : undefined,
          onPreflightMessage: (message) => appendHistory(message),
          onProgress: (info) => {
            if (promptPanelRunGenerationByNodeIdRef.current.get(id) !== runSeq) return
            updateNodeData(id, { kind, runProgress: info } as Partial<StudioNodeData>)
          },
        })
        if (promptPanelRunGenerationByNodeIdRef.current.get(id) !== runSeq) {
          appendHistory(
            `较早一次任务已结束，但已有更新的提交，该次结果未写入节点：${fresh.data.title || id}`,
          )
          return
        }
        applyWorkflowResultToNode(fresh, kind, result)

        updateNodeData(id, {
          kind,
          runStatus: 'success',
          lastRunAt: Date.now(),
          runProgress: undefined,
        } as Partial<StudioNodeData>)
      } catch (error) {
        if (promptPanelRunGenerationByNodeIdRef.current.get(id) !== runSeq) {
          return
        }
        updateNodeData(id, {
          kind,
          runStatus: 'error',
          lastRunAt: Date.now(),
          runProgress: undefined,
        } as Partial<StudioNodeData>)
        const message = (error as Error)?.message || '执行失败'
        appendHistory(`${NODE_KIND_LABEL[kind]}节点执行失败：${message}`)
        window.alert(`执行失败：${message}`)
      }
    } catch (error) {
      const message = (error as Error)?.message || '执行失败（执行前准备阶段）'
      appendHistory(`执行失败：${message}`)
      window.alert(`执行失败：${message}`)
    }
  }, [
    appendHistory,
    applyWorkflowResultToNode,
    ensureLicenseCanSubmit,
    nodes,
    promptPanel,
    runNodeWorkflow,
    selectedNodeId,
    updateNodeData,
  ])

  /**
   * 将文本节点内容拆分为多个文本子节点并自动连线：`asset` 为角色/场景/资产规则，`storyboard` 为分镜锚点规则。
   */
  const splitTextNodeToStructuredNodes = useCallback((mode: TextSplitMode) => {
    if (!promptPanel || promptPanel.kind !== 'text') return
    const sourceNode = nodes.find((item) => item.id === promptPanel.node.id) ?? promptPanel.node
    const body = ((sourceNode.data as TextNodeData).body || '').trim()
    if (!body) {
      window.alert('请先填写文本内容，再执行自动拆分')
      return
    }
    const entries =
      mode === 'asset'
        ? splitTextByCategory(body).map((item) => ({ title: item.title, body: item.body }))
        : mode === 'storyboard'
          ? splitTextByStoryboard(body)
          : splitTextByFixedDelimiters(body)
    if (!entries.length) {
      window.alert(
        mode === 'asset'
          ? '未识别到“角色/场景/资产”段落，请检查文本格式'
          : mode === 'storyboard'
            ? '未识别到「分镜 NN 提示词卡」锚点段落，请检查文本格式'
            : '未识别到可拆分段落，请使用分隔符单独成行：### 或 --- 或 @@',
      )
      return
    }
    if (mode === 'symbol' && entries.length < 2) {
      window.alert('符号拆分至少需要 2 段内容。请在文本中加入分隔符：### 或 --- 或 @@')
      return
    }

    /** 拆分生成节点与「前一节点」在流坐标中的间距（与全景导出等约定一致：20） */
    const SPLIT_GAP_FLOW = 20
    const parseFlowDim = (v: unknown): number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const n = Number.parseFloat(v)
        return Number.isFinite(n) ? n : NaN
      }
      return NaN
    }
    const sourceStyle = (sourceNode.style ?? {}) as {
      width?: number | string
      height?: number | string
    }
    const sn = sourceNode as Node<StudioNodeData>
    const sourceWidth =
      parseFlowDim(sn.measured?.width) ||
      parseFlowDim(sourceStyle.width) ||
      430
    const baseX = sourceNode.position.x + sourceWidth + SPLIT_GAP_FLOW
    let yCursor = sourceNode.position.y
    const newNodes: Array<Node<StudioNodeData>> = []
    const newEdges: Array<Edge> = []

    setNodes((prev) => {
      let nextNodes = prev
      const titleTaken = new Set(
        nextNodes
          .map((node) => String(node.data.title || '').trim())
          .filter(Boolean),
      )
      entries.forEach((entry) => {
        const id = crypto.randomUUID()
        const kind: StudioNodeKind = 'text'
        const baseTitle = entry.title.trim() || '文本节点'
        const title = allocateUniqueNodeTitle(titleTaken, baseTitle)
        const node = createStudioNode(
          kind,
          id,
          {
            x: baseX,
            y: yCursor,
          },
          title,
        )
        ;(node.data as TextNodeData).body = entry.body
        const nodeH =
          typeof node.style?.height === 'number'
            ? node.style.height
            : typeof node.style?.height === 'string'
              ? Number.parseFloat(node.style.height)
              : 340
        yCursor += (Number.isFinite(nodeH) ? nodeH : 340) + SPLIT_GAP_FLOW
        nextNodes = [...nextNodes, node]
        newNodes.push(node)
        newEdges.push({
          id: crypto.randomUUID(),
          source: sourceNode.id,
          target: id,
          animated: true,
          style: { strokeWidth: 2 },
        })
      })
      return nextNodes
    })
    setEdges((prev) => [...prev, ...newEdges])
    appendHistory(
      mode === 'asset'
        ? `资产拆分完成：从「${sourceNode.data.title}」生成 ${newNodes.length} 个文本节点`
        : mode === 'storyboard'
          ? `分镜拆分完成：从「${sourceNode.data.title}」生成 ${newNodes.length} 个文本节点`
          : `符号拆分完成：从「${sourceNode.data.title}」生成 ${newNodes.length} 个文本节点`,
    )
    /** 拆分后焦点常在提示框 textarea，会导致 Ctrl+Z 只作用在输入框；失焦后可用画布撤销 */
    requestAnimationFrame(() => {
      panelPromptTextareaRef.current?.blur()
    })
  }, [appendHistory, nodes, promptPanel, setEdges, setNodes])

  return (
    <CanvasProvider
      updateNodeData={updateNodeData}
      addLinkedNode={addLinkedNode}
      removeHistoryBySource={removeHistoryBySource}
      updateNodeMeta={updateNodeMeta}
      removeNodeById={removeNodeById}
      addPanoramaViewToCanvas={addPanoramaViewToCanvas}
    >
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          onUploadFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div
        className="studio-main"
        onContextMenuCapture={(event) => {
          const t = event.target as HTMLElement | null
          if (!t) return
          if (t.closest('input, textarea, [contenteditable="true"]')) return
          event.preventDefault()
        }}
      >
        <div
          className="studio-flow-wrap"
          onMouseDownCapture={(event) => {
            const target = event.target as HTMLElement | null
            if (!target) return
            if (showMiniPreview) {
              const clickedMiniArea =
                target.closest('.react-flow__minimap') ||
                target.closest('[data-studio-flowid-map-ui="1"]')
              if (!clickedMiniArea) {
                setShowMiniPreview(false)
              }
            }
            if (canvasAddMenu) {
              const clickedCanvasAdd = target.closest('.studio-canvas-add-node-popover')
              if (!clickedCanvasAdd) {
                dismissCanvasAddMenu()
              }
            }
            if (connectAddMenu) {
              const clickedConnectAdd = target.closest('.studio-connect-add-popover')
              if (!clickedConnectAdd) {
                dismissConnectAddMenu()
              }
            }
            if (multiSelectContextMenu) {
              const clickedMultiSelectCtx = target.closest('.studio-multi-select-ctx')
              if (!clickedMultiSelectCtx) {
                dismissMultiSelectContextMenu()
              }
            }
            if (aiAssistantDialogOpen) {
              const clickedAiDialog = target.closest('.ai-assistant-dock')
              if (!clickedAiDialog && !target.closest('.btn--top-ai')) {
                setAiAssistantDialogOpen(false)
              }
            }
            if (!leftPanel) return
            if (leftPanel === 'settings') {
              const clickedSettingsModal = target.closest('[data-studio-settings-modal="1"]')
              if (!clickedSettingsModal) {
                setLeftPanel(null)
              }
              return
            }
            /** 避免捕获阶段先关面板、按钮 onClick 再打开，导致无法关闭 */
            if (leftPanel === 'local-projects' && target.closest('.btn--top-local')) {
              return
            }
            const clickedToolbox = target.closest('.studio-left-toolbelt')
            const clickedFlyout = target.closest('.left-flyout')
            const clickedAiDock = target.closest('.ai-assistant-dock')
            if (!clickedToolbox && !clickedFlyout && !clickedAiDock) {
              setLeftPanel(null)
            }
          }}
        >
          {/* Canvas background overlay (UI-only) */}
          <div
            className="fixed inset-0 opacity-[0.05] pointer-events-none z-0"
            style={{
              backgroundImage: 'radial-gradient(circle, #fff 1.2px, transparent 1.2px)',
              backgroundSize: '48px 48px',
            }}
            aria-hidden
          />

          <header
            className="studio-canvas-topbar fixed top-6 inset-x-8 h-14 flex items-center justify-between z-50 pointer-events-none"
            aria-label="画布顶部栏"
          >
            <div className="studio-canvas-topbar__brand flex items-center gap-4 pointer-events-auto">
              <div className="flex items-center gap-3 bg-[#111114] border border-white/5 px-4 py-2 rounded-full shadow-2xl backdrop-blur-xl">
                {/* Brand */}
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full px-1 text-left transition-colors hover:bg-white/5"
                  title="回到首页"
                  aria-label="回到首页"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    if (onGoHome) {
                      onGoHome()
                      return
                    }
                    setLeftPanel('local-projects')
                  }}
                >
                  <div className="w-6 h-6 bg-orange-600 flex items-center justify-center rounded-sm">
                    <span className="text-[14px] font-black text-white">F</span>
                  </div>
                  <span className="text-sm font-black tracking-widest uppercase text-white/90">
                    Flowid
                  </span>
                </button>

                <div className="w-[1px] h-4 bg-white/10 mx-2" aria-hidden />

                {/* Project tabs (keep behavior; match fig-1 look) */}
                <div className="flex items-center gap-2">
                  {projectTabs.map((tab) => {
                    const isActive = tab.id === activeProjectId
                    return (
                      <div
                        key={tab.id}
                        className={`studio-project-pill group flex items-center gap-2 px-2 py-1 transition-colors cursor-pointer select-none ${
                          isActive ? 'text-white' : 'text-white/70 hover:text-white'
                        }`}
                        onClick={() => activateProjectTab(tab.id)}
                        onDoubleClick={() => startRenameProjectLabel(tab.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            activateProjectTab(tab.id)
                          }
                        }}
                      >
                        {editingTabId === tab.id ? (
                          <input
                            className="studio-project-pill__input bg-transparent outline-none border border-white/15 rounded-md px-2 py-0.5 text-[13px] font-black tracking-widest uppercase text-white/90"
                            value={editingName}
                            style={{
                              width: `${Math.min(220, Math.max(68, (editingName.trim().length + 1) * 9))}px`,
                            }}
                            onChange={(event) => setEditingName(event.target.value)}
                            onBlur={() => commitRenameProjectLabel(tab.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitRenameProjectLabel(tab.id)
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                setEditingTabId(null)
                                setEditingName('')
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <>
                            <span className="studio-project-pill__name text-[14px] font-black tracking-widest">
                              {tab.name}
                            </span>
                            {isActive ? (
                              <span
                                className="ml-1 inline-flex items-center"
                                title="状态正常"
                                aria-label="状态正常"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              </span>
                            ) : null}
                          </>
                        )}
                        <button
                          type="button"
                          className="studio-project-pill__close text-white/40 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="关闭当前项目"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeProjectLabel(tab.id)
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Add project (separate + like fig-1) */}
              <button
                type="button"
                className="studio-project-add w-10 h-10 rounded-xl bg-[#111114] border border-white/10 shadow-2xl backdrop-blur-xl text-white/70 hover:text-white hover:bg-white/5 transition-colors pointer-events-auto"
                aria-label="新增项目"
                onClick={createProjectLabel}
                title="新增项目"
              >
                +
              </button>
            </div>
            <div className="studio-canvas-topbar__actions flex items-center gap-3 pointer-events-auto">
              {/* Right pill group (fig-1) */}
              <div className="flex items-center gap-4 bg-[#111114] border border-white/5 px-5 py-2 rounded-full shadow-2xl backdrop-blur-xl">
                <button
                  ref={localProjectsTopBtnRef}
                  type="button"
                  className={`btn--top-local inline-flex items-center gap-3 px-1 ${
                    leftPanel === 'local-projects' ? 'text-white' : 'text-white/85 hover:text-white'
                  }`}
                  title="打开本地项目列表（与当前浏览器工程同步）"
                  aria-label="本地项目"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    setLeftPanel((prev) => (prev === 'local-projects' ? null : 'local-projects'))
                  }}
                >
                  <img src={ICON_TOP_HOME} alt="" aria-hidden className="w-4 h-4 opacity-70" />
                  <span className="text-[14px] font-black tracking-widest">本地项目</span>
                </button>

                <div className="w-[1px] h-3 bg-white/10" aria-hidden />

                <button
                  type="button"
                  className="btn--top-recharge inline-flex items-center gap-3 px-1 text-[14px] font-black tracking-widest text-white/70 hover:text-white transition-colors disabled:opacity-50"
                  onClick={runAllWorkflowGuarded}
                  disabled={licenseReadOnly}
                  title={licenseReadOnly ? '授权已到期/冻结，当前为只读模式' : undefined}
                >
                  <span className="text-[15px] font-black text-orange-500">? 500</span>
                  <span className="inline-flex items-center gap-2">
                    <img src={ICON_TOP_STAR} alt="" aria-hidden className="w-4 h-4 opacity-70" />
                    <span className="text-[14px] font-black tracking-widest">充值</span>
                  </span>
                </button>
              </div>

              <button
                type="button"
                className="h-10 bg-white text-black font-black text-[14px] tracking-widest px-6 rounded-full hover:bg-orange-500 hover:text-white transition-all shadow-xl border border-transparent"
                onClick={() => setAuthModalOpen(true)}
              >
                {authSession ? `账号：${authSession.nickname}` : '注册 / 登录'}
              </button>
            </div>
          </header>

          {/* Sidebar Toolbelt — match @flowid (2); behavior unchanged */}
          <div className="absolute left-6 inset-y-0 flex items-center z-50 pointer-events-none" aria-label="画布左侧工具栏">
            <div className="relative pointer-events-auto flex items-center">
              <div className="studio-left-toolbelt bg-[#111114] border border-white/10 p-2 rounded-2xl shadow-2xl flex flex-col gap-1 items-center backdrop-blur-xl relative z-20">
                <button
                  type="button"
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95 mb-2 ${
                    leftPanel === 'add-node'
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-black hover:bg-orange-500 hover:text-white'
                  }`}
                  onClick={() => {
                    dismissCanvasAddMenu()
                    setLeftPanel((prev) => (prev === 'add-node' ? null : 'add-node'))
                  }}
                  title="添加节点"
                  aria-label="添加节点"
                >
                  <Plus className="w-6 h-6" strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all group ${
                    leftPanel === 'download-node'
                      ? 'text-orange-500 bg-orange-500/10'
                      : 'text-white/20 hover:text-white hover:bg-white/5'
                  }`}
                  title="系统预设"
                  aria-label="系统预设"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    setLeftPanel((prev) => (prev === 'download-node' ? null : 'download-node'))
                  }}
                >
                  <Box className="w-5 h-5 group-hover:scale-110 transition-transform" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all group ${
                    leftPanel === 'settings'
                      ? 'text-orange-500 bg-orange-500/10'
                      : 'text-white/20 hover:text-white hover:bg-white/5'
                  }`}
                  title="系统设置"
                  aria-label="系统设置"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    setLeftPanel((prev) => (prev === 'settings' ? null : 'settings'))
                  }}
                >
                  <Settings className="w-5 h-5 group-hover:scale-110 transition-transform" strokeWidth={2} />
                </button>
              </div>

              <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 z-10">
                <AnimatePresence mode="wait">
                  {leftPanel &&
                  leftPanel !== 'settings' &&
                  leftPanel !== 'ai-assistant' &&
                  leftPanel !== 'local-projects' &&
                  leftPanel !== 'my-assets' &&
                  leftPanel !== 'history' ? (
                    <motion.aside
                      key={leftPanel}
                      role="complementary"
                      aria-label="左侧功能面板"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.18 }}
                      className={`left-flyout ${leftPanel === 'add-node' ? 'left-flyout--add' : ''} ${leftPanel === 'download-node' ? 'left-flyout--preset' : ''}`}
                    >
                      {leftPanel === 'add-node' ? <AddNodePanel addNodeItems={addNodeItems} /> : null}
                      {leftPanel === 'download-node' ? (
                        <DownloadPanel
                          selectedNode={selectedNode}
                          onDownloadSelected={downloadSelectedNode}
                          onDownloadProject={exportJson}
                          onApplySystemPreset={applySystemPresetFromLibrary}
                        />
                      ) : null}
                    </motion.aside>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <RightPanel
            isOpen={rightPanelOpen}
            onToggleOpen={() => setRightPanelOpen((v) => !v)}
            activeTab={rightPanelTab}
            onTabChange={(tab) => {
              setRightPanelTab(tab)
              setRightPanelOpen(true)
            }}
            assets={assets}
            hoveredAssetId={hoveredAssetId}
            setHoveredAssetId={setHoveredAssetId}
            onUpload={triggerUpload}
            onUploadFiles={onUploadFiles}
            onUseAsset={addAssetToCanvas}
            onRemoveAsset={removeAsset}
            historyItems={historyItems}
            onRemoveHistoryItems={removeHistoryItems}
          />

          {/* Local projects popover remains header-anchored */}
          {leftPanel === 'local-projects' ? (
            <aside
              className="left-flyout left-flyout--local left-flyout--header-popover"
              aria-label="本地项目面板"
              style={
                localProjectsPopoverLayout
                  ? {
                      top: localProjectsPopoverLayout.top,
                      right: localProjectsPopoverLayout.right,
                      left: 'auto',
                    }
                  : undefined
              }
            >
              <LocalProjectsPanel
                onClose={() => setLeftPanel(null)}
                onOpenSnapshot={openLibraryProjectInNewTab}
                onOpenImported={openImportedProjectInNewTab}
                onRegisterCurrentToLibrary={registerCurrentToLibrary}
                getCurrentSnapshot={getCurrentSnapshotForLibrary}
                currentProjectName={activeProjectName}
              />
            </aside>
          ) : null}

          {aiAssistantDialogOpen && typeof document !== 'undefined'
            ? createPortal(
                <div
                  className="ai-assistant-dock"
                  style={{
                    left: `${aiAssistantDockStyle.left}px`,
                    top: `${aiAssistantDockStyle.top}px`,
                    width: `${aiAssistantDockStyle.width}px`,
                    height: `${aiAssistantDockStyle.height}px`,
                  }}
                >
                  <AiAssistantPanel
                    messages={aiMessages}
                    busy={aiBusy}
                    onSend={handleAiAssistantSend}
                    onClose={() => setAiAssistantDialogOpen(false)}
                  />
                </div>,
                document.body,
              )
            : null}

          {leftPanel === 'settings' ? (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
              onMouseDown={() => setLeftPanel(null)}
            >
              <WorkflowSettingsPanel
                executionMode={executionMode}
                executionProvider={executionProvider}
                randomizeKsamplerSeedsOnRun={randomizeKsamplerSeedsOnRun}
                localConfig={localConfig}
                cloudConfig={cloudConfig}
                cloudEndpoints={cloudEndpoints}
                nodeConfigs={nodeConfigs}
                shortcuts={shortcuts}
                lastExecutionMessage={lastExecutionMessage}
                onExecutionProviderChange={updateExecutionProvider}
                onRandomizeKsamplerSeedsOnRunChange={setRandomizeKsamplerSeedsOnRun}
                onProviderConfigChange={updateProviderConfig}
                onNodeConfigChange={updateNodeConfig}
                onSaveNodeWorkflow={saveNodeWorkflow}
                onSelectNodeWorkflow={selectNodeWorkflow}
                onRemoveNodeWorkflow={removeNodeWorkflow}
                onUpdateNodeWorkflowEntry={updateNodeWorkflowEntry}
                onClearNodeWorkflows={clearNodeWorkflows}
                onPinNodeWorkflowToTop={pinNodeWorkflowToTop}
                onAddCloudEndpoint={addCloudEndpoint}
                onUpdateCloudEndpoint={updateCloudEndpoint}
                onRemoveCloudEndpoint={removeCloudEndpoint}
                onShortcutConfigChange={updateShortcutConfig}
                onShortcutBindingChange={updateShortcutBinding}
                onTestProviderConnection={testProviderConnection}
                connectionTestMessage={connectionTestMessage}
                officialTemplates={officialTemplates}
                onExecutionModeChange={updateExecutionMode}
                onRefreshOfficialTemplates={refreshOfficialTemplates}
                aiAssistantConfig={aiConfig}
                onAiAssistantConfigChange={(patch) => {
                  setAiConfig((prev) => {
                    const next = { ...prev, ...patch }
                    saveAiAssistantConfig(next)
                    void persistAiAssistantConfigToExternalPath(next)
                    return next
                  })
                }}
                onSaveAiAssistantConfig={() => {
                  saveAiAssistantConfig(aiConfig)
                  void persistAiAssistantConfigToExternalPath(aiConfig)
                  window.alert('AI 助手配置已保存')
                }}
                onClose={() => setLeftPanel(null)}
              />
            </div>
          ) : null}
          <AuthModal
            open={authModalOpen}
            session={authSession}
            onClose={() => setAuthModalOpen(false)}
            onSuccess={handleAuthSuccess}
          />

          {canvasAddMenu ? (
            <div
              className="studio-canvas-add-node-popover"
              style={{
                left: canvasAddMenu.left,
                top: canvasAddMenu.top,
              }}
              role="dialog"
              aria-label="添加节点"
            >
              <AddNodePanel addNodeItems={addNodeItems} />
            </div>
          ) : null}

          {connectAddMenu ? (
            <div
              className="studio-connect-add-popover"
              style={{
                left: connectAddMenu.left,
                top: connectAddMenu.top,
              }}
              role="dialog"
              aria-label="连接后添加节点"
            >
              <AddNodePanel addNodeItems={connectAddNodeItems} />
            </div>
          ) : null}

          {multiSelectContextMenu
            ? createPortal(
                <div
                  className="studio-multi-select-ctx nodrag"
                  style={{
                    left: multiSelectContextMenu.left,
                    top: multiSelectContextMenu.top,
                    flexDirection: multiSelectContextMenu.preferSubmenuRight ? 'row' : 'row-reverse',
                  }}
                  role="menu"
                  aria-label="节点菜单"
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseEnter={cancelSubmenuHoverCloseTimer}
                  onMouseLeave={scheduleSubmenuHoverCloseTimer}
                >
                  <div className="studio-multi-select-ctx__main">
                    <button
                      type="button"
                      className="studio-group__menuItem"
                      role="menuitem"
                      onClick={() => {
                        copySelectedNodes()
                        dismissMultiSelectContextMenu()
                      }}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      className="studio-group__menuItem"
                      role="menuitem"
                      disabled={!clipboard?.nodes?.length}
                      onClick={() => {
                        if (!clipboard?.nodes?.length) return
                        pasteClipboardNodes()
                        dismissMultiSelectContextMenu()
                      }}
                    >
                      粘贴
                    </button>
                    {batchContextMenuEligibleCount >= 2 ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          sortSelectedNodesByFileNameVertical()
                        }}
                      >
                        按标题分镜纵向排序
                      </button>
                    ) : null}
                    {batchContextMenuEligibleCount >= 2 ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          createGroupFromSelection()
                          dismissMultiSelectContextMenu()
                        }}
                      >
                        编组
                      </button>
                    ) : null}
                    {batchContextMenuEligibleCount === 1 ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          void runBatchExecuteFromContextMenuSelection()
                        }}
                      >
                        执行
                      </button>
                    ) : null}
                    {batchContextMenuEligibleCount >= 2 ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          void runBatchExecuteFromContextMenuSelection()
                        }}
                      >
                        全部执行
                      </button>
                    ) : null}
                    {batchContextMenuEligibleCount >= 1 ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          downloadSelectedNodesMedia()
                        }}
                      >
                        全部下载
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="studio-group__menuItem"
                      role="menuitem"
                      onClick={() => {
                        cancelSubmenuHoverCloseTimer()
                        setMultiSelectContextMenu((prev) =>
                          prev
                            ? {
                                ...prev,
                                submenuMode: prev.submenuMode === 'linked' ? null : 'linked',
                              }
                            : prev,
                        )
                      }}
                    >
                      新增节点
                    </button>
                    <button
                      type="button"
                      className="studio-group__menuItem"
                      role="menuitem"
                      onClick={() => {
                        cancelSubmenuHoverCloseTimer()
                        setMultiSelectContextMenu((prev) =>
                          prev
                            ? {
                                ...prev,
                                submenuMode: prev.submenuMode === 'common' ? null : 'common',
                              }
                            : prev,
                        )
                      }}
                    >
                      新增共同节点
                    </button>
                    <button
                      type="button"
                      className="studio-group__menuItem is-danger"
                      role="menuitem"
                      onClick={() => {
                        deleteSelectedNodes()
                        dismissMultiSelectContextMenu()
                      }}
                    >
                      删除
                    </button>
                  </div>

                  {multiSelectContextMenu.submenuMode ? (
                    <div
                      className="add-node-card nodrag"
                      role="menu"
                      aria-label={
                        multiSelectContextMenu.submenuMode === 'common'
                          ? '新增共同节点类型'
                          : '新增节点类型'
                      }
                    >
                      {SYNC_ADD_MENU_ITEMS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="add-node-card__item"
                          role="menuitem"
                          onClick={() =>
                            multiSelectContextMenu.submenuMode === 'common'
                              ? addCommonNodeViaContextMenuSelection(item.kind)
                              : addLinkedNodesViaContextMenuSelection(item.kind)
                          }
                        >
                          <span className="add-node-card__itemIcon" aria-hidden>
                            <img src={item.icon} alt="" />
                          </span>
                          <span className="add-node-card__itemText">{item.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>,
                document.body,
              )
            : null}

          <ReactFlow
            className="dark"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onMoveEnd={onMoveEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
            onSelectionChange={onSelectionChange}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDoubleClick={onNodeDoubleClick}
            onSelectionContextMenu={onSelectionContextMenu}
            nodeTypes={nodeTypes}
            defaultViewport={loaded.viewport}
            minZoom={0}
            maxZoom={2}
            zoomOnDoubleClick={false}
            zoomOnPinch
            preventScrolling
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag={false}
            selectionKeyCode={['Control', 'Meta']}
            multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
            panOnDrag
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: '#94a3b8', strokeWidth: 2 },
            }}
          >
            <Background variant={BackgroundVariant.Lines} gap={32} size={1} color="#1a1a1a" />
            <Controls showInteractive={false} className="studio-controls studio-controls--hidden" />
            {showMiniPreview ? (
              <MiniMap
                className="studio-flowid-minimap"
                pannable
                zoomable
                nodeColor={minimapColor}
                maskColor="rgba(0,0,0,0.6)"
                style={{
                  backgroundColor: '#111114',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  width: 240,
                  height: 140,
                  bottom: 120,
                  right: 0,
                }}
                onDoubleClick={focusCanvasContent}
              />
            ) : null}
            {typeof document !== 'undefined'
              ? createPortal(
                  <div
                    className="studio-ai-avatar-dock"
                    aria-label="AI 虚拟人"
                    style={{
                      left: `${avatarDockRect.left}px`,
                      top: `${avatarDockRect.top}px`,
                      width: `${avatarDockRect.width}px`,
                      height: `${avatarDockRect.height}px`,
                    }}
                    onMouseDown={handleAvatarDockMouseDown}
                    onDoubleClick={() => setAiAssistantDialogOpen(true)}
                  >
                    <video
                      key={dockAvatarState}
                      className="studio-ai-avatar-dock__video"
                      src={dockAvatarMedia}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                    <button
                      type="button"
                      className="studio-ai-avatar-dock__resizeHandle"
                      aria-label="调整虚拟人大小"
                      onMouseDown={handleAvatarDockResizeMouseDown}
                    />
                  </div>,
                  document.body,
                )
              : null}
            {visiblePromptPanel && visiblePromptPanelLayout && promptPanelWrapStyle ? (
              <div
                className={`studio-music-prompt-panel-wrap ${promptPanelExpanded ? 'is-expanded' : ''}`}
                style={promptPanelWrapStyle}
                aria-label="节点提示词与执行面板"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={`studio-music-prompt-panel ${promptPanelExpanded ? 'is-expanded' : ''}`}>
                  <div className="studio-music-prompt-panel__head">
                    <span>
                      {visiblePromptPanel.kind === 'text'
                        ? '提示内容'
                        : visiblePromptPanel.kind === 'image' || visiblePromptPanel.kind === 'video'
                          ? '提示词'
                          : visiblePromptPanel.kind === 'audio' || visiblePromptPanel.kind === 'music'
                            ? '描述信息'
                            : '描述信息'}
                    </span>
                    <div className="studio-music-prompt-panel__headActions">
                      <button
                        type="button"
                        className="studio-music-prompt-panel__settingsBtn"
                        title="打开 COMFYUI / 模型配置"
                        aria-label="打开设置面板"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!visiblePromptPanel) return
                          const nid = visiblePromptPanel.node.id
                          const current = (visiblePromptPanel.node.data as any)?.promptPickerMode === 'model' ? 'model' : 'workflow'
                          const next = current === 'workflow' ? 'model' : 'workflow'
                          updateNodeData(nid, {
                            promptPickerMode: next,
                          } as any)
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          setLeftPanel('settings')
                        }}
                      >
                        {promptPanelPickerMode === 'workflow' ? 'COMFYUI' : '模型'}
                      </button>
                      <button
                        type="button"
                        className="studio-music-prompt-panel__expandBtn"
                        title={promptPanelExpanded ? '缩小提示框' : '放大提示框'}
                        aria-label={promptPanelExpanded ? '缩小提示框' : '放大提示框'}
                        onClick={(event) => {
                          event.stopPropagation()
                          setPromptPanelExpanded((v) => !v)
                        }}
                      >
                        {promptPanelExpanded ? '⤡' : '⤢'}
                      </button>
                    </div>
                  </div>
                  {promptPanelMentionImages.length > 0 ? (
                    <div className="studio-music-prompt-panel__mentionStrip" aria-label="@ 引用图片">
                      {promptPanelMentionImages.map((item, idx) => (
                        (() => {
                          const chipKey = `${item.mention}-${item.url}-${idx}`
                          const isBroken = brokenMentionChipKeys.has(chipKey)
                          return (
                        <div
                          key={`${item.url}-${idx}`}
                          className="studio-music-prompt-panel__mentionChip"
                          draggable
                          onDragStart={(event) => {
                            mentionDragIndexRef.current = idx
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', String(idx))
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                            const fromIndex = mentionDragIndexRef.current
                            if (fromIndex == null || fromIndex === idx) return
                            movePanelMentionImageByIndex(fromIndex, idx)
                            mentionDragIndexRef.current = idx
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            const fromIndex = mentionDragIndexRef.current
                            mentionDragIndexRef.current = null
                            if (fromIndex == null || fromIndex === idx) return
                            movePanelMentionImageByIndex(fromIndex, idx)
                          }}
                          onDragEnd={() => {
                            mentionDragIndexRef.current = null
                          }}
                          title="可拖拽调整参考图顺序"
                        >
                          <img
                            src={item.url}
                            alt=""
                            onError={() =>
                              setBrokenMentionChipKeys((prev) => {
                                const next = new Set(prev)
                                next.add(chipKey)
                                return next
                              })
                            }
                          />
                          <span className="studio-music-prompt-panel__mentionBadge">{idx + 1}</span>
                          {isBroken ? (
                            <>
                              <button
                                type="button"
                                className="studio-music-prompt-panel__refChipRemove"
                                title="该引用图片当前不可读，点击尝试修复来源图片"
                                aria-label="修复失效引用"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void repairPanelMentionByToken(item.mention, chipKey).then((ok) => {
                                    if (!ok) {
                                      window.alert('引用修复失败：未找到可恢复的来源图片，可改为手动移除该 @ 引用。')
                                    }
                                  })
                                }}
                              >
                                ↺
                              </button>
                              <button
                                type="button"
                                className="studio-music-prompt-panel__refChipRemove"
                                title="从提示词中移除该 @ 引用"
                                aria-label="移除失效引用"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  removePanelMentionByToken(item.mention)
                                }}
                                style={{ right: 22 }}
                              >
                                ×
                              </button>
                            </>
                          ) : null}
                        </div>
                          )
                        })()
                      ))}
                    </div>
                  ) : null}
                  {(visiblePromptPanel.kind === 'image' ||
                    visiblePromptPanel.kind === 'video' ||
                    visiblePromptPanel.kind === 'audio') && (
                    <div className="studio-music-prompt-panel__refZone">
                      <input
                        ref={panelRefImagesInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="visually-hidden"
                        onChange={(event) => {
                          void appendPanelReferenceImages(event.target.files)
                          event.target.value = ''
                        }}
                      />
                      <div
                        className={`studio-music-prompt-panel__dropPad ${
                          refImageDropActive ? 'is-active' : ''
                        }`}
                        role="button"
                        tabIndex={0}
                        onClick={() => panelRefImagesInputRef.current?.click()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            panelRefImagesInputRef.current?.click()
                          }
                        }}
                        onDragEnter={onRefImageDragEnter}
                        onDragLeave={onRefImageDragLeave}
                        onDragOver={onRefImageDragOver}
                        onDrop={onRefImageDrop}
                      >
                        <span className="studio-music-prompt-panel__dropPadText">本地参考图（可选）</span>
                        <span className="studio-music-prompt-panel__dropPadHint">点击或拖拽 · 多图</span>
                      </div>
                      <div
                        className="studio-music-prompt-panel__refStrip"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {((visiblePromptPanel.kind === 'image'
                          ? (visiblePromptPanel.node.data as ImageNodeData).referenceImageSources
                          : visiblePromptPanel.kind === 'video'
                            ? (visiblePromptPanel.node.data as VideoNodeData).referenceImageSources
                            : (visiblePromptPanel.node.data as AudioNodeData).referenceImageSources
                        ) ?? [])
                          ?.filter(Boolean)
                          .map((src, idx, arr) => (
                            <div
                              key={`${src}-${idx}`}
                              className="studio-music-prompt-panel__refChip"
                              draggable
                              onDragStart={(event) => onRefChipDragStart(idx, event)}
                              onDragOver={(event) => onRefChipDragOverIndex(idx, event)}
                              onDrop={(event) => onRefChipDropToIndex(idx, event)}
                              onDragEnd={() => {
                                refChipDragIndexRef.current = null
                              }}
                              title="可拖拽调整参考图顺序"
                            >
                              <img src={src} alt="" />
                              <div className="studio-music-prompt-panel__refChipOrder">
                                <button
                                  type="button"
                                  className="studio-music-prompt-panel__refChipMove"
                                  disabled={idx === 0}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    movePanelReferenceImage(idx, -1)
                                  }}
                                  aria-label="参考图左移"
                                  title="左移（更早上传）"
                                >
                                  ←
                                </button>
                                <button
                                  type="button"
                                  className="studio-music-prompt-panel__refChipMove"
                                  disabled={idx === arr.length - 1}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    movePanelReferenceImage(idx, 1)
                                  }}
                                  aria-label="参考图右移"
                                  title="右移（更晚上传）"
                                >
                                  →
                                </button>
                              </div>
                              <button
                                type="button"
                                className="studio-music-prompt-panel__refChipRemove"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  removePanelReferenceImage(src, idx)
                                }}
                                aria-label="移除参考图"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={panelPromptTextareaRef}
                    className="studio-music-prompt-panel__textarea"
                    placeholder={
                      visiblePromptPanel.kind === 'music' || visiblePromptPanel.kind === 'audio'
                        ? '描述你想要生成的内容；工作流中可使用占位符 __NOTE__、__REF_IMAGES__（多图 URL 换行）'
                        : visiblePromptPanel.kind === 'text'
                          ? '输入文本或提示词；工作流中可使用占位符 __BODY__'
                          : '输入画面/镜头描述；工作流中可使用占位符 __PROMPT__、__SRC__、__REF_IMAGES__'
                    }
                    value={promptPanelText}
                    onDragOver={(event) => {
                      const text = event.dataTransfer?.getData('text/plain') || ''
                      if (text.startsWith('@系统提示词(')) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'copy'
                      }
                    }}
                    onDrop={(event) => {
                      const raw = event.dataTransfer?.getData('text/plain') || ''
                      if (!raw.startsWith('@系统提示词(')) return
                      event.preventDefault()
                      const el = event.currentTarget
                      const insert = raw.endsWith(')') ? `${raw} ` : `${raw}) `
                      const { nextValue, nextCaret } = insertTextAtCaret(el, insert)
                      updatePromptPanelText(nextValue)
                      queueMicrotask(() => {
                        try {
                          el.focus()
                          el.setSelectionRange(nextCaret, nextCaret)
                        } catch {
                          // ignore
                        }
                      })
                    }}
                    onChange={(event) => {
                      const v = event.target.value
                      updatePromptPanelText(v)
                      const caret = event.target.selectionStart ?? v.length
                      const match = detectMentionAtCaret(v, caret)
                      if (!match || !promptPanel) {
                        closeMentionMenu()
                        return
                      }
                      mentionRangeRef.current = { start: match.start, end: match.end }
                      const picked = nodes
                        .filter((n) => n.id !== promptPanel.node.id)
                        .map((n) => ({ id: n.id, title: String(n.data.title || '').trim() }))
                        .filter((item) => item.title)
                        .filter((item) => item.title.includes(match.query))
                        .slice(0, 8)
                      setMentionCandidates(picked)
                      setMentionActiveIndex(0)
                    }}
                    onPaste={onPromptPanelTextareaPaste}
                    onKeyDown={(event) => {
                      if (mentionCandidates.length > 0) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          setMentionActiveIndex((prev) =>
                            Math.min(mentionCandidates.length - 1, prev + 1),
                          )
                          return
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          setMentionActiveIndex((prev) => Math.max(0, prev - 1))
                          return
                        }
                        if (event.key === 'Enter' || event.key === 'Tab') {
                          event.preventDefault()
                          const picked = mentionCandidates[mentionActiveIndex]
                          const range = mentionRangeRef.current
                          const text = event.currentTarget.value
                          if (picked && range) {
                            const token = `${buildMentionToken(picked.title, picked.id)} `
                            const next =
                              text.slice(0, range.start) + token + text.slice(range.end)
                            updatePromptPanelText(next)
                            closeMentionMenu()
                            requestAnimationFrame(() => {
                              const el = panelPromptTextareaRef.current
                              if (!el) return
                              const pos = range.start + token.length
                              el.focus()
                              el.setSelectionRange(pos, pos)
                            })
                          }
                          return
                        }
                        if (event.key === 'Escape') {
                          closeMentionMenu()
                          return
                        }
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void executePromptPanelFromPanel(visiblePromptPanel)
                      }
                    }}
                    onBlur={() => {
                      window.setTimeout(() => closeMentionMenu(), 80)
                    }}
                  />
                  {mentionCandidates.length > 0 ? (
                    <div className="studio-music-prompt-panel__mentionMenu">
                      {mentionCandidates.map((item, idx) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`studio-music-prompt-panel__mentionItem ${
                            idx === mentionActiveIndex ? 'is-active' : ''
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            const el = panelPromptTextareaRef.current
                            if (!el) return
                            const text = el.value
                            const range = mentionRangeRef.current
                            if (!range) return
                            const token = `${buildMentionToken(item.title, item.id)} `
                            const next =
                              text.slice(0, range.start) + token + text.slice(range.end)
                            updatePromptPanelText(next)
                            closeMentionMenu()
                            requestAnimationFrame(() => {
                              const pos = range.start + token.length
                              el.focus()
                              el.setSelectionRange(pos, pos)
                            })
                          }}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {unresolvedMentions.length > 0 ? (
                    <div className="studio-music-prompt-panel__mentionWarn">
                      未匹配到节点：{unresolvedMentions.map((item) => `@${item}`).join('、')}
                    </div>
                  ) : null}
                  <div className="studio-music-prompt-panel__foot">
                    {promptPanelPickerMode === 'workflow' ? (
                      <PromptPanelDropdown
                        ariaLabel="选择工作流模板"
                        className="studio-music-prompt-panel__select"
                        placeholder="选择工作流"
                        value={promptPanelWorkflowSelectValue}
                        options={promptPanelWorkflowOptions.map((item) => ({ value: item, label: item }))}
                        onChange={(pickedName) => {
                          const wfKind = visiblePromptPanel.kind
                          const list = nodeConfigs[wfKind].workflows
                          const picked =
                            list.find((item) => item.name === pickedName) ??
                            list.find((item) => item.name.trim() === pickedName.trim()) ??
                            findWorkflowEntryByPreferredName(list, pickedName)
                          if (picked) {
                            selectNodeWorkflow(wfKind, picked.id)
                          }
                          updateNodeData(visiblePromptPanel.node.id, {
                            kind: wfKind,
                            model: pickedName,
                            /** 与执行逻辑一致：以条目 id 为准，不依赖全局 selectedWorkflowId */
                            workflowEntryId: picked?.id,
                          } as Partial<StudioNodeData>)
                        }}
                      />
                    ) : (
                      <PromptPanelDropdown
                        ariaLabel="选择云端模型"
                        className="studio-music-prompt-panel__select"
                        placeholder="选择模型"
                        value={promptPanelModelSelectValue}
                        options={promptPanelModelOptions}
                        onChange={(pickedId) => {
                          const kind = visiblePromptPanel.kind
                          if (pickedId === 'custom' || pickedId === 'custom-current') {
                            updateNodeConfig(kind, { cloudModelName: '', cloudModelUrl: '' })
                            return
                          }
                          const preset = loadCloudModelPresets().find((i) => i.id === pickedId)
                          if (!preset) return
                          updateNodeConfig(kind, { cloudModelName: preset.name, cloudModelUrl: preset.baseUrl })
                        }}
                      />
                    )}
                    {visiblePromptPanel.kind === 'text' ? (
                      <PromptPanelDropdown
                        key={textSplitSelectKey}
                        aria-label="自动拆分方式"
                        title="选择拆分方式：资产拆分 / 分镜拆分 / 符号拆分"
                        className="nodrag studio-music-prompt-panel__splitSelect"
                        placeholder="自动拆分"
                        value=""
                        options={[
                          { value: '', label: '自动拆分', disabled: true },
                          { value: 'asset', label: '资产拆分' },
                          { value: 'storyboard', label: '分镜拆分' },
                          { value: 'symbol', label: '符号拆分（### / --- / @@）' },
                        ]}
                        onChange={(v) => {
                          if (v === 'asset' || v === 'storyboard' || v === 'symbol') {
                            splitTextNodeToStructuredNodes(v as TextSplitMode)
                            setTextSplitSelectKey((k) => k + 1)
                          }
                        }}
                      />
                    ) : null}
                    <span className="studio-music-prompt-panel__count">
                      {visiblePromptPanel.kind === 'music' || visiblePromptPanel.kind === 'audio'
                        ? `${(visiblePromptPanel.node.data as AudioNodeData).note?.length || 0}/5000`
                        : visiblePromptPanel.kind === 'text'
                          ? `${(visiblePromptPanel.node.data as TextNodeData).body?.length || 0}/5000`
                          : visiblePromptPanel.kind === 'image'
                            ? `${(visiblePromptPanel.node.data as ImageNodeData).prompt?.length || 0}/5000`
                            : `${(visiblePromptPanel.node.data as VideoNodeData).prompt?.length || 0}/5000`}
                    </span>
                    <button
                      type="button"
                      className="studio-music-prompt-panel__submit"
                      onClick={() => void executePromptPanelFromPanel(visiblePromptPanel)}
                      title="执行当前节点工作流；长任务在后台跑时仍可再次提交，仅最后一次完成的任务会写回节点"
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </ReactFlow>
          <div
            className="absolute bottom-8 right-8 flex flex-col items-end gap-6 z-50 studio-flowid-map-ui [-webkit-tap-highlight-color:transparent] [&_button]:outline-none"
            data-studio-flowid-map-ui="1"
          >
            <div className="bg-[#111114] border border-white/10 p-1.5 rounded-full shadow-2xl flex items-center gap-3 pointer-events-auto backdrop-blur-xl">
              <button
                type="button"
                onClick={() => setShowMiniPreview((v) => !v)}
                aria-label="小地图"
                className={`w-10 h-10 flex items-center justify-center transition-all bg-white/5 rounded-full ${
                  showMiniPreview ? 'text-orange-500' : 'text-white/40 hover:text-white'
                }`}
              >
                <MapIcon className="w-4 h-4" aria-hidden />
              </button>
              <div className="w-[1px] h-4 bg-white/10" />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => zoomOut()}
                  aria-label="缩小"
                  className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-all text-sm font-light"
                >
                  −
                </button>
                <span
                  className="text-[15px] font-black tracking-widest text-white/90 min-w-[60px] text-center"
                  title="节点编辑区视口缩放；与浏览器页面缩放无关。"
                >
                  {Math.round((Number.isFinite(viewport.zoom) ? viewport.zoom : getZoom()) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => zoomIn()}
                  aria-label="放大"
                  className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-all text-sm font-light"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CanvasProvider>
  )
}

/**
 * 应用根：提供 React Flow 上下文。
 */
export function StudioApp({ onGoHome }: { onGoHome?: () => void }) {
  return (
    <ReactFlowProvider>
      <StudioCanvasInner onGoHome={onGoHome} />
    </ReactFlowProvider>
  )
}

