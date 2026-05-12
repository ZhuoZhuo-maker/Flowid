import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  applyNodeChanges,
  useStoreApi,
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
  useMemo,
  memo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  Camera,
  Frame,
  Map as MapIcon,
  Moon,
  Plus,
  Settings,
  Sun,
  Zap,
} from 'lucide-react'
import type {
  AudioNodeData,
  ComfyTdRefAudioRoleRow,
  ComfyVoiceTableRow,
  CloudImageAspectKey,
  CloudImageResolutionTier,
  ImageCompareNodeData,
  ImageNodeData,
  NodeResultThumbnail,
  NodeWorkflowConfig,
  PanoramaNodeData,
  ProjectSnapshot,
  ScriptNodeData,
  StudioNodeData,
  StudioNodeKind,
  TextNodeData,
  VideoNodeData,
} from '../types'
import {
  applySensitiveFilterToNodeDataPatch,
  awaitSensitiveLexiconSettled,
  canSend,
  collectUserFacingTextFromNodeData,
  ensureLexiconLoading,
  replaceSensitiveWords,
} from '../lib/sensitiveWords'
import { alertSensitiveWordBlocked } from '../lib/sensitiveWordUi'
import {
  insertTextAtCaret,
  readDraggedPlainText,
  readDraggedPlainTextSync,
} from '../lib/textareaInsertAtCaret'
import { loadCloudSelfPresets } from '../lib/cloudSelfPresets'
import {
  emptyCloudAssistCatalog,
  encodeCloudAssistModelPick,
  fetchCloudAssistModelCatalog,
  findAssistEndpoint,
  getAssistApiKey,
  readAssistLineVerified,
  studioNodeKindToAssistKind,
  tryDecodeCloudAssistModelPick,
  type CloudAssistCatalog,
  type CloudAssistKeysChangedDetail,
} from '../lib/cloudAssistModelCatalog'
import {
  clearAssistModelBindingForAssistKinds,
  stripCloudApiKeyFromAllStudioNodes,
} from '../lib/stripCloudApiKeyFromStudioNodes'
import { CanvasProvider } from '../context/CanvasContext'
import { AudioNode } from './nodes/AudioNode'
import { GhostNode } from './nodes/GhostNode'
import { GroupNode } from './nodes/GroupNode'
import { ImageNode } from './nodes/ImageNode'
import { ImageCompareNode } from './nodes/ImageCompareNode'
import { PanoramaNode } from './nodes/PanoramaNode'
import { ScriptNode } from './nodes/ScriptNode'
import { TextNode } from './nodes/TextNode'
import { VideoNode } from './nodes/VideoNode'
import { SilkBezierEdge } from './edges/SilkBezierEdge'
import { AddNodePanel } from './panels/AddNodePanel'
import { MultiangleControlPanel } from './panels/MultiangleControlPanel'
import { DownloadPanel } from './panels/DownloadPanel'
import { FlowidMark } from './FlowidMark'
import { RightPanel, type RightPanelTab } from './panels/RightPanel'
import { AiAssistantPanel, type AiAssistantMessage } from './panels/AiAssistantPanel'
import { AgentFloatingChatWindow } from './agent/AgentFloatingChatWindow'
import { PointsTaskFailureToast, type PointsTaskFailureToastState } from './PointsTaskFailureToast'
import { estimateSceneBatchFromText } from '../lib/agentPointsExample'
import { subscribePointsTaskFailure } from '../lib/pointsService'
import { apiPointsQuote } from '../lib/licensePointsApi'
import { buildPointsReserveParams } from '../lib/pointsReserveMetadata'
import {
  clampMultiangleHV,
  clampMultiangleZoom,
  FLOWID_MULTIANGLE_DEFAULT_H,
  FLOWID_MULTIANGLE_DEFAULT_V,
  FLOWID_MULTIANGLE_DEFAULT_ZOOM,
} from '../lib/comfyMultianglePlaceholders'
import {
  audioDataPatchFromMusicFineTuneDraft,
  DEFAULT_MUSIC_FINE_TUNE_DRAFT,
  MUSIC_DURATION_MINUTES_OPTIONS,
  MUSIC_KEYSCALE_OPTIONS,
  MUSIC_LANGUAGE_OPTIONS,
  MUSIC_TIMESIGNATURE_OPTIONS,
  type MusicFineTuneDraft,
  musicFineTuneDraftFromAudioData,
} from '../lib/musicWorkflowFineTune'
import {
  alignComfySpatialDimension,
  COMFY_WORKFLOW_ASPECT_PANEL_OPTIONS,
  COMFY_WORKFLOW_STYLE_TONE_PANEL_OPTIONS,
  isLegacyComfyWorkflowPixelOnly,
  resolveComfyWorkflowWidthHeight,
  workflowJsonSupportsComfySizePlaceholders,
  workflowJsonSupportsComfyStyleTonePlaceholder,
} from '../lib/comfyWorkflowOutputSize'
import {
  COMFY_VOICE_TABLE_LANGUAGE_OPTIONS,
  workflowJsonSupportsVoiceTable8Slots,
} from '../lib/comfyVoiceTable8'
import { parseVoiceTableBulkPaste, voiceTableRowsPaddedForUi } from '../lib/parseVoiceTableBulkPaste'
import {
  buildTdRefAudioRoleMatchSlotLabels,
  workflowJsonSupportsTdRefAudioRoleMap,
} from '../lib/comfyTdRefAudioRoleMap'
import { buildMultianglePreviewLine } from '../lib/multianglePresets'
import { fetchCloudWorkflowJson, fetchCloudWorkflowsMeta, type CloudWorkflowMeta } from '../lib/cloudWorkflowsApi'
import { workflowJsonUsesSystemPromptPlaceholder } from '../lib/cloudWorkflowUserGuides'
import {
  listCloudWorkflowExamples,
  pinCloudWorkflowExample,
  removeCloudWorkflowExample,
  type CloudWorkflowExampleEntry,
} from '../lib/cloudWorkflowExampleProjects'
import { nodeSupportsMultiangleAngleControl } from '../lib/workflowMultiangleSupport'
import {
  registerAgentCanvasTasksProvider,
  registerAgentNavigateToNode,
} from '../lib/agentCanvasBridge'
import { registerAgentProjectContextProvider } from '../lib/agentProjectContextBridge'
import { registerAgentOpenCanvasSettings } from '../lib/agentStudioUiBridge'
import { callLLM } from '../lib/agentLlmStub'
import {
  runFlowidAgentToolLoop,
  type AgentCanvasBriefNode,
} from '../lib/flowidAgentToolLoop'
import type { AgentParseMode } from '../lib/agentParseMode'
import {
  invokeStudioAgentExecution,
  registerStudioAgentChatHandler,
  registerStudioAgentExecutor,
  type AgentSceneBatchPayload,
  type StudioAgentChatHandler,
} from '../lib/studioAgentBridge'
import { WorkflowSettingsPanel, type SettingsTab } from './panels/WorkflowSettingsPanel'
import { registerStudioDeviceActivationOpener } from '../lib/studioSettingsOpen'
import { useAssetsHistory } from '../hooks/useAssetsHistory'
import { useWorkflowRunner } from '../hooks/useWorkflowRunner'
import { useWorkflowIntegration } from '../hooks/useWorkflowIntegration'
import {
  computeAccessState,
  loadLicenseServerConfig,
  loadLicenseSnapshotV2,
  saveLicenseSnapshotV2,
  touchLicenseLocalTime,
} from '../lib/licenseAccess'
import { verifyLicenseRemote } from '../lib/licenseClient'
import {
  loadLocalDiskPathsSettings,
  saveLocalDiskPathsSettings,
} from '../lib/localDiskPathsSettings'
import type {
  AddNodeMenuItem,
  AssetItem,
  LeftPanelType,
} from './panels/types'
import {
  createGroupNode,
  createImageCompareStudioNode,
  createStudioNode,
  defaultStudioNodeTitle,
} from '../lib/nodeFactory'
import { resolvedPromptPickerMode } from '../lib/promptPickerMode'
import { getPrimaryImageDisplayUrlForCompare } from '../lib/imageCompareNodeUtils'
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
import {
  attachVideoTargetHandleForEdge,
  computeVideoTextPromptSlot,
  migrateVideoTargetEdges,
  shouldInheritIntoVideoOnConnect,
  videoTargetHandleForPendingConnectReplace,
  VIDEO_IN_UNIFIED,
} from '../lib/videoNodeInports'
import { persistProjectSnapshotToExternalStores, tryLoadExternalProjectSnapshot } from '../lib/projectDiskMirror'
import {
  FLOWID_MATERIAL_DRAG_MIME,
  parseFlowidMaterialDragPayload,
} from '../lib/materialLibrary'
import {
  FLOWID_PRESET_TEMPLATE_DRAG_MIME,
  loadPresetTemplateSnapshot,
  parsePresetTemplateDragPayload,
  type PresetTemplateDragPayload,
} from '../lib/templateCatalog'
import {
  persistAiAssistantConfigToExternalPath,
  tryLoadAiAssistantConfigFromExternalPath,
} from '../lib/aiAssistantConfigMirror'
import {
  chatReplyWithModel,
  isAiAssistantCreatableNodeKind,
  loadAiAssistantConfig,
  planActionsWithModel,
  planActionsWithRules,
  saveAiAssistantConfig,
  type AiAssistantAction,
  type AiAssistantConfig,
} from '../lib/aiAssistantAgent'
import { augmentPromptWithMentionResolution } from '../lib/agentMentionResolution'
import { dashScopeCompatibleModeTts404Hint, normalizeOpenAICompatibleBaseUrl } from '../lib/openaiCompat'
import {
  isDashScopeCompatibleModeMisusedForTts,
  isQwenTtsMultimodalEndpoint,
  normalizeQwenTtsMultimodalUrl,
  type QwenTtsMultimodalResponse,
} from '../lib/qwenTtsMultimodal'
import { fetchOpenAICompat } from '../lib/openaiProxy'
import {
  buildMentionToken,
  collectMentionAudioResolvedEntries,
  collectMentionImageSources,
  collectUpstreamNodeIds,
  listMentionImageAttachments,
  listMentionAudioRefLabelsForNote,
  mentionAlreadyReferencesNodeId,
  parseDefaultNodeTitleIndex,
  parseMentionRefs,
  refreshMentionLabelsInText,
  resolveMentionRefToNode,
  resolveNodeMentionsInText,
} from '../lib/nodeMentions'
import { DEFAULT_WORKSPACE_LIBRARY_ID, writeLibraryProject } from '../lib/localProjectLibrary'
import {
  getDesktopDiskFileObjectUrl,
  getLocalImageAssetObjectUrl,
  getDesktopMirroredOutputObjectUrlByNode,
  isBlobUrlHeldInLocalAssetObjectUrlCache,
  saveLocalImageAsset,
} from '../lib/localImageAssetStore'
import { mirrorComfyOutputToDisk, mirrorUploadToInputDir } from '../lib/localAssetDiskMirror'
import { resolveComfyAudioPlaybackSrc } from '../lib/comfyAudioPlayback'
import { partitionMediaFilesByKind } from '../lib/mediaDropPartition'
import {
  ICON_NODE_AUDIO,
  ICON_NODE_IMAGE,
  ICON_NODE_MUSIC,
  ICON_NODE_PANORAMA,
  ICON_NODE_TEXT,
  ICON_NODE_VIDEO,
} from '../assets/studioIcons'
import { AI_ASSISTANT_AVATAR_MEDIA_URLS } from '../assets/ai-assistant/avatarWebmUrls'

const nodeTypes = {
  text: TextNode,
  script: ScriptNode,
  image: ImageNode,
  imageCompare: ImageCompareNode,
  video: VideoNode,
  audio: AudioNode,
  panorama: PanoramaNode,
  ghost: GhostNode,
  group: GroupNode,
}

/** 默认贝塞尔边：丝缕双层描边（见 SilkBezierEdge、App.css 变量） */
const edgeTypes = { default: SilkBezierEdge }

/** 与 `createStudioNode` 默认 height 一致；拖入多文件时竖排，节点底到下一节点顶 20px */
const FLOWID_CANVAS_DROP_STACK_H = 340
const FLOWID_CANVAS_DROP_STACK_GAP_Y = 20
const FLOWID_CANVAS_DROP_STACK_STEP_Y = FLOWID_CANVAS_DROP_STACK_H + FLOWID_CANVAS_DROP_STACK_GAP_Y

/** 底部参考条：有常见图片后缀才用 `<img>`，否则走「音」块（多路参考音频多为 blob）。 */
function refChipUseImagePreview(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(String(url || '').trim())
}

type AssistantAvatarState = keyof typeof AI_ASSISTANT_AVATAR_MEDIA_URLS
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
  const lower = String(rawEndpoint || '').trim().toLowerCase()
  return (
    lower.includes(':7860') ||
    lower.includes('/gradio_api') ||
    lower.includes('indextts')
  )
}

async function readHttpErrorMessage(res: Response): Promise<string> {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase()
  try {
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as any
      const msg = String(json?.error?.message || json?.message || '').trim()
      if (msg) return msg
      return JSON.stringify(json).slice(0, 500)
    }
    const text = await res.text().catch(() => '')
    return String(text || '').trim().slice(0, 500)
  } catch {
    return ''
  }
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
  imageCompare: '图像对比',
  video: '视频',
  audio: '音频',
  music: '音乐',
  panorama: 'VR360全景',
}

/** 底部提示框可切换工作流/模型的节点类型（与 `visiblePromptPanel` 一致，不含剧本）。 */
const BATCH_PROMPT_UNIFY_KINDS = new Set<StudioNodeKind>(['music', 'text', 'image', 'video', 'audio'])

function isBatchPromptUnifyKind(kind: StudioNodeKind): boolean {
  return BATCH_PROMPT_UNIFY_KINDS.has(kind)
}

type BatchWorkflowUnifyRow =
  | { mode: 'cloud'; meta: CloudWorkflowMeta }
  | { mode: 'local'; kind: StudioNodeKind; entry: NodeWorkflowConfig['workflows'][number] }

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
 * 用户重命名等写入 `title` 时：与同画布其他节点全字面前提下去重；
 * 冲突时在末尾追加 `(1)`、`(2)`…（与新建/粘贴用的 `allocateUniqueNodeTitle` 尾号规则区分）。
 */
function allocateUniqueCanvasTitleAmongPeers(desired: string, peerTitles: Iterable<string>): string {
  const base = String(desired ?? '').trim() || '节点'
  const taken = new Set<string>()
  for (const t of peerTitles) {
    const s = String(t ?? '').trim()
    if (s) taken.add(s)
  }
  if (!taken.has(base)) return base
  let k = 1
  for (;;) {
    const c = `${base}(${k})`
    if (!taken.has(c)) return c
    k += 1
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
function isNumberedKindNodeTitle(kind: 'image' | 'video', title: string): boolean {
  const t = String(title ?? '').trim()
  const prefix = `${NODE_KIND_LABEL[kind]}节点`
  if (!t.startsWith(prefix)) return false
  const rest = t.slice(prefix.length).trim()
  return /^\d+$/.test(rest)
}

function isDefaultStyledImageNodeTitle(title: string): boolean {
  return isNumberedKindNodeTitle('image', title)
}

function isDefaultStyledVideoNodeTitle(title: string): boolean {
  return isNumberedKindNodeTitle('video', title)
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

/**
 * 形如 `图-文字节点3`、`图-剧本节点2`、`图-图片节点1` 等：仍为「类型默认名」的占位标题，
 * 与上游真实标题派生的 `图-xxx` 区分，便于在连线后随上游改名强制对齐。
 */
function isDefaultLinkedVisualNodeTitle(title: string): boolean {
  const t = String(title ?? '').trim()
  const m = t.match(
    /^图[\s\u200b]*(?:[\u002D\u2013\u2014\uFF0D\u2212])[\s\u200b]*(.+)$/u,
  )
  const rest = (m ? m[1] : '').trim()
  if (!rest) return false
  for (const kind of Object.keys(NODE_KIND_LABEL) as StudioNodeKind[]) {
    const prefix = `${NODE_KIND_LABEL[kind]}节点`
    if (!rest.startsWith(prefix)) continue
    const suffix = rest.slice(prefix.length).trim()
    if (/^\d+$/.test(suffix)) return true
  }
  return false
}

/**
 * 图/视频节点与上游文字/剧本的连线：优先「文 → 图」（source 为文本），兼容反向拖拽（source 为图）。
 */
function findUpstreamTextAnchorForVisual(
  visualId: string,
  nodeList: Array<Node<StudioNodeData>>,
  edgeList: Edge[],
): Node<StudioNodeData> | null {
  for (const e of edgeList) {
    if (e.target !== visualId) continue
    const n = nodeList.find((x) => x.id === e.source)
    if (n?.data?.kind === 'text' || n?.data?.kind === 'script') {
      return n as Node<StudioNodeData>
    }
  }
  for (const e of edgeList) {
    if (e.source !== visualId) continue
    const n = nodeList.find((x) => x.id === e.target)
    if (n?.data?.kind === 'text' || n?.data?.kind === 'script') {
      return n as Node<StudioNodeData>
    }
  }
  return null
}

/** 文本节点「符号拆分」支持的分段标记（与底部下拉一致） */
type TextSymbolSplitDelimiter = '###' | '///'

/**
 * 按选定分隔符拆分文本为多段。
 * - 分隔符可单独成行，也可出现在行内；连续分隔符会产生空段，已 trim 后过滤；
 * - 每段标题默认「段落N」。
 */
function splitTextByDelimiter(
  raw: string,
  delimiter: TextSymbolSplitDelimiter,
): Array<{ title: string; body: string }> {
  const text = String(raw || '').replace(/\r\n?/g, '\n')
  const chunks = text
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean)
  return chunks.map((body, idx) => ({ title: `段落${idx + 1}`, body }))
}

/** 框选键：仅 Shift / Alt（Ctrl、Cmd 留给 React Flow「追加多选」） */
function normalizeMarqueeSelectionKey(binding: string | undefined): 'Shift' | 'Alt' {
  const k = String(binding || 'Shift').trim()
  return k === 'Alt' ? 'Alt' : 'Shift'
}

function nativeHasMarqueeModifier(native: MouseEvent, key: 'Shift' | 'Alt'): boolean {
  if (key === 'Alt') return Boolean(native.altKey)
  return Boolean(native.shiftKey)
}

/**
 * 按目标节点类型构造“引用继承”补丁：写入 `@[标题](上游节点id)`，绑定具体节点而非标题猜测。
 */
/** 解析旧版「单框 + ---PROMPT2---」存盘，仅用于一次性迁移到四路字段。 */
function splitVideoRawPromptText(raw: string): {
  prompt: string
  prompt2: string
  prompt3: string
  prompt4: string
} {
  const MARK2 = '\n---PROMPT2---\n'
  const MARK3 = '\n---PROMPT3---\n'
  const MARK4 = '\n---PROMPT4---\n'
  const t = String(raw ?? '').replace(/\r\n?/g, '\n')
  if (!t.includes('---PROMPT2---')) {
    return { prompt: t, prompt2: '', prompt3: '', prompt4: '' }
  }
  const i2 = t.indexOf(MARK2)
  if (i2 < 0) return { prompt: t, prompt2: '', prompt3: '', prompt4: '' }
  const p1 = t.slice(0, i2)
  let rest = t.slice(i2 + MARK2.length)
  const i3 = rest.indexOf(MARK3)
  if (i3 < 0) {
    return { prompt: p1, prompt2: rest, prompt3: '', prompt4: '' }
  }
  const p2 = rest.slice(0, i3)
  rest = rest.slice(i3 + MARK3.length)
  const i4 = rest.indexOf(MARK4)
  if (i4 < 0) {
    return { prompt: p1, prompt2: p2, prompt3: rest, prompt4: '' }
  }
  const p3 = rest.slice(0, i4)
  const p4 = rest.slice(i4 + MARK4.length)
  return { prompt: p1, prompt2: p2, prompt3: p3, prompt4: p4 }
}

/** 底部单框内拼接多段（PUA）；执行仍按字段映射到 `__PROMPT__` / `__PROMPTn__`。 */
const VIDEO_PROMPT_PANEL_SEP = '\uE000'

function getVideoPromptSlotsFromData(vd: VideoNodeData): string[] {
  return [
    String(vd.prompt ?? ''),
    String(vd.prompt2 ?? ''),
    String(vd.prompt3 ?? ''),
    String(vd.prompt4 ?? ''),
    ...(Array.isArray(vd.extraPrompts) ? vd.extraPrompts.map((s) => String(s ?? '')) : []),
  ]
}

function packVideoPromptPanelValue(vd: VideoNodeData): string {
  const slots = getVideoPromptSlotsFromData(vd)
  let last = -1
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (String(slots[i] ?? '').trim()) {
      last = i
      break
    }
  }
  if (last < 0) return ''
  return slots.slice(0, last + 1).join(VIDEO_PROMPT_PANEL_SEP)
}

function unpackVideoPromptPanelValue(raw: string): {
  prompt: string
  prompt2: string
  prompt3: string
  prompt4: string
  extraPrompts: string[] | undefined
} {
  if (!raw.includes(VIDEO_PROMPT_PANEL_SEP)) {
    return { prompt: raw, prompt2: '', prompt3: '', prompt4: '', extraPrompts: undefined }
  }
  const parts = raw.split(VIDEO_PROMPT_PANEL_SEP)
  const tail = parts.slice(4)
  const extraPrompts = tail.some((t) => String(t).trim()) ? tail : undefined
  return {
    prompt: parts[0] ?? '',
    prompt2: parts[1] ?? '',
    prompt3: parts[2] ?? '',
    prompt4: parts[3] ?? '',
    extraPrompts,
  }
}

/** 执行诊断等：各槽非空提示词拼接（不含面板专用分隔符）。 */
function joinVideoRawPromptText(vd: VideoNodeData): string {
  return getVideoPromptSlotsFromData(vd)
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}

function buildInheritedPatchForTarget(
  target: StudioNodeData,
  sourceTitle: string,
  sourceNodeId: string,
  options?: { videoTextSlot?: number; sourceKind?: StudioNodeKind | string },
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
  if (target.kind === 'video') {
    const vd = target as VideoNodeData
    const sk = options?.sourceKind
    if (sk === 'text' || sk === 'script') {
      const slot = options?.videoTextSlot ?? 1
      if (slot >= 5) {
        const ei = slot - 5
        const extras = [...(vd.extraPrompts ?? [])]
        while (extras.length <= ei) extras.push('')
        extras[ei] = injectMention(extras[ei])
        return { kind: 'video', extraPrompts: extras }
      }
      if (slot === 2) return { kind: 'video', prompt2: injectMention(vd.prompt2) }
      if (slot === 3) return { kind: 'video', prompt3: injectMention(vd.prompt3) }
      if (slot === 4) return { kind: 'video', prompt4: injectMention(vd.prompt4) }
    }
    return { kind: 'video', prompt: injectMention(vd.prompt) }
  }
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

/**
 * 若文本开头是连续 `@[节点](id)` 行，则按参考图顺序重排这些行。
 * 仅调整“开头引用块”，正文内容保持不变。
 */
function reorderLeadingMentionLinesByReferenceOrder(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId: string,
  referenceOrderUrls: string[],
  edges?: Edge[],
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
  const attachments = listMentionImageAttachments(headBlock, nodes, currentNodeId, edges)
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
  edges?: Edge[],
): Node<StudioNodeData> {
  const data = node.data
  if (data.kind === 'text' || data.kind === 'script') {
    const nextBody = resolveNodeMentionsInText(data.body || '', allNodes, node.id, edges)
    return {
      ...node,
      data: { ...data, body: nextBody } as StudioNodeData,
    }
  }
  if (data.kind === 'image') {
    const referencedImages = collectMentionImageSources(data.prompt || '', allNodes, node.id, edges)
    const nextPrompt = resolveNodeMentionsInText(data.prompt || '', allNodes, node.id, edges)
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
  if (data.kind === 'video') {
    const vd = data as VideoNodeData
    const raw2 = String(vd.prompt2 || '')
    const raw3 = String(vd.prompt3 || '')
    const raw4 = String(vd.prompt4 || '')
    const rawExtras = Array.isArray(vd.extraPrompts) ? vd.extraPrompts.map((s) => String(s ?? '')) : []
    const combinedForRefs = [String(vd.prompt || ''), raw2, raw3, raw4, ...rawExtras]
      .filter(Boolean)
      .join('\n')
    const referencedImages = collectMentionImageSources(combinedForRefs, allNodes, node.id, edges)
    const nextPrompt = resolveNodeMentionsInText(String(vd.prompt || ''), allNodes, node.id, edges)
    const nextPrompt2 = resolveNodeMentionsInText(raw2, allNodes, node.id, edges)
    const nextPrompt3 = resolveNodeMentionsInText(raw3, allNodes, node.id, edges)
    const nextPrompt4 = resolveNodeMentionsInText(raw4, allNodes, node.id, edges)
    const nextExtras = rawExtras.length
      ? rawExtras.map((s) => resolveNodeMentionsInText(s, allNodes, node.id, edges))
      : undefined
    const prevRefs = vd.referenceImageSources?.filter(Boolean) ?? []
    const mergedRefs = Array.from(new Set([...prevRefs, ...referencedImages]))
    const nextSrc =
      String(vd.src || '').trim() ||
      (referencedImages.length > 0 ? referencedImages[0] : '')
    return {
      ...node,
      data: {
        ...vd,
        prompt: nextPrompt,
        prompt2: nextPrompt2,
        prompt3: nextPrompt3,
        prompt4: nextPrompt4,
        ...(nextExtras ? { extraPrompts: nextExtras } : {}),
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
    const ad = data as AudioNodeData
    const referencedImages = collectMentionImageSources(data.note || '', allNodes, node.id, edges)
    const referencedAudioEntries = collectMentionAudioResolvedEntries(
      data.note || '',
      allNodes,
      node.id,
      edges,
    )
    const referencedAudios = referencedAudioEntries.map((e) => e.url)
    const nextNote = resolveNodeMentionsInText(data.note || '', allNodes, node.id, edges)
    const prevRefs = ad.referenceImageSources?.filter(Boolean) ?? []
    const prevIdsRaw = Array.isArray(ad.referenceImageAssetIds) ? ad.referenceImageAssetIds : []
    const mergedUrls: string[] = []
    const mergedIds: string[] = []
    const seenUrl = new Set<string>()
    const pushRefPair = (url: string, assetId: string) => {
      const u = String(url || '').trim()
      const aid = String(assetId || '').trim()
      if (!u) return
      if (seenUrl.has(u)) {
        if (aid) {
          const idx = mergedUrls.indexOf(u)
          if (idx >= 0 && !String(mergedIds[idx] || '').trim()) mergedIds[idx] = aid
        }
        return
      }
      seenUrl.add(u)
      mergedUrls.push(u)
      mergedIds.push(aid)
    }
    for (let i = 0; i < prevRefs.length; i += 1) {
      pushRefPair(prevRefs[i]!, String(prevIdsRaw[i] || '').trim())
    }
    for (const u of referencedImages) pushRefPair(u, '')
    for (const e of referencedAudioEntries) pushRefPair(e.url, e.assetId)

    const hadSrc = Boolean(String(ad.src || '').trim())
    const nextSrc =
      String(ad.src || '').trim() ||
      (referencedAudios.length > 0 ? referencedAudios[0]! : '') ||
      (referencedImages.length > 0 ? referencedImages[0]! : '')
    const nextSrcAssetId = hadSrc
      ? String(ad.srcAssetId || '').trim()
      : referencedAudioEntries.length > 0
        ? String(referencedAudioEntries[0]!.assetId || '').trim()
        : String(ad.srcAssetId || '').trim()

    return {
      ...node,
      data: {
        ...data,
        note: nextNote,
        src: nextSrc,
        srcAssetId: nextSrcAssetId,
        referenceImageSources: mergedUrls,
        referenceImageAssetIds: mergedIds,
      } as StudioNodeData,
    }
  }
  if (data.kind === 'imageCompare') {
    return node
  }
  return node
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

const CANVAS_DAY_MODE_STORAGE_KEY = 'flowid.canvasDayMode'

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
 * 底部「输出条」缩略图：持久化后 blob/Comfy URL 可能失效；优先本地镜像 diskPath，再 IndexedDB。
 */
async function hydrateNodeResultThumbnails(
  items: NodeResultThumbnail[] | undefined,
): Promise<NodeResultThumbnail[] | undefined> {
  if (!items?.length) return items
  const next = await Promise.all(
    items.map(async (t) => {
      const url = String(t.url || '').trim()
      const aid = String(t.assetId || '').trim()
      const disk = String(t.diskPath || '').trim()

      if (disk) {
        const fromDisk = await getDesktopDiskFileObjectUrl(disk)
        if (fromDisk) return { ...t, url: fromDisk }
      }

      const needIdb =
        !url ||
        url.startsWith('blob:') ||
        url.startsWith('/_comfy_local_') ||
        isRemoteOrComfyViewSrc(url)
      if (aid && needIdb) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) return { ...t, url: restored }
      }

      return t
    }),
  )
  const changed = next.some((t, i) => t.url !== items[i]?.url)
  return changed ? next : items
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
      const srcDiskPathRaw = String((normalizedData as StudioNodeData & { srcDiskPath?: string }).srcDiskPath || '').trim()
      const mediaKind =
        data.kind === 'video' ? 'video' : data.kind === 'image' ? 'image' : 'audio'
      const isMediaKindForDisk =
        data.kind === 'image' || data.kind === 'video' || data.kind === 'audio' || data.kind === 'music'

      console.log('[Flowid] hydrateNodesLocalImageAssets: processing node', {
        nodeId: node.id,
        title: data.title,
        kind: data.kind,
        srcAssetId,
        persistedSrc,
        hasSrcDiskPath: Boolean(srcDiskPathRaw),
      })

      /**
       * 预览策略（桌面端）：
       * 1) IndexedDB（srcAssetId）——生成流程会把完整音频拉取后写入；必须先于 srcDiskPath，
       *    否则会误用「上一次镜像」留在输出目录里的短 wav 覆盖新结果。
       * 2) srcDiskPath
       * 3) 按标题+节点 id 扫输出目录
       */
      let recoveredLocal = false
      if (srcAssetId) {
        const wantIdb =
          !persistedSrc ||
          persistedSrc.startsWith('blob:') ||
          persistedSrc.startsWith('/_comfy_local_') ||
          isRemoteOrComfyViewSrc(persistedSrc)
        if (wantIdb) {
          const restored = await getLocalImageAssetObjectUrl(srcAssetId)
          if (restored) {
            nextSrc = restored
            recoveredLocal = true
            console.log('[Flowid] Restored from IndexedDB asset', { nodeId: node.id, srcAssetId })
          }
        }
      }

      if (!recoveredLocal && isMediaKindForDisk && srcDiskPathRaw) {
        const fromSavedPath = await getDesktopDiskFileObjectUrl(srcDiskPathRaw)
        if (fromSavedPath) {
          nextSrc = fromSavedPath
          recoveredLocal = true
          console.log('[Flowid] Restored from srcDiskPath', { nodeId: node.id, srcDiskPathRaw })
        }
      }

      const shouldClearStaleMainAssetId = Boolean(srcAssetId) && isRemoteOrComfyViewSrc(persistedSrc)

      /** 纯新建空节点不应扫输出目录：legacyStem 仅按标题匹配，会误绑到同名旧输出。 */
      const resultThumbs = Array.isArray(normalizedData.resultThumbnails)
        ? normalizedData.resultThumbnails
        : []
      const hasPersistedMediaHint =
        Boolean(persistedSrc) ||
        Boolean(srcAssetId) ||
        Boolean(srcDiskPathRaw) ||
        resultThumbs.length > 0

      const stillNeedOutputScan =
        hasPersistedMediaHint &&
        !recoveredLocal &&
        (!nextSrc ||
          nextSrc.startsWith('/_comfy_local_') ||
          nextSrc.startsWith('blob:') ||
          isRemoteOrComfyViewSrc(nextSrc))
      if (isMediaKindForDisk && stillNeedOutputScan) {
        const titleForMirror = String(data.title || 'output')
        const legacyStem = String(data.title || '').trim() || String(node.id || '').trim()
        console.log('[Flowid] Trying to restore from output dir:', {
          nodeId: node.id,
          titleForMirror,
          legacyStem,
          mediaKind,
        })
        if (legacyStem) {
          const restoredFromOutput = await getDesktopMirroredOutputObjectUrlByNode(
            titleForMirror,
            node.id,
            mediaKind,
            legacyStem,
          )
          if (restoredFromOutput) {
            nextSrc = restoredFromOutput
            console.log('[Flowid] Restored from output scan', { nodeId: node.id })
          }
        }
      }

      const refIds = normalizedData.referenceImageAssetIds ?? []
      const oldRefs = normalizedData.referenceImageSources ?? []
      console.log('[Flowid] Reference images status:', { nodeId: node.id, title: data.title, refIdsLength: refIds.length, oldRefsLength: oldRefs.length, refIds, oldRefs })
      const nextRefs = [...oldRefs]
      const hasStaleBlobUrls = oldRefs.some((ref) => String(ref || '').startsWith('blob:'))
      console.log('[Flowid] Has stale blob URLs:', hasStaleBlobUrls)
      for (let i = 0; i < refIds.length; i += 1) {
        const aid = String(refIds[i] || '').trim()
        if (!aid) continue
        const restored = await getLocalImageAssetObjectUrl(aid)
        console.log('[Flowid] Restoring ref image:', { index: i, assetId: aid, restored: !!restored })
        if (!restored) continue
        nextRefs[i] = restored
      }
      const hydratedThumbs = await hydrateNodeResultThumbnails(normalizedData.resultThumbnails)
      const rawThumbs = normalizedData.resultThumbnails
      const thumbsChanged =
        Array.isArray(hydratedThumbs) &&
        Array.isArray(rawThumbs) &&
        hydratedThumbs.some((t, i) => t.url !== rawThumbs[i]?.url)
      const srcChanged = nextSrc !== persistedSrc
      const refsChanged = nextRefs.some((item, idx) => item !== oldRefs[idx])
      /**
       * 配音/音乐：播放器优先渲染 `resultSources[0]`。hydrate 只改 `src` 时，列表里仍可能是
       * 刷新前已失效的 blob:，表现为 0:00/0:00；须与 `nextSrc` 对齐。
       *
       * 注意：IndexedDB 还原的 `nextSrc` 每次刷新都是**新的** blob: 字符串；若仍把旧 rs 里其它 blob:
       * 全部留在 tail，会「每刷新多一条空音频」且删不完。tail 中仅保留非 blob（http/Comfy view 等）。
       */
      let audioResultSourcesPatch: { resultSources: string[] } | undefined
      if ((data.kind === 'audio' || data.kind === 'music') && nextSrc) {
        const rs = (normalizedData as AudioNodeData).resultSources?.filter(Boolean) ?? []
        const tail = rs.filter((u) => u !== nextSrc)
        const tailWithoutStaleBlobs = tail.filter((u) => !String(u).startsWith('blob:'))
        const nextRs = [nextSrc, ...tailWithoutStaleBlobs]
        const same =
          nextRs.length === rs.length && nextRs.every((u, i) => u === rs[i])
        if (!same) {
          audioResultSourcesPatch = {
            resultSources: nextRs,
          }
        }
      }
      if (
        srcChanged ||
        refsChanged ||
        shouldClearStaleMainAssetId ||
        runtimeChanged ||
        thumbsChanged ||
        audioResultSourcesPatch
      ) {
        mutated = true
        nextNodes.push({
          ...node,
          data: {
            ...normalizedData,
            src: nextSrc,
            ...(audioResultSourcesPatch ?? {}),
            ...(shouldClearStaleMainAssetId ? { srcAssetId: undefined } : {}),
            referenceImageSources: nextRefs,
            ...(thumbsChanged ? { resultThumbnails: hydratedThumbs } : {}),
          } as StudioNodeData,
        })
      } else {
        nextNodes.push(node)
      }
      continue
    }
    if (data.kind === 'panorama') {
      const p = normalizedData as PanoramaNodeData
      const srcAid = String(p.srcAssetId || '').trim()
      const persistedSrc = String(p.src || '').trim()
      let nextSrc = persistedSrc
      if (srcAid && !isRemoteOrComfyViewSrc(persistedSrc)) {
        const restored = await getLocalImageAssetObjectUrl(srcAid)
        if (restored) nextSrc = restored
      }
      const srcChanged = nextSrc !== persistedSrc
      if (srcChanged || runtimeChanged) {
        mutated = true
        nextNodes.push({
          ...node,
          data: {
            ...normalizedData,
            ...(srcChanged ? { src: nextSrc } : {}),
          } as StudioNodeData,
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
const MULTI_SELECT_CTX_MENU_EST_H = 320
/** 「新增节点 / 统一工作流」等子卡预估宽度：与 `App.css` 中 `.studio-multi-select-ctx .add-node-card` max-width 对齐 */
const MULTI_SELECT_SYNC_SUBMENU_EST_W = 432
const NODE_APPEND_GAP = 60
/** Ctrl+D 复制副本：新图整体相对选区向下平移，选区底边到新图顶边间距（流坐标 px） */
const DUPLICATE_BELOW_GAP_FLOW = 20
const DEFAULT_NODE_WIDTH = 430
const DEFAULT_NODE_HEIGHT = 340
const PROMPT_PANEL_MIN_ZOOM_PERCENT = 0
const GROUP_PADDING = 24
/**
 * 未指定画布坐标时连续新建：按网格排布，步长≈默认节点宽高 + 间隙，避免大图节点仍挤在同一叠。
 */
const AUTO_NODE_STAGGER_COLS = 3
const AUTO_NODE_STAGGER_DX = DEFAULT_NODE_WIDTH + NODE_APPEND_GAP
const AUTO_NODE_STAGGER_DY = DEFAULT_NODE_HEIGHT + GROUP_PADDING

function countStaggerEligibleNodes(nodes: Array<Node<StudioNodeData>>): number {
  return nodes.filter((n) => n.type !== 'ghost' && n.type !== 'group').length
}

function staggerAutoPlacedPosition(base: XYPosition, staggerIndex: number): XYPosition {
  const col = staggerIndex % AUTO_NODE_STAGGER_COLS
  const row = Math.floor(staggerIndex / AUTO_NODE_STAGGER_COLS)
  return {
    x: base.x + col * AUTO_NODE_STAGGER_DX,
    y: base.y + row * AUTO_NODE_STAGGER_DY,
  }
}

/** Agent 工具：按名称子串 / id 解析节点类型下的 Comfy 工作流条目 */
function resolveWorkflowEntryForKind(
  kind: StudioNodeKind,
  nodeConfigs: Record<StudioNodeKind, NodeWorkflowConfig>,
  nameOrIdHint: string,
): { id: string; name: string } | null {
  const hint = String(nameOrIdHint || '').trim()
  if (!hint) return null
  const list = nodeConfigs[kind]?.workflows ?? []
  if (!list.length) return null
  const low = hint.toLowerCase()
  const byId = list.find((w) => w.id === hint)
  if (byId) return { id: byId.id, name: byId.name }
  const exactName = list.find((w) => (w.name || '').trim().toLowerCase() === low)
  if (exactName) return { id: exactName.id, name: exactName.name }
  const partial = list.find((w) => (w.name || '').toLowerCase().includes(low))
  if (partial) return { id: partial.id, name: partial.name }
  return null
}

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

/** 解析节点 style / measured 上的宽高（支持数字或 `430px` 字符串） */
function parseNodeDim(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/**
 * 读取节点当前尺寸，用于「后接新增 / 拆分落点」等布局。
 * 优先 `style`（含 NodeResizer 写入的宽高），避免 `Number("430px")` 为 NaN 时误用偏大的 `measured` 导致横向甩开。
 */
function getNodeSize(node: Node<StudioNodeData>): { width: number; height: number } {
  const n = node as Node<StudioNodeData>
  const styleW = parseNodeDim(n.style?.width)
  const styleH = parseNodeDim(n.style?.height)
  const measW = parseNodeDim(n.measured?.width)
  const measH = parseNodeDim(n.measured?.height)
  const rootW = parseNodeDim(n.width as unknown)
  const rootH = parseNodeDim(n.height as unknown)
  const width = styleW ?? measW ?? rootW ?? DEFAULT_NODE_WIDTH
  const height = styleH ?? measH ?? rootH ?? DEFAULT_NODE_HEIGHT
  return {
    width: Number.isFinite(width) ? width : DEFAULT_NODE_WIDTH,
    height: Number.isFinite(height) ? height : DEFAULT_NODE_HEIGHT,
  }
}

/**
 * 文本拆分落点用的「源节点右缘」宽度：取 style / measured / root 中**合法正数**的最大值，
 * 避免仅 style 过窄或为 0 时子节点叠在源节点正下方（与源同 x）。
 */
function splitAnchorNodeFlowWidth(node: Node<StudioNodeData>): number {
  const n = node as Node<StudioNodeData>
  const candidates = [
    parseNodeDim(n.style?.width),
    parseNodeDim(n.measured?.width),
    parseNodeDim(n.width as unknown),
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const raw = candidates.length ? Math.max(...candidates) : DEFAULT_NODE_WIDTH
  return Math.max(raw, 280)
}

/**
 * 计算一组节点在画布中的包围盒（基于节点位置和尺寸）。
 */
/** 角度控制浮层与节点边缘的间距（与产品约定 20px） */
const MULTIANGLE_PANEL_NODE_GAP = 20
const MULTIANGLE_PANEL_EST_W = 368
const MULTIANGLE_PANEL_EST_H = 540

/**
 * 将角度控制面板锚定到节点右侧（若右侧空间不足则贴左侧），坐标为 `position:fixed` 视口像素。
 */
function computeMultianglePanelAnchorScreen(nodeId: string): { left: number; top: number } {
  const pad = 8
  let safeId = nodeId
  try {
    safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId
  } catch {
    safeId = nodeId
  }
  const el = document.querySelector(
    `.react-flow__node[data-id="${safeId}"]`,
  ) as HTMLElement | null
  if (!el) {
    return { left: pad, top: pad }
  }
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) {
    return { left: pad, top: pad }
  }
  let left = rect.right + MULTIANGLE_PANEL_NODE_GAP
  let top = rect.top
  if (left + MULTIANGLE_PANEL_EST_W > window.innerWidth - pad) {
    left = rect.left - MULTIANGLE_PANEL_EST_W - MULTIANGLE_PANEL_NODE_GAP
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - MULTIANGLE_PANEL_EST_W - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - MULTIANGLE_PANEL_EST_H - pad))
  return { left, top }
}

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

type PromptPanelDropdownOption = { value: string; label: string; disabled?: boolean }

function PromptPanelDropdown({
  value,
  placeholder,
  options,
  onChange,
  className,
  ariaLabel,
  title,
  renderButtonContent,
  disabled,
  onMainButtonDoubleClick,
}: {
  value?: string
  placeholder: string
  options: PromptPanelDropdownOption[]
  onChange: (value: string) => void
  className: string
  ariaLabel?: string
  title?: string
  /** 仅展示图标等紧凑内容时传入；`title` 未设时会用当前选项文案作悬停说明 */
  renderButtonContent?: (info: { activeLabel: string; value: string | undefined }) => ReactNode
  disabled?: boolean
  /** 双击主按钮（不展开菜单时）：用于例如「工作流示例」快捷入口 */
  onMainButtonDoubleClick?: () => void
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

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const iconTrigger = Boolean(renderButtonContent)
  const buttonTitle = title ?? (iconTrigger ? activeLabel : undefined)
  const buttonAriaLabel = iconTrigger
    ? [ariaLabel ?? placeholder, activeLabel].filter(Boolean).join('：')
    : ariaLabel

  return (
    <div
      ref={rootRef}
      className={`pp-select${iconTrigger ? ' pp-select--iconTrigger' : ''}${disabled ? ' pp-select--disabled' : ''}`}
      data-open={open ? '1' : '0'}
    >
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={buttonAriaLabel}
        title={buttonTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
        }}
        onDoubleClick={(e) => {
          if (!onMainButtonDoubleClick || disabled) return
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          onMainButtonDoubleClick()
        }}
      >
        {iconTrigger ? renderButtonContent!({ activeLabel, value }) : activeLabel}
      </button>
      {open && !disabled ? (
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

/** 音乐微调弹窗：与 `PromptPanelDropdown` / `.pp-select` 深色菜单一致（避免原生 select 系统浅色弹层） */
const MUSIC_FINE_TUNE_DURATION_DROPDOWN_OPTIONS: PromptPanelDropdownOption[] =
  MUSIC_DURATION_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分钟` }))
const MUSIC_FINE_TUNE_TS_DROPDOWN_OPTIONS: PromptPanelDropdownOption[] = MUSIC_TIMESIGNATURE_OPTIONS.map((t) => ({
  value: t,
  label: t,
}))
const MUSIC_FINE_TUNE_LANG_DROPDOWN_OPTIONS: PromptPanelDropdownOption[] = MUSIC_LANGUAGE_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}))
const MUSIC_FINE_TUNE_KEY_DROPDOWN_OPTIONS: PromptPanelDropdownOption[] = MUSIC_KEYSCALE_OPTIONS.map((k) => ({
  value: k,
  label: k,
}))

const CLOUD_IMAGE_RESOLUTION_PANEL_OPTIONS: PromptPanelDropdownOption[] = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
]

/** 比例/画幅：四角取景框（与常见「尺寸」示意一致） */
function CloudAspectGlyph() {
  return <Frame size={18} strokeWidth={2.15} className="studio-music-prompt-panel__cloudPickSvg" aria-hidden />
}

/** 分辨率：侧方镜头机身（与常见「相机/清晰度」示意一致）；2K 略加粗并强调色 */
function CloudResolutionGlyph({ tier }: { tier: CloudImageResolutionTier }) {
  return (
    <Camera
      size={18}
      strokeWidth={tier === '2k' ? 2.4 : 2.1}
      className={`studio-music-prompt-panel__cloudPickSvg${tier === '2k' ? ' studio-music-prompt-panel__cloudPickSvg--emph' : ''}`}
      aria-hidden
    />
  )
}

/**
 * TD「槽位与台本角色名」：草稿只在子树内 setState，避免每键触发 StudioCanvasInner 全量重绘与防抖写节点导致的闪屏。
 */
const StudioTdRefRoleModalPortal = memo(function StudioTdRefRoleModalPortal(props: {
  slotLabels: string[]
  seedRows: Array<{ roleName: string }>
  left: number
  top: number
  width: number
  onCommit: (rows: ComfyTdRefAudioRoleRow[]) => void
  /** 供父组件在强制关窗（如切换选中节点）时仍能落盘当前输入 */
  persistRef?: MutableRefObject<(() => ComfyTdRefAudioRoleRow[]) | null>
}) {
  const { slotLabels, seedRows, left, top, width, onCommit, persistRef } = props
  const [draft, setDraft] = useState<Array<{ roleName: string }>>(() =>
    slotLabels.map((_, i) => ({
      roleName: String(seedRows[i]?.roleName ?? ''),
    })),
  )

  useEffect(() => {
    if (!persistRef) return
    persistRef.current = () =>
      draft.map((r) => ({
        roleName: String(r.roleName ?? ''),
      }))
    return () => {
      persistRef.current = null
    }
  }, [draft, persistRef])

  const handleSaveOrExit = () => {
    onCommit(
      draft.map((r) => ({
        roleName: String(r.roleName ?? ''),
      })),
    )
  }

  return createPortal(
    <div
      className="studio-vt8-modal-shell nodrag nopan"
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: 'min(560px, 70vh)',
        zIndex: 12200,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="studio-vt8-modal">
        <div className="studio-vt8-modal__top">
          <span className="studio-vt8-modal__title">槽位与台本角色名</span>
          <div className="studio-vt8-modal__toolbar">
            <button
              type="button"
              className="studio-vt8-modal__toolbtn studio-vt8-modal__toolbtn--primary"
              onClick={handleSaveOrExit}
            >
              保存
            </button>
            <button
              type="button"
              className="studio-vt8-modal__toolbtn"
              onClick={() => {
                setDraft(slotLabels.map(() => ({ roleName: '' })))
              }}
            >
              清空
            </button>
            <button type="button" className="studio-vt8-modal__toolbtn" onClick={handleSaveOrExit}>
              退出
            </button>
          </div>
        </div>
        <div className="studio-vt8-modal__body">
          <div className="studio-vt8-modal__scroll">
            <div className="studio-vt8-modal__th studio-vt8-modal__th--td-ref" aria-hidden>
              <span>上传顺序 · 音源</span>
              <span>对应姓名（台本角色名）</span>
            </div>
            {slotLabels.map((slotLabel, rowIdx) => (
              <div
                key={`td-ref-${rowIdx}-${slotLabel}`}
                className="studio-vt8-modal__tr studio-vt8-modal__tr--td-ref"
              >
                <div className="studio-vt8-modal__cell" title="与执行时上传顺序一致">
                  {slotLabel.trim() ? (
                    slotLabel
                  ) : (
                    <span className="studio-vt8-modal__placeholder">—</span>
                  )}
                </div>
                <input
                  type="text"
                  className="studio-vt8-modal__field"
                  aria-label={`第 ${rowIdx + 1} 路音频对应角色名`}
                  value={String(draft[rowIdx]?.roleName ?? '')}
                  placeholder="与台本「角色名:」一致"
                  onChange={(e) => {
                    const v = e.target.value
                    setDraft((prev) => {
                      const next = prev.slice()
                      while (next.length <= rowIdx) next.push({ roleName: '' })
                      next[rowIdx] = { roleName: v }
                      return next
                    })
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
})

/**
 * 仅节点 / 连线 id 集合，用于判断是否为「纯位移」拖拽。
 * `nodeCanvasDragActiveRef` 为 true 时仍要在加删节点后写入撤销栈，否则 Ctrl+Z 无条目可退。
 */
function canvasSnapshotTopologyKey(snapshot: Omit<ProjectSnapshot, 'version' | 'name'>): string {
  const nk = snapshot.nodes
    .map((n) => n.id)
    .sort()
    .join('\0')
  const ek = snapshot.edges
    .map((e) => e.id)
    .sort()
    .join('\0')
  return `${nk}\n${ek}`
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
  const projectTabsRef = useRef(projectTabs)
  const activeProjectIdRef = useRef(activeProjectId)
  useEffect(() => {
    projectTabsRef.current = projectTabs
  }, [projectTabs])
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [nodes, setNodes] = useNodesState(loaded.nodes)
  /** 执行时读取最新画布节点，避免下拉刚改工作流仍拿到旧闭包里的 `nodes` */
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  /** 尽早拉取主敏感词库，缩短仅用内置小表的窗口（与异步发送处的 await 配合）。 */
  useEffect(() => {
    ensureLexiconLoading()
  }, [])

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
          const r1 = rewrite(d.prompt)
          const r2 = rewrite(String(d.prompt2 || ''))
          const r3 = rewrite(String(d.prompt3 || ''))
          const r4 = rewrite(String(d.prompt4 || ''))
          if (!r1.changed && !r2.changed && !r3.changed && !r4.changed) return node
          changed = true
          return {
            ...node,
            data: {
              ...d,
              prompt: r1.text,
              prompt2: r2.text,
              prompt3: r3.text,
              prompt4: r4.text,
            } as any,
          }
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
  const edgesRef = useRef(edges)
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  /**
   * 占位图/视频标题随上游「可派生标题」对齐：在打开工程、改上游标题、改连线后都能收敛，
   * 不依赖用户再提交一次标题编辑。
   */
  const linkedVisualTitleSyncKey = useMemo(() => {
    const edgePart = edges
      .map((e) => `${e.source}>${e.target}`)
      .sort()
      .join(',')
    const titlePart = nodes
      .map((n) => {
        const k = n.data.kind
        if (k === 'text' || k === 'script' || k === 'image' || k === 'video') {
          return `${n.id}:${k}:${String(n.data.title ?? '').trim()}`
        }
        return ''
      })
      .filter(Boolean)
      .sort()
      .join('|')
    return `${edgePart}::${titlePart}`
  }, [edges, nodes])

  useEffect(() => {
    setNodes((prev) => {
      const proposed = new Map<string, string>()
      for (const n of prev) {
        if (n.data.kind !== 'image' && n.data.kind !== 'video') continue
        const anchor = findUpstreamTextAnchorForVisual(n.id, prev, edges)
        if (!anchor) continue
        const ct = String(n.data.title ?? '').trim()
        const derived = buildImageLinkedNewNodeBaseTitle(
          anchor as Node<StudioNodeData>,
        )
        if (!derived || ct === derived) continue
        const syncPlaceholder = isDefaultLinkedVisualNodeTitle(ct)
        const syncPlainDefault =
          (n.data.kind === 'image' && isDefaultStyledImageNodeTitle(ct)) ||
          (n.data.kind === 'video' && isDefaultStyledVideoNodeTitle(ct))
        if (!syncPlaceholder && !syncPlainDefault) continue
        proposed.set(n.id, derived)
      }
      if (proposed.size === 0) return prev

      const allocated = new Set(
        prev.map((x) => String(x.data.title ?? '').trim()).filter(Boolean),
      )
      for (const id of proposed.keys()) {
        const cur = String(prev.find((x) => x.id === id)?.data.title ?? '').trim()
        if (cur) allocated.delete(cur)
      }

      const finalById = new Map<string, string>()
      for (const [id, base] of proposed) {
        finalById.set(id, allocateUniqueNodeTitle(allocated, base))
      }

      let changed = false
      const next = prev.map((n) => {
        const nextTitle = finalById.get(n.id)
        if (!nextTitle) return n
        if (String(n.data.title ?? '').trim() === nextTitle) return n
        changed = true
        return {
          ...n,
          data: { ...n.data, title: nextTitle } as StudioNodeData,
        }
      })
      return changed ? next : prev
    })
  }, [linkedVisualTitleSyncKey, setNodes, edges])

  const [viewportVersion, setViewportVersion] = useState(0)
  /** 节点拖动结束后递增，配合 `nodeCanvasDragActiveRef` 在撤销栈中合并为一步 */
  const [postDragUndoTick, setPostDragUndoTick] = useState(0)
  const [leftPanel, setLeftPanel] = useState<LeftPanelType>(null)
  /** 由首页顶栏等调用 openStudioSettingsDeviceActivation 时切到侧栏「授权码」 */
  const [settingsFocusTab, setSettingsFocusTab] = useState<SettingsTab | null>(null)
  const clearSettingsFocusTab = useCallback(() => {
    setSettingsFocusTab(null)
  }, [])
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('system-prompts')
  const [aiAssistantDialogOpen, setAiAssistantDialogOpen] = useState(false)
  /** 全屏 AI 工作台（与旧版浮动 AiAssistantPanel 并存；双击虚拟人打开） */
  const [agentFloatingOpen, setAgentFloatingOpen] = useState(false)
  /** 全屏工作台内 invoke 聊天进行中，用于虚拟人「思考」态 */
  const [agentWorkspaceSending, setAgentWorkspaceSending] = useState(false)
  const [aiMessages, setAiMessages] = useState<AiAssistantMessage[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [chatModelTestStatus, setChatModelTestStatus] = useState('')
  const [ttsTestStatus, setTtsTestStatus] = useState('')
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
  const openLocalProjectFromFilePicker = useCallback(async () => {
    const desk = (window as any).flowidDesktop as
      | {
          pickJsonFile?: (opts?: { defaultPath?: string }) => Promise<{
            ok: boolean
            canceled?: boolean
            path?: string
            error?: string
          }>
          readUtf8File?: (filePath: string) => Promise<{ ok: boolean; text?: string; error?: string }>
        }
      | undefined

    if (!desk?.pickJsonFile || !desk?.readUtf8File) {
      window.alert('当前桌面端能力异常：无法选择或导入工程 JSON。请重启桌面端后再试。')
      return
    }

    const prev = String(loadLocalDiskPathsSettings().flowidProjectJsonPath || '').trim()
    const pickedFile = await desk.pickJsonFile({ defaultPath: prev || undefined })
    if (!pickedFile.ok) {
      window.alert(pickedFile.error || '选择工程 JSON 失败')
      return
    }
    if (pickedFile.canceled || !pickedFile.path) return
    const fp = String(pickedFile.path || '').trim()
    if (!fp) return

    const inferredDir = fp.replace(/[\\/][^\\/]+$/, '')
    if (inferredDir && inferredDir !== prev) {
      saveLocalDiskPathsSettings({ flowidProjectJsonPath: inferredDir })
    }

    const read = await desk.readUtf8File(fp)
    if (!read.ok || !read.text) {
      window.alert(read.error || '读取工程 JSON 失败')
      return
    }
    const snap = parseProjectFile(String(read.text || ''))
    openImportedProjectInNewTab(snap)
  }, [openImportedProjectInNewTab])

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
    /** 双击画布时的流坐标；与 pending ref 分离，避免 mousedown 先关菜单时 ref 被清空导致节点落到「窗口中心 + 网格偏移」。 */
    flowPosition: XYPosition
  } | null>(null)
  const [connectAddMenu, setConnectAddMenu] = useState<{
    left: number
    top: number
    flowPosition: XYPosition
  } | null>(null)
  /** 节点右键菜单：复制、粘贴、（多选）编组、执行/全部执行、新增节点、删除（单选隐藏编组；删除始终在最下） */
  const [multiSelectContextMenu, setMultiSelectContextMenu] = useState<{
    left: number
    top: number
    submenuMode: 'linked' | 'common' | 'batchUnified' | 'batchWorkflow' | 'batchModel' | null
    /** true：子菜单在主菜单右侧；false：子菜单在主菜单左侧（贴边自适应） */
    preferSubmenuRight: boolean
  } | null>(null)
  /** 右键「角度控制」：单选图片/视频时打开 Multiangle 浮层（位置随节点与视口变化，距节点 20px） */
  const [multianglePanel, setMultianglePanel] = useState<{ nodeId: string } | null>(null)
  /** 窗口 resize 时递增，驱动角度面板锚点 `useMemo` 重算 */
  const [multiangleLayoutBump, setMultiangleLayoutBump] = useState(0)
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
    refreshOfficialTemplates,
    testProviderConnection,
    runNodeWorkflow,
    workflowSnapshot,
  } = useWorkflowIntegration()

  /** 辅助线路 Key / 测试状态变化时递增，驱动节点模型下拉与绑定清理 */
  const [assistModelGateBump, setAssistModelGateBump] = useState(0)

  const updateNodeConfigAndSyncCloudKeys = useCallback(
    (kind: StudioNodeKind, patch: Partial<NodeWorkflowConfig>) => {
      if ('cloudApiKey' in patch && !String(patch.cloudApiKey ?? '').trim()) {
        setNodes((nds) => stripCloudApiKeyFromAllStudioNodes(nds))
      }
      updateNodeConfig(kind, patch)
    },
    [updateNodeConfig, setNodes],
  )

  /** 自助预设里已无任何非空 Key，或用户删掉最后一条预设时，去掉节点上缓存的 cloudApiKey */
  useEffect(() => {
    const syncOnSelfPresets = () => {
      const presets = loadCloudSelfPresets()
      const anyKey = presets.some((p) => String(p.apiKey || '').trim())
      if (anyKey) return
      setNodes((nds) => stripCloudApiKeyFromAllStudioNodes(nds))
    }
    syncOnSelfPresets()
    window.addEventListener('flowid:cloud-self-presets-changed', syncOnSelfPresets)
    return () => window.removeEventListener('flowid:cloud-self-presets-changed', syncOnSelfPresets)
  }, [setNodes])

  /** 辅助线路 Key 变更 / 测试状态变更：删 Key 时清该类节点的 Assist 绑定；任意 Key 变化 bump 以刷新下拉与兜底清理 */
  useEffect(() => {
    const bump = () => setAssistModelGateBump((x) => x + 1)
    const onAssistKeys = (ev: Event) => {
      const ce = ev as CustomEvent<CloudAssistKeysChangedDetail>
      const cleared = ce.detail?.clearedAssistKinds ?? []
      if (cleared.length) {
        setNodes((nds) => clearAssistModelBindingForAssistKinds(nds, cleared))
      }
      bump()
    }
    window.addEventListener('flowid:cloud-assist-keys-changed', onAssistKeys as EventListener)
    window.addEventListener('flowid:assist-line-verified-changed', bump)
    return () => {
      window.removeEventListener('flowid:cloud-assist-keys-changed', onAssistKeys as EventListener)
      window.removeEventListener('flowid:assist-line-verified-changed', bump)
    }
  }, [setNodes])

  /** 未通过测试或未填 Key 时，去掉仍挂在节点上的辅助线路选型，避免执行用到旧状态 */
  useEffect(() => {
    const verified = readAssistLineVerified()
    setNodes((nds) => {
      let changed = false
      const next = nds.map((n) => {
        const ak = studioNodeKindToAssistKind(n.data.kind)
        if (!ak) return n
        const pick = String((n.data as { cloudAssistModelPick?: string }).cloudAssistModelPick || '').trim()
        if (!pick || !tryDecodeCloudAssistModelPick(pick)) return n
        const keyOk = String(getAssistApiKey(ak) || '').trim()
        const lineOk = verified[ak]
        if (keyOk && lineOk) return n
        changed = true
        return {
          ...n,
          data: {
            ...n.data,
            cloudAssistModelPick: undefined,
            cloudModelName: '',
            cloudModelUrl: '',
            cloudApiKey: '',
          } as StudioNodeData,
        }
      })
      return changed ? next : nds
    })
  }, [assistModelGateBump, setNodes])

  const marqueeSelectionKeyCode = useMemo(() => {
    const k = normalizeMarqueeSelectionKey(shortcuts.bindings.marqueeSelect)
    return [k] as Array<'Shift' | 'Alt'>
  }, [shortcuts.bindings.marqueeSelect])
  const {
    assets,
    historyItems,
    appendHistory,
    appendCloudTaskRecord,
    onUploadFiles,
    removeAsset,
    renameAsset,
    importNodeMediaToLibrary,
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
  /** 积分预扣任务失败且已自动退还时的全局提示（仅保留最新一条） */
  const [pointsTaskFailToast, setPointsTaskFailToast] = useState<PointsTaskFailureToastState | null>(null)
  const pointsTaskFailToastSeqRef = useRef(0)
  const pointsTaskFailToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const { screenToFlowPosition, fitView, getViewport, setViewport, zoomIn, zoomOut, getZoom, getNodes } =
    useReactFlow()
  const rfStore = useStoreApi()
  const reactFlowRootRef = useRef<HTMLDivElement | null>(null)
  const viewport = useViewport()
  /** 覆盖框选命中后，避免 setNodes 触发 selectionChange 递归循环 */
  const selectionOverrideInFlightRef = useRef(false)
  /** 仅在为 true 时用 userSelectionRect 覆盖选中；松手后须为 false，否则 Ctrl+点无法从多选里取消单个节点 */
  const isMarqueeGestureActiveRef = useRef(false)

  useEffect(() => {
    return subscribePointsTaskFailure((detail) => {
      pointsTaskFailToastSeqRef.current += 1
      const seq = pointsTaskFailToastSeqRef.current
      if (pointsTaskFailToastTimerRef.current) {
        clearTimeout(pointsTaskFailToastTimerRef.current)
        pointsTaskFailToastTimerRef.current = null
      }
      setPointsTaskFailToast({
        id: seq,
        message: detail.message,
        errorFull: detail.errorFull,
      })
      pointsTaskFailToastTimerRef.current = setTimeout(() => {
        setPointsTaskFailToast((cur) => (cur && cur.id === seq ? null : cur))
        pointsTaskFailToastTimerRef.current = null
      }, 10000)
    })
  }, [])

  const selectedNodeQuoteSourceKey = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedNodeId)
    if (!n) return ''
    const d = n.data as StudioNodeData
    const k = d.kind
    const cfg = k !== 'group' ? nodeConfigs[k] : undefined
    return JSON.stringify({
      kind: k,
      wf: d.workflowEntryId,
      ppm: d.promptPickerMode,
      cm: d.cloudModelName,
      cu: d.cloudModelUrl,
      cap: (d as { cloudAssistModelPick?: string }).cloudAssistModelPick,
      mdl: 'model' in d ? (d as { model?: string }).model : undefined,
      cfgSwf: cfg?.selectedWorkflowId,
      cfgWfs: (cfg?.workflows ?? []).map((w: { id: string; name: string }) => `${w.id}\t${w.name}`).join('|'),
      cfgCloud: `${String(cfg?.cloudModelName || '')}\t${String(cfg?.cloudModelUrl || '')}`,
      sv: {
        em: workflowSnapshot.executionMode,
        ep: workflowSnapshot.executionProvider,
        le: workflowSnapshot.local.enabled,
        ce: workflowSnapshot.cloud.enabled,
        rr: workflowSnapshot.randomizeKsamplerSeedsOnRun,
      },
    })
  }, [nodes, selectedNodeId, nodeConfigs, workflowSnapshot])

  /**
   * 选中节点变化或工作流/模型变化时，拉取与预扣一致的积分预估，写入节点 `pointsReserveHint`（底部提示框等使用，不在节点角标展示）。
   * 仅云端 ComfyUI 工作流会请求 /quote；本地 Comfy 无积分预扣，不请求并清空提示。
   */
  useEffect(() => {
    const clearAllHints = () => {
      setNodes((nds) => {
        let changed = false
        const next = nds.map((n) => {
          if ((n.data as { pointsReserveHint?: number }).pointsReserveHint != null) {
            changed = true
            return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
          }
          return n
        })
        return changed ? next : nds
      })
    }

    if (!selectedNodeId) {
      clearAllHints()
      return
    }

    const lic = loadLicenseSnapshotV2()
    const lc = String(lic?.licenseCode || '').trim()
    const mc = String(lic?.machineId || '').trim()
    if (!lc || !mc) {
      clearAllHints()
      return
    }

    const node = getNodes().find((x) => x.id === selectedNodeId) as Node<StudioNodeData> | undefined
    const kind = node?.data?.kind
    if (!node || kind === 'group' || kind === 'panorama' || kind === 'imageCompare') {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n
          if ((n.data as { pointsReserveHint?: number }).pointsReserveHint == null) return n
          return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
        }),
      )
      return
    }

    setNodes((nds) => {
      let changed = false
      const next = nds.map((n) => {
        if (n.id === selectedNodeId) return n
        if ((n.data as { pointsReserveHint?: number }).pointsReserveHint != null) {
          changed = true
          return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
        }
        return n
      })
      return changed ? next : nds
    })

    let params: ReturnType<typeof buildPointsReserveParams>
    try {
      params = buildPointsReserveParams(node, workflowSnapshot, {})
    } catch {
      return
    }

    /** 云端 OpenAI 兼容「模型」模式不计积分，与预扣接口一致不在此请求 quote */
    if (params.executionTarget === 'model') {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n
          if ((n.data as { pointsReserveHint?: number }).pointsReserveHint == null) return n
          return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
        }),
      )
      return
    }

    /** 本地 ComfyUI 工作流不参与积分预扣，/quote 亦无意义（避免底部出现「积分 0」） */
    if (executionProvider !== 'cloud') {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n
          if ((n.data as { pointsReserveHint?: number }).pointsReserveHint == null) return n
          return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
        }),
      )
      return
    }

    let cancelled = false
    void apiPointsQuote({
      licenseCode: lc,
      machineCode: mc,
      nodeKind: params.nodeKind,
      executionTarget: params.executionTarget,
      metadata: params.metadata,
    }).then((r) => {
      if (cancelled) return
      if (!r.success || typeof r.points !== 'number') {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== selectedNodeId) return n
            if ((n.data as { pointsReserveHint?: number }).pointsReserveHint == null) return n
            return { ...n, data: { ...n.data, pointsReserveHint: undefined } }
          }),
        )
        return
      }
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n
          if ((n.data as { pointsReserveHint?: number }).pointsReserveHint === r.points) return n
          return { ...n, data: { ...n.data, pointsReserveHint: r.points } }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [executionProvider, selectedNodeId, selectedNodeQuoteSourceKey, workflowSnapshot, getNodes, setNodes])

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
  const [canvasDayMode, setCanvasDayMode] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(CANVAS_DAY_MODE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(CANVAS_DAY_MODE_STORAGE_KEY, canvasDayMode ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [canvasDayMode])

  /** 右键/分组菜单通过 portal 挂到 body，用 html 标记供全局 CSS 命中日间样式 */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (canvasDayMode) {
      root.setAttribute('data-flowid-canvas-day', '1')
    } else {
      root.removeAttribute('data-flowid-canvas-day')
    }
    return () => {
      root.removeAttribute('data-flowid-canvas-day')
    }
  }, [canvasDayMode])

  /** 深色画布：连线颜色/线宽见 App.css（xyflow 变量 + 光晕），避免内联 stroke 盖住选中高亮 */
  /** 深色：主线色见 `.react-flow.dark`；日间：见 `.studio-flow-wrap--canvas-day` 的 xyflow 变量 */
  const flowDefaultEdgeOptions = useMemo(() => ({ animated: true as const }), [])

  const minimapNodeColor = useCallback(
    (node: Node<StudioNodeData>) => {
      if (node.selected) {
        return canvasDayMode ? '#262626' : '#b6becd'
      }
      return canvasDayMode ? '#525252' : '#6f7786'
    },
    [canvasDayMode],
  )

  /** 底部提示框是否放大布局（参考外部产品的大输入区）。 */
  const [promptPanelExpanded, setPromptPanelExpanded] = useState(false)
  /** 当前 Comfy 工作流是否含对应占位符，用于展示比例/风格行 */
  const [promptPanelComfyWorkflowOpts, setPromptPanelComfyWorkflowOpts] = useState<{
    size: boolean
    style: boolean
  }>({ size: false, style: false })
  /** 文本 Comfy 模板是否含 __SYSTEM_PROMPT__，用于侧栏展示系统提示词编辑区 */
  const [promptPanelTextSystemPromptSlot, setPromptPanelTextSystemPromptSlot] = useState(false)
  const [textPanelSystemPromptDraft, setTextPanelSystemPromptDraft] = useState('')
  /** 当前 Comfy 工作流关联的「我的示例工程」弹层 */
  const [cloudWorkflowExampleModalOpen, setCloudWorkflowExampleModalOpen] = useState(false)
  const [cloudWorkflowExampleListTick, setCloudWorkflowExampleListTick] = useState(0)
  const [cloudWorkflowExampleModalEntries, setCloudWorkflowExampleModalEntries] = useState<
    CloudWorkflowExampleEntry[]
  >([])
  const promptPanelComfyWorkflowHint = useMemo(() => {
    const parts: string[] = []
    if (promptPanelComfyWorkflowOpts.size) {
      parts.push('含 __WIDTH__/__HEIGHT__ 时可在上方调整输出比例')
    }
    if (promptPanelComfyWorkflowOpts.style) {
      parts.push('含 __STYLE_TONE__ 时可在上方选择风格色调')
    }
    return parts.length ? ` 当前工作流${parts.join('；')}。` : ''
  }, [promptPanelComfyWorkflowOpts])
  /** 8 路 FB 多人无参：侧栏角色/音色表 */
  const [promptPanelVoiceTable8, setPromptPanelVoiceTable8] = useState<{
    show: boolean
    scanned: boolean
  }>({ show: false, scanned: false })
  /** TD 有参多人：「匹配」表仅 @/底部上传 ↔ MultiDialog；不含主预览第 1 路 */
  const [promptPanelTdRefRoleMap, setPromptPanelTdRefRoleMap] = useState<{
    show: boolean
    scanned: boolean
  }>({ show: false, scanned: false })
  /** 「台本信息」弹窗：双击单元格编辑；保存写入节点 */
  const [voiceTable8ModalOpen, setVoiceTable8ModalOpen] = useState(false)
  const [voiceTable8Draft, setVoiceTable8Draft] = useState<ComfyVoiceTableRow[]>([])
  const [voiceTable8Editing, setVoiceTable8Editing] = useState<{
    row: number
    field: 'roleName' | 'sampleLine' | 'voiceInstruct'
  } | null>(null)
  /** 台本信息：批量粘贴 `角色###台词###声音` 解析用 */
  const [voiceTable8BulkPasteDraft, setVoiceTable8BulkPasteDraft] = useState('')
  const voiceTable8DraftRef = useRef<ComfyVoiceTableRow[]>([])
  const voiceTable8ModalTargetIdRef = useRef<string | null>(null)
  const voiceTable8ModalWasOpenRef = useRef(false)
  voiceTable8DraftRef.current = voiceTable8Draft
  const [tdRefRoleModalOpen, setTdRefRoleModalOpen] = useState(false)
  const [tdRefRoleModalKey, setTdRefRoleModalKey] = useState(0)
  const [tdRefRoleModalSeedRows, setTdRefRoleModalSeedRows] = useState<Array<{ roleName: string }>>([])
  const [tdRefRoleSlotLabels, setTdRefRoleSlotLabels] = useState<string[]>([])
  const tdRefRoleModalTargetIdRef = useRef<string | null>(null)
  const tdRefRolePersistRef = useRef<(() => ComfyTdRefAudioRoleRow[]) | null>(null)
  const tdRefRoleModalOpenRef = useRef(false)
  tdRefRoleModalOpenRef.current = tdRefRoleModalOpen
  /** 音乐节点 Comfy 参数「微调」弹窗 */
  const [musicFineTuneModalOpen, setMusicFineTuneModalOpen] = useState(false)
  const [musicFineTuneDraft, setMusicFineTuneDraft] = useState<MusicFineTuneDraft>(DEFAULT_MUSIC_FINE_TUNE_DRAFT)
  const musicFineTuneModalTargetIdRef = useRef<string | null>(null)
  /** 点击「符号拆分」后展开菜单，选择 ### 或 /// 再执行拆分 */
  const [symbolSplitMenuOpen, setSymbolSplitMenuOpen] = useState(false)
  const symbolSplitMenuRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!symbolSplitMenuOpen) return
    const onDown = (event: MouseEvent | TouchEvent) => {
      const el = symbolSplitMenuRootRef.current
      if (!el) return
      if (event.target instanceof Node && el.contains(event.target)) return
      setSymbolSplitMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSymbolSplitMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('touchstart', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('touchstart', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [symbolSplitMenuOpen])
  /** 正在轮询中的云端 taskId，避免重复拉状态。 */
  const cloudTaskPollingIdsRef = useRef(new Set<string>())
  /** 防重复提交：同一节点任务运行中再次点击执行直接拦截。 */
  const promptPanelSubmittingNodeIdsRef = useRef(new Set<string>())
  const [clipboard, setClipboard] = useState<CanvasClipboard | null>(null)
  /** 连续内存粘贴时轻微错位，避免叠在视口正中心完全重合 */
  const internalPasteStaggerRef = useRef(0)
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

  /** 与预扣一致：仅云端 ComfyUI 工作流展示积分预估（本地执行不显示） */
  const promptPanelFootPointsHint = useMemo(() => {
    if (!visiblePromptPanel) return null
    if (executionProvider !== 'cloud') return null
    const fresh = nodes.find((n) => n.id === visiblePromptPanel.node.id)
    const h = fresh ? (fresh.data as { pointsReserveHint?: number }).pointsReserveHint : undefined
    return typeof h === 'number' && Number.isFinite(h) ? h : null
  }, [executionProvider, nodes, visiblePromptPanel])

  const promptPanelMentionImages = useMemo(() => {
    if (!visiblePromptPanel) return []
    const { node, kind } = visiblePromptPanel
    const sortByRefOrder = (items: Array<{ mention: string; url: string }>) => {
      if (!(kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'music')) return items
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
    if (kind === 'image') {
      return sortByRefOrder(
        listMentionImageAttachments(
          (node.data as ImageNodeData).prompt || '',
          nodes,
          node.id,
          edges,
        ),
      )
    }
    if (kind === 'video') {
      const vd = node.data as VideoNodeData
      const combined = getVideoPromptSlotsFromData(vd)
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)
        .join('\n')
      return sortByRefOrder(listMentionImageAttachments(combined, nodes, node.id, edges))
    }
    if (kind === 'audio' || kind === 'music') {
      return sortByRefOrder(
        listMentionImageAttachments((node.data as AudioNodeData).note || '', nodes, node.id, edges),
      )
    }
    if (kind === 'text') {
      return listMentionImageAttachments((node.data as TextNodeData).body || '', nodes, node.id, edges)
    }
    return []
  }, [visiblePromptPanel, nodes, edges])

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

  const [cloudWorkflowMetaList, setCloudWorkflowMetaList] = useState<CloudWorkflowMeta[]>([])
  const [assistCatalog, setAssistCatalog] = useState<CloudAssistCatalog>(() => emptyCloudAssistCatalog())

  useEffect(() => {
    let cancelled = false
    const loadAssist = async () => {
      try {
        const c = await fetchCloudAssistModelCatalog()
        if (!cancelled) setAssistCatalog(c)
      } catch {
        if (!cancelled) setAssistCatalog(emptyCloudAssistCatalog())
      }
    }
    void loadAssist()
    const onAssistRefresh = () => void loadAssist()
    window.addEventListener('flowid:license-changed', onAssistRefresh as EventListener)
    window.addEventListener('flowid:cloud-assist-catalog-changed', onAssistRefresh as EventListener)
    window.addEventListener('flowid:cloud-assist-keys-changed', onAssistRefresh as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener('flowid:license-changed', onAssistRefresh as EventListener)
      window.removeEventListener('flowid:cloud-assist-catalog-changed', onAssistRefresh as EventListener)
      window.removeEventListener('flowid:cloud-assist-keys-changed', onAssistRefresh as EventListener)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const base = String(loadLicenseServerConfig().baseUrl || '').trim()
      if (!base) {
        if (!cancelled) setCloudWorkflowMetaList([])
        return
      }
      const list = await fetchCloudWorkflowsMeta()
      if (!cancelled) setCloudWorkflowMetaList(list)
    }
    void load()
    const onLic = () => void load()
    window.addEventListener('flowid:license-changed', onLic as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener('flowid:license-changed', onLic as EventListener)
    }
  }, [])

  /** 底部提示框工作流下拉：云端 Comfy 仅展示授权服务维护的云端工作流；本地仍用设置里的列表 */
  const promptPanelWorkflowDropdownOptions = useMemo((): PromptPanelDropdownOption[] => {
    if (!promptPanel) return []
    const kind = promptPanel.kind
    if (executionProvider === 'cloud') {
      return cloudWorkflowMetaList
        .filter((w) => !w.nodeKind || w.nodeKind === kind)
        .map((w) => ({ value: w.id, label: w.name }))
    }
    const names = nodeConfigs[kind].workflows.map((item) => item.name).filter(Boolean)
    const fallback =
      names.length > 0
        ? names
        : kind === 'music'
          ? ['Comfy Music Flow A']
          : kind === 'text'
            ? ['默认文本工作流']
            : kind === 'image'
              ? ['默认图片工作流']
              : kind === 'video'
                ? ['默认视频工作流']
                : ['默认配音工作流']
    return fallback.map((name) => ({ value: name, label: name }))
  }, [cloudWorkflowMetaList, executionProvider, nodeConfigs, promptPanel])

  /** 仅含 __CAM_H__ 等占位符的 Comfy 工作流（及云端对应条目）才展示角度控制相关 UI */
  const promptPanelSupportsMultiangle = useMemo(() => {
    if (!visiblePromptPanel) return false
    const k = visiblePromptPanel.kind
    if (k !== 'image' && k !== 'video') return false
    const fresh = nodes.find((n) => n.id === visiblePromptPanel.node.id)
    if (!fresh) return false
    return nodeSupportsMultiangleAngleControl({
      kind: k,
      nodeData: fresh.data as ImageNodeData | VideoNodeData,
      executionProvider,
      cloudWorkflowMetaList,
      nodeConfigs,
    })
  }, [visiblePromptPanel, nodes, executionProvider, cloudWorkflowMetaList, nodeConfigs])

  const promptPanelModelOptions = useMemo(() => {
    if (!promptPanel) return [] as PromptPanelDropdownOption[]
    const pk = promptPanel.kind
    const assistVerified = readAssistLineVerified()
    const presets = loadCloudSelfPresets().filter((p) => {
      const nk = String((p as any)?.nodeKind || '').trim()
      if (nk && nk !== pk) return false
      return String((p as any).apiKey || '').trim() !== ''
    })
    const base: PromptPanelDropdownOption[] = presets.map((item) => ({
      value: item.id,
      label: String(item.model || '').trim() || item.id,
    }))
    const assistKind = studioNodeKindToAssistKind(pk)
    const assistKeyOk = assistKind ? String(getAssistApiKey(assistKind) || '').trim() !== '' : false
    const assistLineOk = assistKind ? assistVerified[assistKind] === true : false
    if (assistKind && assistKeyOk && assistLineOk) {
      const rows = assistCatalog.kinds[assistKind] || []
      for (const ep of rows) {
        for (const model of ep.models) {
          const m = String(model || '').trim()
          if (!m) continue
          base.push({
            value: encodeCloudAssistModelPick(ep.id, m),
            label: m,
          })
        }
      }
    }
    const assistPick = String((promptPanel.node.data as any)?.cloudAssistModelPick || '').trim()
    if (
      assistPick &&
      tryDecodeCloudAssistModelPick(assistPick) &&
      assistKind &&
      assistKeyOk &&
      assistLineOk &&
      !base.some((b) => b.value === assistPick)
    ) {
      const dec = tryDecodeCloudAssistModelPick(assistPick)!
      const m = String(dec.model || '').trim()
      if (m)
        base.unshift({
          value: assistPick,
          label: m,
        })
    }
    const current = String((promptPanel.node.data as any)?.cloudModelName || '').trim()
    if (current && !base.some((i) => i.label === current)) {
      base.unshift({ value: 'custom-current', label: current })
    }
    /** 多条线路同名模型时，下拉仅展示模型名会重复，用 (2)(3) 区分 */
    const labelCount = new Map<string, number>()
    for (const o of base) {
      labelCount.set(o.label, (labelCount.get(o.label) || 0) + 1)
    }
    const labelSeq = new Map<string, number>()
    const deduped = base.map((o) => {
      const n = labelCount.get(o.label) || 0
      if (n <= 1) return o
      const seq = (labelSeq.get(o.label) || 0) + 1
      labelSeq.set(o.label, seq)
      return seq === 1 ? o : { ...o, label: `${o.label} (${seq})` }
    })
    return deduped
  }, [assistCatalog, assistModelGateBump, nodeConfigs, promptPanel])

  const promptPanelModelSelectValue = useMemo(() => {
    if (!promptPanel) return ''
    const assistPick = String((promptPanel.node.data as any)?.cloudAssistModelPick || '').trim()
    if (assistPick && tryDecodeCloudAssistModelPick(assistPick)) return assistPick
    const savedId = String((promptPanel.node.data as any)?.cloudSelfPresetId || '').trim()
    if (savedId) return savedId
    const pk = promptPanel.kind
    const current = String((promptPanel.node.data as any)?.cloudModelName || '').trim()
    const presets = loadCloudSelfPresets().filter((p) => {
      const nk = String((p as any)?.nodeKind || '').trim()
      return !nk || nk === pk
    })
    const found = presets.find((i) => i.model === current)
    if (found) return found.id
    if (current) return 'custom-current'
    return presets[0]?.id || ''
  }, [assistModelGateBump, nodeConfigs, promptPanel])

  /** 底部提示框：节点级切换「工作流」还是「模型」 */
  const promptPanelPickerMode = useMemo(() => {
    if (!promptPanel) return 'model' as const
    return resolvedPromptPickerMode(promptPanel.node.data as { promptPickerMode?: 'workflow' | 'model' })
  }, [promptPanel])

  /** 与执行逻辑一致：云端用 workflowEntryId（与选项 value 对齐）；本地用名称 */
  const promptPanelWorkflowSelectValue = useMemo(() => {
    if (!promptPanel) return ''
    const kind = promptPanel.kind
    const data = promptPanel.node.data as { model?: string; workflowEntryId?: string }
    if (executionProvider === 'cloud') {
      const filtered = cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === kind)
      const eid = String(data.workflowEntryId || '').trim()
      if (eid && filtered.some((w) => w.id === eid)) return eid
      const modelTrim = String(data.model || '').trim()
      if (modelTrim) {
        const byName =
          filtered.find((w) => w.name === modelTrim) ??
          filtered.find((w) => w.name.trim() === modelTrim)
        if (byName) return byName.id
      }
      return filtered[0]?.id ?? ''
    }
    const picked = matchStudioNodeWorkflow(data, nodeConfigs[kind]).picked
    const first = promptPanelWorkflowDropdownOptions[0]?.value ?? ''
    return picked?.name ?? first
  }, [
    cloudWorkflowMetaList,
    executionProvider,
    nodeConfigs,
    promptPanel,
    promptPanelWorkflowDropdownOptions,
  ])

  /** 底部面板「工作流示例」存储键：云端为条目 id，本地为工作流条目 id */
  const promptPanelExampleWorkflowKey = useMemo(() => {
    if (!promptPanel) return ''
    if (executionMode !== 'custom' || promptPanelPickerMode !== 'workflow') return ''
    const data = promptPanel.node.data as { workflowEntryId?: string }
    if (executionProvider === 'cloud') {
      return (
        String(data.workflowEntryId || '').trim() || String(promptPanelWorkflowSelectValue || '').trim()
      )
    }
    return String(data.workflowEntryId || '').trim()
  }, [
    promptPanel,
    executionMode,
    promptPanelPickerMode,
    executionProvider,
    promptPanelWorkflowSelectValue,
  ])

  const exampleWorkflowPanelLabel = useMemo(() => {
    if (!promptPanelExampleWorkflowKey || !promptPanel) return ''
    if (executionProvider === 'cloud') {
      const hit = cloudWorkflowMetaList.find((w) => w.id === promptPanelExampleWorkflowKey)
      return hit?.name || promptPanelExampleWorkflowKey
    }
    const list = nodeConfigs[promptPanel.kind].workflows
    const hit = list.find((w) => w.id === promptPanelExampleWorkflowKey)
    return hit?.name || promptPanelExampleWorkflowKey
  }, [
    cloudWorkflowMetaList,
    executionProvider,
    nodeConfigs,
    promptPanel,
    promptPanelExampleWorkflowKey,
  ])

  useEffect(() => {
    if (!cloudWorkflowExampleModalOpen || !promptPanelExampleWorkflowKey) {
      setCloudWorkflowExampleModalEntries([])
      return
    }
    setCloudWorkflowExampleModalEntries(listCloudWorkflowExamples(promptPanelExampleWorkflowKey))
  }, [cloudWorkflowExampleModalOpen, promptPanelExampleWorkflowKey, cloudWorkflowExampleListTick])

  const textPanelSystemPromptWorkflowKey = useMemo(() => {
    if (!promptPanel || promptPanel.kind !== 'text') return ''
    if (executionMode !== 'custom' || promptPanelPickerMode !== 'workflow') return ''
    const data = promptPanel.node.data as { workflowEntryId?: string }
    if (executionProvider === 'cloud') {
      return (
        String(data.workflowEntryId || '').trim() ||
        String(promptPanelWorkflowSelectValue || '').trim()
      )
    }
    return String(data.workflowEntryId || '').trim()
  }, [
    promptPanel,
    executionMode,
    promptPanelPickerMode,
    executionProvider,
    promptPanelWorkflowSelectValue,
  ])

  const savedTextPanelSystemPrompt =
    textPanelSystemPromptWorkflowKey &&
    nodeConfigs.text.cloudWorkflowSystemPrompts?.[textPanelSystemPromptWorkflowKey]

  useEffect(() => {
    if (!textPanelSystemPromptWorkflowKey) return
    setTextPanelSystemPromptDraft(String(savedTextPanelSystemPrompt ?? ''))
  }, [textPanelSystemPromptWorkflowKey, savedTextPanelSystemPrompt])

  useEffect(() => {
    const panel = promptPanel
    if (!panel || panel.kind !== 'text') {
      setPromptPanelTextSystemPromptSlot(false)
      return
    }
    if (executionMode !== 'custom' || promptPanelPickerMode !== 'workflow') {
      setPromptPanelTextSystemPromptSlot(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        let jsonText = ''
        if (executionProvider === 'cloud') {
          const eid =
            String((panel.node.data as { workflowEntryId?: string }).workflowEntryId || '').trim() ||
            String(promptPanelWorkflowSelectValue || '').trim()
          const cfg = nodeConfigs.text
          const rawOv = eid ? cfg.cloudWorkflowOverrides?.[eid] : undefined
          if (rawOv && typeof rawOv === 'object' && String(rawOv.jsonText || '').trim()) {
            jsonText = String(rawOv.jsonText)
          } else if (rawOv && typeof rawOv === 'string' && rawOv.trim()) {
            jsonText = rawOv.trim()
          } else if (eid) {
            const r = await fetchCloudWorkflowJson(eid)
            if (cancelled) return
            jsonText = r.workflowJson || ''
          }
        } else {
          const { picked } = matchStudioNodeWorkflow(
            panel.node.data as { model?: string; workflowEntryId?: string },
            nodeConfigs.text,
          )
          jsonText =
            String(picked?.jsonText || '').trim() || String(nodeConfigs.text.workflowJsonText || '').trim()
        }
        if (cancelled) return
        setPromptPanelTextSystemPromptSlot(workflowJsonUsesSystemPromptPlaceholder(jsonText))
      } catch {
        if (!cancelled) setPromptPanelTextSystemPromptSlot(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    executionMode,
    executionProvider,
    nodeConfigs.text,
    promptPanel,
    promptPanelPickerMode,
    promptPanelWorkflowSelectValue,
  ])

  useEffect(() => {
    const panel = promptPanel
    if (!panel || (panel.kind !== 'image' && panel.kind !== 'video')) {
      setPromptPanelComfyWorkflowOpts({ size: false, style: false })
      return
    }
    if (promptPanelPickerMode !== 'workflow' || executionMode !== 'custom') {
      setPromptPanelComfyWorkflowOpts({ size: false, style: false })
      return
    }
    const kind = panel.kind
    let cancelled = false
    void (async () => {
      try {
        let jsonText = ''
        if (executionProvider === 'cloud') {
          const eid =
            String((panel.node.data as { workflowEntryId?: string }).workflowEntryId || '').trim() ||
            String(promptPanelWorkflowSelectValue || '').trim()
          const cfg = nodeConfigs[kind]
          const rawOv = eid ? cfg.cloudWorkflowOverrides?.[eid] : undefined
          if (rawOv && typeof rawOv === 'object' && String(rawOv.jsonText || '').trim()) {
            jsonText = String(rawOv.jsonText)
          } else if (rawOv && typeof rawOv === 'string' && rawOv.trim()) {
            jsonText = rawOv.trim()
          } else if (eid) {
            const r = await fetchCloudWorkflowJson(eid)
            if (cancelled) return
            jsonText = r.workflowJson || ''
          }
        } else {
          const { picked } = matchStudioNodeWorkflow(
            panel.node.data as { model?: string; workflowEntryId?: string },
            nodeConfigs[kind],
          )
          jsonText =
            String(picked?.jsonText || '').trim() || String(nodeConfigs[kind].workflowJsonText || '').trim()
        }
        if (cancelled) return
        setPromptPanelComfyWorkflowOpts({
          size: workflowJsonSupportsComfySizePlaceholders(jsonText),
          style: workflowJsonSupportsComfyStyleTonePlaceholder(jsonText),
        })
      } catch {
        if (!cancelled) setPromptPanelComfyWorkflowOpts({ size: false, style: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    executionMode,
    executionProvider,
    nodeConfigs.image,
    nodeConfigs.video,
    promptPanel,
    promptPanelPickerMode,
    promptPanelWorkflowSelectValue,
  ])

  useEffect(() => {
    const panel = promptPanel
    if (!panel || panel.kind !== 'audio') {
      setPromptPanelVoiceTable8({ show: false, scanned: false })
      setPromptPanelTdRefRoleMap({ show: false, scanned: false })
      return
    }
    if (promptPanelPickerMode !== 'workflow') {
      setPromptPanelVoiceTable8({ show: false, scanned: false })
      setPromptPanelTdRefRoleMap({ show: false, scanned: false })
      return
    }
    const kind = 'audio' as const
    let cancelled = false
    setPromptPanelVoiceTable8({ show: false, scanned: false })
    setPromptPanelTdRefRoleMap({ show: false, scanned: false })
    void (async () => {
      try {
        let jsonText = ''
        if (executionProvider === 'cloud') {
          const eid =
            String((panel.node.data as { workflowEntryId?: string }).workflowEntryId || '').trim() ||
            String(promptPanelWorkflowSelectValue || '').trim()
          const cfg = nodeConfigs[kind]
          const rawOv = eid ? cfg.cloudWorkflowOverrides?.[eid] : undefined
          if (rawOv && typeof rawOv === 'object' && String(rawOv.jsonText || '').trim()) {
            jsonText = String(rawOv.jsonText)
          } else if (rawOv && typeof rawOv === 'string' && rawOv.trim()) {
            jsonText = rawOv.trim()
          } else if (eid) {
            const r = await fetchCloudWorkflowJson(eid)
            if (cancelled) return
            jsonText = r.workflowJson || ''
          }
        } else {
          const { picked } = matchStudioNodeWorkflow(
            panel.node.data as { model?: string; workflowEntryId?: string },
            nodeConfigs[kind],
          )
          jsonText =
            String(picked?.jsonText || '').trim() || String(nodeConfigs[kind].workflowJsonText || '').trim()
        }
        if (cancelled) return
        setPromptPanelVoiceTable8({
          show: workflowJsonSupportsVoiceTable8Slots(jsonText),
          scanned: true,
        })
        setPromptPanelTdRefRoleMap({
          show: workflowJsonSupportsTdRefAudioRoleMap(jsonText),
          scanned: true,
        })
      } catch {
        if (!cancelled) {
          setPromptPanelVoiceTable8({ show: false, scanned: true })
          setPromptPanelTdRefRoleMap({ show: false, scanned: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [executionProvider, nodeConfigs.audio, promptPanel, promptPanelPickerMode, promptPanelWorkflowSelectValue])

  const voiceTable8ModalPosition = useMemo(() => {
    if (!voiceTable8ModalOpen || !promptPanel || promptPanel.kind !== 'audio') return null
    const n = promptPanel.node
    const vp = viewport
    const zoom = vp.zoom || 1
    const nodeWidth = Number(n.measured?.width ?? n.width ?? n.style?.width ?? 430)
    const nodeLeft = n.position.x * zoom + vp.x
    const nodeRight = nodeLeft + nodeWidth * zoom
    const nodeTop = n.position.y * zoom + vp.y
    const gap = 20
    const modalWidth = Math.min(480, Math.max(360, window.innerWidth - 32))
    let left = nodeRight + gap
    if (left + modalWidth > window.innerWidth - 8) {
      left = nodeLeft - modalWidth - gap
    }
    left = Math.max(8, Math.min(left, window.innerWidth - modalWidth - 8))
    const top = Math.max(8, Math.min(nodeTop, window.innerHeight - 120))
    return { left, top, width: modalWidth }
  }, [voiceTable8ModalOpen, promptPanel, viewport.x, viewport.y, viewport.zoom])

  const tdRefRoleModalPosition = useMemo(() => {
    if (!tdRefRoleModalOpen || !promptPanel || promptPanel.kind !== 'audio') return null
    const n = promptPanel.node
    const vp = viewport
    const zoom = vp.zoom || 1
    const nodeWidth = Number(n.measured?.width ?? n.width ?? n.style?.width ?? 430)
    const nodeLeft = n.position.x * zoom + vp.x
    const nodeRight = nodeLeft + nodeWidth * zoom
    const nodeTop = n.position.y * zoom + vp.y
    const gap = 20
    const modalWidth = Math.min(480, Math.max(360, window.innerWidth - 32))
    /** 始终锚在节点右侧；视口不够时只在屏内平移，不翻到节点左侧（避免「匹配」弹窗挡在节点左边）。 */
    const left = Math.max(8, Math.min(nodeRight + gap, window.innerWidth - modalWidth - 8))
    const top = Math.max(8, Math.min(nodeTop, window.innerHeight - 120))
    return { left, top, width: modalWidth }
  }, [tdRefRoleModalOpen, promptPanel, viewport.x, viewport.y, viewport.zoom])

  const musicFineTuneModalPosition = useMemo(() => {
    if (!musicFineTuneModalOpen || !promptPanel || promptPanel.kind !== 'music') return null
    const n = promptPanel.node
    const vp = viewport
    const zoom = vp.zoom || 1
    const nodeWidth = Number(n.measured?.width ?? n.width ?? n.style?.width ?? 430)
    const nodeLeft = n.position.x * zoom + vp.x
    const nodeRight = nodeLeft + nodeWidth * zoom
    const nodeTop = n.position.y * zoom + vp.y
    const gap = 20
    const modalWidth = Math.min(420, Math.max(340, window.innerWidth - 32))
    let left = nodeRight + gap
    if (left + modalWidth > window.innerWidth - 8) {
      left = nodeLeft - modalWidth - gap
    }
    left = Math.max(8, Math.min(left, window.innerWidth - modalWidth - 8))
    const top = Math.max(8, Math.min(nodeTop, window.innerHeight - 80))
    return { left, top, width: modalWidth }
  }, [musicFineTuneModalOpen, promptPanel, viewport.x, viewport.y, viewport.zoom])

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
    if (promptPanel.kind === 'video') {
      return packVideoPromptPanelValue(promptPanel.node.data as VideoNodeData)
    }
    return ''
  }, [promptPanel])

  /** COMFY 配音侧栏：明确「会参与参考音上传」的 @，与正文里的文字节点 @ 区分 */
  const promptPanelAudioRefMentionLabels = useMemo(() => {
    if (!promptPanel || promptPanel.kind !== 'audio') return [] as string[]
    if (promptPanelPickerMode !== 'workflow') return []
    return listMentionAudioRefLabelsForNote(promptPanelText, nodes, promptPanel.node.id, edges)
  }, [promptPanel, promptPanelPickerMode, promptPanelText, nodes, edges])

  const unresolvedMentions = useMemo(() => {
    if (!promptPanel) return [] as string[]
    const scanText =
      promptPanel.kind === 'video'
        ? getVideoPromptSlotsFromData(promptPanel.node.data as VideoNodeData)
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .join('\n')
        : promptPanelText
    const restrict =
      promptPanel.node.id && edges?.length
        ? collectUpstreamNodeIds(promptPanel.node.id, edges)
        : undefined
    return parseMentionRefs(scanText)
      .filter((ref) => {
        const label = String(ref.label || '').trim()
        // `@系统提示词(标题)` 不是节点引用，不应触发“未匹配到节点”的提示。
        if (/^系统提示词[\(（]/u.test(label)) return false
        return true
      })
      .filter((ref) => !resolveMentionRefToNode(ref, nodes, promptPanel.node.id, undefined, restrict))
      .map((ref) => ref.label)
  }, [nodes, promptPanel, promptPanelText, edges])

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

  /** 多选右键「统一」：仅含底部带提示框的节点类型（与底部面板一致）。 */
  const batchPromptUnifyTargets = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.selected &&
          n.type !== 'ghost' &&
          n.type !== 'group' &&
          isBatchPromptUnifyKind(n.data.kind),
      ),
    [nodes],
  )

  /** 批量统一工作流：云端为授权列表；本地按选中类型展开各类型工作流条目。 */
  const batchWorkflowUnifyRows = useMemo((): BatchWorkflowUnifyRow[] => {
    if (!batchPromptUnifyTargets.length) return []
    const unifyKinds = [...new Set(batchPromptUnifyTargets.map((t) => t.data.kind))].filter(
      isBatchPromptUnifyKind,
    ) as StudioNodeKind[]
    if (executionProvider === 'cloud') {
      const out: BatchWorkflowUnifyRow[] = []
      for (const w of cloudWorkflowMetaList) {
        let applies = false
        for (const k of unifyKinds) {
          const filtered = cloudWorkflowMetaList.filter((x) => !x.nodeKind || x.nodeKind === k)
          if (filtered.some((x) => x.id === w.id)) {
            applies = true
            break
          }
        }
        if (applies) out.push({ mode: 'cloud', meta: w })
      }
      out.sort((a, b) => a.meta.name.localeCompare(b.meta.name, 'zh-CN'))
      return out
    }
    const out: BatchWorkflowUnifyRow[] = []
    for (const k of unifyKinds) {
      for (const entry of nodeConfigs[k].workflows) {
        out.push({ mode: 'local', kind: k, entry })
      }
    }
    out.sort((a, b) => {
      if (a.mode !== 'local' || b.mode !== 'local') return 0
      const c = a.entry.name.localeCompare(b.entry.name, 'zh-CN')
      if (c !== 0) return c
      return NODE_KIND_LABEL[a.kind].localeCompare(NODE_KIND_LABEL[b.kind], 'zh-CN')
    })
    return out
  }, [batchPromptUnifyTargets, executionProvider, cloudWorkflowMetaList, nodeConfigs])

  /** 批量统一模型：与底部「选择模型」同源，仅云端执行有意义。 */
  const batchModelUnifyOptions = useMemo((): PromptPanelDropdownOption[] => {
    if (executionProvider !== 'cloud') return []
    if (!batchPromptUnifyTargets.length) return []
    const kinds = [...new Set(batchPromptUnifyTargets.map((t) => t.data.kind))].filter(
      isBatchPromptUnifyKind,
    ) as StudioNodeKind[]
    const assistVerified = readAssistLineVerified()
    const base: PromptPanelDropdownOption[] = []
    const seenVal = new Set<string>()
    const pushUnique = (opt: PromptPanelDropdownOption) => {
      if (seenVal.has(opt.value)) return
      seenVal.add(opt.value)
      base.push(opt)
    }
    for (const item of loadCloudSelfPresets()) {
      const nk = String((item as { nodeKind?: string }).nodeKind || '').trim()
      if (nk && !kinds.includes(nk as StudioNodeKind)) continue
      if (String((item as { apiKey?: string }).apiKey || '').trim() === '') continue
      pushUnique({
        value: item.id,
        label: String(item.model || '').trim() || item.id,
      })
    }
    for (const pk of kinds) {
      const assistKind = studioNodeKindToAssistKind(pk)
      const assistKeyOk = assistKind ? String(getAssistApiKey(assistKind) || '').trim() !== '' : false
      const assistLineOk = assistKind ? assistVerified[assistKind] === true : false
      if (!assistKind || !assistKeyOk || !assistLineOk) continue
      const rows = assistCatalog.kinds[assistKind] || []
      for (const ep of rows) {
        for (const model of ep.models) {
          const m = String(model || '').trim()
          if (!m) continue
          pushUnique({
            value: encodeCloudAssistModelPick(ep.id, m),
            label: m,
          })
        }
      }
    }
    const labelCount = new Map<string, number>()
    for (const o of base) {
      labelCount.set(o.label, (labelCount.get(o.label) || 0) + 1)
    }
    const labelSeq = new Map<string, number>()
    return base.map((o) => {
      const n = labelCount.get(o.label) || 0
      if (n <= 1) return o
      const seq = (labelSeq.get(o.label) || 0) + 1
      labelSeq.set(o.label, seq)
      return seq === 1 ? o : { ...o, label: `${o.label} (${seq})` }
    })
  }, [assistCatalog, assistModelGateBump, batchPromptUnifyTargets, executionProvider])

  const batchUnifyMenuVisible = useMemo(() => {
    if (!batchPromptUnifyTargets.length) return false
    if (batchWorkflowUnifyRows.length > 0) return true
    return executionProvider === 'cloud' && batchModelUnifyOptions.length > 0
  }, [
    batchModelUnifyOptions.length,
    batchPromptUnifyTargets.length,
    batchWorkflowUnifyRows.length,
    executionProvider,
  ])

  /** 恰好选中 2 个图片节点：右键菜单可提供「新增对比节点」 */
  const contextMenuImageCompareTwoPick = useMemo(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== 'ghost' && n.type !== 'group')
    if (sel.length !== 2) return null
    if (sel[0]!.data.kind !== 'image' || sel[1]!.data.kind !== 'image') return null
    return { a: sel[0]!, b: sel[1]! }
  }, [nodes])

  /** 单选图片/视频且当前选中工作流为 Multiangle 模板：右键菜单显示「角度控制」 */
  const contextMenuMultiangleTarget = useMemo(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== 'ghost' && n.type !== 'group')
    if (sel.length !== 1) return null
    const k = sel[0].data.kind
    if (k !== 'image' && k !== 'video') return null
    const data = sel[0].data as ImageNodeData | VideoNodeData
    if (
      !nodeSupportsMultiangleAngleControl({
        kind: k,
        nodeData: data,
        executionProvider,
        cloudWorkflowMetaList,
        nodeConfigs,
      })
    ) {
      return null
    }
    return { id: sel[0].id, kind: k as 'image' | 'video' }
  }, [nodes, executionProvider, cloudWorkflowMetaList, nodeConfigs])

  const multiangleTargetNodeId = multianglePanel?.nodeId
  useEffect(() => {
    if (!multiangleTargetNodeId) return
    if (!nodes.some((n) => n.id === multiangleTargetNodeId)) setMultianglePanel(null)
  }, [nodes, multiangleTargetNodeId])

  useEffect(() => {
    if (!multianglePanel) return
    const n = nodes.find((x) => x.id === multianglePanel.nodeId)
    if (!n || (n.data.kind !== 'image' && n.data.kind !== 'video')) {
      setMultianglePanel(null)
      return
    }
    const ok = nodeSupportsMultiangleAngleControl({
      kind: n.data.kind,
      nodeData: n.data as ImageNodeData | VideoNodeData,
      executionProvider,
      cloudWorkflowMetaList,
      nodeConfigs,
    })
    if (!ok) setMultianglePanel(null)
  }, [multianglePanel, nodes, executionProvider, cloudWorkflowMetaList, nodeConfigs])

  const multiangleNodeLayoutSig = useMemo(() => {
    const id = multianglePanel?.nodeId
    if (!id) return ''
    const n = nodes.find((x) => x.id === id)
    if (!n) return ''
    const { width, height } = getNodeSize(n)
    return `${n.position.x}:${n.position.y}:${width}:${height}:${Boolean(n.hidden)}`
  }, [multianglePanel?.nodeId, nodes])

  const multianglePanelAnchor = useMemo(() => {
    if (!multianglePanel) return { left: 0, top: 0 }
    return computeMultianglePanelAnchorScreen(multianglePanel.nodeId)
  }, [
    multianglePanel?.nodeId,
    viewport.x,
    viewport.y,
    viewport.zoom,
    multiangleNodeLayoutSig,
    multiangleLayoutBump,
  ])

  useEffect(() => {
    if (!multianglePanel) {
      setMultiangleLayoutBump(0)
      return
    }
    const onResize = () => setMultiangleLayoutBump((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [multianglePanel])

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

  const USER_TEXT_PATCH_KEYS = [
    'body',
    'prompt',
    'prompt2',
    'prompt3',
    'prompt4',
    'note',
    'title',
  ] as const satisfies readonly (keyof StudioNodeData | string)[]

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<StudioNodeData>) => {
      for (const k of USER_TEXT_PATCH_KEYS) {
        if (!(k in patch)) continue
        const v = (patch as Record<string, unknown>)[k]
        if (typeof v !== 'string') continue
        const gate = canSend(v)
        if (!gate.allowed) {
          alertSensitiveWordBlocked(gate.reason)
          return
        }
      }
      const ex = (patch as { extraPrompts?: unknown }).extraPrompts
      if (Array.isArray(ex)) {
        for (const s of ex) {
          const gate = canSend(String(s ?? ''))
          if (!gate.allowed) {
            alertSensitiveWordBlocked(gate.reason)
            return
          }
        }
      }

      const safePatch = applySensitiveFilterToNodeDataPatch(patch)
      setNodes((nds) => {
        const prevNode = nds.find((n) => n.id === nodeId)
        if (!prevNode) return nds

        let patchToApply = safePatch
        if (typeof safePatch.title === 'string') {
          const desired = String(safePatch.title).trim() || '节点'
          const peerTitles = nds
            .filter((n) => n.id !== nodeId && n.type !== 'ghost')
            .map((n) => String(n.data.title ?? '').trim())
            .filter(Boolean)
          const uniqueTitle = allocateUniqueCanvasTitleAmongPeers(desired, peerTitles)
          patchToApply = { ...safePatch, title: uniqueTitle }
        }

        const prevTitle = String(prevNode.data.title ?? '').trim()
        const nextTitle =
          typeof patchToApply.title === 'string'
            ? String(patchToApply.title).trim()
            : prevTitle

        let next = nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: { ...n.data, ...patchToApply } as StudioNodeData,
              }
            : n,
        )

        const sk = prevNode.data.kind
        const titleChanged =
          typeof patchToApply.title === 'string' && nextTitle !== prevTitle
        if (titleChanged && (sk === 'text' || sk === 'script')) {
          const mergedData = {
            ...prevNode.data,
            ...patchToApply,
            title: nextTitle,
          } as StudioNodeData
          const anchorNext = {
            ...prevNode,
            data: mergedData,
          } as Node<StudioNodeData>
          const expectedNew = buildImageLinkedNewNodeBaseTitle(anchorNext)
          if (expectedNew) {
            const expectedOld = buildImageLinkedNewNodeBaseTitle(
              prevNode as Node<StudioNodeData>,
            )
            const linkedTargets = new Set<string>()
            for (const e of edges) {
              if (e.source === nodeId) linkedTargets.add(e.target)
              if (e.target === nodeId) linkedTargets.add(e.source)
            }
            next = next.map((n) => {
              if (!linkedTargets.has(n.id)) return n
              if (n.data.kind !== 'image' && n.data.kind !== 'video')
                return n
              const ct = String(n.data.title ?? '').trim()
              const syncFromDerived =
                expectedOld !== '' && ct === expectedOld
              const syncFromPlaceholder = isDefaultLinkedVisualNodeTitle(ct)
              if (!syncFromDerived && !syncFromPlaceholder) return n
              if (ct === expectedNew) return n
              return {
                ...n,
                data: { ...n.data, title: expectedNew } as StudioNodeData,
              }
            })
          }
        }

        return next
      })
    },
    [setNodes, edges],
  )

  const applyBatchWorkflowUnifyRow = useCallback(
    (row: BatchWorkflowUnifyRow) => {
      const targets = nodes.filter(
        (n) =>
          n.selected &&
          n.type !== 'ghost' &&
          n.type !== 'group' &&
          isBatchPromptUnifyKind(n.data.kind),
      )
      if (!targets.length) return
      if (row.mode === 'cloud') {
        const w = row.meta
        for (const n of targets) {
          const k = n.data.kind
          if (!isBatchPromptUnifyKind(k)) continue
          const filtered = cloudWorkflowMetaList.filter((x) => !x.nodeKind || x.nodeKind === k)
          const hit = filtered.find((x) => x.id === w.id)
          if (!hit) continue
          updateNodeData(n.id, {
            kind: k,
            promptPickerMode: 'workflow',
            model: hit.name,
            workflowEntryId: hit.id,
          } as Partial<StudioNodeData>)
        }
      } else {
        const { kind, entry } = row
        let any = false
        for (const n of targets) {
          if (n.data.kind !== kind) continue
          any = true
          updateNodeData(n.id, {
            kind,
            promptPickerMode: 'workflow',
            model: entry.name,
            workflowEntryId: entry.id,
          } as Partial<StudioNodeData>)
        }
        if (any) selectNodeWorkflow(kind, entry.id)
      }
      appendHistory('已批量统一为同一工作流')
      dismissMultiSelectContextMenu()
    },
    [
      appendHistory,
      cloudWorkflowMetaList,
      dismissMultiSelectContextMenu,
      nodes,
      selectNodeWorkflow,
      updateNodeData,
    ],
  )

  const applyBatchModelPickFromContextMenu = useCallback(
    (pickedId: string) => {
      if (pickedId === 'custom-current') return
      const targets = nodes.filter(
        (n) =>
          n.selected &&
          n.type !== 'ghost' &&
          n.type !== 'group' &&
          isBatchPromptUnifyKind(n.data.kind),
      )
      if (!targets.length) return
      for (const n of targets) {
        const kind = n.data.kind
        if (!isBatchPromptUnifyKind(kind)) continue
        const assistDecoded = tryDecodeCloudAssistModelPick(pickedId)
        if (assistDecoded) {
          const ak = studioNodeKindToAssistKind(kind)
          if (!ak) continue
          const ep = findAssistEndpoint(ak, assistDecoded.endpointId, assistCatalog)
          if (!ep) continue
          updateNodeData(n.id, {
            kind,
            promptPickerMode: 'model',
            cloudAssistModelPick: pickedId,
            cloudSelfPresetId: undefined,
            cloudModelName: assistDecoded.model,
            cloudModelUrl: ep.baseUrl,
            cloudApiKey: getAssistApiKey(ak),
          } as Partial<StudioNodeData>)
          continue
        }
        const preset = loadCloudSelfPresets().find((i) => i.id === pickedId)
        if (!preset) continue
        const nk = String((preset as { nodeKind?: string }).nodeKind || '').trim()
        if (nk && nk !== kind) continue
        updateNodeData(n.id, {
          kind,
          promptPickerMode: 'model',
          cloudAssistModelPick: undefined,
          cloudSelfPresetId: preset.id,
          cloudModelName: preset.model,
          cloudModelUrl: preset.baseUrl,
          cloudApiKey: String((preset as { apiKey?: string }).apiKey || ''),
        } as Partial<StudioNodeData>)
      }
      appendHistory('已批量统一为同一云端模型')
      dismissMultiSelectContextMenu()
    },
    [appendHistory, assistCatalog, dismissMultiSelectContextMenu, nodes, updateNodeData],
  )

  const flushVoiceTable8DraftToNode = useCallback(() => {
    const nid = voiceTable8ModalTargetIdRef.current
    if (!nid) return
    updateNodeData(nid, {
      kind: 'audio',
      comfyVoiceTableRows: voiceTable8DraftRef.current,
    } as Partial<StudioNodeData>)
  }, [updateNodeData])

  const applyVoiceTable8BulkPaste = useCallback(() => {
    const { rows, skippedLines, truncated } = parseVoiceTableBulkPaste(voiceTable8BulkPasteDraft)
    if (!rows.length) {
      window.alert(
        '未解析到有效行。每行格式：角色名称###代表台词###声音设定。可选第四段###语言（须与语言下拉一致）。代表台词与声音设定中请勿出现 ###。',
      )
      return
    }
    setVoiceTable8Draft(voiceTableRowsPaddedForUi(rows))
    setVoiceTable8Editing(null)
    const msgs: string[] = []
    if (truncated) msgs.push('超过 8 个角色，已只保留前 8 路')
    if (skippedLines > 0) msgs.push(`已跳过 ${skippedLines} 行（格式无效）`)
    if (msgs.length) window.alert(msgs.join('；'))
  }, [voiceTable8BulkPasteDraft])

  const commitTdRefRoleModalToNode = useCallback(
    (rows: ComfyTdRefAudioRoleRow[]) => {
      const nid = tdRefRoleModalTargetIdRef.current
      if (!nid) return
      updateNodeData(nid, {
        kind: 'audio',
        comfyTdRefAudioRoleRows: rows,
      } as Partial<StudioNodeData>)
      tdRefRoleModalTargetIdRef.current = null
      setTdRefRoleModalOpen(false)
    },
    [updateNodeData],
  )

  useEffect(() => {
    setVoiceTable8ModalOpen(false)
    setVoiceTable8Editing(null)
    if (tdRefRoleModalOpenRef.current) {
      const snap = tdRefRolePersistRef.current?.()
      const nid = tdRefRoleModalTargetIdRef.current
      if (snap && nid) {
        updateNodeData(nid, {
          kind: 'audio',
          comfyTdRefAudioRoleRows: snap,
        } as Partial<StudioNodeData>)
      }
      tdRefRoleModalTargetIdRef.current = null
    }
    setTdRefRoleModalOpen(false)
  }, [selectedNodeId, updateNodeData])

  /** 台本信息：编辑后防抖写入节点，误点外部关闭也不丢 */
  useEffect(() => {
    if (!voiceTable8ModalOpen) return
    const t = window.setTimeout(() => {
      flushVoiceTable8DraftToNode()
    }, 320)
    return () => {
      window.clearTimeout(t)
    }
  }, [voiceTable8Draft, voiceTable8ModalOpen, flushVoiceTable8DraftToNode])

  useEffect(() => {
    if (voiceTable8ModalWasOpenRef.current && !voiceTable8ModalOpen) {
      flushVoiceTable8DraftToNode()
      voiceTable8ModalTargetIdRef.current = null
    }
    voiceTable8ModalWasOpenRef.current = voiceTable8ModalOpen
  }, [voiceTable8ModalOpen, flushVoiceTable8DraftToNode])

  /**
   * 迁移旧版「第一路里含 ---PROMPT2---」的存盘到四路字段（仅在 2～4 路仍为空时执行，避免误拆）。
   */
  useEffect(() => {
    if (promptPanel?.kind !== 'video') return
    const id = promptPanel.node.id
    const live = nodes.find((n) => n.id === id)?.data as VideoNodeData | undefined
    if (!live) return
    if (String(live.prompt2 || '').trim() || String(live.prompt3 || '').trim() || String(live.prompt4 || '').trim()) {
      return
    }
    const p1 = String(live.prompt || '')
    if (!p1.includes('---PROMPT2---')) return
    const slots = splitVideoRawPromptText(p1)
    updateNodeData(id, {
      kind: 'video',
      prompt: slots.prompt,
      prompt2: slots.prompt2,
      prompt3: slots.prompt3,
      prompt4: slots.prompt4,
    } as Partial<StudioNodeData>)
  }, [nodes, promptPanel?.kind, promptPanel?.node?.id, updateNodeData])

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
        const data = node.data as { model?: string; workflowEntryId?: string }
        let nextModel: string | undefined = data.model
        let nextWid: string | undefined = data.workflowEntryId

        if (executionProvider === 'cloud') {
          const cloudList = cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === kind)
          const idSet = new Set(cloudList.map((w) => w.id))
          const entryIdTrim = normId(nextWid)
          const modelTrim = normModel(nextModel)
          if (entryIdTrim && !idSet.has(entryIdTrim)) {
            nextModel = undefined
            nextWid = undefined
          } else if (entryIdTrim && idSet.has(entryIdTrim)) {
            const entry = cloudList.find((w) => w.id === entryIdTrim)
            if (entry && entry.name.trim() !== modelTrim) {
              nextModel = entry.name
            }
          }
          const eid2 = normId(nextWid)
          const mid2 = normModel(nextModel)
          if (!eid2 && mid2) {
            const hit =
              cloudList.find((w) => w.name === mid2) ?? cloudList.find((w) => w.name.trim() === mid2)
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
        }

        const list = nodeConfigs[kind].workflows
        const idSet = new Set(list.map((w) => w.id))

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
  }, [cloudWorkflowMetaList, executionProvider, nodeConfigs, setNodes])

  /**
   * 底部面板打开时：若节点尚未写入 `model`，则把当前解析到的工作流写回节点，与下拉展示/执行一致。
   */
  useEffect(() => {
    if (!promptPanel) return
    const { node, kind } = promptPanel
    const data = node.data as { model?: string; workflowEntryId?: string }
    if (executionProvider === 'cloud') {
      const cloudList = cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === kind)
      const modelTrim = (data.model ?? '').trim()
      const eidTrim = String(data.workflowEntryId || '').trim()
      if (!modelTrim && !eidTrim && cloudList[0]) {
        updateNodeData(node.id, {
          kind,
          model: cloudList[0].name,
          workflowEntryId: cloudList[0].id,
        } as Partial<StudioNodeData>)
        return
      }
      if (eidTrim) {
        const cw = cloudList.find((w) => w.id === eidTrim)
        if (cw && cw.name !== modelTrim) {
          updateNodeData(node.id, {
            kind,
            model: cw.name,
            workflowEntryId: cw.id,
          } as Partial<StudioNodeData>)
        }
        return
      }
      if (modelTrim) {
        const hit =
          cloudList.find((w) => w.name === modelTrim) ??
          cloudList.find((w) => w.name.trim() === modelTrim)
        if (hit && hit.id !== eidTrim) {
          updateNodeData(node.id, {
            kind,
            model: hit.name,
            workflowEntryId: hit.id,
          } as Partial<StudioNodeData>)
        }
      }
      return
    }

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
  }, [cloudWorkflowMetaList, executionProvider, nodeConfigs, promptPanel, updateNodeData])

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
      } else if (promptPanel.kind === 'video') {
        const u = unpackVideoPromptPanelValue(nextText)
        let extras = u.extraPrompts
        if (extras?.length) {
          while (extras.length && !String(extras[extras.length - 1] ?? '').trim()) {
            extras = extras.slice(0, -1)
          }
          if (!extras.length) extras = undefined
        }
        updateNodeData(nid, {
          kind: 'video',
          prompt: u.prompt,
          prompt2: u.prompt2,
          prompt3: u.prompt3,
          prompt4: u.prompt4,
          extraPrompts: extras,
        } as Partial<StudioNodeData>)
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
   * 底部面板：追加参考素材。图/视频仅收图片；配音/音乐可收多路参考音频（及可选封面图）。
   */
  const appendPanelReferenceImages = useCallback(
    async (list: FileList | readonly File[] | null) => {
      if (!promptPanel) return
      const arr = list ? Array.from(list as ArrayLike<File>) : []
      if (!arr.length) return
      const { node, kind } = promptPanel
      const id = node.id
      if (kind === 'image' || kind === 'video') {
        const files = arr.filter((f) => f.type.startsWith('image/'))
        if (!files.length) return
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
        } else {
          const d = node.data as VideoNodeData
          updateNodeData(id, {
            kind: 'video',
            referenceImageSources: [...(d.referenceImageSources ?? []), ...urls],
            referenceImageAssetIds: [...(d.referenceImageAssetIds ?? []), ...assetIds],
          })
        }
        return
      }
      if (kind === 'audio' || kind === 'music') {
        const { images, audios } = partitionMediaFilesByKind(arr)
        if (!images.length && !audios.length) return
        const urls: string[] = []
        const assetIds: string[] = []
        const persisted = await Promise.all(
          images.map(async (file) => {
            try {
              const assetId = await saveLocalImageAsset(file)
              const restored = await getLocalImageAssetObjectUrl(assetId)
              return {
                url: restored || URL.createObjectURL(file),
                assetId,
              }
            } catch {
              return { url: URL.createObjectURL(file), assetId: '' }
            }
          }),
        )
        persisted.forEach((p) => {
          urls.push(p.url)
          assetIds.push(p.assetId)
        })
        const audioPersisted = await Promise.all(
          audios.map(async (file) => {
            try {
              const assetId = await saveLocalImageAsset(file)
              const restored = await getLocalImageAssetObjectUrl(assetId)
              return { url: restored || URL.createObjectURL(file), assetId }
            } catch {
              return { url: URL.createObjectURL(file), assetId: '' }
            }
          }),
        )
        audioPersisted.forEach((p) => {
          urls.push(p.url)
          assetIds.push(p.assetId)
        })
        const d = node.data as AudioNodeData
        updateNodeData(id, {
          kind: d.kind,
          referenceImageSources: [...(d.referenceImageSources ?? []), ...urls],
          referenceImageAssetIds: [...(d.referenceImageAssetIds ?? []), ...assetIds],
        } as Partial<StudioNodeData>)
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

  const applyVideoFileToNode = useCallback(
    (nodeId: string, file: File) => {
      const isVid =
        file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i.test(file.name)
      if (!isVid) return
      const src = URL.createObjectURL(file)
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId || n.data.kind !== 'video') return n
          const d = n.data as VideoNodeData
          return {
            ...n,
            data: {
              ...d,
              src,
              srcFileName: file.name,
              srcDiskPath: undefined,
              srcAssetId: undefined,
            } as StudioNodeData,
          }
        }),
      )
      appendHistory(`已写入节点：${file.name}`)
    },
    [appendHistory, setNodes],
  )

  const applyAudioFileToNode = useCallback(
    async (nodeId: string, file: File) => {
      const isAud =
        file.type.startsWith('audio/') ||
        /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff?)$/i.test(file.name)
      if (!isAud) return
      let url = URL.createObjectURL(file)
      let srcAssetId = ''
      try {
        srcAssetId = await saveLocalImageAsset(file)
        const restored = await getLocalImageAssetObjectUrl(srcAssetId)
        if (restored) url = restored
      } catch {
        void mirrorUploadToInputDir(file)
        srcAssetId = ''
      }
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n
          const d = n.data
          if (d.kind !== 'audio' && d.kind !== 'music') return n
          return {
            ...n,
            data: {
              ...d,
              src: url,
              srcAssetId: srcAssetId || undefined,
              srcFileName: file.name,
              srcDiskPath: undefined,
              resultSources: [url, ...(d.resultSources ?? []).filter((item) => item !== url)],
            } as StudioNodeData,
          }
        }),
      )
      appendHistory(`已写入节点：${file.name}`)
    },
    [appendHistory, setNodes],
  )

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
            position: { x: base.x, y: base.y + idx * FLOWID_CANVAS_DROP_STACK_STEP_Y },
            style: { width: 430, height: FLOWID_CANVAS_DROP_STACK_H },
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

  const addVideoFilesAtFlowPosition = useCallback(
    (files: readonly File[], base: XYPosition) => {
      const { videos } = partitionMediaFilesByKind(files)
      if (!videos.length) return
      setNodes((prev) => {
        const extra: Array<Node<StudioNodeData>> = []
        videos.forEach((file, idx) => {
          const id = crypto.randomUUID()
          const baseNode = createStudioNode('video', id, {
            x: base.x,
            y: base.y + idx * FLOWID_CANVAS_DROP_STACK_STEP_Y,
          })
          const src = URL.createObjectURL(file)
          const stem = file.name.replace(/\.[^.]+$/, '').trim() || '未命名'
          extra.push({
            ...baseNode,
            data: {
              ...(baseNode.data as VideoNodeData),
              title: `视频 · ${stem}`,
              src,
              srcFileName: file.name,
            } as StudioNodeData,
          })
        })
        return [...prev, ...extra]
      })
      appendHistory(`拖入视频：${videos.length} 个`)
    },
    [appendHistory, createStudioNode, setNodes],
  )

  const addAudioFilesAtFlowPosition = useCallback(
    async (files: readonly File[], base: XYPosition) => {
      const { audios } = partitionMediaFilesByKind(files)
      if (!audios.length) return
      const persisted = await Promise.all(
        audios.map(async (file) => {
          try {
            const srcAssetId = await saveLocalImageAsset(file)
            const restored = await getLocalImageAssetObjectUrl(srcAssetId)
            return { file, src: restored || URL.createObjectURL(file), srcAssetId }
          } catch {
            void mirrorUploadToInputDir(file)
            return { file, src: URL.createObjectURL(file), srcAssetId: '' }
          }
        }),
      )
      setNodes((prev) => {
        const extra: Array<Node<StudioNodeData>> = []
        persisted.forEach(({ file, src, srcAssetId }, idx) => {
          const id = crypto.randomUUID()
          const baseNode = createStudioNode('audio', id, {
            x: base.x,
            y: base.y + idx * FLOWID_CANVAS_DROP_STACK_STEP_Y,
          })
          const stem = file.name.replace(/\.[^.]+$/, '').trim() || '未命名'
          extra.push({
            ...baseNode,
            data: {
              ...(baseNode.data as AudioNodeData),
              title: `配音 · ${stem}`,
              src,
              srcAssetId: srcAssetId || undefined,
              srcFileName: file.name,
              resultSources: [src],
            } as StudioNodeData,
          })
        })
        return [...prev, ...extra]
      })
      appendHistory(`拖入音频：${audios.length} 个`)
    },
    [appendHistory, createStudioNode, setNodes],
  )

  const applyVideoFilesToNodes = useCallback(
    async (files: readonly File[], nodeIds: readonly string[], preferredFirstNodeId?: string | null) => {
      const { videos } = partitionMediaFilesByKind(files)
      if (!videos.length || !nodeIds.length) return
      const dedupIds = Array.from(new Set(nodeIds.filter(Boolean)))
      if (!dedupIds.length) return
      const orderedIds = [...dedupIds]
      if (preferredFirstNodeId && orderedIds.includes(preferredFirstNodeId)) {
        const rest = orderedIds.filter((id) => id !== preferredFirstNodeId)
        orderedIds.splice(0, orderedIds.length, preferredFirstNodeId, ...rest)
      }
      const count = Math.min(videos.length, orderedIds.length)
      for (let i = 0; i < count; i += 1) {
        const file = videos[i]
        const nodeId = orderedIds[i]
        if (!file || !nodeId) continue
        applyVideoFileToNode(nodeId, file)
      }
      appendHistory(`批量填充节点：${count} 个视频`)
    },
    [appendHistory, applyVideoFileToNode],
  )

  const applyAudioFilesToNodes = useCallback(
    async (files: readonly File[], nodeIds: readonly string[], preferredFirstNodeId?: string | null) => {
      const { audios } = partitionMediaFilesByKind(files)
      if (!audios.length || !nodeIds.length) return
      const dedupIds = Array.from(new Set(nodeIds.filter(Boolean)))
      if (!dedupIds.length) return
      const orderedIds = [...dedupIds]
      if (preferredFirstNodeId && orderedIds.includes(preferredFirstNodeId)) {
        const rest = orderedIds.filter((id) => id !== preferredFirstNodeId)
        orderedIds.splice(0, orderedIds.length, preferredFirstNodeId, ...rest)
      }
      const count = Math.min(audios.length, orderedIds.length)
      for (let i = 0; i < count; i += 1) {
        const file = audios[i]
        const nodeId = orderedIds[i]
        if (!file || !nodeId) continue
        await applyAudioFileToNode(nodeId, file)
      }
      appendHistory(`批量填充节点：${count} 个音频`)
    },
    [appendHistory, applyAudioFileToNode],
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
   * 将一组节点/边合并到当前画布：包围盒中心对齐到 flowAnchor（加与粘贴相同的错位 stagger）。
   */
  const mergeSubgraphAtFlowCenter = useCallback(
    async (
      incomingNodes: Node<StudioNodeData>[],
      incomingEdges: Edge[],
      flowAnchor: XYPosition,
      opts?: { hydrateLocalAssets?: boolean; historyLabel?: string; skipAnchorStagger?: boolean },
    ) => {
      if (!incomingNodes.length) return
      let nodesToMerge = structuredClone(incomingNodes) as Node<StudioNodeData>[]
      if (opts?.hydrateLocalAssets) {
        nodesToMerge = await hydrateNodesLocalImageAssets(nodesToMerge)
      }
      const edgesToMerge = structuredClone(incomingEdges) as Edge[]
      const bb = getNodesBounds(nodesToMerge)
      if (!bb) return
      const clipCx = (bb.minX + bb.maxX) / 2
      const clipCy = (bb.minY + bb.maxY) / 2

      let staggerX = 0
      let staggerY = 0
      if (!opts?.skipAnchorStagger) {
        internalPasteStaggerRef.current += 1
        const s = (internalPasteStaggerRef.current - 1) % 6
        staggerX = (s % 3) * 44
        staggerY = Math.floor(s / 3) * 44
      }
      const targetX = flowAnchor.x + staggerX
      const targetY = flowAnchor.y + staggerY
      const deltaX = targetX - clipCx
      const deltaY = targetY - clipCy

      const allocatedTitles = new Set(
        nodes.map((n) => String(n.data.title ?? '').trim()).filter(Boolean),
      )
      const idMap = new Map<string, string>()
      const pastedNodes = nodesToMerge.map((node) => {
        const nextId = crypto.randomUUID()
        idMap.set(node.id, nextId)
        const rawTitle = String(node.data.title ?? '').trim()
        const kind = String(node.data.kind || '') as StudioNodeKind
        const fallbackTitle = `${NODE_KIND_LABEL[kind] || '节点'}节点`
        const uniqueTitle =
          node.type === 'ghost' || node.type === 'group'
            ? rawTitle || fallbackTitle
            : allocateUniqueNodeTitle(allocatedTitles, rawTitle || fallbackTitle)
        const prevThumbs = node.data.resultThumbnails
        return {
          ...structuredClone(node),
          id: nextId,
          selected: true,
          data: {
            ...node.data,
            title: uniqueTitle,
            srcDiskPath: undefined,
            resultThumbnails: Array.isArray(prevThumbs)
              ? prevThumbs.map((t) => ({ ...t, diskPath: undefined }))
              : prevThumbs,
          } as StudioNodeData,
          position: {
            x: node.position.x + deltaX,
            y: node.position.y + deltaY,
          },
        }
      })
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
        if (data.kind === 'image') {
          const nextPrompt = remapMentionIdsInTextForPaste(
            String(data.prompt || ''),
            idMap,
            pastedNodeTitleById,
          )
          if (nextPrompt === String(data.prompt || '')) return node
          return { ...node, data: { ...data, prompt: nextPrompt } as StudioNodeData }
        }
        if (data.kind === 'video') {
          const vd = data as VideoNodeData
          const nextPrompt = remapMentionIdsInTextForPaste(
            String(vd.prompt || ''),
            idMap,
            pastedNodeTitleById,
          )
          const nextPrompt2 = remapMentionIdsInTextForPaste(
            String(vd.prompt2 || ''),
            idMap,
            pastedNodeTitleById,
          )
          const nextPrompt3 = remapMentionIdsInTextForPaste(
            String(vd.prompt3 || ''),
            idMap,
            pastedNodeTitleById,
          )
          const nextPrompt4 = remapMentionIdsInTextForPaste(
            String(vd.prompt4 || ''),
            idMap,
            pastedNodeTitleById,
          )
          const prevExtras = Array.isArray(vd.extraPrompts) ? vd.extraPrompts : []
          const nextExtras = prevExtras.map((s) =>
            remapMentionIdsInTextForPaste(String(s || ''), idMap, pastedNodeTitleById),
          )
          const extrasUnchanged =
            nextExtras.length === prevExtras.length &&
            nextExtras.every((s, i) => s === String(prevExtras[i] || ''))
          if (
            nextPrompt === String(vd.prompt || '') &&
            nextPrompt2 === String(vd.prompt2 || '') &&
            nextPrompt3 === String(vd.prompt3 || '') &&
            nextPrompt4 === String(vd.prompt4 || '') &&
            extrasUnchanged
          ) {
            return node
          }
          return {
            ...node,
            data: {
              ...vd,
              prompt: nextPrompt,
              prompt2: nextPrompt2,
              prompt3: nextPrompt3,
              prompt4: nextPrompt4,
              ...(nextExtras.length ? { extraPrompts: nextExtras } : { extraPrompts: undefined }),
            } as StudioNodeData,
          }
        }
        if (data.kind === 'audio' || data.kind === 'music') {
          const nextNote = remapMentionIdsInTextForPaste(String(data.note || ''), idMap, pastedNodeTitleById)
          if (nextNote === String(data.note || '')) return node
          return { ...node, data: { ...data, note: nextNote } as StudioNodeData }
        }
        return node
      })
      const pastedEdgesRemapped = edgesToMerge
        .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
        .map((edge) => ({
          ...structuredClone(edge),
          id: crypto.randomUUID(),
          source: idMap.get(edge.source) as string,
          target: idMap.get(edge.target) as string,
          selected: false,
        }))
      const pastedEdges = migrateVideoTargetEdges(
        pastedNodesWithRemappedMentions,
        pastedEdgesRemapped,
      )
      setNodes((prev) =>
        prev.map((node) => ({ ...node, selected: false })).concat(pastedNodesWithRemappedMentions),
      )
      setEdges((prev) => prev.concat(pastedEdges))
      setSelectedNodeId(pastedNodesWithRemappedMentions[0]?.id ?? null)
      appendHistory(
        opts?.historyLabel ?? `粘贴节点：${pastedNodesWithRemappedMentions.length} 个`,
      )
    },
    [appendHistory, nodes, setEdges, setNodes],
  )

  const mergePresetTemplateFromLibrary = useCallback(
    async (payload: PresetTemplateDragPayload, flowAnchor: XYPosition) => {
      try {
        const snap = await loadPresetTemplateSnapshot(payload.id)
        if (!snap.nodes?.length) {
          window.alert('该预设没有可合并的节点')
          return
        }
        await mergeSubgraphAtFlowCenter(snap.nodes, snap.edges, flowAnchor, {
          hydrateLocalAssets: true,
          historyLabel: `已从预设模板合并：${payload.name}（${snap.nodes.length} 个节点）`,
        })
      } catch (e) {
        const msg = String((e as Error)?.message || e)
        window.alert(msg)
      }
    },
    [mergeSubgraphAtFlowCenter],
  )

  /**
   * 画布拖入外部文件：图片 / 视频 / 音频在落点新建节点；工程 JSON 可导入项目。
   */
  const onCanvasDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer?.types?.length) return
    const types = Array.from(event.dataTransfer.types)
    if (types.includes(FLOWID_MATERIAL_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      return
    }
    if (types.includes(FLOWID_PRESET_TEMPLATE_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      return
    }
    if (!types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const presetPayload = parsePresetTemplateDragPayload(event.dataTransfer)
      if (presetPayload) {
        const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        void mergePresetTemplateFromLibrary(presetPayload, pos)
        return
      }
      const material = parseFlowidMaterialDragPayload(event.dataTransfer)
      if (material?.src) {
        const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const newId = crypto.randomUUID()
        const rawTitle = String(material.title || '').trim().slice(0, 80)
        if (material.kind === 'image') {
          const base = createStudioNode('image', newId, pos, rawTitle || undefined)
          setNodes((nds) => [
            ...nds,
            { ...base, data: { ...(base.data as ImageNodeData), src: material.src } },
          ])
          appendHistory(`已从输出条/素材拖入画布：新建图片节点`)
          return
        }
        if (material.kind === 'video') {
          const base = createStudioNode('video', newId, pos, rawTitle || undefined)
          setNodes((nds) => [
            ...nds,
            { ...base, data: { ...(base.data as VideoNodeData), src: material.src } },
          ])
          appendHistory(`已从输出条/素材拖入画布：新建视频节点`)
          return
        }
        if (material.kind === 'audio') {
          const base = createStudioNode('audio', newId, pos, rawTitle || undefined)
          setNodes((nds) => [
            ...nds,
            {
              ...base,
              data: {
                ...(base.data as AudioNodeData),
                src: material.src,
                resultSources: [material.src],
              },
            },
          ])
          appendHistory(`已从输出条/素材拖入画布：新建配音节点`)
          return
        }
      }
      const list = event.dataTransfer?.files
      if (!list?.length) return
      const droppedFiles = Array.from(list)
      const { images: imageFiles, videos: videoFiles, audios: audioFiles } =
        partitionMediaFilesByKind(droppedFiles)
      /**
       * 画布支持直接拖入 Flowid 工程 JSON：行为等同「本地项目 -> 从 JSON 导入」。
       */
      const projectJsonFiles = droppedFiles.filter((f) => {
        const lower = f.name.toLowerCase()
        if (lower.endsWith('.json')) return true
        const t = String(f.type || '').toLowerCase()
        return t === 'application/json' || t === 'text/json'
      })
      const hasMedia =
        imageFiles.length > 0 || videoFiles.length > 0 || audioFiles.length > 0
      if (!hasMedia && projectJsonFiles.length) {
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
      if (!hasMedia) return

      /** 框选优先：若已有可接素材的节点被选中，按类型匹配后批量填充。 */
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
        if (imageFiles.length) {
          void applyImageFilesToNodes(imageFiles, selectedIds, preferred)
          return
        }
        if (videoFiles.length) {
          const videoNodeIds = selectedFillNodes
            .filter((n) => n.data.kind === 'video')
            .map((n) => n.id)
          if (videoNodeIds.length) {
            void applyVideoFilesToNodes(
              videoFiles,
              videoNodeIds,
              preferred && videoNodeIds.includes(preferred) ? preferred : null,
            )
            return
          }
        }
        if (audioFiles.length) {
          const audioNodeIds = selectedFillNodes
            .filter((n) => n.data.kind === 'audio' || n.data.kind === 'music')
            .map((n) => n.id)
          if (audioNodeIds.length) {
            void applyAudioFilesToNodes(
              audioFiles,
              audioNodeIds,
              preferred && audioNodeIds.includes(preferred) ? preferred : null,
            )
            return
          }
        }
      }

      if (nodeId) {
        const targetNode = nodes.find((n) => n.id === nodeId)
        const kind = targetNode?.data.kind
        if (
          imageFiles.length &&
          (kind === 'image' ||
            kind === 'video' ||
            kind === 'audio' ||
            kind === 'music' ||
            kind === 'panorama')
        ) {
          const first = imageFiles[0]
          if (!first) return
          void applyImageFileToNode(nodeId, first)
          return
        }
        if (videoFiles.length && kind === 'video') {
          const first = videoFiles[0]
          if (!first) return
          applyVideoFileToNode(nodeId, first)
          return
        }
        if (audioFiles.length && (kind === 'audio' || kind === 'music')) {
          const first = audioFiles[0]
          if (!first) return
          void applyAudioFileToNode(nodeId, first)
          return
        }
      }
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void (async () => {
        let yOff = 0
        if (imageFiles.length) {
          await addImageFilesAtFlowPosition(imageFiles, { x: pos.x, y: pos.y + yOff })
          yOff += imageFiles.length * FLOWID_CANVAS_DROP_STACK_STEP_Y
        }
        if (videoFiles.length) {
          addVideoFilesAtFlowPosition(videoFiles, { x: pos.x, y: pos.y + yOff })
          yOff += videoFiles.length * FLOWID_CANVAS_DROP_STACK_STEP_Y
        }
        if (audioFiles.length) {
          await addAudioFilesAtFlowPosition(audioFiles, { x: pos.x, y: pos.y + yOff })
        }
      })()
    },
    [
      addAudioFilesAtFlowPosition,
      addImageFilesAtFlowPosition,
      addVideoFilesAtFlowPosition,
      applyAudioFileToNode,
      applyAudioFilesToNodes,
      applyImageFileToNode,
      applyImageFilesToNodes,
      applyVideoFileToNode,
      applyVideoFilesToNodes,
      appendHistory,
      createStudioNode,
      mergePresetTemplateFromLibrary,
      nodes,
      openImportedProjectInNewTab,
      parseProjectFile,
      screenToFlowPosition,
      setNodes,
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
      const assetRowId =
        kind === 'image'
          ? String((node.data as ImageNodeData).referenceImageAssetIds?.[index] ?? '').trim()
          : kind === 'video'
            ? String((node.data as VideoNodeData).referenceImageAssetIds?.[index] ?? '').trim()
            : kind === 'audio' || kind === 'music'
              ? String((node.data as AudioNodeData).referenceImageAssetIds?.[index] ?? '').trim()
              : ''
      if (
        url.startsWith('blob:') &&
        !assetRowId &&
        !isBlobUrlHeldInLocalAssetObjectUrlCache(url)
      ) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // ignore
        }
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
      } else if (kind === 'audio' || kind === 'music') {
        const d = node.data as AudioNodeData
        updateNodeData(id, {
          kind: d.kind,
          referenceImageSources: (d.referenceImageSources ?? []).filter((_, i) => i !== index),
          referenceImageAssetIds: (d.referenceImageAssetIds ?? []).filter((_, i) => i !== index),
        } as Partial<StudioNodeData>)
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
          if (kind !== 'image' && kind !== 'video' && kind !== 'audio' && kind !== 'music') return n
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
                  edges,
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
                  edges,
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
                edges,
              ),
            } as StudioNodeData,
          }
        }),
      )
    },
    [setNodes, edges],
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
            const mentionUrls = listMentionImageAttachments(nextPrompt, prev, promptPanel.node.id, edges)
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
            const mentionUrls = listMentionImageAttachments(nextPrompt, prev, promptPanel.node.id, edges)
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
            const mentionUrls = listMentionImageAttachments(nextNote, prev, promptPanel.node.id, edges)
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
    [promptPanel, setNodes, edges],
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
      const restrict =
        promptPanel.node.id && edges?.length
          ? collectUpstreamNodeIds(promptPanel.node.id, edges)
          : undefined
      const hit = resolveMentionRefToNode(ref, nodes, promptPanel.node.id, undefined, restrict)
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
    [nodes, promptPanel, updateNodeData, edges],
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

  useEffect(() => {
    const handler = async (payload: AgentSceneBatchPayload) => {
      try {
        createProjectLabel()
        await new Promise<void>((r) => {
          setTimeout(r, 50)
        })
        const scriptId = crypto.randomUUID()
        const imageId = crypto.randomUUID()
        const scriptTitle = '自动剧本（任务）'
        const imageTitle = `场景图×${payload.sceneCount}`
        setNodes(() => [
          createStudioNode('script', scriptId, { x: 140, y: 180 }, scriptTitle),
          createStudioNode('image', imageId, { x: 600, y: 180 }, imageTitle),
        ])
        setEdges(() =>
          addEdge(
            {
              id: crypto.randomUUID(),
              source: scriptId,
              target: imageId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            [],
          ),
        )
        await awaitSensitiveLexiconSettled()
        const spGate = canSend(payload.userPrompt)
        if (!spGate.allowed) {
          alertSensitiveWordBlocked(spGate.reason ?? '指令包含敏感内容')
          return { ok: false, summary: spGate.reason ?? '指令包含敏感内容' }
        }
        updateNodeData(scriptId, { kind: 'script', body: replaceSensitiveWords(payload.userPrompt) })
        appendHistory(`智能体：已创建「${scriptTitle}」→「${imageTitle}」连线（示例）`)
        return {
          ok: true,
          summary: `已完成。请在**当前新建的项目标签**画布查看「${scriptTitle}」与「${imageTitle}」及连线；剧本节点已写入你的指令。选中「${imageTitle}」后可在右侧执行出图（需已配置工作流）。`,
        }
      } catch (e) {
        return { ok: false, summary: (e as Error)?.message || '执行异常' }
      }
    }
    registerStudioAgentExecutor(handler)
    return () => registerStudioAgentExecutor(null)
  }, [appendHistory, createProjectLabel, setNodes, setEdges, updateNodeData])

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
    const last = undoStackRef.current[undoStackRef.current.length - 1]
    if (nodeCanvasDragActiveRef.current && last) {
      const liveTopo = canvasSnapshotTopologyKey({
        nodes,
        edges,
        viewport: last.viewport,
      })
      if (canvasSnapshotTopologyKey(last) === liveTopo) return
    }
    const next = cloneCanvasSnapshot(getCanvasSnapshot())
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
    internalPasteStaggerRef.current = 0
    setClipboard({
      nodes: structuredClone(selectedNodes),
      edges: structuredClone(selectedEdges),
    })
    appendHistory(`复制节点：${selectedNodes.length} 个`)
  }, [appendHistory, edges, nodes, selectedNodeIds])

  /**
   * Ctrl+D 复制副本：在选中包围盒 **正下方** 落点，顶边距选区底边 `DUPLICATE_BELOW_GAP_FLOW`（与符号拆分横向间距一致取 20px）。
   * 同步写入内存剪贴板，且不依赖「先 setState 再读 clipboard」的同一拍延迟。
   */
  const duplicateSelectedNodes = useCallback(async () => {
    if (!selectedNodeIds.length) return
    const selected = new Set(selectedNodeIds)
    const selectedNodes = nodes.filter((node) => selected.has(node.id))
    const selectedEdges = edges.filter(
      (edge) => selected.has(edge.source) && selected.has(edge.target),
    )
    if (!selectedNodes.length) return
    internalPasteStaggerRef.current = 0
    const clipboardPayload: CanvasClipboard = {
      nodes: structuredClone(selectedNodes),
      edges: structuredClone(selectedEdges),
    }
    setClipboard(clipboardPayload)
    const pastedBb = getNodesBounds(clipboardPayload.nodes)
    const selBb = getNodesBounds(selectedNodes)
    if (!pastedBb || !selBb) return
    const clipCx = (pastedBb.minX + pastedBb.maxX) / 2
    const clipCy = (pastedBb.minY + pastedBb.maxY) / 2
    const deltaX = selBb.minX - pastedBb.minX
    const deltaY = selBb.maxY + DUPLICATE_BELOW_GAP_FLOW - pastedBb.minY
    const anchorX = clipCx + deltaX
    const anchorY = clipCy + deltaY
    await mergeSubgraphAtFlowCenter(clipboardPayload.nodes, clipboardPayload.edges, { x: anchorX, y: anchorY }, {
      historyLabel: `复制副本：${clipboardPayload.nodes.length} 个`,
      skipAnchorStagger: true,
    })
  }, [edges, mergeSubgraphAtFlowCenter, nodes, selectedNodeIds, setClipboard])

  /**
   * 粘贴剪贴板内容到当前画布。
   * 将剪贴板包围盒中心对齐到 **当前视口中心**（跨项目粘贴时原坐标可能很远，旧逻辑只加纵向偏移会贴在屏幕外）。
   */
  const pasteClipboardNodes = useCallback(() => {
    if (!clipboard || !clipboard.nodes.length) return
    const bb = getNodesBounds(clipboard.nodes)
    if (!bb) return
    const clipCx = (bb.minX + bb.maxX) / 2
    const clipCy = (bb.minY + bb.maxY) / 2
    let anchorX = clipCx
    let anchorY = clipCy
    const root = reactFlowRootRef.current
    if (root) {
      const r = root.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        const center = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
        anchorX = center.x
        anchorY = center.y
      }
    }
    void mergeSubgraphAtFlowCenter(clipboard.nodes, clipboard.edges, { x: anchorX, y: anchorY })
  }, [clipboard, mergeSubgraphAtFlowCenter, screenToFlowPosition])

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
        void duplicateSelectedNodes()
        return
      }
      /**
       * 画布撤销/重做：仅在非输入控件上触发（输入框内 Ctrl+Z 交给浏览器做逐字撤销）。
       * 符号拆分后会对提示框 textarea 执行 blur，便于下一步直接撤画布。
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
    duplicateSelectedNodes,
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

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const tid = connection.target
    const sid = connection.source
    if (!tid || !sid) return false
    const t = nodesRef.current.find((n) => n.id === tid)
    const s = nodesRef.current.find((n) => n.id === sid)
    if (!t || !s) return true
    if (t.data.kind === 'imageCompare' || s.data.kind === 'imageCompare') return false
    if (t.data.kind !== 'video') return true
    const th = connection.targetHandle ?? ''
    const sk = s.data.kind
    if (!shouldInheritIntoVideoOnConnect(sk, th || VIDEO_IN_UNIFIED)) {
      return false
    }
    const dupSamePair = edgesRef.current.some((e) => e.source === sid && e.target === tid)
    return !dupSamePair
  }, [])

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceId = connection.source
      const targetId = connection.target
      const targetPre = targetId
        ? nodesRef.current.find((n) => n.id === targetId)?.data.kind
        : undefined
      const connPayload = {
        ...connection,
        ...(targetPre === 'video' ? { targetHandle: VIDEO_IN_UNIFIED } : {}),
        animated: true,
        style: { strokeWidth: 2 },
      }
      setEdges((eds) => addEdge(connPayload, eds))
      if (!sourceId || !targetId) return
      const previewEdges = addEdge(connPayload, edgesRef.current)
      setNodes((prev) => {
        const source = prev.find((n) => n.id === sourceId)
        const target = prev.find((n) => n.id === targetId)
        if (!source || !target) return prev
        const sourceTitle = String(source.data.title || '').trim()
        const sk = source.data.kind
        const tk = target.data.kind
        const videoTextSlot =
          tk === 'video' && (sk === 'text' || sk === 'script')
            ? computeVideoTextPromptSlot(previewEdges, prev, targetId, sourceId)
            : undefined
        const rawPatch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id, {
          sourceKind: sk,
          videoTextSlot,
        })
        const patch =
          tk === 'video' && rawPatch && !shouldInheritIntoVideoOnConnect(sk, VIDEO_IN_UNIFIED)
            ? null
            : rawPatch

        /**
         * 图片节点 <-> VR 全景节点：直接把图片资源覆盖到 panorama 的纹理上。
         * PanoramaNode 仅依赖 `data.src` 渲染贴图；不写 `src` 就不会刷新预览。
         *
         * 连接方向不确定（可能 image->panorama，也可能 panorama->image），所以两端都要兜底。
         */
        const panoramaNodeId =
          tk === 'panorama' ? targetId : sk === 'panorama' ? sourceId : ''
        const imageNode =
          tk === 'panorama'
            ? (source as Node<StudioNodeData>)
            : sk === 'panorama'
              ? (target as Node<StudioNodeData>)
              : null

        const panoramaSrcPatch: Partial<StudioNodeData> | null =
          panoramaNodeId && imageNode?.data.kind === 'image'
            ? ({
                src: String((imageNode.data as any).src || '').trim(),
                srcAssetId: (imageNode.data as any).srcAssetId,
                srcFileName: (imageNode.data as any).srcFileName,
                rectilinearSrc: undefined, // 换全景后旧“当前视角导出”作废
              } as Partial<StudioNodeData>)
            : null
        const titlePatches = new Map<string, string>()
        const tryAlignVisualToAnchor = (
          anchor: Node<StudioNodeData>,
          visual: Node<StudioNodeData>,
        ) => {
          if (visual.data.kind !== 'image' && visual.data.kind !== 'video') return
          const derived = buildImageLinkedNewNodeBaseTitle(anchor)
          const ct = String(visual.data.title ?? '').trim()
          if (!derived || ct === derived) return
          const syncPlaceholder = isDefaultLinkedVisualNodeTitle(ct)
          const syncPlainDefault =
            (visual.data.kind === 'image' && isDefaultStyledImageNodeTitle(ct)) ||
            (visual.data.kind === 'video' && isDefaultStyledVideoNodeTitle(ct))
          if (syncPlaceholder || syncPlainDefault) {
            titlePatches.set(visual.id, derived)
          }
        }
        if (sk === 'text' || sk === 'script') {
          if (tk === 'image' || tk === 'video') {
            const alignVisualToUpstream =
              tk !== 'video' ||
              !((sk === 'text' || sk === 'script') && videoTextSlot !== 1)
            if (alignVisualToUpstream) {
              tryAlignVisualToAnchor(source as Node<StudioNodeData>, target as Node<StudioNodeData>)
            }
          }
        }
        if (tk === 'text' || tk === 'script') {
          if (sk === 'image' || sk === 'video') {
            tryAlignVisualToAnchor(target as Node<StudioNodeData>, source as Node<StudioNodeData>)
          }
        }
        if (!patch && !panoramaSrcPatch && titlePatches.size === 0) return prev
        return prev.map((node) => {
          let nextData = node.data as StudioNodeData
          if (node.id === targetId && patch) {
            nextData = { ...nextData, ...patch } as StudioNodeData
          }
          if (node.id === panoramaNodeId && panoramaSrcPatch) {
            nextData = { ...nextData, ...panoramaSrcPatch } as StudioNodeData
          }
          const tp = titlePatches.get(node.id)
          if (tp) {
            nextData = { ...nextData, title: tp } as StudioNodeData
          }
          if (nextData === node.data) return node
          return { ...node, data: nextData }
        })
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
    /**
     * 极少数情况下 React Flow 不会触发 onNodeDragStop（失焦、异常中断等），
     * `nodeCanvasDragActiveRef` 会一直为 true，导致后续加节点无法压入撤销栈。用 pointer 结束兜底解锁。
     */
    const failSafeEnd = () => {
      queueMicrotask(() => {
        if (!nodeCanvasDragActiveRef.current) return
        nodeCanvasDragActiveRef.current = false
        setPostDragUndoTick((n) => n + 1)
      })
    }
    window.addEventListener('pointerup', failSafeEnd, { capture: true, once: true })
    window.addEventListener('pointercancel', failSafeEnd, { capture: true, once: true })
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
          if (data.kind === 'image') {
            const nextPrompt = remapMentionIdsInTextForPaste(
              String(data.prompt || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            if (nextPrompt === String(data.prompt || '')) return node
            return { ...node, data: { ...data, prompt: nextPrompt } as StudioNodeData }
          }
          if (data.kind === 'video') {
            const vd = data as VideoNodeData
            const nextPrompt = remapMentionIdsInTextForPaste(
              String(vd.prompt || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            const nextPrompt2 = remapMentionIdsInTextForPaste(
              String(vd.prompt2 || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            const nextPrompt3 = remapMentionIdsInTextForPaste(
              String(vd.prompt3 || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            const nextPrompt4 = remapMentionIdsInTextForPaste(
              String(vd.prompt4 || ''),
              idMap,
              duplicatedNodeTitleById,
            )
            if (
              nextPrompt === String(vd.prompt || '') &&
              nextPrompt2 === String(vd.prompt2 || '') &&
              nextPrompt3 === String(vd.prompt3 || '') &&
              nextPrompt4 === String(vd.prompt4 || '')
            ) {
              return node
            }
            return {
              ...node,
              data: {
                ...vd,
                prompt: nextPrompt,
                prompt2: nextPrompt2,
                prompt3: nextPrompt3,
                prompt4: nextPrompt4,
              } as StudioNodeData,
            }
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

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      if (selectionOverrideInFlightRef.current) return

      const st: any = rfStore.getState()
      const rect = st?.userSelectionRect
      const root = reactFlowRootRef.current

      /**
       * 关键修复：React Flow 在某些环境下框选命中会漂移，导致“框一点选一大片”。
       * 仅在**正在拖框**时用 userSelectionRect 覆盖；框选结束后 store 里 rect 可能仍在，
       * 若继续覆盖会把 Ctrl+点击（从多选里去掉某个节点）立刻打回成整框命中结果。
       */
      if (rect && root && isMarqueeGestureActiveRef.current) {
        const bounds = root.getBoundingClientRect()
        const p1 = screenToFlowPosition({ x: bounds.left + rect.x, y: bounds.top + rect.y })
        const p2 = screenToFlowPosition({
          x: bounds.left + rect.x + rect.width,
          y: bounds.top + rect.y + rect.height,
        })
        const zoomNow = Number(getViewport()?.zoom ?? 1) || 1
        // 选区容错：缩放越大（更“近”）padding 越小；缩放越小 padding 越大，避免“框很准但选不中”的不灵敏感
        const pad = 10 / zoomNow
        const sel = {
          minX: Math.min(p1.x, p2.x) - pad,
          minY: Math.min(p1.y, p2.y) - pad,
          maxX: Math.max(p1.x, p2.x) + pad,
          maxY: Math.max(p1.y, p2.y) + pad,
        }

        // 手感优先：擦边也算（同时保留 pad，避免轻微抖动/像素误差导致漏选）
        const shouldUseFull = false
        const snapshotNodes = nodesRef.current
        const hitIds = new Set<string>()
        for (const n of snapshotNodes) {
          if (n.type === 'ghost' || n.type === 'group') continue
          const { width, height } = getNodeSize(n)
          const box = {
            x1: n.position.x,
            y1: n.position.y,
            x2: n.position.x + width,
            y2: n.position.y + height,
          }
          const fullyInside =
            box.x1 >= sel.minX && box.y1 >= sel.minY && box.x2 <= sel.maxX && box.y2 <= sel.maxY
          const overlap =
            box.x1 <= sel.maxX && box.x2 >= sel.minX && box.y1 <= sel.maxY && box.y2 >= sel.minY
          const hit = shouldUseFull ? fullyInside : overlap
          if (hit) hitIds.add(n.id)
        }

        selectionOverrideInFlightRef.current = true
        setNodes((prev) => prev.map((n) => ({ ...n, selected: hitIds.has(n.id) })))
        setEdges((prev) => prev.map((e) => ({ ...e, selected: false })))
        queueMicrotask(() => {
          selectionOverrideInFlightRef.current = false
        })

        const eligibleSelected = snapshotNodes.filter(
          (n) => hitIds.has(n.id) && n.type !== 'ghost' && n.type !== 'group',
        )
        if (eligibleSelected.length === 1) {
          setSelectedNodeId(eligibleSelected[0]!.id)
        } else {
          setSelectedNodeId(null)
        }
        if (eligibleSelected.length < 1) {
          dismissMultiSelectContextMenu()
        }

        if (import.meta.env.DEV && localStorage.getItem('flowidDebugSelection') === '1') {
          try {
            // eslint-disable-next-line no-console
            console.log('[Flowid select-debug:override]', { rectPx: rect, flowRect: sel, hitCount: hitIds.size })
          } catch {
            // ignore
          }
        }
        return
      }

      // 无框选矩形（点击单选/程序性选择）走默认逻辑
      const eligibleSelected = params.nodes.filter((node) => node.type !== 'ghost' && node.type !== 'group')
      if (eligibleSelected.length === 1) {
        setSelectedNodeId(eligibleSelected[0]!.id)
      } else {
        setSelectedNodeId(null)
      }
      if (eligibleSelected.length < 1) {
        dismissMultiSelectContextMenu()
      }
    },
    [dismissMultiSelectContextMenu, rfStore, screenToFlowPosition, setNodes, setEdges, getViewport],
  )

  /**
   * 框选开始时默认清空旧选区（除非用户按住 Ctrl/Meta 明确要“追加选中”）。
   * 目的：避免分组区域/历史选区导致“框右边却把左边也一起选中”的错觉。
   */
  const onSelectionStart = useCallback(
    (event: ReactMouseEvent) => {
      isMarqueeGestureActiveRef.current = true
      const native = event.nativeEvent as MouseEvent
      // 注意：部分键盘右 Alt(AltGr) 会以 Ctrl+Alt 的形式上报；
      // 若把 ctrlKey 直接当作“追加多选”，会导致按了 Alt 后框选不清空旧选区。
      const isAdditive = Boolean((native?.ctrlKey && !native?.altKey) || native?.metaKey)
      if (isAdditive) return
      setNodes((prev) =>
        prev.some((n) => n.selected) ? prev.map((n) => (n.selected ? { ...n, selected: false } : n)) : prev,
      )
      setEdges((prev) =>
        prev.some((e) => e.selected) ? prev.map((e) => (e.selected ? { ...e, selected: false } : e)) : prev,
      )
    },
    [setEdges, setNodes],
  )

  const onSelectionEnd = useCallback(() => {
    isMarqueeGestureActiveRef.current = false
  }, [])

  /**
   * 兜底：按住「框选键」（默认 Shift，可在设置改为 Alt）在画布空白处准备框选时，先清空旧选区（除非 Ctrl/Meta 追加）。
   * 某些情况下（例如命中 RF 的 selection-rect 层）不会触发 `onSelectionStart`，导致旧选区残留。
   */
  const onCanvasMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      const native = event.nativeEvent as MouseEvent
      const el = event.target as HTMLElement | null
      // 仅在画布区域内生效（避免顶部栏/面板点击触发清空）
      if (!el || !el.closest?.('.react-flow')) return
      const marqueeKey = normalizeMarqueeSelectionKey(shortcuts.bindings.marqueeSelect)
      if (!nativeHasMarqueeModifier(native, marqueeKey)) return
      const isAdditive = Boolean((native?.ctrlKey && !native?.altKey) || native?.metaKey)
      if (isAdditive) return
      isMarqueeGestureActiveRef.current = true
      setNodes((prev) =>
        prev.some((n) => n.selected) ? prev.map((n) => (n.selected ? { ...n, selected: false } : n)) : prev,
      )
      setEdges((prev) =>
        prev.some((e) => e.selected) ? prev.map((e) => (e.selected ? { ...e, selected: false } : e)) : prev,
      )
    },
    [setEdges, setNodes, shortcuts.bindings.marqueeSelect],
  )

  /**
   * 多选时 RF 会在节点上方叠一层 `react-flow__nodesselection-rect`，普通点击落在该层，
   * `onNodeClick` / 内部多选切换拿不到事件，Ctrl+点击无法从多选里去掉某个节点。
   * 在捕获阶段：若 Ctrl/Cmd + 点中该层，则用 elementsFromPoint 跳过该层命中下方节点并手动切换 selected。
   *
   * 注意：仅拦 `pointerdown` 不够——鼠标仍会派发 `mousedown`，会传到该层上的 d3-drag，
   * 可能触发内部 `unselectNodesAndEdges` 等逻辑，表现成「一点击整组选区全被取消」。
   * 因此需同步拦截 `mousedown`，并吞掉紧随的 `click`。
   */
  const additiveChromeGestureRef = useRef<{
    t: number
    x: number
    y: number
    toggled: boolean
    swallowClickUntil: number
  } | null>(null)

  useEffect(() => {
    const resolveRawIdUnderNodesSelection = (clientX: number, clientY: number): string | null => {
      const stack = document.elementsFromPoint(clientX, clientY)
      for (const el of stack) {
        if (!(el instanceof HTMLElement)) continue
        if (
          el.classList.contains('react-flow__nodesselection') ||
          el.classList.contains('react-flow__nodesselection-rect')
        ) {
          continue
        }
        const hit = el.closest('.react-flow__node[data-id]')
        if (hit instanceof HTMLElement) {
          return hit.getAttribute('data-id')?.trim() || null
        }
      }
      return null
    }

    const shouldHandleChromeAdditive = (e: PointerEvent | MouseEvent): boolean => {
      const root = reactFlowRootRef.current
      if (!root) return false
      const t = e.target
      if (!(t instanceof Node) || !root.contains(t)) return false
      if (e.button !== 0) return false
      if (!e.metaKey && !(e.ctrlKey && !e.altKey)) return false
      const path = e.composedPath()
      const hitChrome = path.some(
        (el): el is HTMLElement =>
          el instanceof HTMLElement &&
          (el.classList.contains('react-flow__nodesselection') ||
            el.classList.contains('react-flow__nodesselection-rect')),
      )
      if (!hitChrome) return false
      if (e.target instanceof HTMLElement) {
        const deep = e.target.closest('button, input, textarea, select, a[href]')
        if (deep && root.contains(deep)) return false
      }
      return true
    }

    const blockEvent = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }

    const onPointerDownCapture = (e: PointerEvent) => {
      if (!shouldHandleChromeAdditive(e)) return
      const rawId = resolveRawIdUnderNodesSelection(e.clientX, e.clientY)
      const cur = rawId ? nodesRef.current.find((n) => n.id === rawId) : null
      if (rawId && cur && cur.type !== 'ghost' && cur.type !== 'group') {
        blockEvent(e)
        const now = performance.now()
        additiveChromeGestureRef.current = {
          t: now,
          x: e.clientX,
          y: e.clientY,
          toggled: true,
          swallowClickUntil: now + 500,
        }
        setNodes((prev) => {
          const next = prev.map((n) => (n.id === rawId ? { ...n, selected: !n.selected } : n))
          const eligible = next.filter((n) => n.selected && n.type !== 'ghost' && n.type !== 'group')
          queueMicrotask(() => {
            if (eligible.length === 1) {
              setSelectedNodeId(eligible[0]!.id)
            } else {
              setSelectedNodeId(null)
            }
          })
          return next
        })
        return
      }
      /** 点在多选层空白处：仍阻止穿透到 d3，避免误触整组逻辑 */
      blockEvent(e)
      additiveChromeGestureRef.current = {
        t: performance.now(),
        x: e.clientX,
        y: e.clientY,
        toggled: false,
        swallowClickUntil: performance.now() + 500,
      }
    }

    const onMouseDownCapture = (e: MouseEvent) => {
      if (!shouldHandleChromeAdditive(e)) return
      const g = additiveChromeGestureRef.current
      const now = performance.now()
      if (
        g &&
        g.toggled &&
        now - g.t < 200 &&
        Math.hypot(e.clientX - g.x, e.clientY - g.y) < 12
      ) {
        blockEvent(e)
        return
      }
      const rawId = resolveRawIdUnderNodesSelection(e.clientX, e.clientY)
      const cur = rawId ? nodesRef.current.find((n) => n.id === rawId) : null
      if (rawId && cur && cur.type !== 'ghost' && cur.type !== 'group') {
        blockEvent(e)
        additiveChromeGestureRef.current = {
          t: now,
          x: e.clientX,
          y: e.clientY,
          toggled: true,
          swallowClickUntil: now + 500,
        }
        setNodes((prev) => {
          const next = prev.map((n) => (n.id === rawId ? { ...n, selected: !n.selected } : n))
          const eligible = next.filter((n) => n.selected && n.type !== 'ghost' && n.type !== 'group')
          queueMicrotask(() => {
            if (eligible.length === 1) {
              setSelectedNodeId(eligible[0]!.id)
            } else {
              setSelectedNodeId(null)
            }
          })
          return next
        })
        return
      }
      blockEvent(e)
    }

    const onClickCapture = (e: MouseEvent) => {
      const g = additiveChromeGestureRef.current
      if (!g || e.button !== 0) return
      if (performance.now() > g.swallowClickUntil) {
        additiveChromeGestureRef.current = null
        return
      }
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 14) return
      const root = reactFlowRootRef.current
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return
      blockEvent(e)
    }

    window.addEventListener('pointerdown', onPointerDownCapture, true)
    window.addEventListener('mousedown', onMouseDownCapture, true)
    window.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true)
      window.removeEventListener('mousedown', onMouseDownCapture, true)
      window.removeEventListener('click', onClickCapture, true)
    }
  }, [setNodes, setSelectedNodeId])

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
   * 框选/点选恰好两张图片节点：新建本地滑动对比节点（不跑 Comfy）。
   */
  const createImageCompareFromContextMenuSelection = useCallback(() => {
    const pick = contextMenuImageCompareTwoPick
    if (!pick) return
    const sorted = [pick.a, pick.b].sort((a, b) => {
      const dy = a.position.y - b.position.y
      if (Math.abs(dy) > 48) return dy
      return a.position.x - b.position.x
    })
    const urlA = getPrimaryImageDisplayUrlForCompare(sorted[0]!)
    const urlB = getPrimaryImageDisplayUrlForCompare(sorted[1]!)
    if (!urlA || !urlB) {
      window.alert('两张图片节点都需要有可显示的预览图（主图或输出缩略图列表中的首张图）。')
      return
    }
    dismissMultiSelectContextMenu()
    const sz0 = getNodeSize(sorted[0]!)
    const sz1 = getNodeSize(sorted[1]!)
    const minX = Math.min(sorted[0]!.position.x, sorted[1]!.position.x)
    const maxR = Math.max(sorted[0]!.position.x + sz0.width, sorted[1]!.position.x + sz1.width)
    const maxB = Math.max(sorted[0]!.position.y + sz0.height, sorted[1]!.position.y + sz1.height)
    const newW = 520
    const position = {
      x: (minX + maxR) / 2 - newW / 2,
      y: maxB + NODE_APPEND_GAP,
    }
    const id = crypto.randomUUID()
    setNodes((nds) => {
      const index = getNextNodeTitleIndex(nds, 'imageCompare')
      const title = `${NODE_KIND_LABEL.imageCompare}节点${index}`
      const cleared = nds.map((n) => ({ ...n, selected: false }))
      const node = createImageCompareStudioNode(id, position, title, {
        compareSrcA: urlA,
        compareSrcB: urlB,
        compareLabelA: String(sorted[0]!.data.title || '').trim().slice(0, 40),
        compareLabelB: String(sorted[1]!.data.title || '').trim().slice(0, 40),
      })
      return [...cleared, { ...node, selected: true }]
    })
    appendHistory('新增图像对比节点')
  }, [
    appendHistory,
    contextMenuImageCompareTwoPick,
    dismissMultiSelectContextMenu,
    setNodes,
  ])

  /**
   * 新增节点；若传入 `flowPosition` 则在指定画布坐标落点，否则落在屏幕偏中位置。
   */
  const addNode = useCallback(
    (kind: StudioNodeKind, flowPosition?: XYPosition) => {
      const id = crypto.randomUUID()
      const pending = pendingCanvasNodePositionRef.current
      const rawBase =
        flowPosition ??
        pending ??
        screenToFlowPosition({
          x: window.innerWidth * 0.46,
          y: window.innerHeight * 0.38,
        })
      pendingCanvasNodePositionRef.current = null
      const useStagger = !flowPosition && !pending
      const staggerN = countStaggerEligibleNodes(nodesRef.current as Node<StudioNodeData>[])
      const position = useStagger ? staggerAutoPlacedPosition(rawBase, staggerN) : rawBase
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
    (kind: StudioNodeKind, pointerFlow?: XYPosition) => {
      const pending = pendingConnectRef.current
      if (!pending) {
        addNode(kind, pointerFlow)
        return
      }
      const id = crypto.randomUUID()
      const anchorNode = nodes.find((node) => node.id === pending.nodeId)
      const anchorSize = anchorNode ? getNodeSize(anchorNode) : null
      const position =
        pointerFlow ??
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
      const connectSrcId = pending.handleType === 'source' ? pending.nodeId : id
      const connectTgtId = pending.handleType === 'source' ? id : pending.nodeId
      const connectSrcKind: StudioNodeKind | undefined =
        connectSrcId === id ? kind : (nodes.find((n) => n.id === connectSrcId)?.data.kind as StudioNodeKind)
      const connectTgtKind: StudioNodeKind | undefined =
        connectTgtId === id ? kind : (nodes.find((n) => n.id === connectTgtId)?.data.kind as StudioNodeKind)
      const anchorKindForPreview = nodes.find((n) => n.id === pending.nodeId)?.data.kind as
        | StudioNodeKind
        | undefined
      const previewVideoHandle = videoTargetHandleForPendingConnectReplace({
        handleType: pending.handleType,
        anchorNodeId: pending.nodeId,
        newNodeId: id,
        newNodeKind: kind,
        anchorKind: anchorKindForPreview,
      })
      if (preview) {
        setEdges((eds) =>
          eds.map((edge) =>
            edge.id === preview.edgeId
              ? {
                  ...edge,
                  source: connectSrcId,
                  target: connectTgtId,
                  ...(previewVideoHandle ? { targetHandle: previewVideoHandle } : {}),
                }
              : edge,
          ),
        )
        setNodes((nds) => nds.filter((node) => node.id !== preview.ghostNodeId))
        pendingConnectPreviewRef.current = null
      } else {
        setEdges((eds) =>
          addEdge(
            attachVideoTargetHandleForEdge(
              {
                id: crypto.randomUUID(),
                source: connectSrcId,
                target: connectTgtId,
                animated: true,
                style: { strokeWidth: 2 },
              },
              connectSrcKind,
              connectTgtKind,
            ) as Edge,
            eds,
          ),
        )
      }
      if (pending.handleType === 'source') {
        setNodes((prev) => {
          const source = prev.find((node) => node.id === pending.nodeId)
          const target = prev.find((node) => node.id === id)
          if (!source || !target) return prev
          if (
            target.data.kind === 'video' &&
            !shouldInheritIntoVideoOnConnect(source.data.kind, VIDEO_IN_UNIFIED)
          ) {
            return prev
          }
          const sourceTitle = String(source.data.title || '').trim()
          const attached = attachVideoTargetHandleForEdge(
            {
              id: crypto.randomUUID(),
              source: connectSrcId,
              target: connectTgtId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            connectSrcKind,
            connectTgtKind,
          ) as Edge
          const previewEdges = addEdge(attached, edgesRef.current)
          const videoTextSlot =
            target.data.kind === 'video' &&
            (source.data.kind === 'text' || source.data.kind === 'script')
              ? computeVideoTextPromptSlot(previewEdges, prev, target.id, source.id)
              : undefined
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id, {
            sourceKind: source.data.kind,
            videoTextSlot,
          })
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
      const linkSrcId = side === 'right' ? nodeId : id
      const linkTgtId = side === 'right' ? id : nodeId
      const linkSrcKind = side === 'right' ? anchor.data.kind : baseKind
      const linkTgtKind = side === 'right' ? baseKind : anchor.data.kind
      setEdges((eds) =>
        addEdge(
          attachVideoTargetHandleForEdge(
            {
              id: crypto.randomUUID(),
              source: linkSrcId,
              target: linkTgtId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            linkSrcKind,
            linkTgtKind,
          ) as Edge,
          eds,
        ),
      )
      if (side === 'right') {
        setNodes((prev) => {
          const source = prev.find((node) => node.id === nodeId)
          const target = prev.find((node) => node.id === id)
          if (!source || !target) return prev
          if (
            target.data.kind === 'video' &&
            !shouldInheritIntoVideoOnConnect(source.data.kind, VIDEO_IN_UNIFIED)
          ) {
            return prev
          }
          const sourceTitle = String(source.data.title || '').trim()
          const attached = attachVideoTargetHandleForEdge(
            {
              id: crypto.randomUUID(),
              source: linkSrcId,
              target: linkTgtId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            linkSrcKind,
            linkTgtKind,
          ) as Edge
          const previewEdges = addEdge(attached, edgesRef.current)
          const videoTextSlot =
            target.data.kind === 'video' &&
            (source.data.kind === 'text' || source.data.kind === 'script')
              ? computeVideoTextPromptSlot(previewEdges, prev, target.id, source.id)
              : undefined
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id, {
            sourceKind: source.data.kind,
            videoTextSlot,
          })
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
        newEdges.push(
          attachVideoTargetHandleForEdge(
            {
              id: crypto.randomUUID(),
              source: anchorId,
              target: newId,
              animated: true,
              style: { strokeWidth: 2 },
            },
            anchor.data.kind,
            kind,
          ) as Edge,
        )
      })

      setNodes((prev) => [...prev, ...newNodes])
      setEdges((prev) => [...prev, ...newEdges])

      setNodes((prev) => {
        const previewEdges = [...edgesRef.current, ...newEdges]
        let next = prev
        creations.forEach(({ anchorId, newId }) => {
          const source = next.find((node) => node.id === anchorId)
          const target = next.find((node) => node.id === newId)
          if (!source || !target) return
          if (
            target.data.kind === 'video' &&
            !shouldInheritIntoVideoOnConnect(source.data.kind, VIDEO_IN_UNIFIED)
          ) {
            return
          }
          const sourceTitle = String(source.data.title || '').trim()
          const videoTextSlot =
            target.data.kind === 'video' &&
            (source.data.kind === 'text' || source.data.kind === 'script')
              ? computeVideoTextPromptSlot(previewEdges, next, newId, anchorId)
              : undefined
          const patch = buildInheritedPatchForTarget(target.data, sourceTitle, source.id, {
            sourceKind: source.data.kind,
            videoTextSlot,
          })
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
      const syntheticEdges: Edge[] = orderedAnchors.map((source) =>
        attachVideoTargetHandleForEdge(
          {
            id: crypto.randomUUID(),
            source: source.id,
            target: newId,
            animated: true,
            style: { strokeWidth: 2 },
          },
          source.data.kind,
          kind,
        ) as Edge,
      )
      const previewEdgesForCommon = [...edgesRef.current, ...syntheticEdges]
      const nodesForSlot = [...nodes, newNode]
      ;[...orderedAnchors].reverse().forEach((source) => {
        if (kind === 'video' && !shouldInheritIntoVideoOnConnect(source.data.kind, VIDEO_IN_UNIFIED))
          return
        const sourceTitle = String(source.data.title || '').trim()
        const videoTextSlot =
          kind === 'video' &&
          (source.data.kind === 'text' || source.data.kind === 'script')
            ? computeVideoTextPromptSlot(previewEdgesForCommon, nodesForSlot, newId, source.id)
            : undefined
        const patch = buildInheritedPatchForTarget(inheritedData, sourceTitle, source.id, {
          sourceKind: source.data.kind,
          videoTextSlot,
        })
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
      setNodes((prev) => [...prev, newNodeWithInherited])
      setEdges((prev) => [...prev, ...syntheticEdges])
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
      const clamped = clampCanvasAddMenuPosition(event.clientX, event.clientY)
      setCanvasAddMenu({ ...clamped, flowPosition: flowPos })
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
      const clampedConnect = clampCanvasAddMenuPosition(clientX, clientY)
      setConnectAddMenu({ ...clampedConnect, flowPosition: flowPos })
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

  /** 画布双击菜单：把流坐标绑进 action，避免关菜单时 pending ref 被清空导致落点漂移。 */
  const canvasAddNodeItems = useMemo<AddNodeMenuItem[]>(() => {
    const fp = canvasAddMenu?.flowPosition
    return addNodeItems.map((item) => ({
      ...item,
      action: () => {
        if (item.id === 'compose-video') {
          addNode('video', fp)
          return
        }
        addNode(item.id as StudioNodeKind, fp)
      },
    }))
  }, [addNode, addNodeItems, canvasAddMenu])

  const connectAddNodeItems = useMemo<AddNodeMenuItem[]>(() => {
    const fp = connectAddMenu?.flowPosition
    return addNodeItems.map((item) => ({
      ...item,
      action: () => {
        if (item.id === 'compose-video') {
          addNodeFromPendingConnect('video', fp)
          return
        }
        addNodeFromPendingConnect(item.id as StudioNodeKind, fp)
      },
    }))
  }, [addNodeFromPendingConnect, addNodeItems, connectAddMenu])

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
    if (kind === 'imageCompare') {
      return String((data as ImageCompareNodeData).compareSrcA || '').trim()
    }
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
   * 将工作流执行结果回填到节点并写入历史（供顶部执行入口与底部面板入口共用）。
   */
  const applyWorkflowResultToNode = useCallback(
    async (
      fresh: Node<StudioNodeData>,
      kind: StudioNodeKind,
      result: {
        previewUrl: string | null
        audioUrl: string | null
        resultUrl: string | null
        textResult?: string | null
        /** 图/视频：同一任务多输出 view URL（Comfy 多分镜等） */
        resultViewUrls?: string[]
      },
      applyOpts?: { replaceImageOutputStrip?: boolean },
    ) => {
      const id = fresh.id
      const mediaUrl = result.audioUrl || result.previewUrl || result.resultUrl || null
      const licenseSnap = loadLicenseSnapshotV2()
      const mirrorHeaders =
        licenseSnap?.licenseCode && licenseSnap?.machineId
          ? ({ 'x-license-code': licenseSnap.licenseCode, 'x-machine-id': licenseSnap.machineId } as Record<
              string,
              string
            >)
          : undefined

      if (kind === 'music') {
        if (!result.audioUrl) {
          throw new Error(
            '执行完成但未检测到音频输出，请确认工作流含 PreviewAudio / SaveAudio 等节点且 history 中可见 audio/audios',
          )
        }
        const data = fresh.data as AudioNodeData
        const previousSources = data.resultSources?.filter(Boolean) ?? (data.src ? [data.src] : [])
        const prevThumbs = data.resultThumbnails ?? []
        const mirror = await mirrorComfyOutputToDisk({
          url: result.audioUrl,
          mediaKind: 'music',
          title: fresh.data.title,
          nodeId: id,
          requestHeaders: mirrorHeaders,
        })
        const playback = await resolveComfyAudioPlaybackSrc({
          comfyUrl: result.audioUrl,
          mirrorFilePath: mirror.filePath,
          requestHeaders: mirrorHeaders,
          fileBaseName: String(fresh.data.title || 'music'),
        })
        const displaySrc = playback.src || result.audioUrl
        const nextSourcesResolved = [
          displaySrc,
          ...previousSources.filter((item) => item !== displaySrc && item !== result.audioUrl),
        ]
        const thumb: NodeResultThumbnail = {
          id: crypto.randomUUID(),
          url: displaySrc,
          mediaKind: 'audio',
        }
        const nextThumbs = [thumb, ...prevThumbs.filter((t) => t.url !== displaySrc)].slice(0, 36)
        updateNodeData(id, {
          kind: 'music',
          src: nextSourcesResolved[0],
          srcAssetId: String(playback.srcAssetId || '').trim(),
          resultSources: nextSourcesResolved,
          resultThumbnails: nextThumbs,
          srcDiskPath: mirror.filePath || undefined,
        })
        if (!mirror.saved) {
          appendHistory(`输出目录写入失败（音乐）：${mirror.reason || '未知原因'}`)
        } else if (mirror.filePath) {
          appendHistory(`已保存到输出目录（音乐）：${mirror.filePath}`)
        }
        appendHistory({
          text: '音乐生成成功',
          kind: 'music',
          src: displaySrc,
          title: fresh.data.title,
        })
        appendHistory(`音乐节点执行成功：${(fresh.data as AudioNodeData).model || '未命名工作流'}`)
        return
      }

      if (kind === 'audio') {
        if (!result.audioUrl) {
          throw new Error(
            '执行完成但未检测到音频输出，请确认工作流含 PreviewAudio / SaveAudio 等节点且 history 中可见 audio/audios',
          )
        }
        const data = fresh.data as AudioNodeData
        const previousSources = data.resultSources?.filter(Boolean) ?? (data.src ? [data.src] : [])
        const prevThumbs = data.resultThumbnails ?? []
        const mirror = await mirrorComfyOutputToDisk({
          url: result.audioUrl,
          mediaKind: 'audio',
          title: fresh.data.title,
          nodeId: id,
          requestHeaders: mirrorHeaders,
        })
        const playback = await resolveComfyAudioPlaybackSrc({
          comfyUrl: result.audioUrl,
          mirrorFilePath: mirror.filePath,
          requestHeaders: mirrorHeaders,
          fileBaseName: String(fresh.data.title || 'audio'),
        })
        const displaySrc = playback.src || result.audioUrl
        const nextSourcesResolved = [
          displaySrc,
          ...previousSources.filter((item) => item !== displaySrc && item !== result.audioUrl),
        ]
        const thumb: NodeResultThumbnail = {
          id: crypto.randomUUID(),
          url: displaySrc,
          mediaKind: 'audio',
        }
        const nextThumbs = [thumb, ...prevThumbs.filter((t) => t.url !== displaySrc)].slice(0, 36)
        updateNodeData(id, {
          kind: 'audio',
          src: nextSourcesResolved[0],
          srcAssetId: String(playback.srcAssetId || '').trim(),
          resultSources: nextSourcesResolved,
          resultThumbnails: nextThumbs,
          srcDiskPath: mirror.filePath || undefined,
        })
        if (!mirror.saved) {
          appendHistory(`输出目录写入失败（配音）：${mirror.reason || '未知原因'}`)
        } else if (mirror.filePath) {
          appendHistory(`已保存到输出目录（配音）：${mirror.filePath}`)
        }
        appendHistory({
          text: '配音生成成功',
          kind: 'audio',
          src: displaySrc,
          title: fresh.data.title,
        })
        appendHistory(`配音节点执行成功：${(fresh.data as AudioNodeData).model || '未命名工作流'}`)
        return
      }

      if (kind === 'image' || kind === 'video') {
        if (!mediaUrl) {
          throw new Error('执行完成但未检测到图片或视频输出，请检查工作流输出节点')
        }
        const urlsRaw =
          Array.isArray(result.resultViewUrls) && result.resultViewUrls.length
            ? result.resultViewUrls
            : [mediaUrl]
        const urls = [...new Set(urlsRaw.map((u) => String(u || '').trim()).filter(Boolean))]
        const newThumbs: NodeResultThumbnail[] = []
        let primarySrc = ''
        let primaryAssetId: string | undefined
        let primaryFileName: string | undefined
        for (let i = 0; i < urls.length; i += 1) {
          const rawUrl = urls[i]!
          let displayUrl = rawUrl
          let assetId: string | undefined
          let fileName: string | undefined
          if (kind === 'image') {
            try {
              const res = await fetch(rawUrl, { mode: 'cors', credentials: 'include' })
              if (res.ok) {
                const blob = await res.blob()
                if (blob.size > 0 && String(blob.type || '').startsWith('image/')) {
                  const ext =
                    blob.type.includes('png')
                      ? 'png'
                      : blob.type.includes('jpeg') || blob.type.includes('jpg')
                        ? 'jpg'
                        : blob.type.includes('webp')
                          ? 'webp'
                          : 'png'
                  const baseTitle = `${String(fresh.data.title || 'image').trim() || 'image'}`
                  const fileNameOne =
                    urls.length > 1 ? `${baseTitle}-${i + 1}.${ext}` : `${baseTitle}.${ext}`
                  const file = new File([blob], fileNameOne, {
                    type: blob.type || 'image/png',
                  })
                  const aid = await saveLocalImageAsset(file)
                  const restored = await getLocalImageAssetObjectUrl(aid)
                  if (restored) {
                    displayUrl = restored
                    assetId = aid
                    fileName = fileNameOne
                  }
                }
              }
            } catch {
              // 远端 URL 无法直接 fetch（防盗链/CORS）时，回退使用原始媒体 URL。
            }
          }
          const mirror = await mirrorComfyOutputToDisk({
            url: rawUrl,
            mediaKind: kind === 'video' ? 'video' : 'image',
            title: fresh.data.title,
            nodeId: id,
            requestHeaders: mirrorHeaders,
          })
          /** 桌面端：镜像成功后优先用本地文件做预览，避免主图长期依赖易失效的云端 URL */
          if (mirror.filePath) {
            const fromMirrorDisk = await getDesktopDiskFileObjectUrl(mirror.filePath)
            if (fromMirrorDisk) {
              displayUrl = fromMirrorDisk
            }
          }
          if (!mirror.saved && urls.length === 1) {
            appendHistory(
              `输出目录写入失败（${kind === 'image' ? '图片' : '视频'}）：${mirror.reason || '未知原因'}`,
            )
          } else if (mirror.filePath && urls.length === 1) {
            appendHistory(`已保存到输出目录（${kind === 'image' ? '图片' : '视频'}）：${mirror.filePath}`)
          }
          const stripUrl = displayUrl || rawUrl
          const videoThumbKind: 'video' | 'image' =
            kind === 'video'
              ? /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(stripUrl.split(/[?#]/)[0] || '')
                ? 'image'
                : 'video'
              : 'image'
          newThumbs.push({
            id: crypto.randomUUID(),
            url: displayUrl,
            assetId,
            fileName,
            diskPath: mirror.filePath || undefined,
            mediaKind: kind === 'video' ? videoThumbKind : 'image',
          })
          if (i === 0) {
            primarySrc = displayUrl
            primaryAssetId = assetId
            primaryFileName = fileName
          }
        }
        const prevThumbs =
          kind === 'image'
            ? (fresh.data as ImageNodeData).resultThumbnails ?? []
            : (fresh.data as VideoNodeData).resultThumbnails ?? []
        /** 模型模式单次只应一条主输出；合并旧条会把历史黑图/错图与本次结果叠成「一次四条」的错觉 */
        const merged =
          applyOpts?.replaceImageOutputStrip && urls.length === 1
            ? newThumbs
            : [...newThumbs, ...prevThumbs.filter((p) => !newThumbs.some((n) => n.url === p.url))].slice(0, 36)
        updateNodeData(id, {
          kind,
          src: primarySrc || urls[0]!,
          srcAssetId: primaryAssetId,
          srcFileName: primaryFileName,
          resultThumbnails: merged,
          srcDiskPath: newThumbs[0]?.diskPath,
        } as Partial<StudioNodeData>)
        if (urls.length > 1) {
          appendHistory(
            `${kind === 'image' ? '图片' : '视频'}节点一次产出 ${urls.length} 个文件，已加入底部输出条并可展开查看`,
          )
        }
        if (urls.length > 1) {
          let mirrorOk = 0
          for (const t of newThumbs) {
            if (t.diskPath) mirrorOk += 1
          }
          if (mirrorOk > 0) {
            appendHistory(`已镜像 ${mirrorOk}/${urls.length} 个文件到本地输出目录`)
          }
        }
        appendHistory({
          text: kind === 'image' ? '图片生成成功' : '视频生成成功',
          kind,
          src: urls[0]!,
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
      if (kind === 'script') {
        updateNodeData(id, {
          kind,
          body: textResult,
        } as any)
        appendHistory({ text: '模型已生成脚本并回填', kind: 'action' })
        return
      }
    },
    [appendHistory, updateNodeData],
  )

  const { isRunning: isWorkflowRunnerRunning, runAllWorkflow: _runAllWorkflow, executeNodeIds } =
    useWorkflowRunner({
    nodes,
    edges,
    selectedNodeId,
    setNodes,
    appendHistory,
    executeSingleNode: async (node) => {
      const kind = node.data.kind
      if (kind === 'group') return
      if (kind === 'imageCompare') return
      await awaitSensitiveLexiconSettled()
      const liveNodes = nodesRef.current
      const latest = liveNodes.find((n) => n.id === node.id) ?? node
      const prepared = withResolvedNodeMentions(latest, liveNodes, edgesRef.current)
      const sensitiveBlob = collectUserFacingTextFromNodeData(prepared.data as StudioNodeData)
      const sensitiveGate = canSend(sensitiveBlob, true)
      if (!sensitiveGate.allowed) {
        appendHistory(`${String(kind)}节点未执行：${sensitiveGate.reason ?? ''}`)
        alertSensitiveWordBlocked(sensitiveGate.reason ?? '提示词包含敏感内容，已取消执行')
        return false
      }
      const result = await runNodeWorkflow(prepared, {
        allNodes: liveNodes,
        studioEdges: edgesRef.current,
        runNodeTitle: String(latest.data.title || latest.id),
        executionTarget: resolvedPromptPickerMode(latest.data as { promptPickerMode?: 'workflow' | 'model' }),
        rawPromptText:
          latest.data.kind === 'image'
            ? String((latest.data as ImageNodeData).prompt || '')
            : latest.data.kind === 'video'
              ? joinVideoRawPromptText(latest.data as VideoNodeData)
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
      const nodeForMerge = nodesRef.current.find((n) => n.id === node.id) ?? latest
      const execMode = resolvedPromptPickerMode(latest.data as { promptPickerMode?: 'workflow' | 'model' })
      await applyWorkflowResultToNode(nodeForMerge, kind, result, {
        replaceImageOutputStrip: execMode === 'model' && (kind === 'image' || kind === 'video'),
      })
    },
    })

  const ensureLicenseCanSubmit = useCallback((): boolean => {
    const latest = loadLicenseSnapshotV2()
    const nextAccess = computeAccessState(latest)
    if (nextAccess !== 'expired') return true
    window.alert('您的授权已到期。如需继续使用会员模板/云端能力，请续费并刷新授权。')
    return false
  }, [])

  const runNodeFromCanvas = useCallback(
    async (nodeId: string) => {
      if (!ensureLicenseCanSubmit()) return
      await executeNodeIds([nodeId], '画布节点执行')
    },
    [ensureLicenseCanSubmit, executeNodeIds],
  )

  const pollPendingCloudTaskAndBackfill = useCallback(async (
    taskId: string,
    nodeId: string,
    kind: StudioNodeKind,
  ) => {
    const tid = String(taskId || '').trim()
    if (!tid) return
    if (cloudTaskPollingIdsRef.current.has(tid)) return
    cloudTaskPollingIdsRef.current.add(tid)
    try {
      const snap = loadLicenseSnapshotV2()
      if (!snap) {
        appendHistory(`云端任务 ${tid} 轮询失败：未授权（请先激活机器码授权）`)
        return
      }
      const base = String(loadLicenseServerConfig().baseUrl || '').trim().replace(/\/+$/, '')
      if (!base) {
        appendHistory(`云端任务 ${tid} 轮询失败：未配置授权服务地址`)
        return
      }
      const endpoint = `${base}/tasks/${encodeURIComponent(tid)}/status`
      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        const res = await fetch(endpoint, {
          headers: {
            'x-license-code': snap.licenseCode,
            'x-machine-id': snap.machineId,
          },
        })
        const json = (await res.json().catch(() => ({}))) as {
          status?: string
          result?: { mediaUrls?: string[] }
          error?: string
          message?: string
        }
        if (!res.ok) {
          await new Promise((resolve) => setTimeout(resolve, 2500))
          continue
        }
        const status = String(json.status || '').trim().toLowerCase()
        if (status === 'success') {
          const mediaUrls = Array.isArray(json.result?.mediaUrls) ? json.result?.mediaUrls ?? [] : []
          const normalizedUrls = mediaUrls.map((u) => String(u || '').trim()).filter(Boolean)
          const outputUrl = normalizedUrls[0] || ''
          if (!outputUrl) {
            appendHistory(`云端任务 ${tid} 已完成，但未返回可回填媒体 URL`)
            return
          }
          const lower = outputUrl.toLowerCase()
          const isAudio =
            lower.endsWith('.mp3') ||
            lower.endsWith('.wav') ||
            lower.endsWith('.flac') ||
            lower.endsWith('.m4a') ||
            lower.endsWith('.ogg') ||
            lower.endsWith('.aac')
          const latest = nodesRef.current.find((n) => n.id === nodeId)
          if (!latest) return
          await applyWorkflowResultToNode(latest, kind, {
            previewUrl: isAudio ? null : outputUrl,
            audioUrl: isAudio ? outputUrl : null,
            resultUrl: outputUrl,
            resultViewUrls:
              !isAudio && (kind === 'image' || kind === 'video') && normalizedUrls.length
                ? normalizedUrls
                : undefined,
          })
          updateNodeData(nodeId, {
            kind,
            runStatus: 'success',
            runProgress: undefined,
            lastRunAt: Date.now(),
          } as Partial<StudioNodeData>)
          appendHistory(`${NODE_KIND_LABEL[kind]}节点任务已完成并回填：${latest.data.title || nodeId}`)
          return
        }
        if (status === 'error') {
          const msg = String(json.error || json.message || '任务失败')
          updateNodeData(nodeId, {
            kind,
            runStatus: 'error',
            runProgress: undefined,
            lastRunAt: Date.now(),
          } as Partial<StudioNodeData>)
          appendHistory(`${NODE_KIND_LABEL[kind]}节点任务失败：${msg}`)
          return
        }
        updateNodeData(nodeId, {
          kind,
          runStatus: 'queued',
          runProgress: {
            percent: 52,
            label: `云端任务处理中（${tid}）`,
          },
        } as Partial<StudioNodeData>)
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
      appendHistory(`云端任务 ${tid} 轮询超时，请稍后重试`)
    } finally {
      cloudTaskPollingIdsRef.current.delete(tid)
    }
  }, [appendHistory, applyWorkflowResultToNode, updateNodeData])

  useEffect(() => {
    // 启动时做一次“本地回拨检测 + 轻量联网校验”（失败不阻断）
    const snap = loadLicenseSnapshotV2()
    if (!snap) return
    const tamper = touchLicenseLocalTime(snap)
    if (!tamper.ok) {
      // 有回拨线索：提示用户去设置里点击校验
      if (import.meta.env.DEV) console.warn('[Flowid License] time rollback detected')
    }
    void (async () => {
      try {
        const latest = loadLicenseSnapshotV2()
        if (!latest) return
        const res = await verifyLicenseRemote(latest)
        if (!res.ok) return
        const now = Date.now()
        saveLicenseSnapshotV2({
          ...latest,
          licenseCode: res.licenseCode,
          machineId: res.machineId,
          expiresAtMs: res.expiresAtMs,
          entitlements: res.entitlements,
          lastVerifiedAtMs: now,
          serverAnchor: { serverTimeMs: res.serverTimeMs, localTimeMs: now, updatedAtMs: now },
        })
      } catch {
        // ignore
      }
    })()
  }, [])

  /**
   * 右键菜单批量执行：按当前选中业务节点 id 调用 `executeNodeIds`（拓扑顺序、串行）。
   * 与 `batchContextMenuEligibleCount` 一致，不含 ghost / group；单选时菜单文案为「执行」，多选为「全部执行」。
   */
  const runBatchExecuteFromContextMenuSelection = useCallback(async () => {
    if (!ensureLicenseCanSubmit()) return
    const selectedIds = nodes
      .filter((node) => node.selected && node.type !== 'ghost' && node.type !== 'group')
      .map((node) => node.id)
    if (!selectedIds.length) {
      window.alert('没有可执行节点')
      return
    }
    dismissMultiSelectContextMenu()

    const allowedNodeIds = new Set(
      nodes.filter((n) => n.type !== 'ghost' && n.type !== 'group').map((n) => n.id),
    )
    /**
     * 单选：沿连线向下游扩展，方便「从当前节点跑整条链路」。
     * 多选框选：只执行**被选中的节点**（拓扑排序），避免多选 8 个图节点却因下游/旁支多出 2 次计费。
     */
    let ids: string[]
    let runName: string
    if (selectedIds.length <= 1) {
      const reachable = new Set<string>()
      const queue: string[] = []
      selectedIds.forEach((id) => {
        if (!allowedNodeIds.has(id)) return
        reachable.add(id)
        queue.push(id)
      })
      while (queue.length) {
        const curr = queue.shift()
        if (!curr) continue
        for (const e of edges) {
          if (e.source !== curr) continue
          const nxt = e.target
          if (!nxt || !allowedNodeIds.has(nxt)) continue
          if (reachable.has(nxt)) continue
          reachable.add(nxt)
          queue.push(nxt)
        }
      }
      ids = Array.from(reachable)
      runName = selectedIds.length === 1 ? '执行选中节点（含下游）' : '执行选中节点'
    } else {
      ids = selectedIds.filter((id) => allowedNodeIds.has(id))
      runName = '全部执行选中节点'
    }
    await executeNodeIds(ids, runName)
  }, [dismissMultiSelectContextMenu, ensureLicenseCanSubmit, executeNodeIds, nodes, edges])

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

  /** Agent 浮动窗「智能 / LLM」模式：OpenAI 式 tools 循环，实时读 nodesRef 定位节点 */
  const executeFlowidAgentTool = useCallback(
    async (name: string, argumentsJson: string) => {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(argumentsJson || '{}') as Record<string, unknown>
      } catch {
        return JSON.stringify({ ok: false, error: '无效的 JSON 参数' })
      }

      const findInCanvas = (query: string) => {
        const q = String(query).trim().toLowerCase()
        if (!q) return null
        const list = nodesRef.current.filter((n) => n.type !== 'ghost')
        const exact = list.find(
          (n) =>
            n.id.toLowerCase() === q || String(n.data.title || '').trim().toLowerCase() === q,
        )
        if (exact) return exact as Node<StudioNodeData>
        return (
          (list.find((n) => String(n.data.title || '').toLowerCase().includes(q)) as
            | Node<StudioNodeData>
            | undefined) ?? null
        )
      }

      const findBiz = (query: string) => {
        const n = findInCanvas(query)
        if (!n || n.type === 'group') return null
        return n as Node<StudioNodeData>
      }

      try {
        if (name === 'flowid_create_node') {
          const kind = args.kind as string
          if (!isAiAssistantCreatableNodeKind(kind as StudioNodeKind)) {
            return JSON.stringify({ ok: false, error: `不支持的节点类型：${kind}` })
          }
          let newId = ''
          let newTitle = ''
          setNodes((nds) => {
            newId = crypto.randomUUID()
            const explicitPending = pendingCanvasNodePositionRef.current
            const rawBase =
              explicitPending ??
              screenToFlowPosition({
                x: window.innerWidth * 0.46,
                y: window.innerHeight * 0.38,
              })
            pendingCanvasNodePositionRef.current = null
            const staggerN = countStaggerEligibleNodes(nds as Node<StudioNodeData>[])
            const position = explicitPending
              ? rawBase
              : staggerAutoPlacedPosition(rawBase, staggerN)
            const index = getNextNodeTitleIndex(nds, kind as StudioNodeKind)
            newTitle = `${NODE_KIND_LABEL[kind as StudioNodeKind]}节点${index}`
            return [...nds, createStudioNode(kind as StudioNodeKind, newId, position, newTitle)]
          })
          appendHistory(`Agent 工具创建节点：${kind}`)
          return JSON.stringify({ ok: true, node_id: newId, title: newTitle })
        }

        if (name === 'flowid_connect_nodes') {
          const s = findInCanvas(String(args.source_query ?? ''))
          const t = findInCanvas(String(args.target_query ?? ''))
          if (!s || !t) {
            return JSON.stringify({
              ok: false,
              error: `未找到节点：${!s ? String(args.source_query) : ''}${!s && !t ? ' / ' : ''}${!t ? String(args.target_query) : ''}`,
            })
          }
          if (s.id === t.id) {
            return JSON.stringify({ ok: false, error: '不能将节点连接到自身' })
          }
          setEdges((eds) =>
            addEdge(
              attachVideoTargetHandleForEdge(
                {
                  id: crypto.randomUUID(),
                  source: s.id,
                  target: t.id,
                  animated: true,
                  style: { strokeWidth: 2 },
                },
                s.data.kind,
                t.data.kind,
              ) as Edge,
              eds,
            ),
          )
          appendHistory(`Agent 工具连线：${s.data.title} -> ${t.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_script_body') {
          const node = findInCanvas(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到剧本节点' })
          if (node.data.kind !== 'script') {
            return JSON.stringify({ ok: false, error: '目标不是剧本节点' })
          }
          const body = String(args.body ?? '')
          const safeBody = replaceSensitiveWords(body)
          const gate = canSend(safeBody)
          if (!gate.allowed) {
            return JSON.stringify({ ok: false, error: gate.reason ?? '内容未通过校验' })
          }
          updateNodeData(node.id, { kind: 'script', body: safeBody })
          appendHistory(`Agent 工具写入剧本：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_video_prompt') {
          const node = findInCanvas(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到视频节点' })
          if (node.data.kind !== 'video') {
            return JSON.stringify({ ok: false, error: '目标不是视频节点' })
          }
          const prompt = String(args.prompt ?? '')
          const safePrompt = replaceSensitiveWords(prompt)
          const gate = canSend(safePrompt)
          if (!gate.allowed) {
            return JSON.stringify({ ok: false, error: gate.reason ?? '内容未通过校验' })
          }
          updateNodeData(node.id, { kind: 'video', prompt: safePrompt })
          appendHistory(`Agent 工具写入视频提示：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_image_prompt') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到图片节点' })
          if (node.data.kind !== 'image') {
            return JSON.stringify({ ok: false, error: '目标不是图片节点' })
          }
          const prompt = String(args.prompt ?? '')
          const safePrompt = replaceSensitiveWords(prompt)
          const gate = canSend(safePrompt)
          if (!gate.allowed) {
            return JSON.stringify({ ok: false, error: gate.reason ?? '内容未通过校验' })
          }
          updateNodeData(node.id, { kind: 'image', prompt: safePrompt })
          appendHistory(`Agent 工具写入图片提示：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_text_body') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到文本节点' })
          if (node.data.kind !== 'text') {
            return JSON.stringify({ ok: false, error: '目标不是文本节点' })
          }
          const body = String(args.body ?? '')
          const safeBody = replaceSensitiveWords(body)
          const gate = canSend(safeBody)
          if (!gate.allowed) {
            return JSON.stringify({ ok: false, error: gate.reason ?? '内容未通过校验' })
          }
          updateNodeData(node.id, { kind: 'text', body: safeBody })
          appendHistory(`Agent 工具写入文本：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_media_note') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到节点' })
          if (node.data.kind !== 'audio' && node.data.kind !== 'music') {
            return JSON.stringify({ ok: false, error: '目标不是配音或音乐节点' })
          }
          const note = String(args.note ?? '')
          const safeNote = replaceSensitiveWords(note)
          const gate = canSend(safeNote)
          if (!gate.allowed) {
            return JSON.stringify({ ok: false, error: gate.reason ?? '内容未通过校验' })
          }
          updateNodeData(node.id, { kind: node.data.kind, note: safeNote } as Partial<StudioNodeData>)
          appendHistory(`Agent 工具写入${node.data.kind === 'audio' ? '配音' : '音乐'}备注：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_set_prompt_picker_mode') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到节点' })
          const mode = String(args.mode ?? '')
          if (mode !== 'workflow' && mode !== 'model') {
            return JSON.stringify({ ok: false, error: 'mode 须为 workflow 或 model' })
          }
          updateNodeData(node.id, { promptPickerMode: mode } as Partial<StudioNodeData>)
          appendHistory(`Agent 工具切换执行模式（${mode}）：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_bind_workflow_by_name') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到节点' })
          const kind = node.data.kind as StudioNodeKind
          const hit = resolveWorkflowEntryForKind(kind, nodeConfigs, String(args.name_substring ?? ''))
          if (!hit) {
            return JSON.stringify({ ok: false, error: '未匹配到工作流（请检查名称子串或设置里该类型工作流列表）' })
          }
          updateNodeData(node.id, {
            promptPickerMode: 'workflow',
            workflowEntryId: hit.id,
          } as Partial<StudioNodeData>)
          appendHistory(`Agent 工具绑定工作流「${hit.name}」：${node.data.title}`)
          return JSON.stringify({ ok: true, workflow_id: hit.id, workflow_name: hit.name })
        }

        if (name === 'flowid_set_cloud_assist_pick') {
          const node = findBiz(String(args.target_query ?? ''))
          if (!node) return JSON.stringify({ ok: false, error: '未找到节点' })
          const pick = String(args.pick ?? '').trim()
          if (!tryDecodeCloudAssistModelPick(pick)) {
            return JSON.stringify({ ok: false, error: 'pick 格式无效（需为画布云端线路编码）' })
          }
          const assistKind = studioNodeKindToAssistKind(node.data.kind)
          if (!assistKind) {
            return JSON.stringify({ ok: false, error: '该节点类型不支持云端辅助线路' })
          }
          updateNodeData(node.id, {
            promptPickerMode: 'model',
            cloudAssistModelPick: pick,
            cloudSelfPresetId: '',
          } as Partial<StudioNodeData>)
          appendHistory(`Agent 工具设置云端线路：${node.data.title}`)
          return JSON.stringify({ ok: true })
        }

        if (name === 'flowid_delete_nodes') {
          const rawQs = args.target_queries
          const qlist = Array.isArray(rawQs) ? rawQs.map((x) => String(x ?? '').trim()).filter(Boolean) : []
          if (!qlist.length) {
            return JSON.stringify({ ok: false, error: 'target_queries 不能为空' })
          }
          const targets = new Map<string, Node<StudioNodeData>>()
          for (const q of qlist) {
            const n = findBiz(q)
            if (n) targets.set(n.id, n)
          }
          if (!targets.size) {
            return JSON.stringify({ ok: false, error: '未解析到可删除的节点' })
          }
          const lines = [...targets.values()].map((n) => `· ${String(n.data.title || '').trim() || n.id}`)
          const okConfirm = window.confirm(
            `Agent 请求删除 ${targets.size} 个节点（将移除相关连线）：\n\n${lines.join('\n')}\n\n是否继续？`,
          )
          if (!okConfirm) {
            return JSON.stringify({ ok: false, error: '用户已取消删除' })
          }
          for (const id of targets.keys()) {
            removeNodeById(id)
          }
          appendHistory(`Agent 工具删除节点：${targets.size} 个`)
          return JSON.stringify({ ok: true, deleted: targets.size })
        }

        if (name === 'flowid_run_nodes') {
          const rawQs = args.target_queries
          const qlist = Array.isArray(rawQs) ? rawQs.map((x) => String(x ?? '').trim()).filter(Boolean) : []
          const ids = new Set<string>()
          for (const q of qlist) {
            const n = findBiz(q)
            if (n) ids.add(n.id)
          }
          if (Boolean(args.use_selected_all)) {
            for (const n of nodesRef.current) {
              if (n.selected && n.type !== 'ghost' && n.type !== 'group') {
                ids.add(n.id)
              }
            }
          }
          const list = Array.from(ids)
          if (!list.length) {
            return JSON.stringify({ ok: false, error: '没有可执行的节点（请填写 target_queries 或勾选多选并设 use_selected_all）' })
          }
          if (list.length > 1) {
            const lines = list.map((id) => {
              const n = nodesRef.current.find((x) => x.id === id)
              return `· ${String(n?.data.title || '').trim() || id}`
            })
            const okConfirm = window.confirm(
              `Agent 请求批量执行 ${list.length} 个节点：\n\n${lines.join(
                '\n',
              )}\n\n将按画布规则排队/串行执行。是否继续？`,
            )
            if (!okConfirm) {
              return JSON.stringify({ ok: false, error: '用户已取消批量执行' })
            }
          }
          if (!ensureLicenseCanSubmit()) {
            return JSON.stringify({ ok: false, error: '授权校验未通过，无法执行' })
          }
          await executeNodeIds(list, 'Agent 工具批量执行')
          return JSON.stringify({ ok: true, count: list.length })
        }

        if (name === 'flowid_run_node') {
          if (!ensureLicenseCanSubmit()) {
            return JSON.stringify({ ok: false, error: '授权校验未通过，无法执行' })
          }
          const useCurrent = Boolean(args.use_current)
          let targetId: string | null = null
          if (useCurrent) {
            const sel = nodesRef.current.find(
              (n) => n.selected && n.type !== 'ghost' && n.type !== 'group',
            )
            targetId = sel?.id ?? null
          } else {
            const q = String(args.target_query ?? '').trim()
            if (q) targetId = findInCanvas(q)?.id ?? null
          }
          if (!targetId) {
            return JSON.stringify({ ok: false, error: '未指定可执行节点或未选中节点' })
          }
          await executeNodeIds([targetId], 'Agent 工具执行节点')
          const n = nodesRef.current.find((x) => x.id === targetId)
          return JSON.stringify({
            ok: true,
            title: n?.data.title ?? targetId,
            node_id: targetId,
          })
        }

        return JSON.stringify({ ok: false, error: `未知工具：${name}` })
      } catch (e) {
        return JSON.stringify({ ok: false, error: (e as Error)?.message || '执行异常' })
      }
    },
    [
      appendHistory,
      createStudioNode,
      ensureLicenseCanSubmit,
      executeNodeIds,
      nodeConfigs,
      removeNodeById,
      screenToFlowPosition,
      setEdges,
      setNodes,
      updateNodeData,
    ],
  )

  const describeAiAction = useCallback((action: AiAssistantAction) => {
    if (action.type === 'create_node') return `新建节点：${action.kind}`
    if (action.type === 'connect_nodes') return `连接节点：${action.sourceQuery} -> ${action.targetQuery}`
    return `执行节点：${action.current ? '当前选中' : action.targetQuery || '未指定'}`
  }, [])

  const workflowBusyForAiPlanning = isWorkflowRunnerRunning

  type ExecuteAiAssistantOpts = {
    queued?: boolean
    /** 全屏工作台：不写入旧浮动面板消息列表 */
    replySink?: (msg: string, role?: 'assistant' | 'system') => void
    skipConfirm?: boolean
    silentPlanning?: boolean
    /**
     * 为 true 时仅用本地规则解析动作，不调用 planActionsWithModel。
     * 与 Agent 工作台「规则引擎」一致，避免模型臆造 `create_node: project` 等导致崩溃。
     */
    rulesOnly?: boolean
  }

  /**
   * MVP：解析自然语言并映射到本地工具调用（建节点/连线/执行）。
   */
  const executeAiAssistantCommand = useCallback(
    async (text: string, opts: ExecuteAiAssistantOpts = {}) => {
      const { queued = false, replySink, skipConfirm = false, silentPlanning = false, rulesOnly = false } = opts
      setAiBusy(true)
      const reply = (msg: string, role: 'assistant' | 'system' = 'assistant') => {
        const out = replaceSensitiveWords(msg)
        if (replySink) {
          replySink(out, role)
          return
        }
        setAiMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text: out }])
      }
      try {
        await awaitSensitiveLexiconSettled()
        const raw = text.trim()
        if (!raw) {
          reply('请输入要执行的指令。', 'system')
          return
        }
        const gate = canSend(raw)
        if (!gate.allowed) {
          reply(gate.reason ?? '消息包含敏感内容，无法发送', 'system')
          alertSensitiveWordBlocked(gate.reason)
          return
        }
        const safeText = replaceSensitiveWords(raw)
        if (queued) {
          reply(`工作流已空闲，继续处理缓存指令：${safeText}`, 'system')
        }
        const tabsBrief = projectTabsRef.current.map((t) => ({ id: t.id, name: t.name }))
        const forModel = augmentPromptWithMentionResolution(safeText, nodes, tabsBrief)
        const modelActions = rulesOnly ? [] : await planActionsWithModel(forModel, nodes, aiConfig)
        let actions = modelActions.length ? modelActions : planActionsWithRules(safeText)
        actions = actions.filter((a) =>
          a.type !== 'create_node' ? true : isAiAssistantCreatableNodeKind(a.kind),
        )
        /** 项目标签 id 与节点 id 同为 uuid；误把 @项目(...) 规划成 run_node 时会找不到节点 */
        const tabUuidRe =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i
        actions = actions.filter((action) => {
          if (action.type !== 'run_node') return true
          const q = (action.targetQuery || '').trim()
          if (!q || action.current) return true
          if (!tabUuidRe.test(q)) return true
          if (nodes.some((n) => n.id === q)) return true
          if (projectTabsRef.current.some((t) => t.id === q)) return false
          return true
        })
        if (!actions.length) {
          const chatText = await chatReplyWithModel(forModel, aiConfig)
          if (chatText) {
            reply(chatText)
          } else {
            if (!aiOfflineFallbackHintShownRef.current) {
              aiOfflineFallbackHintShownRef.current = true
              reply('提示：当前本地模型未连接，已切换为离线兜底聊天模式。', 'system')
            }
            reply(buildLocalSmallTalkReply(safeText))
          }
          return
        }
        if (!silentPlanning) {
          reply(`已生成 ${actions.length} 条动作：${actions.map(describeAiAction).join('；')}`)
        }
        for (const action of actions) {
          if (!skipConfirm && aiConfig.confirmBeforeRun) {
            const ok = window.confirm(`AI 助手准备执行：${describeAiAction(action)}\n是否继续？`)
            if (!ok) {
              reply(`已取消：${describeAiAction(action)}`, 'system')
              continue
            }
          }
          if (action.type === 'create_node') {
            if (!isAiAssistantCreatableNodeKind(action.kind)) {
              reply(`无法创建该类型节点（仅支持画布节点）：${String(action.kind)}`, 'system')
              continue
            }
            addNode(action.kind)
            appendHistory(`AI 助手创建节点：${action.kind}`)
            const label =
              action.kind === 'text'
                ? '文字'
                : action.kind === 'script'
                  ? '脚本'
                  : action.kind === 'image'
                    ? '图片'
                    : action.kind === 'video'
                      ? '视频'
                      : action.kind === 'audio'
                        ? '配音'
                        : action.kind === 'music'
                          ? '音乐'
                          : action.kind === 'panorama'
                            ? '全景'
                            : '节点'
            reply(`好的，已创建${label}节点（可在画布上查看）。`)
            continue
          }
          if (action.type === 'connect_nodes') {
            const s = findNodeByLabelOrId(action.sourceQuery)
            const t = findNodeByLabelOrId(action.targetQuery)
            if (!s || !t) {
              reply(
                `未找到节点：${!s ? action.sourceQuery : ''}${!s && !t ? ' / ' : ''}${!t ? action.targetQuery : ''}`,
              )
              continue
            }
            if (s.id === t.id) {
              reply('同一个节点不能连接到自身。')
              continue
            }
            setEdges((eds) =>
              addEdge(
                attachVideoTargetHandleForEdge(
                  {
                    id: crypto.randomUUID(),
                    source: s.id,
                    target: t.id,
                    animated: true,
                    style: { strokeWidth: 2 },
                  },
                  s.data.kind,
                  t.data.kind,
                ) as Edge,
                eds,
              ),
            )
            appendHistory(`AI 助手连线：${s.data.title} -> ${t.data.title}`)
            reply(`已完成连接：「${String(s.data.title || '').trim()}」→「${String(t.data.title || '').trim()}」。`)
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
    },
    [addNode, aiConfig, appendHistory, describeAiAction, ensureLicenseCanSubmit, executeNodeIds, findNodeByLabelOrId, nodes, selectedNodeId, setEdges],
  )

  /**
   * 用户发送入口：工作流繁忙时，本地模型改为排队，避免与主工作流争抢本地 GPU。
   */
  const handleAiAssistantSend = useCallback(async (text: string) => {
    const raw = text.trim()
    if (!raw) return
    await awaitSensitiveLexiconSettled()
    const gate = canSend(raw)
    if (!gate.allowed) {
      alertSensitiveWordBlocked(gate.reason)
      setAiMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: gate.reason ?? '消息包含敏感内容，无法发送',
        },
      ])
      return
    }
    const safeText = replaceSensitiveWords(raw)
    const userMsg: AiAssistantMessage = { id: crypto.randomUUID(), role: 'user', text: safeText }
    setAiMessages((prev) => [...prev, userMsg])
    const shouldQueueLocalModel =
      aiConfig.provider === 'ollama' &&
      aiConfig.pauseLocalModelWhenWorkflowRunning &&
      workflowBusyForAiPlanning
    if (shouldQueueLocalModel) {
      aiDeferredQueueRef.current.push(safeText)
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
    await executeAiAssistantCommand(safeText, {})
  }, [aiConfig, executeAiAssistantCommand, workflowBusyForAiPlanning])

  useEffect(() => {
    if (workflowBusyForAiPlanning || aiBusy) return
    const next = aiDeferredQueueRef.current.shift()
    if (!next) return
    void executeAiAssistantCommand(next, { queued: true })
  }, [aiBusy, executeAiAssistantCommand, workflowBusyForAiPlanning])

  useEffect(() => {
    const handler: StudioAgentChatHandler = async (text, options) => {
      await awaitSensitiveLexiconSettled()
      const mode: AgentParseMode = options?.mode ?? 'rules'
      if (mode !== 'rules') {
        const hist = options?.history ?? []
        const t0 = text.trim()
        const pg = canSend(t0)
        if (!pg.allowed) {
          alertSensitiveWordBlocked(pg.reason)
          return [pg.reason ?? '消息包含敏感内容，无法发送']
        }
        const userLine = replaceSensitiveWords(t0)
        if (
          aiConfig.provider === 'ollama' &&
          aiConfig.pauseLocalModelWhenWorkflowRunning &&
          workflowBusyForAiPlanning
        ) {
          return [
            '当前工作流正在运行，请稍后重试；或在「设置 → AI 助手」中切换到云端模型 / 关闭「工作流运行时暂停本地模型」。',
          ]
        }
        const getCanvasBrief = (): AgentCanvasBriefNode[] =>
          getNodes()
            .filter((n) => n.type !== 'ghost' && n.type !== 'group')
            .map((n) => {
              const d = n.data as StudioNodeData | undefined
              const kind = String(d?.kind ?? n.type ?? 'other')
              const trimmed = d && typeof d.title === 'string' ? d.title.trim() : ''
              const title = trimmed || defaultStudioNodeTitle(kind)
              return { id: n.id, title, kind }
            })
        const loopOut = await runFlowidAgentToolLoop({
          config: aiConfig,
          userText: userLine,
          history: hist,
          getCanvasBrief,
          executeTool: executeFlowidAgentTool,
        })
        if (loopOut.error) {
          const em = loopOut.error.toLowerCase()
          if (
            /tool|tools|function_call|not supported|unsupported|unknown parameter|invalid/.test(
              em,
            )
          ) {
            const replyText = await callLLM(
              [...hist, { role: 'user', content: userLine }],
              aiConfig,
            )
            return [replaceSensitiveWords(replyText)]
          }
        }
        return loopOut.lines.map((x) => replaceSensitiveWords(x))
      }

      const raw = text.trim()
      const pg = canSend(raw)
      if (!pg.allowed) {
        alertSensitiveWordBlocked(pg.reason)
        return [pg.reason ?? '消息包含敏感内容，无法发送']
      }
      const safeLine = replaceSensitiveWords(raw)
      const batchMatch =
        /\d+\s*张/.test(safeLine) &&
        (/场景图/.test(safeLine) ||
          /场景/.test(safeLine) ||
          (/张/.test(safeLine) && /图/.test(safeLine) && /产品|做|生成/.test(safeLine)))
      if (batchMatch) {
        const est = estimateSceneBatchFromText(safeLine)
        const points = Math.max(10, est.sceneCount * 10)
        const res = await invokeStudioAgentExecution({
          kind: 'scene-batch',
          userPrompt: safeLine,
          sceneCount: est.sceneCount,
          points,
        })
        return res.ok
          ? [
              replaceSensitiveWords(`收到，正在按约 ${est.sceneCount} 张场景图搭建工作流…`),
              replaceSensitiveWords(res.summary),
            ]
          : [replaceSensitiveWords(`执行未完成：${res.summary}`)]
      }

      if (
        aiConfig.provider === 'ollama' &&
        aiConfig.pauseLocalModelWhenWorkflowRunning &&
        workflowBusyForAiPlanning
      ) {
        return [
          '当前工作流正在运行，请稍后重试；或在「设置 → AI 助手」中切换到云端模型 / 关闭「工作流运行时暂停本地模型」。',
        ]
      }

      const lines: string[] = []
      await executeAiAssistantCommand(safeLine, {
        replySink: (msg) => lines.push(msg),
        skipConfirm: true,
        silentPlanning: true,
        rulesOnly: true,
      })
      return lines.length ? lines : ['好的。']
    }
    registerStudioAgentChatHandler(handler)
    return () => registerStudioAgentChatHandler(null)
  }, [
    aiConfig,
    executeAiAssistantCommand,
    executeFlowidAgentTool,
    getNodes,
    workflowBusyForAiPlanning,
  ])

  useEffect(() => {
    registerAgentCanvasTasksProvider(() => {
      /** 与 React Flow 内部 store 同步，避免与 `nodes` 渲染帧差一拍；仅排除幽灵占位，分组与业务节点一律列出 */
      return getNodes()
        .filter((n) => n.type !== 'ghost')
        .map((n) => {
          const d = n.data as StudioNodeData | undefined
          const kind = (d?.kind ?? n.type ?? 'other') as string
          const trimmed = d && typeof d.title === 'string' ? d.title.trim() : ''
          const title = trimmed || defaultStudioNodeTitle(kind)
          return {
            nodeId: n.id,
            kind,
            title,
            runStatus: d?.runStatus,
            runProgress: d?.runProgress,
            sortY: n.position?.y ?? 0,
            sortX: n.position?.x ?? 0,
          }
        })
    })
    registerAgentNavigateToNode((nodeId) => {
      const n = getNodes().find((x) => x.id === nodeId) ?? nodesRef.current.find((x) => x.id === nodeId)
      if (!n) return
      void fitView({ nodes: [n], padding: 0.38, duration: 420 })
      updateNodeMeta(nodeId, { className: 'studio-node--agent-pick-flash' })
      window.setTimeout(() => {
        updateNodeMeta(nodeId, { className: undefined })
      }, 2000)
    })
    registerAgentProjectContextProvider(() => {
      const tabs = projectTabsRef.current
      const activeId = activeProjectIdRef.current
      const paths = loadLocalDiskPathsSettings()
      const dir = paths.flowidProjectJsonPath.trim()

      const describeTab = (t: (typeof tabs)[number]) => {
        const fp = t.filePath?.trim()
        if (fp) return `打开来源：${fp}`
        if (dir) {
          const sep = dir.includes('\\') ? '\\' : '/'
          const base = dir.replace(/[\\/]+$/, '')
          return `工程目录：${base}${sep}`
        }
        return '当前为浏览器本地存档；可在「设置 → 本地路径」绑定工程目录'
      }

      return tabs.map((t) => ({
        id: `tab:${t.id}`,
        label: t.name?.trim() || '未命名项目',
        description: describeTab(t),
        isActive: t.id === activeId,
      }))
    })
    return () => {
      registerAgentCanvasTasksProvider(null)
      registerAgentNavigateToNode(null)
      registerAgentProjectContextProvider(null)
    }
  }, [fitView, getNodes, updateNodeMeta])

  useEffect(() => {
    registerAgentOpenCanvasSettings(() => {
      setAgentFloatingOpen(false)
      // 助手层 z-[12000]；设置弹层若仍为 z-[100] 会被压在下面看似无响应。延后一帧再打开，避免与 portaled 层点击顺序打架。
      window.setTimeout(() => {
        clearSettingsFocusTab()
        setLeftPanel('settings')
      }, 0)
    })
    return () => registerAgentOpenCanvasSettings(null)
  }, [clearSettingsFocusTab])

  useEffect(() => {
    registerStudioDeviceActivationOpener(() => {
      setSettingsFocusTab('device-activation')
      setLeftPanel('settings')
    })
    return () => registerStudioDeviceActivationOpener(null)
  }, [])

  /**
   * 将助手文本通过 OpenAI 兼容 TTS 接口转为语音并播放。
   */
  const speakAssistantText = useCallback(async (text: string) => {
    const endpoint = aiConfig.ttsEndpoint.trim()
    if (!endpoint) throw new Error('未配置 TTS endpoint')

    const cloneAudioDataUrl = aiConfig.ttsCloneAudioDataUrl.trim()
    const needsCloneAudio = isLikelyGradioTtsEndpoint(endpoint)
    if (needsCloneAudio && !cloneAudioDataUrl) {
      throw new Error('请先在 AI 助手设置上传克隆音色参考音频')
    }

    let blob: Blob | null = null
    let lastError = ''

    if (needsCloneAudio) {
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
    } else if (isQwenTtsMultimodalEndpoint(endpoint)) {
      try {
        const genUrl = normalizeQwenTtsMultimodalUrl(endpoint)
        const model = aiConfig.ttsModel.trim()
        const voice = aiConfig.ttsVoice.trim()
        const apiKey = aiConfig.ttsApiKey.trim()
        if (!model) throw new Error('请填写 TTS 模型名（如 qwen3-tts-vd-2026-01-26）')
        if (!voice) throw new Error('请填写 TTS 音色 voice（VD 系列需先在百炼「声音设计」生成并与 model 一致）')
        if (!apiKey) throw new Error('请填写 TTS API Key')
        const res = await fetchOpenAICompat(genUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          json: {
            model,
            input: {
              text,
              voice,
              language_type: 'Chinese',
            },
          },
        })
        if (!res.ok) {
          const msg = await readHttpErrorMessage(res)
          throw new Error(`千问 TTS -> HTTP ${res.status}${msg ? ` (${msg})` : ''}`)
        }
        const data = (await res.json()) as QwenTtsMultimodalResponse
        if (data.code) {
          throw new Error(`千问 TTS -> ${data.code}: ${data.message || ''}`)
        }
        if (data.status_code != null && data.status_code !== 200) {
          throw new Error(`千问 TTS -> ${data.status_code}: ${data.message || ''}`)
        }
        const audioUrl = String(data.output?.audio?.url || '').trim()
        const audioB64 = String(data.output?.audio?.data || '').trim()
        if (audioB64) {
          const bytes = atob(audioB64)
          const arr = new Uint8Array(bytes.length)
          for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
          blob = new Blob([arr], { type: 'audio/wav' })
        } else if (audioUrl) {
          const audioRes = await fetch(audioUrl)
          if (!audioRes.ok) {
            throw new Error(`下载合成音频失败（${audioRes.status}）。若在浏览器中报 CORS，请用桌面端测试。`)
          }
          blob = await audioRes.blob()
        } else {
          throw new Error('千问 TTS 响应中无 output.audio.url / data')
        }
      } catch (error) {
        lastError = (error as Error)?.message || '千问 TTS 请求失败'
      }
    } else if (isDashScopeCompatibleModeMisusedForTts(endpoint)) {
      lastError =
        'TTS 不能使用百炼 compatible-mode 地址（仅用于聊天）。请改为 endpoint：qwen-tts-multimodal；模型：qwen3-tts-flash；音色：Cherry；API Key 与聊天相同即可。'
    } else {
      const endpointCandidates = buildTtsEndpointCandidates(endpoint)
      const model = aiConfig.ttsModel.trim()
      const voice = aiConfig.ttsVoice.trim() || 'alloy'
      for (const item of endpointCandidates) {
        try {
          const payload: Record<string, unknown> = {
            input: text,
            voice,
            format: 'mp3',
          }
          if (model) payload.model = model
          // 云端 OpenAI 兼容 TTS：仅发送标准字段，避免厂商不支持的克隆字段以及超大 payload（DataURL/base64）。

          const speechUrl = `${normalizeOpenAICompatibleBaseUrl(item)}/v1/audio/speech`
          const res = await fetchOpenAICompat(speechUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(aiConfig.ttsApiKey.trim() ? { Authorization: `Bearer ${aiConfig.ttsApiKey.trim()}` } : {}),
            },
            json: payload,
          })
          if (!res.ok) {
            const msg = await readHttpErrorMessage(res)
            const base = normalizeOpenAICompatibleBaseUrl(item)
            const dsHint = res.status === 404 ? dashScopeCompatibleModeTts404Hint(base) : null
            lastError = `${speechUrl} -> HTTP ${res.status}${msg ? ` (${msg})` : ''}${dsHint ? `。${dsHint}` : ''}`
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
  }, [aiConfig.ttsApiKey, aiConfig.ttsCloneAudioDataUrl, aiConfig.ttsCloneAudioName, aiConfig.ttsEndpoint, aiConfig.ttsModel, aiConfig.ttsVoice])

  const testAiChatModelFromPanel = useCallback(async () => {
    const started = performance.now()
    const provider = aiConfig.provider
    setChatModelTestStatus(`测试中…（provider=${provider}）`)
    try {
      const rawEndpoint =
        provider === 'ollama'
          ? (aiConfig.endpoint.trim() || 'http://127.0.0.1:11434/v1/chat/completions')
          : aiConfig.endpoint.trim()
      const endpoint = rawEndpoint
        ? `${normalizeOpenAICompatibleBaseUrl(rawEndpoint)}/v1/chat/completions`
        : ''
      const model = aiConfig.model.trim()
      if (!endpoint || !model) {
        setChatModelTestStatus('聊天模型测试失败：未配置 endpoint 或 model')
        return
      }
      const res = await fetchOpenAICompat(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiConfig.apiKey.trim() ? { Authorization: `Bearer ${aiConfig.apiKey.trim()}` } : {}),
        },
        json: {
          model,
          temperature: 0,
          messages: [{ role: 'user', content: '只回复 OK' }],
        },
      })
      const elapsed = Math.round(performance.now() - started)
      if (!res.ok) {
        const msg = await readHttpErrorMessage(res)
        setChatModelTestStatus(
          `聊天模型测试失败：HTTP ${res.status}${msg ? ` (${msg})` : ''}（endpoint=${endpoint}，${elapsed}ms）`,
        )
        return
      }
      const data = (await res.json().catch(() => ({}))) as any
      const content = String(data?.choices?.[0]?.message?.content || '').trim()
      if (!content) {
        setChatModelTestStatus(`聊天模型测试失败：响应为空（endpoint=${endpoint}，${elapsed}ms）`)
        return
      }
      setChatModelTestStatus(`聊天模型测试成功：${elapsed}ms（provider=${provider}，endpoint=${endpoint}）`)
    } catch (e) {
      const elapsed = Math.round(performance.now() - started)
      setChatModelTestStatus(`聊天模型测试失败：${String((e as any)?.message || e)}（${elapsed}ms）`)
    }
  }, [aiConfig])

  const testAiTtsFromPanel = useCallback(async () => {
    const started = performance.now()
    const ep = aiConfig.ttsEndpoint.trim() || '未填写'
    setTtsTestStatus(`测试中…（endpoint=${ep}）`)
    try {
      await speakAssistantText('这是一段语音播报测试。')
      const elapsed = Math.round(performance.now() - started)
      setTtsTestStatus(`TTS 测试成功：已尝试播报（endpoint=${ep}，${elapsed}ms）`)
    } catch (e) {
      const elapsed = Math.round(performance.now() - started)
      setTtsTestStatus(
        `TTS 测试失败：${String((e as any)?.message || e)}（endpoint=${ep}，${elapsed}ms）`,
      )
    }
  }, [aiConfig.ttsEndpoint, speakAssistantText])

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
        busy: aiBusy || agentWorkspaceSending,
        messages: aiMessages,
      }),
    [agentWorkspaceSending, aiBusy, aiMessages],
  )
  const dockAvatarMedia = AI_ASSISTANT_AVATAR_MEDIA_URLS[dockAvatarState]
  const aiAssistantDockStyle = useMemo(() => {
    const panelWidth = 360
    const panelHeight = 520
    const gap = 20
    const margin = 20
    if (typeof window === 'undefined') {
      return { left: 0, top: 0, width: panelWidth, height: panelHeight }
    }
    if (!aiConfig.virtualAvatarVisible) {
      const left = window.innerWidth - panelWidth - margin
      const top = window.innerHeight - panelHeight - margin
      const maxLeft = Math.max(0, window.innerWidth - panelWidth)
      const maxTop = Math.max(0, window.innerHeight - panelHeight)
      return {
        left: clampNumber(left, 0, maxLeft),
        top: clampNumber(top, 0, maxTop),
        width: panelWidth,
        height: panelHeight,
      }
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
  }, [aiConfig.virtualAvatarVisible, avatarDockRect.height, avatarDockRect.left, avatarDockRect.top])

  useEffect(() => {
    if (!aiConfig.virtualAvatarVisible) {
      setAiAssistantDialogOpen(false)
      setAgentFloatingOpen(false)
    }
  }, [aiConfig.virtualAvatarVisible])

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
    (event: ReactMouseEvent<HTMLElement>) => {
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
      await awaitSensitiveLexiconSettled()
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
      const prepared = withResolvedNodeMentions(fresh, latestNodes, edgesRef.current)
      const sensitiveBlob = collectUserFacingTextFromNodeData(prepared.data as StudioNodeData)
      const sensitiveGate = canSend(sensitiveBlob, true)
      if (!sensitiveGate.allowed) {
        alertSensitiveWordBlocked(sensitiveGate.reason ?? '提示词包含敏感内容，已取消执行')
        appendHistory(`${fresh.data.title || fresh.id}：${sensitiveGate.reason ?? '已取消执行'}`)
        return
      }
      const id = fresh.id
      if (promptPanelSubmittingNodeIdsRef.current.has(id)) {
        const tip = '任务已提交，请勿重复点击'
        appendHistory(`${fresh.data.title || fresh.id}：${tip}`)
        window.alert(tip)
        return
      }
      promptPanelSubmittingNodeIdsRef.current.add(id)
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
          studioEdges: edgesRef.current,
          runNodeTitle: String(fresh.data.title || fresh.id),
          executionTarget: resolvedPromptPickerMode(fresh.data as { promptPickerMode?: 'workflow' | 'model' }),
          rawPromptText:
            fresh.data.kind === 'image'
              ? String((fresh.data as ImageNodeData).prompt || '')
              : fresh.data.kind === 'video'
                ? joinVideoRawPromptText(fresh.data as VideoNodeData)
                : undefined,
          rawNoteText:
            fresh.data.kind === 'audio' || fresh.data.kind === 'music'
              ? String((fresh.data as AudioNodeData).note || '')
              : undefined,
          onPreflightMessage: (message) => appendHistory(message),
          onProgress: (info) => {
            updateNodeData(id, { kind, runProgress: info } as Partial<StudioNodeData>)
          },
        })
        const nodeForMerge = nodesRef.current.find((n) => n.id === id) ?? fresh
        const execMode = resolvedPromptPickerMode(fresh.data as { promptPickerMode?: 'workflow' | 'model' })
        await applyWorkflowResultToNode(nodeForMerge, kind, result, {
          replaceImageOutputStrip: execMode === 'model' && (kind === 'image' || kind === 'video'),
        })

        updateNodeData(id, {
          kind,
          runStatus: 'success',
          lastRunAt: Date.now(),
          runProgress: undefined,
        } as Partial<StudioNodeData>)
      } catch (error) {
        const message = (error as Error)?.message || '执行失败'
        const pendingMatch = message.match(/任务仍在处理中（taskId=([^)]+)）/)
        if (pendingMatch) {
          const taskId = String(pendingMatch[1] || '').trim()
          appendCloudTaskRecord({
            taskId,
            nodeId: id,
            nodeKind: kind,
            title: String(fresh.data.title || ''),
          })
          updateNodeData(id, {
            kind,
            runStatus: 'queued',
            runProgress: {
              percent: 52,
              label: taskId ? `云端任务处理中（${taskId}）` : '云端任务处理中…',
            },
            lastRunAt: Date.now(),
          } as Partial<StudioNodeData>)
          appendHistory(`${NODE_KIND_LABEL[kind]}节点任务已提交：${taskId || '处理中'}，请稍候查看结果`)
          window.alert(`任务已提交，正在云端处理中${taskId ? `（${taskId}）` : ''}，请勿重复点击。`)
          void pollPendingCloudTaskAndBackfill(taskId, id, kind)
          return
        }
        updateNodeData(id, {
          kind,
          runStatus: 'error',
          lastRunAt: Date.now(),
          runProgress: undefined,
        } as Partial<StudioNodeData>)
        appendHistory(`${NODE_KIND_LABEL[kind]}节点执行失败：${message}`)
        window.alert(`执行失败：${message}`)
      } finally {
        promptPanelSubmittingNodeIdsRef.current.delete(id)
      }
    } catch (error) {
      const message = (error as Error)?.message || '执行失败（执行前准备阶段）'
      appendHistory(`执行失败：${message}`)
      window.alert(`执行失败：${message}`)
    }
  }, [
    appendHistory,
    appendCloudTaskRecord,
    applyWorkflowResultToNode,
    ensureLicenseCanSubmit,
    nodes,
    pollPendingCloudTaskAndBackfill,
    promptPanel,
    runNodeWorkflow,
    selectedNodeId,
    updateNodeData,
  ])

  /**
   * 将文本节点按指定分段标记（### 或 ///）拆成多个文本子节点并自动连线。
   */
  const splitTextNodeToStructuredNodes = useCallback((delimiter: TextSymbolSplitDelimiter) => {
    if (!promptPanel || promptPanel.kind !== 'text') return
    const sourceNode = nodes.find((item) => item.id === promptPanel.node.id) ?? promptPanel.node
    const body = ((sourceNode.data as TextNodeData).body || '').trim()
    if (!body) {
      window.alert('请先填写文本内容，再执行符号拆分')
      return
    }
    const entries = splitTextByDelimiter(body, delimiter)
    if (!entries.length) {
      window.alert(`未识别到可拆分段落，请使用 ${delimiter} 作为分段标记`)
      return
    }
    if (entries.length < 2) {
      window.alert(`符号拆分至少需要 2 段内容。请在文本中加入 ${delimiter} 分段。`)
      return
    }

    /**
     * 拆分落点（与「后接节点」一致）：
     * - 第一个子节点与源节点 **顶缘平齐**（同一水平线，`y` 相同）；
     * - 子节点列左缘 = 源节点 **右缘 + 20**（水平净距 20px）；
     * - 后续子节点在本列向下叠，间距仍为 20。
     * 宽度与坐标在 `setNodes` 内用 `prev` 中最新节点 + `splitAnchorNodeFlowWidth` 计算，避免闭包陈旧或 style/measured 不一致导致横向偏移为 0。
     */
    const SPLIT_GAP_FLOW = 20
    const sourceId = sourceNode.id
    const newNodes: Array<Node<StudioNodeData>> = []
    const newEdges: Array<Edge> = []

    setNodes((prev) => {
      const liveSource = prev.find((n) => n.id === sourceId) as Node<StudioNodeData> | undefined
      if (!liveSource) return prev

      const px = Number(liveSource.position.x)
      const py = Number(liveSource.position.y)
      const flowX = Number.isFinite(px) ? px : 0
      const flowY = Number.isFinite(py) ? py : 0
      const storeSource = getNodes().find((n) => n.id === sourceId) as Node<StudioNodeData> | undefined
      const sourceW = splitAnchorNodeFlowWidth(storeSource ?? liveSource)
      const baseX = flowX + sourceW + SPLIT_GAP_FLOW
      let yCursor = flowY

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
        const nodeH = getNodeSize(node).height
        yCursor += nodeH + SPLIT_GAP_FLOW
        nextNodes = [...nextNodes, node]
        newNodes.push(node)
        newEdges.push({
          id: crypto.randomUUID(),
          source: sourceId,
          target: id,
          animated: true,
          style: { strokeWidth: 2 },
        })
      })
      return nextNodes
    })
    setEdges((prev) => [...prev, ...newEdges])
    appendHistory(
      `符号拆分（${delimiter}）完成：从「${sourceNode.data.title}」生成 ${newNodes.length} 个文本节点`,
    )
    /** 拆分后焦点常在提示框 textarea，会导致 Ctrl+Z 只作用在输入框；失焦后可用画布撤销 */
    requestAnimationFrame(() => {
      panelPromptTextareaRef.current?.blur()
    })
  }, [appendHistory, getNodes, nodes, promptPanel, setEdges, setNodes])

  return (
    <CanvasProvider
      updateNodeData={updateNodeData}
      addLinkedNode={addLinkedNode}
      removeHistoryBySource={removeHistoryBySource}
      updateNodeMeta={updateNodeMeta}
      removeNodeById={removeNodeById}
      addPanoramaViewToCanvas={addPanoramaViewToCanvas}
      runNodeFromCanvas={runNodeFromCanvas}
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
          className={canvasDayMode ? 'studio-flow-wrap studio-flow-wrap--canvas-day' : 'studio-flow-wrap'}
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
            if (agentFloatingOpen && target.closest('[data-studio-agent-workspace="1"]')) {
              return
            }
            if (!leftPanel) return
            if (leftPanel === 'settings') {
              const clickedSettingsModal = target.closest('[data-studio-settings-modal="1"]')
              if (!clickedSettingsModal) {
                clearSettingsFocusTab()
                setLeftPanel(null)
              }
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
            className="studio-canvas-grain fixed inset-0 pointer-events-none z-0"
            aria-hidden
          />

          <header
            className="studio-canvas-topbar fixed top-6 inset-x-8 h-14 flex items-center justify-between z-50 pointer-events-none"
            aria-label="画布顶部栏"
          >
            <div className="studio-canvas-topbar__brand flex items-center gap-4 pointer-events-auto">
              <div
                className={
                  canvasDayMode
                    ? 'flex items-center gap-3 bg-[#FFFFFF] border border-[#E8E8E8] px-4 py-2 rounded-2xl shadow-[0_8px_32px_rgba(38,38,38,0.08)] backdrop-blur-xl'
                    : 'flex items-center gap-3 bg-[#111114] border border-white/5 px-4 py-2 rounded-full shadow-2xl backdrop-blur-xl'
                }
              >
                {/* Brand */}
                <button
                  type="button"
                  className={
                    canvasDayMode
                      ? 'flex items-center gap-2 rounded-xl px-1 text-left transition-colors hover:bg-[#F5F5F5]'
                      : 'flex items-center gap-2 rounded-full px-1 text-left transition-colors hover:bg-white/5'
                  }
                  title="回到首页"
                  aria-label="回到首页"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    if (onGoHome) {
                      onGoHome()
                      return
                    }
                  }}
                >
                  <FlowidMark />
                  <span
                    className={
                      canvasDayMode
                        ? 'text-sm font-black tracking-widest uppercase text-[#262626]'
                        : 'text-sm font-black tracking-widest uppercase text-white/90'
                    }
                  >
                    Flowid
                  </span>
                </button>

                <div
                  className={canvasDayMode ? 'w-[1px] h-4 bg-[#E8E8E8] mx-2' : 'w-[1px] h-4 bg-white/10 mx-2'}
                  aria-hidden
                />

                {/* Project tabs (keep behavior; match fig-1 look) */}
                <div className="flex items-center gap-2">
                  {projectTabs.map((tab) => {
                    const isActive = tab.id === activeProjectId
                    return (
                      <div
                        key={tab.id}
                        className={`studio-project-pill group flex items-center gap-2 px-2 py-1 transition-colors cursor-pointer select-none ${
                          isActive ? 'is-active' : ''
                        } ${
                          canvasDayMode
                            ? isActive
                              ? 'text-[#262626]'
                              : 'text-[#525252] hover:text-[#262626]'
                            : isActive
                              ? 'text-white'
                              : 'text-white/70 hover:text-white'
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
                            className={
                              canvasDayMode
                                ? 'studio-project-pill__input bg-[#FFFFFF] outline-none border border-[#E8E8E8] rounded-md px-2 py-0.5 text-[13px] font-black tracking-widest uppercase text-[#262626]'
                                : 'studio-project-pill__input bg-transparent outline-none border border-white/15 rounded-md px-2 py-0.5 text-[13px] font-black tracking-widest uppercase text-white/90'
                            }
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
                            <span
                              className="studio-project-pill__name text-[14px] font-black tracking-widest"
                              title="双击此处可重命名项目"
                            >
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
                          className={
                            canvasDayMode
                              ? 'studio-project-pill__close text-[#737373] hover:text-[#262626] transition-colors opacity-0 group-hover:opacity-100'
                              : 'studio-project-pill__close text-white/40 hover:text-white transition-colors opacity-0 group-hover:opacity-100'
                          }
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
                className={
                  canvasDayMode
                    ? 'studio-project-add w-10 h-10 rounded-xl bg-[#FFFFFF] border border-[#E8E8E8] shadow-[0_6px_20px_rgba(38,38,38,0.06)] backdrop-blur-xl text-[#525252] hover:text-[#262626] hover:border-[#D4D4D4] hover:bg-[#F5F5F5] transition-colors pointer-events-auto'
                    : 'studio-project-add w-10 h-10 rounded-xl bg-[#111114] border border-white/10 shadow-2xl backdrop-blur-xl text-white/70 hover:text-white hover:bg-white/5 transition-colors pointer-events-auto'
                }
                aria-label="新增项目"
                onClick={createProjectLabel}
                title="新增项目"
              >
                +
              </button>
            </div>
            <div className="studio-canvas-topbar__actions flex items-center gap-3 pointer-events-auto">
              {/* Right pill group (fig-1) */}
              <div
                className={
                  canvasDayMode
                    ? 'flex items-center gap-4 bg-[#FFFFFF] border border-[#E8E8E8] px-5 py-2 rounded-2xl shadow-[0_8px_32px_rgba(38,38,38,0.07)] backdrop-blur-xl'
                    : 'flex items-center gap-4 bg-[#111114] border border-white/5 px-5 py-2 rounded-full shadow-2xl backdrop-blur-xl'
                }
              >
                <button
                  type="button"
                  className={`btn--top-local inline-flex items-center px-1 ${
                    canvasDayMode ? 'text-[#262626] hover:text-[#171717]' : 'text-white/85 hover:text-white'
                  }`}
                  title="选择工程 JSON 并导入"
                  aria-label="本地项目"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    void openLocalProjectFromFilePicker()
                  }}
                >
                  <span className="text-[14px] font-black tracking-widest">本地项目</span>
                </button>
              </div>
            </div>
          </header>

          {/* Sidebar Toolbelt — match @flowid (2); behavior unchanged */}
          <div className="absolute left-6 inset-y-0 flex items-center z-50 pointer-events-none" aria-label="画布左侧工具栏">
            <div className="relative pointer-events-auto flex items-center">
              <div
                className={
                  canvasDayMode
                    ? 'studio-left-toolbelt bg-[#FFFFFF] border border-[#E8E8E8] p-2 rounded-2xl shadow-[0_10px_36px_rgba(38,38,38,0.08)] flex flex-col gap-1 items-center backdrop-blur-xl relative z-20'
                    : 'studio-left-toolbelt bg-[#111114] border border-white/10 p-2 rounded-2xl shadow-2xl flex flex-col gap-1 items-center backdrop-blur-xl relative z-20'
                }
              >
                <button
                  type="button"
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95 mb-2 ${
                    canvasDayMode
                      ? leftPanel === 'add-node'
                        ? 'border border-[rgba(234,88,12,0.38)] bg-[rgba(234,88,12,0.18)] text-[#9a3412] shadow-[0_8px_24px_rgba(234,88,12,0.12)]'
                        : 'bg-[#FFFFFF] border border-[#E8E8E8] text-[#262626] hover:bg-[#F5F5F5] hover:border-[#D4D4D4]'
                      : leftPanel === 'add-node'
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
                    canvasDayMode
                      ? leftPanel === 'download-node'
                        ? 'border border-[rgba(234,88,12,0.38)] bg-[rgba(234,88,12,0.18)] text-[#9a3412]'
                        : 'border border-transparent text-[#525252] hover:bg-[#F5F5F5] hover:text-[#262626]'
                      : leftPanel === 'download-node'
                        ? 'text-orange-500 bg-orange-500/10'
                        : 'text-white/20 hover:text-white hover:bg-white/5'
                  }`}
                  title="预设模板"
                  aria-label="预设模板"
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
                    canvasDayMode
                      ? leftPanel === 'settings'
                        ? 'text-[#262626] bg-[#F5F5F5]'
                        : 'text-[#525252] hover:text-[#262626] hover:bg-[#F5F5F5]'
                      : leftPanel === 'settings'
                        ? 'text-orange-500 bg-orange-500/10'
                        : 'text-white/20 hover:text-white hover:bg-white/5'
                  }`}
                  title="系统设置"
                  aria-label="系统设置"
                  onClick={() => {
                    dismissCanvasAddMenu()
                    clearSettingsFocusTab()
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
                      {leftPanel === 'add-node' ? (
                        <AddNodePanel addNodeItems={addNodeItems} canvasDayMode={canvasDayMode} />
                      ) : null}
                      {leftPanel === 'download-node' ? (
                        <DownloadPanel
                          canvasDayMode={canvasDayMode}
                          selectedNode={selectedNode}
                          onDownloadSelected={downloadSelectedNode}
                          onDownloadProject={exportJson}
                          onMergePresetTemplate={async (payload) => {
                            const root = reactFlowRootRef.current
                            let ax = 0
                            let ay = 0
                            if (root) {
                              const r = root.getBoundingClientRect()
                              if (r.width > 0 && r.height > 0) {
                                const c = screenToFlowPosition({
                                  x: r.left + r.width / 2,
                                  y: r.top + r.height / 2,
                                })
                                ax = c.x
                                ay = c.y
                              }
                            }
                            await mergePresetTemplateFromLibrary(payload, { x: ax, y: ay })
                          }}
                        />
                      ) : null}
                    </motion.aside>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <RightPanel
            canvasDayMode={canvasDayMode}
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
            onRenameAsset={renameAsset}
            onFlowidMaterialDrop={importNodeMediaToLibrary}
            historyItems={historyItems}
            onRemoveHistoryItems={removeHistoryItems}
          />

          {/* Local projects popover removed: use native pickers instead */}

          {agentFloatingOpen && typeof document !== 'undefined'
            ? createPortal(
                <AgentFloatingChatWindow
                  open
                  busy={aiBusy}
                  ttsEnabled={aiConfig.ttsEnabled}
                  onSpeak={speakAssistantText}
                  onClose={() => setAgentFloatingOpen(false)}
                  onWorkspaceSendingChange={setAgentWorkspaceSending}
                  assistantModelName={aiConfig.model}
                />,
                document.body,
              )
            : null}

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
                    onTestChatModel={testAiChatModelFromPanel}
                    onTestTts={testAiTtsFromPanel}
                    chatModelTestStatus={chatModelTestStatus}
                    ttsTestStatus={ttsTestStatus}
                    onClose={() => setAiAssistantDialogOpen(false)}
                  />
                </div>,
                document.body,
              )
            : null}

          {pointsTaskFailToast && typeof document !== 'undefined'
            ? createPortal(
                <PointsTaskFailureToast
                  state={pointsTaskFailToast}
                  onClose={() => {
                    if (pointsTaskFailToastTimerRef.current) {
                      clearTimeout(pointsTaskFailToastTimerRef.current)
                      pointsTaskFailToastTimerRef.current = null
                    }
                    setPointsTaskFailToast(null)
                  }}
                />,
                document.body,
              )
            : null}

          {voiceTable8ModalOpen &&
          voiceTable8ModalPosition &&
          promptPanel &&
          promptPanel.kind === 'audio' &&
          typeof document !== 'undefined'
            ? createPortal(
                <div
                  className="studio-vt8-modal-shell nodrag nopan"
                  style={{
                    position: 'fixed',
                    left: `${voiceTable8ModalPosition.left}px`,
                    top: `${voiceTable8ModalPosition.top}px`,
                    width: `${voiceTable8ModalPosition.width}px`,
                    height: 'min(480px, 56vh)',
                    zIndex: 12200,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="studio-vt8-modal">
                    <div className="studio-vt8-modal__top">
                      <span className="studio-vt8-modal__title">台本信息</span>
                      <div className="studio-vt8-modal__toolbar">
                        <button
                          type="button"
                          className="studio-vt8-modal__toolbtn studio-vt8-modal__toolbtn--primary"
                          onClick={() => {
                            flushVoiceTable8DraftToNode()
                            setVoiceTable8ModalOpen(false)
                            setVoiceTable8Editing(null)
                          }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="studio-vt8-modal__toolbtn"
                          onClick={() => {
                            const blank = (): ComfyVoiceTableRow => ({
                              roleName: '',
                              sampleLine: '',
                              voiceInstruct: '',
                              language: 'Auto',
                            })
                            setVoiceTable8Draft([blank(), blank(), blank()])
                            setVoiceTable8Editing(null)
                          }}
                        >
                          清空
                        </button>
                        <button
                          type="button"
                          className="studio-vt8-modal__toolbtn"
                          onClick={() => {
                            setVoiceTable8ModalOpen(false)
                            setVoiceTable8Editing(null)
                          }}
                        >
                          退出
                        </button>
                      </div>
                    </div>
                    <div className="studio-vt8-modal__body">
                      <div className="studio-vt8-modal__bulk">
                        <textarea
                          className="studio-vt8-modal__bulk-input nodrag nopan nowheel"
                          rows={2}
                          spellCheck={false}
                          placeholder="粘贴批量结果（覆盖下方表格）：每行「角色名称###代表台词###声音设定」。可选第四段「###语言」与下拉一致。勿在台词/声音中使用 ###。"
                          value={voiceTable8BulkPasteDraft}
                          onChange={(e) => setVoiceTable8BulkPasteDraft(e.target.value)}
                        />
                        <div className="studio-vt8-modal__bulk-bar">
                          <button
                            type="button"
                            className="studio-vt8-modal__toolbtn studio-vt8-modal__toolbtn--primary"
                            onClick={applyVoiceTable8BulkPaste}
                          >
                            填入表格
                          </button>
                          <button
                            type="button"
                            className="studio-vt8-modal__toolbtn"
                            onClick={async () => {
                              try {
                                const t = await navigator.clipboard.readText()
                                setVoiceTable8BulkPasteDraft(t)
                              } catch {
                                window.alert('无法读取剪贴板，请在上框手动粘贴。')
                              }
                            }}
                          >
                            从剪贴板读取
                          </button>
                        </div>
                      </div>
                      <div className="studio-vt8-modal__scroll">
                      <div className="studio-vt8-modal__th" aria-hidden>
                        <span>角色名称</span>
                        <span>角色台词</span>
                        <span>角色声音设定</span>
                        <span>语言</span>
                        <span />
                      </div>
                      {voiceTable8Draft.map((row, rowIdx) => (
                        <div key={`vt8m-${rowIdx}`} className="studio-vt8-modal__tr">
                          {(
                            [
                              ['roleName', false],
                              ['sampleLine', true],
                              ['voiceInstruct', true],
                            ] as const
                          ).map(([field, multiline]) => {
                            const isEd =
                              voiceTable8Editing?.row === rowIdx &&
                              voiceTable8Editing?.field === field
                            const val = String(row[field] ?? '')
                            if (isEd) {
                              if (multiline) {
                                return (
                                  <textarea
                                    key={field}
                                    className="studio-vt8-modal__field studio-vt8-modal__field--textarea"
                                    rows={2}
                                    autoFocus
                                    value={val}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setVoiceTable8Draft((prev) => {
                                        const next = prev.slice()
                                        next[rowIdx] = { ...next[rowIdx]!, [field]: v }
                                        return next
                                      })
                                    }}
                                    onBlur={() => setVoiceTable8Editing(null)}
                                  />
                                )
                              }
                              return (
                                <input
                                  key={field}
                                  type="text"
                                  className="studio-vt8-modal__field"
                                  autoFocus
                                  value={val}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setVoiceTable8Draft((prev) => {
                                      const next = prev.slice()
                                      next[rowIdx] = { ...next[rowIdx]!, [field]: v }
                                      return next
                                    })
                                  }}
                                  onBlur={() => setVoiceTable8Editing(null)}
                                />
                              )
                            }
                            return (
                              <div
                                key={field}
                                className="studio-vt8-modal__cell"
                                title="双击编辑"
                                onDoubleClick={() =>
                                  setVoiceTable8Editing({ row: rowIdx, field })
                                }
                              >
                                {val.trim() ? val : <span className="studio-vt8-modal__placeholder">—</span>}
                              </div>
                            )
                          })}
                          <PromptPanelDropdown
                            placeholder="语言"
                            ariaLabel={`角色 ${rowIdx + 1} 语言`}
                            className="studio-vt8-modal__lang-dropdown"
                            value={
                              (COMFY_VOICE_TABLE_LANGUAGE_OPTIONS as readonly string[]).includes(
                                row.language,
                              )
                                ? row.language
                                : 'Auto'
                            }
                            options={COMFY_VOICE_TABLE_LANGUAGE_OPTIONS.map((v) => ({
                              value: v,
                              label: v,
                            }))}
                            onChange={(v) => {
                              setVoiceTable8Draft((prev) => {
                                const next = prev.slice()
                                next[rowIdx] = { ...next[rowIdx]!, language: v }
                                return next
                              })
                            }}
                          />
                          <button
                            type="button"
                            className="studio-vt8-modal__rowdel"
                            title="删除本行"
                            disabled={voiceTable8Draft.length <= 1}
                            onClick={() => {
                              setVoiceTable8Draft((prev) => prev.filter((_, j) => j !== rowIdx))
                              setVoiceTable8Editing(null)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="studio-vt8-modal__add-wide"
                      disabled={voiceTable8Draft.length >= 8}
                      onClick={() => {
                        setVoiceTable8Draft((prev) => {
                          if (prev.length >= 8) return prev
                          return [
                            ...prev,
                            {
                              roleName: '',
                              sampleLine: '',
                              voiceInstruct: '',
                              language: 'Auto',
                            },
                          ]
                        })
                      }}
                    >
                      新增角色
                    </button>
                  </div>
                </div>,
                document.body,
              )
            : null}

          {tdRefRoleModalOpen &&
          tdRefRoleModalPosition &&
          promptPanel &&
          promptPanel.kind === 'audio' &&
          typeof document !== 'undefined' ? (
            <StudioTdRefRoleModalPortal
              key={tdRefRoleModalKey}
              slotLabels={tdRefRoleSlotLabels}
              seedRows={tdRefRoleModalSeedRows}
              left={tdRefRoleModalPosition.left}
              top={tdRefRoleModalPosition.top}
              width={tdRefRoleModalPosition.width}
              onCommit={commitTdRefRoleModalToNode}
              persistRef={tdRefRolePersistRef}
            />
          ) : null}

          {musicFineTuneModalOpen &&
          musicFineTuneModalPosition &&
          promptPanel &&
          promptPanel.kind === 'music' &&
          typeof document !== 'undefined'
            ? createPortal(
                <div
                  className="studio-vt8-modal-shell nodrag nopan"
                  style={{
                    position: 'fixed',
                    left: `${musicFineTuneModalPosition.left}px`,
                    top: `${musicFineTuneModalPosition.top}px`,
                    width: `${musicFineTuneModalPosition.width}px`,
                    height: 'min(520px, 72vh)',
                    zIndex: 12200,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="studio-vt8-modal">
                    <div className="studio-vt8-modal__top">
                      <span className="studio-vt8-modal__title">音乐工作流微调</span>
                      <div className="studio-vt8-modal__toolbar">
                        <button
                          type="button"
                          className="studio-vt8-modal__toolbtn studio-vt8-modal__toolbtn--primary"
                          onClick={() => {
                            const nid = musicFineTuneModalTargetIdRef.current ?? promptPanel.node.id
                            updateNodeData(
                              nid,
                              audioDataPatchFromMusicFineTuneDraft(musicFineTuneDraft) as Partial<StudioNodeData>,
                            )
                            setMusicFineTuneModalOpen(false)
                          }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="studio-vt8-modal__toolbtn"
                          onClick={() => {
                            setMusicFineTuneModalOpen(false)
                          }}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                    <div className="studio-vt8-modal__body">
                      <div className="studio-vt8-modal__scroll">
                        <div className="studio-music-finetune__row">
                          <span>时长</span>
                          <PromptPanelDropdown
                            ariaLabel="生成时长（分钟）"
                            placeholder="时长"
                            className="studio-vt8-modal__field studio-vt8-modal__field--select"
                            value={String(musicFineTuneDraft.durationMinutes)}
                            options={MUSIC_FINE_TUNE_DURATION_DROPDOWN_OPTIONS}
                            onChange={(v) => {
                              const n = Number(v)
                              const dm =
                                n === 1 || n === 2 || n === 3 || n === 4
                                  ? n
                                  : DEFAULT_MUSIC_FINE_TUNE_DRAFT.durationMinutes
                              setMusicFineTuneDraft((prev) => ({ ...prev, durationMinutes: dm }))
                            }}
                          />
                        </div>
                        <div className="studio-music-finetune__row">
                          <label htmlFor="flowid-music-ft-bpm">BPM</label>
                          <input
                            id="flowid-music-ft-bpm"
                            type="number"
                            className="studio-vt8-modal__field"
                            min={40}
                            max={240}
                            step={1}
                            value={musicFineTuneDraft.bpm}
                            onChange={(e) => {
                              const n = Math.round(Number(e.target.value))
                              setMusicFineTuneDraft((prev) => ({
                                ...prev,
                                bpm: Number.isFinite(n) ? n : prev.bpm,
                              }))
                            }}
                          />
                        </div>
                        <div className="studio-music-finetune__row">
                          <span>拍号</span>
                          <PromptPanelDropdown
                            ariaLabel="拍号"
                            placeholder="拍号"
                            className="studio-vt8-modal__field studio-vt8-modal__field--select"
                            value={musicFineTuneDraft.timesignature}
                            options={MUSIC_FINE_TUNE_TS_DROPDOWN_OPTIONS}
                            onChange={(v) =>
                              setMusicFineTuneDraft((prev) => ({
                                ...prev,
                                timesignature: v,
                              }))
                            }
                          />
                        </div>
                        <div className="studio-music-finetune__row">
                          <span>语言</span>
                          <PromptPanelDropdown
                            ariaLabel="语言"
                            placeholder="语言"
                            className="studio-vt8-modal__field studio-vt8-modal__field--select"
                            value={musicFineTuneDraft.language}
                            options={MUSIC_FINE_TUNE_LANG_DROPDOWN_OPTIONS}
                            onChange={(v) =>
                              setMusicFineTuneDraft((prev) => ({
                                ...prev,
                                language: v,
                              }))
                            }
                          />
                        </div>
                        <div className="studio-music-finetune__row">
                          <span>调性</span>
                          <PromptPanelDropdown
                            ariaLabel="调性"
                            placeholder="调性"
                            className="studio-vt8-modal__field studio-vt8-modal__field--select"
                            value={musicFineTuneDraft.keyscale}
                            options={MUSIC_FINE_TUNE_KEY_DROPDOWN_OPTIONS}
                            onChange={(v) =>
                              setMusicFineTuneDraft((prev) => ({
                                ...prev,
                                keyscale: v,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}

          {leftPanel === 'settings' ? (
            <div
              className={
                canvasDayMode
                  ? 'fixed inset-0 z-[12100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm'
                  : 'fixed inset-0 z-[12100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md'
              }
              onMouseDown={() => {
                clearSettingsFocusTab()
                setLeftPanel(null)
              }}
            >
              <WorkflowSettingsPanel
                canvasDayMode={canvasDayMode}
                executionMode={executionMode}
                executionProvider={executionProvider}
                randomizeKsamplerSeedsOnRun={randomizeKsamplerSeedsOnRun}
                localConfig={localConfig}
                cloudConfig={cloudConfig}
                cloudEndpoints={cloudEndpoints}
                cloudWorkflowMetaList={cloudWorkflowMetaList}
                nodeConfigs={nodeConfigs}
                shortcuts={shortcuts}
                lastExecutionMessage={lastExecutionMessage}
                onExecutionProviderChange={updateExecutionProvider}
                onRandomizeKsamplerSeedsOnRunChange={setRandomizeKsamplerSeedsOnRun}
                onProviderConfigChange={updateProviderConfig}
                onNodeConfigChange={updateNodeConfigAndSyncCloudKeys}
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
                settingsFocusTab={settingsFocusTab}
                onSettingsFocusTabConsumed={clearSettingsFocusTab}
                onClose={() => {
                  clearSettingsFocusTab()
                  setLeftPanel(null)
                }}
              />
            </div>
          ) : null}

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
              <AddNodePanel addNodeItems={canvasAddNodeItems} canvasDayMode={canvasDayMode} />
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
              <AddNodePanel addNodeItems={connectAddNodeItems} canvasDayMode={canvasDayMode} />
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
                    {contextMenuMultiangleTarget && multiSelectContextMenu ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          setMultianglePanel({ nodeId: contextMenuMultiangleTarget.id })
                          dismissMultiSelectContextMenu()
                        }}
                      >
                        角度控制
                      </button>
                    ) : null}
                    {contextMenuImageCompareTwoPick ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => createImageCompareFromContextMenuSelection()}
                      >
                        新增对比节点
                      </button>
                    ) : null}
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
                    {batchUnifyMenuVisible ? (
                      <button
                        type="button"
                        className="studio-group__menuItem"
                        role="menuitem"
                        onClick={() => {
                          cancelSubmenuHoverCloseTimer()
                          setMultiSelectContextMenu((prev) => {
                            if (!prev) return prev
                            const m = prev.submenuMode
                            const isBatch =
                              m === 'batchUnified' || m === 'batchWorkflow' || m === 'batchModel'
                            return { ...prev, submenuMode: isBatch ? null : 'batchUnified' }
                          })
                        }}
                      >
                        统一（工作流 / 模型）
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
                          : multiSelectContextMenu.submenuMode === 'linked'
                            ? '新增节点类型'
                            : multiSelectContextMenu.submenuMode === 'batchUnified'
                              ? '统一工作流或模型'
                              : multiSelectContextMenu.submenuMode === 'batchWorkflow'
                                ? '选择工作流统一应用到所选节点'
                                : '选择模型统一应用到所选节点'
                      }
                    >
                      {multiSelectContextMenu.submenuMode === 'linked' ||
                      multiSelectContextMenu.submenuMode === 'common' ? (
                        SYNC_ADD_MENU_ITEMS.map((item) => (
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
                        ))
                      ) : multiSelectContextMenu.submenuMode === 'batchUnified' ? (
                        <>
                          <button
                            type="button"
                            className="add-node-card__item"
                            role="menuitem"
                            disabled={!batchWorkflowUnifyRows.length}
                            title={
                              batchWorkflowUnifyRows.length
                                ? undefined
                                : '当前选中节点类型下没有可用工作流'
                            }
                            onClick={() => {
                              if (!batchWorkflowUnifyRows.length) return
                              cancelSubmenuHoverCloseTimer()
                              setMultiSelectContextMenu((p) =>
                                p ? { ...p, submenuMode: 'batchWorkflow' } : p,
                              )
                            }}
                          >
                            <span className="add-node-card__itemIcon" aria-hidden>
                              ⧉
                            </span>
                            <span className="add-node-card__itemMain">
                              <span className="add-node-card__itemText">ComfyUI 工作流</span>
                              <span className="add-node-card__itemSub">将所选节点的提示框统一为同一工作流</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="add-node-card__item"
                            role="menuitem"
                            disabled={
                              executionProvider !== 'cloud' || !batchModelUnifyOptions.length
                            }
                            title={
                              executionProvider !== 'cloud'
                                ? '本地执行时请在各节点工作流中配置模型'
                                : !batchModelUnifyOptions.length
                                  ? '暂无可用云端模型选项'
                                  : undefined
                            }
                            onClick={() => {
                              if (executionProvider !== 'cloud' || !batchModelUnifyOptions.length)
                                return
                              cancelSubmenuHoverCloseTimer()
                              setMultiSelectContextMenu((p) =>
                                p ? { ...p, submenuMode: 'batchModel' } : p,
                              )
                            }}
                          >
                            <span className="add-node-card__itemIcon" aria-hidden>
                              ◎
                            </span>
                            <span className="add-node-card__itemMain">
                              <span className="add-node-card__itemText">模型</span>
                              <span className="add-node-card__itemSub">与底部「选择模型」一致，批量写入所选节点</span>
                            </span>
                          </button>
                        </>
                      ) : multiSelectContextMenu.submenuMode === 'batchWorkflow' ? (
                        <>
                          <button
                            type="button"
                            className="add-node-card__item"
                            role="menuitem"
                            onClick={() => {
                              cancelSubmenuHoverCloseTimer()
                              setMultiSelectContextMenu((p) =>
                                p ? { ...p, submenuMode: 'batchUnified' } : p,
                              )
                            }}
                          >
                            <span className="add-node-card__itemIcon" aria-hidden>
                              ←
                            </span>
                            <span className="add-node-card__itemText">返回</span>
                          </button>
                          {batchWorkflowUnifyRows.map((row) => {
                            const key =
                              row.mode === 'cloud'
                                ? `c-${row.meta.id}`
                                : `l-${row.kind}-${row.entry.id}`
                            const label =
                              row.mode === 'cloud'
                                ? String(row.meta.nodeKind || '').trim()
                                  ? `${row.meta.name}（${
                                      NODE_KIND_LABEL[row.meta.nodeKind as StudioNodeKind] ??
                                      row.meta.nodeKind
                                    }）`
                                  : row.meta.name
                                : `${NODE_KIND_LABEL[row.kind]} · ${row.entry.name}`
                            return (
                              <button
                                key={key}
                                type="button"
                                className="add-node-card__item"
                                role="menuitem"
                                title={label}
                                onClick={() => applyBatchWorkflowUnifyRow(row)}
                              >
                                <span className="add-node-card__itemIcon" aria-hidden>
                                  ⧉
                                </span>
                                <span className="add-node-card__itemMain">
                                  <span className="add-node-card__itemText">{label}</span>
                                </span>
                              </button>
                            )
                          })}
                          {!batchWorkflowUnifyRows.length ? (
                            <div className="add-node-card__itemSub add-node-card__batchEmptyHint">
                              暂无可统一的工作流
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="add-node-card__item"
                            role="menuitem"
                            onClick={() => {
                              cancelSubmenuHoverCloseTimer()
                              setMultiSelectContextMenu((p) =>
                                p ? { ...p, submenuMode: 'batchUnified' } : p,
                              )
                            }}
                          >
                            <span className="add-node-card__itemIcon" aria-hidden>
                              ←
                            </span>
                            <span className="add-node-card__itemText">返回</span>
                          </button>
                          {batchModelUnifyOptions.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className="add-node-card__item"
                              role="menuitem"
                              disabled={opt.disabled}
                              title={opt.label}
                              onClick={() => applyBatchModelPickFromContextMenu(opt.value)}
                            >
                              <span className="add-node-card__itemIcon" aria-hidden>
                                ◎
                              </span>
                              <span className="add-node-card__itemMain">
                                <span className="add-node-card__itemText">{opt.label}</span>
                              </span>
                            </button>
                          ))}
                          {!batchModelUnifyOptions.length ? (
                            <div className="add-node-card__itemSub add-node-card__batchEmptyHint">
                              暂无可统一的云端模型
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>,
                document.body,
              )
            : null}

          {multianglePanel
            ? createPortal(
                (() => {
                  const n = nodes.find((x) => x.id === multianglePanel.nodeId)
                  if (!n || (n.data.kind !== 'image' && n.data.kind !== 'video')) return null
                  const d = n.data as ImageNodeData | VideoNodeData
                  return (
                    <MultiangleControlPanel
                      nodeId={n.id}
                      nodeKind={n.data.kind === 'image' ? 'image' : 'video'}
                      rawH={d.comfyMultiangleH}
                      rawV={d.comfyMultiangleV}
                      rawZ={d.comfyMultiangleZoom}
                      anchorLeft={multianglePanelAnchor.left}
                      anchorTop={multianglePanelAnchor.top}
                      canvasDayMode={canvasDayMode}
                      onApply={(patch) =>
                        updateNodeData(n.id, { kind: n.data.kind, ...patch } as Partial<StudioNodeData>)
                      }
                      onClose={() => setMultianglePanel(null)}
                    />
                  )
                })(),
                document.body,
              )
            : null}

          <ReactFlow
            ref={reactFlowRootRef}
            className={canvasDayMode ? undefined : 'dark'}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onMoveEnd={onMoveEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
            onSelectionChange={onSelectionChange}
            onSelectionStart={onSelectionStart}
            onSelectionEnd={onSelectionEnd}
            onMouseDown={onCanvasMouseDown}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onSelectionContextMenu={onSelectionContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={loaded.viewport}
            minZoom={0}
            maxZoom={2}
            zoomOnDoubleClick={false}
            zoomOnPinch
            preventScrolling
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
            /** 避免节点 DOM 盒模型异常导致“轻微碰到就全选” */
            selectionMode={SelectionMode.Full}
            selectionOnDrag={false}
            /** 框选键在「设置 → 快捷键」可配为 Shift 或 Alt；Ctrl/Cmd 追加多选 */
            selectionKeyCode={marqueeSelectionKeyCode}
            multiSelectionKeyCode={['Control', 'Meta']}
            panOnDrag
            defaultEdgeOptions={flowDefaultEdgeOptions}
          >
            {canvasDayMode ? (
              <Background variant={BackgroundVariant.Lines} gap={32} size={1} color="#c5cad6" />
            ) : (
              <Background variant={BackgroundVariant.Lines} gap={32} size={1} color="#1a1a1a" />
            )}
            <Controls showInteractive={false} className="studio-controls studio-controls--hidden" />
            {showMiniPreview ? (
              <MiniMap
                className="studio-flowid-minimap"
                pannable
                zoomable
                nodeColor={minimapNodeColor}
                maskColor={canvasDayMode ? 'rgba(226,229,236,0.78)' : 'rgba(0,0,0,0.6)'}
                style={{
                  backgroundColor: canvasDayMode ? '#e2e5ec' : '#111114',
                  borderRadius: '16px',
                  border: canvasDayMode
                    ? '1px solid #E8E8E8'
                    : '1px solid rgba(255,255,255,0.1)',
                  width: 240,
                  height: 140,
                  bottom: 120,
                  right: 0,
                }}
                onDoubleClick={focusCanvasContent}
              />
            ) : null}
            {typeof document !== 'undefined' && aiConfig.virtualAvatarVisible
              ? createPortal(
                  <div
                    className={`studio-ai-avatar-dock${agentFloatingOpen ? ' studio-ai-avatar-dock--over-agent' : ''}`}
                    aria-label="AI 虚拟人"
                    style={{
                      left: `${avatarDockRect.left}px`,
                      top: `${avatarDockRect.top}px`,
                      width: `${avatarDockRect.width}px`,
                      height: `${avatarDockRect.height}px`,
                    }}
                    onMouseDown={agentFloatingOpen ? undefined : handleAvatarDockMouseDown}
                    onDoubleClick={agentFloatingOpen ? undefined : () => setAgentFloatingOpen(true)}
                  >
                    <video
                      key={dockAvatarState}
                      className="studio-ai-avatar-dock__video"
                      src={dockAvatarMedia}
                      autoPlay
                      loop
                      muted
                      playsInline
                      onMouseDown={agentFloatingOpen ? handleAvatarDockMouseDown : undefined}
                      onDoubleClick={agentFloatingOpen ? () => setAgentFloatingOpen(true) : undefined}
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
              <>
              <div
                className={`studio-music-prompt-panel-wrap nodrag nopan nowheel ${promptPanelExpanded ? 'is-expanded' : ''}`}
                style={promptPanelWrapStyle}
                aria-label="节点提示词与执行面板"
                onMouseDown={(event) => {
                  event.stopPropagation()
                  const t = event.target as HTMLElement
                  if (t.closest('button') || t.closest('[role="listbox"]') || t.closest('input[type="file"]')) {
                    return
                  }
                  if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.closest('textarea')) {
                    return
                  }
                  const ta = panelPromptTextareaRef.current
                  if (!ta || ta.disabled || ta.readOnly) return
                  try {
                    ta.focus({ preventScroll: true })
                  } catch {
                    ta.focus()
                  }
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className={`studio-music-prompt-panel nodrag nopan ${promptPanelExpanded ? 'is-expanded' : ''}`}
                >
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
                        title="切换 COMFYUI / 模型；双击打开设置"
                        aria-label="切换 COMFYUI 或模型模式"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!visiblePromptPanel) return
                          const nid = visiblePromptPanel.node.id
                          const current = resolvedPromptPickerMode(
                            visiblePromptPanel.node.data as { promptPickerMode?: 'workflow' | 'model' },
                          )
                          const next = current === 'workflow' ? 'model' : 'workflow'
                          updateNodeData(nid, {
                            promptPickerMode: next,
                          } as any)
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          clearSettingsFocusTab()
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
                  {/* 统一参考图条：@ 引用图 + 本地拖入图 同行展示 */}
                  {promptPanelMentionImages.length > 0 ||
                  ((visiblePromptPanel.kind === 'image'
                    ? (visiblePromptPanel.node.data as ImageNodeData).referenceImageSources
                    : visiblePromptPanel.kind === 'video'
                      ? (visiblePromptPanel.node.data as VideoNodeData).referenceImageSources
                      : visiblePromptPanel.kind === 'audio' ||
                          visiblePromptPanel.kind === 'music'
                        ? (visiblePromptPanel.node.data as AudioNodeData).referenceImageSources
                        : []) ?? []).filter(Boolean).length > 0 ? (
                    <div
                      className="studio-music-prompt-panel__refStripUnified"
                      aria-label="参考图（@ 引用 + 本地）"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {promptPanelMentionImages.map((item, idx) => {
                        const chipKey = `${item.mention}-${item.url}-${idx}`
                        const isBroken = brokenMentionChipKeys.has(chipKey)
                        return (
                          <div
                            key={`m-${item.url}-${idx}`}
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
                            title="@ 引用参考图（可拖拽调整顺序）"
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
                            <span className="studio-music-prompt-panel__mentionBadge">@{idx + 1}</span>
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
                      })}
                      {((visiblePromptPanel.kind === 'image'
                        ? (visiblePromptPanel.node.data as ImageNodeData).referenceImageSources
                        : visiblePromptPanel.kind === 'video'
                          ? (visiblePromptPanel.node.data as VideoNodeData).referenceImageSources
                          : visiblePromptPanel.kind === 'audio' ||
                              visiblePromptPanel.kind === 'music'
                            ? (visiblePromptPanel.node.data as AudioNodeData).referenceImageSources
                            : []) ?? [])
                        ?.filter(Boolean)
                        .map((src, idx) => (
                          <div
                            key={`r-${src}-${idx}`}
                            className="studio-music-prompt-panel__refChip"
                            draggable
                            onDragStart={(event) => onRefChipDragStart(idx, event)}
                            onDragOver={(event) => onRefChipDragOverIndex(idx, event)}
                            onDrop={(event) => onRefChipDropToIndex(idx, event)}
                            onDragEnd={() => {
                              refChipDragIndexRef.current = null
                            }}
                            title={
                              visiblePromptPanel.kind === 'audio' ||
                              visiblePromptPanel.kind === 'music'
                                ? '本地参考音/图（可拖拽排序；主槽=第1路，其余=第2路起；传几路就只上传几路文件）'
                                : '本地参考图（可拖拽调整顺序）'
                            }
                          >
                            {visiblePromptPanel.kind === 'audio' ||
                            visiblePromptPanel.kind === 'music'
                              ? refChipUseImagePreview(src)
                                ? (
                                    <img src={src} alt="" />
                                  )
                                : (
                                    <div
                                      className="studio-music-prompt-panel__refChipAudioPh"
                                      aria-hidden
                                    >
                                      音
                                    </div>
                                  )
                              : (
                                  <img src={src} alt="" />
                                )}
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
                  ) : null}
                  {(visiblePromptPanel.kind === 'image' ||
                    visiblePromptPanel.kind === 'video' ||
                    visiblePromptPanel.kind === 'audio' ||
                    visiblePromptPanel.kind === 'music') && (
                    <div className="studio-music-prompt-panel__refZone">
                      <input
                        ref={panelRefImagesInputRef}
                        type="file"
                        accept={
                          visiblePromptPanel.kind === 'image' || visiblePromptPanel.kind === 'video'
                            ? 'image/*'
                            : 'audio/*,image/*'
                        }
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
                        <span className="studio-music-prompt-panel__dropPadText">
                          {visiblePromptPanel.kind === 'audio' || visiblePromptPanel.kind === 'music'
                            ? '本地参考音 / 封面图（可选）'
                            : '本地参考图（可选）'}
                        </span>
                        <span className="studio-music-prompt-panel__dropPadHint">
                          {visiblePromptPanel.kind === 'audio' || visiblePromptPanel.kind === 'music'
                            ? '点击或拖拽 · 多文件'
                            : '点击或拖拽 · 多图'}
                        </span>
                      </div>
                      {/* refStrip 已合并到上方 unified strip */}
                    </div>
                  )}
                  {(visiblePromptPanel.kind === 'image' || visiblePromptPanel.kind === 'video') &&
                    promptPanelSupportsMultiangle &&
                    (() => {
                      const d = visiblePromptPanel.node.data as ImageNodeData | VideoNodeData
                      const h = clampMultiangleHV(d.comfyMultiangleH, FLOWID_MULTIANGLE_DEFAULT_H)
                      const v = clampMultiangleHV(d.comfyMultiangleV, FLOWID_MULTIANGLE_DEFAULT_V)
                      const z = clampMultiangleZoom(d.comfyMultiangleZoom, FLOWID_MULTIANGLE_DEFAULT_ZOOM)
                      const previewFull = buildMultianglePreviewLine(h, v, z)
                      const isDefault =
                        h === FLOWID_MULTIANGLE_DEFAULT_H &&
                        v === FLOWID_MULTIANGLE_DEFAULT_V &&
                        z === FLOWID_MULTIANGLE_DEFAULT_ZOOM
                      const panelOpenHere = multianglePanel?.nodeId === visiblePromptPanel.node.id
                      return (
                        <div
                          className={`studio-prompt-multiangle-strip${isDefault ? ' is-default' : ''}${
                            panelOpenHere ? ' is-panel-open' : ''
                          }`}
                          title={`工作流占位符 __CAM_H__ / __CAM_V__ / __CAM_Z__ 将注入为当前角度。\n${previewFull}`}
                          aria-label="当前镜头角度摘要"
                        >
                          <span className="studio-prompt-multiangle-strip__tag">镜头</span>
                          <span className="studio-prompt-multiangle-strip__kv">
                            H {h}° · V {v}° · Z {z}
                          </span>
                          <span className="studio-prompt-multiangle-strip__hint">
                            {isDefault ? '默认角度' : '已配置 · 悬停查看英文关键词'}
                          </span>
                        </div>
                      )
                    })()}
                  {(visiblePromptPanel.kind === 'image' || visiblePromptPanel.kind === 'video') &&
                  promptPanelPickerMode === 'workflow' &&
                  (promptPanelComfyWorkflowOpts.size || promptPanelComfyWorkflowOpts.style)
                    ? (() => {
                        const nk = visiblePromptPanel.kind
                        const nid = visiblePromptPanel.node.id
                        const d = visiblePromptPanel.node.data as ImageNodeData | VideoNodeData
                        const legacyPx = isLegacyComfyWorkflowPixelOnly(d)
                        const useCustom =
                          d.comfyWorkflowUseCustomPixels === true || legacyPx
                        const resolved = resolveComfyWorkflowWidthHeight(nk, d)
                        const aspectVal =
                          (d.comfyWorkflowAspect as CloudImageAspectKey | undefined) ??
                          (nk === 'video' ? '16:9' : '1:1')
                        const wVal =
                          typeof d.comfyWorkflowWidth === 'number' && Number.isFinite(d.comfyWorkflowWidth)
                            ? alignComfySpatialDimension(d.comfyWorkflowWidth)
                            : resolved.width
                        const hVal =
                          typeof d.comfyWorkflowHeight === 'number' && Number.isFinite(d.comfyWorkflowHeight)
                            ? alignComfySpatialDimension(d.comfyWorkflowHeight)
                            : resolved.height
                        const stRaw = String(d.comfyWorkflowStyleTone ?? '').trim()
                        const baseStyleOpts = COMFY_WORKFLOW_STYLE_TONE_PANEL_OPTIONS
                        const styleDropdownOptions: PromptPanelDropdownOption[] =
                          stRaw && !baseStyleOpts.some((o) => o.value === stRaw)
                            ? [
                                ...baseStyleOpts,
                                {
                                  value: stRaw,
                                  label:
                                    stRaw.length > 36
                                      ? `自定义 · ${stRaw.slice(0, 36)}…`
                                      : `自定义 · ${stRaw}`,
                                },
                              ]
                            : baseStyleOpts
                        return (
                          <div
                            className="studio-prompt-comfy-opts nodrag nopan"
                            title="按比例映射 __WIDTH__ / __HEIGHT__（与云端「模型」模式的 1K 像素表一致，Comfy 无单独 1K/2K 档位）。含 __STYLE_TONE__ 时可选风格短语。"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {promptPanelComfyWorkflowOpts.size ? (
                              <div className="studio-prompt-comfy-opts__row studio-prompt-comfy-opts__row--outputs">
                                <span className="studio-prompt-comfy-opts__tag">输出</span>
                                <PromptPanelDropdown
                                  ariaLabel="Comfy 输出比例"
                                  placeholder="比例"
                                  className="studio-music-prompt-panel__select studio-prompt-comfy-opts__dropdown studio-prompt-comfy-opts__dropdown--wide"
                                  value={aspectVal}
                                  options={COMFY_WORKFLOW_ASPECT_PANEL_OPTIONS}
                                  disabled={useCustom}
                                  onChange={(picked) => {
                                    updateNodeData(nid, {
                                      kind: nk,
                                      comfyWorkflowAspect: picked as CloudImageAspectKey,
                                      comfyWorkflowUseCustomPixels: false,
                                    } as Partial<StudioNodeData>)
                                  }}
                                />
                                <label className="studio-prompt-comfy-opts__customCheck">
                                  <input
                                    type="checkbox"
                                    checked={useCustom}
                                    onChange={(e) => {
                                      const on = e.target.checked
                                      if (!on) {
                                        updateNodeData(nid, {
                                          kind: nk,
                                          comfyWorkflowUseCustomPixels: false,
                                          comfyWorkflowAspect:
                                            (d.comfyWorkflowAspect as CloudImageAspectKey | undefined) ??
                                            (nk === 'video' ? '16:9' : '1:1'),
                                        } as Partial<StudioNodeData>)
                                        return
                                      }
                                      const snap = resolveComfyWorkflowWidthHeight(nk, {
                                        ...d,
                                        comfyWorkflowUseCustomPixels: false,
                                        comfyWorkflowAspect: aspectVal,
                                      })
                                      updateNodeData(nid, {
                                        kind: nk,
                                        comfyWorkflowUseCustomPixels: true,
                                        comfyWorkflowWidth: snap.width,
                                        comfyWorkflowHeight: snap.height,
                                      } as Partial<StudioNodeData>)
                                    }}
                                  />
                                  自定义宽高
                                </label>
                              </div>
                            ) : null}
                            {promptPanelComfyWorkflowOpts.size && useCustom ? (
                              <div className="studio-prompt-comfy-opts__row studio-prompt-comfy-opts__row--pixels">
                                <span className="studio-prompt-comfy-opts__tag studio-prompt-comfy-opts__tag--muted">
                                  像素
                                </span>
                                <input
                                  type="number"
                                  className="studio-prompt-comfy-opts__num"
                                  min={256}
                                  max={4096}
                                  step={8}
                                  value={wVal}
                                  aria-label="输出宽度"
                                  onChange={(e) => {
                                    const n = alignComfySpatialDimension(Number(e.target.value))
                                    updateNodeData(nid, {
                                      kind: nk,
                                      comfyWorkflowUseCustomPixels: true,
                                      comfyWorkflowWidth: n,
                                      comfyWorkflowHeight: hVal,
                                    } as Partial<StudioNodeData>)
                                  }}
                                />
                                <span className="studio-prompt-comfy-opts__times" aria-hidden>
                                  ×
                                </span>
                                <input
                                  type="number"
                                  className="studio-prompt-comfy-opts__num"
                                  min={256}
                                  max={4096}
                                  step={8}
                                  value={hVal}
                                  aria-label="输出高度"
                                  onChange={(e) => {
                                    const n = alignComfySpatialDimension(Number(e.target.value))
                                    updateNodeData(nid, {
                                      kind: nk,
                                      comfyWorkflowUseCustomPixels: true,
                                      comfyWorkflowWidth: wVal,
                                      comfyWorkflowHeight: n,
                                    } as Partial<StudioNodeData>)
                                  }}
                                />
                              </div>
                            ) : null}
                            {promptPanelComfyWorkflowOpts.style ? (
                              <div className="studio-prompt-comfy-opts__row studio-prompt-comfy-opts__row--style">
                                <span className="studio-prompt-comfy-opts__tag">风格</span>
                                <PromptPanelDropdown
                                  ariaLabel="风格色调短语"
                                  placeholder="风格色调"
                                  className="studio-music-prompt-panel__select studio-prompt-comfy-opts__dropdown studio-prompt-comfy-opts__dropdown--wide"
                                  value={stRaw}
                                  options={styleDropdownOptions}
                                  onChange={(picked) => {
                                    updateNodeData(nid, {
                                      kind: nk,
                                      comfyWorkflowStyleTone: picked,
                                    } as Partial<StudioNodeData>)
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        )
                      })()
                    : null}
                  {visiblePromptPanel.kind === 'audio' &&
                  promptPanelPickerMode === 'workflow' &&
                  promptPanelVoiceTable8.scanned &&
                  promptPanelVoiceTable8.show ? (
                    <div
                      className="studio-voice-table-8-trigger nodrag nopan"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="studio-voice-table-8-open-btn"
                        onClick={() => {
                          const nid = visiblePromptPanel.node.id
                          voiceTable8ModalTargetIdRef.current = nid
                          const stored = (nodes.find((x) => x.id === nid)?.data as AudioNodeData)
                            ?.comfyVoiceTableRows
                          const blank = (): ComfyVoiceTableRow => ({
                            roleName: '',
                            sampleLine: '',
                            voiceInstruct: '',
                            language: 'Auto',
                          })
                          if (Array.isArray(stored) && stored.length > 0) {
                            setVoiceTable8Draft(stored.map((r) => ({ ...r })))
                          } else {
                            setVoiceTable8Draft([blank(), blank(), blank()])
                          }
                          setVoiceTable8Editing(null)
                          setVoiceTable8ModalOpen(true)
                        }}
                      >
                        台本信息
                      </button>
                      <span className="studio-voice-table-8-trigger__hint">
                        最多 8 路角色；台本在下方填写或文本节点 @ 合并
                      </span>
                    </div>
                  ) : null}
                  {visiblePromptPanel.kind === 'audio' &&
                  promptPanelPickerMode === 'workflow' &&
                  promptPanelTdRefRoleMap.scanned &&
                  promptPanelTdRefRoleMap.show ? (
                    <div
                      className="studio-voice-table-8-trigger nodrag nopan"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="studio-voice-table-8-open-btn"
                        onClick={() => {
                          const nid = visiblePromptPanel.node.id
                          tdRefRoleModalTargetIdRef.current = nid
                          const d = nodes.find((x) => x.id === nid)?.data as AudioNodeData | undefined
                          const labels = buildTdRefAudioRoleMatchSlotLabels({
                            noteText: String(d?.note || ''),
                            hostNodeId: nid,
                            primarySrc: String(d?.src || '').trim(),
                            referenceImageSources: d?.referenceImageSources?.filter(Boolean) ?? [],
                            allNodes: nodes,
                            studioEdges: edges,
                          })
                          const stored = d?.comfyTdRefAudioRoleRows ?? []
                          let base = stored.map((r) => ({
                            roleName: String(r.roleName ?? ''),
                          }))
                          // 旧版只存「第 2 路起」：比当前少一行则在首行补空
                          if (labels.length > 0 && base.length === labels.length - 1) {
                            base = [{ roleName: '' }, ...base]
                          }
                          if (base.length === labels.length + 1) {
                            base = base.slice(1)
                          }
                          while (base.length < labels.length) base.push({ roleName: '' })
                          if (base.length > labels.length) base = base.slice(0, labels.length)
                          setTdRefRoleSlotLabels(labels)
                          setTdRefRoleModalSeedRows(
                            labels.map((_, i) => ({
                              roleName: String(base[i]?.roleName ?? '').trim(),
                            })),
                          )
                          setTdRefRoleModalKey((k) => k + 1)
                          setTdRefRoleModalOpen(true)
                        }}
                      >
                        匹配
                      </button>
                      <span className="studio-voice-table-8-trigger__hint">
                        仅 @ 与底部上传的参考音（不含节点主预览）；角色名须与台本「角色名:」一致
                      </span>
                    </div>
                  ) : null}
                  {visiblePromptPanel.kind === 'audio' && promptPanelPickerMode === 'workflow' ? (
                    <div
                      className="studio-prompt-audio-ref-audit nodrag nopan"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="studio-prompt-audio-ref-audit__label">参考音 @</span>
                      <span className="studio-prompt-audio-ref-audit__body">
                        {promptPanelAudioRefMentionLabels.length > 0
                          ? promptPanelAudioRefMentionLabels.join('、')
                          : '（当前无）'}
                      </span>
                    </div>
                  ) : null}
                  {visiblePromptPanel.kind === 'music' && promptPanelPickerMode === 'workflow' ? (
                    <div
                      className="studio-music-finetune-trigger nodrag nopan"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="studio-voice-table-8-open-btn"
                        onClick={() => {
                          const nid = visiblePromptPanel.node.id
                          musicFineTuneModalTargetIdRef.current = nid
                          const d = nodes.find((x) => x.id === nid)?.data as AudioNodeData | undefined
                          setMusicFineTuneDraft(musicFineTuneDraftFromAudioData(d ?? (visiblePromptPanel.node.data as AudioNodeData)))
                          setMusicFineTuneModalOpen(true)
                        }}
                      >
                        微调
                      </button>
                      <span className="studio-voice-table-8-trigger__hint">
                        时长、BPM、拍号、语言、调性（提交时写入 Comfy）
                      </span>
                    </div>
                  ) : null}
                  {visiblePromptPanel.kind === 'text' && promptPanelTextSystemPromptSlot ? (
                    <div
                      className="studio-prompt-text-system nodrag nopan"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="studio-prompt-text-system__row">
                        <span className="studio-prompt-text-system__label">系统提示词</span>
                        <button
                          type="button"
                          className="studio-prompt-text-system__save"
                          onClick={() => {
                            const id = textPanelSystemPromptWorkflowKey
                            if (!id) return
                            const raw = textPanelSystemPromptDraft
                            const prev = nodeConfigs.text.cloudWorkflowSystemPrompts ?? {}
                            const next = { ...prev }
                            if (raw.trim()) next[id] = raw
                            else delete next[id]
                            updateNodeConfig('text', {
                              cloudWorkflowSystemPrompts: Object.keys(next).length ? next : undefined,
                            })
                          }}
                        >
                          保存
                        </button>
                      </div>
                      <textarea
                        className="studio-prompt-text-system__textarea nodrag nopan nowheel"
                        rows={3}
                        placeholder="可选。保存后执行时写入 Comfy 中的 __SYSTEM_PROMPT__（与上方主输入独立）。可粘贴，或从侧栏/记事本等拖入文本、.txt。"
                        value={textPanelSystemPromptDraft}
                        onChange={(e) => setTextPanelSystemPromptDraft(e.target.value)}
                        onPaste={(e) => {
                          e.stopPropagation()
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const dt = e.dataTransfer
                          if (
                            dt.types.includes('text/plain') ||
                            dt.types.includes('Files')
                          ) {
                            dt.dropEffect = 'copy'
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const el = e.currentTarget
                          const applyChunk = (chunk: string) => {
                            const t = chunk.trim()
                            if (!t) return
                            const { nextValue, nextCaret } = insertTextAtCaret(el, t)
                            setTextPanelSystemPromptDraft(nextValue)
                            queueMicrotask(() => {
                              try {
                                el.focus()
                                el.setSelectionRange(nextCaret, nextCaret)
                              } catch {
                                // ignore
                              }
                            })
                          }
                          const syncChunk = readDraggedPlainTextSync(e.dataTransfer)
                          if (syncChunk.trim()) {
                            applyChunk(syncChunk)
                            return
                          }
                          void (async () => {
                            applyChunk(await readDraggedPlainText(e.dataTransfer))
                          })()
                        }}
                      />
                    </div>
                  ) : null}
                  <textarea
                      ref={panelPromptTextareaRef}
                      data-studio-prompt-textarea="1"
                      className="studio-music-prompt-panel__textarea nodrag nopan nowheel"
                      placeholder={
                        visiblePromptPanel.kind === 'music'
                          ? '描述你想要生成的内容；工作流可用 __NOTE__。参考音：主槽=第1路，@引用与下方参考区按顺序为第2、3…路；你只上传/引用几路，网络里就只会传那几路文件（模板里多出来的 Comfy 音频槽会用其中一路的文件名占位，避免空槽报错，不会多上传）。'
                          : visiblePromptPanel.kind === 'audio'
                            ? promptPanelVoiceTable8.show && promptPanelVoiceTable8.scanned
                              ? '台本（__NOTE__）：多人对白每行「角色名:台词」，角色名须与「台本信息」里「角色名称」列一致。可用 @ 引用文本/剧本节点（勿 @ 配音/音乐节点，否则正文不会展开）；或与文本/剧本节点连线，执行时会自动合并进台本。未填的表格行不覆盖 Comfy 默认槽。'
                              : promptPanelTdRefRoleMap.show && promptPanelTdRefRoleMap.scanned
                                ? '台本（__NOTE__）：多人对白每行「角色名:台词」。「匹配」仅填 @/底部上传参考路的角色名（不含主预览）。正文里 @文字/剧本 可合并台词；@配音/音乐 参与参考音。'
                                : '描述你想要生成的内容；工作流可用 __NOTE__ 作为台本占位符。若工作流含 __REF_AUDIO_n__，参考音：主槽=第1路，@引用与下方参考区按顺序为第2、3…路；未含则无需上传参考音。'
                            : visiblePromptPanel.kind === 'text'
                            ? '输入文本或提示词；工作流中可使用占位符 __BODY__'
                            : visiblePromptPanel.kind === 'video'
                              ? `@ 引用与文案写在一起；上游文本按画布顺序对应 __PROMPT__、__PROMPT2__…（第二路同时映射 __BODY__）。工作流可写 __PROMPT5__ 等占位符。${promptPanelComfyWorkflowHint}`
                              : promptPanelSupportsMultiangle
                                ? `输入画面/编辑描述（映射 __PROMPT__）；镜头角度请右键节点选「角度控制」。${promptPanelComfyWorkflowHint}`
                                : `输入画面/编辑描述（映射 __PROMPT__）。${promptPanelComfyWorkflowHint}`
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
                  <div
                    className={`studio-music-prompt-panel__foot${
                      visiblePromptPanel.kind === 'image' && promptPanelPickerMode === 'model'
                        ? ' studio-music-prompt-panel__foot--imageCloudModel'
                        : ''
                    }`}
                  >
                    {visiblePromptPanel.kind === 'image' && promptPanelPickerMode === 'model' ? (
                      <>
                        <div className="studio-music-prompt-panel__footSlot studio-music-prompt-panel__footSlot--imageCluster nodrag">
                          <PromptPanelDropdown
                            ariaLabel="选择云端模型"
                            className="studio-music-prompt-panel__select studio-music-prompt-panel__select--cloudModelPrimary"
                            placeholder="选择模型"
                            value={promptPanelModelSelectValue}
                            options={promptPanelModelOptions}
                            onChange={(pickedId) => {
                              const kind = visiblePromptPanel.kind
                              if (pickedId === 'custom-current') return
                              const assistDecoded = tryDecodeCloudAssistModelPick(pickedId)
                              if (assistDecoded) {
                                const ak = studioNodeKindToAssistKind(kind)
                                if (!ak) return
                                const ep = findAssistEndpoint(ak, assistDecoded.endpointId, assistCatalog)
                                if (!ep) return
                                updateNodeData(visiblePromptPanel.node.id, {
                                  kind,
                                  cloudAssistModelPick: pickedId,
                                  cloudSelfPresetId: undefined,
                                  cloudModelName: assistDecoded.model,
                                  cloudModelUrl: ep.baseUrl,
                                  cloudApiKey: getAssistApiKey(ak),
                                } as any)
                                return
                              }
                              const preset = loadCloudSelfPresets().find((i) => i.id === pickedId)
                              if (!preset) return
                              updateNodeData(visiblePromptPanel.node.id, {
                                kind,
                                cloudAssistModelPick: undefined,
                                cloudSelfPresetId: preset.id,
                                cloudModelName: preset.model,
                                cloudModelUrl: preset.baseUrl,
                                cloudApiKey: String((preset as any).apiKey || ''),
                              } as any)
                            }}
                          />
                        </div>
                        <div className="studio-music-prompt-panel__footSlot nodrag">
                          <PromptPanelDropdown
                            ariaLabel="比例"
                            title="对应云端 Image API 的 size，不会拼进提示词"
                            className="studio-music-prompt-panel__select studio-music-prompt-panel__select--iconOnly"
                            placeholder="比例"
                            value={(visiblePromptPanel.node.data as ImageNodeData).cloudImageAspect ?? 'auto'}
                            options={COMFY_WORKFLOW_ASPECT_PANEL_OPTIONS}
                            renderButtonContent={() => <CloudAspectGlyph />}
                            onChange={(picked) => {
                              updateNodeData(visiblePromptPanel.node.id, {
                                kind: 'image',
                                cloudImageAspect: picked as CloudImageAspectKey,
                              } as Partial<StudioNodeData>)
                            }}
                          />
                        </div>
                        <div className="studio-music-prompt-panel__footSlot nodrag">
                          <PromptPanelDropdown
                            ariaLabel="分辨率"
                            title="影响像素档位与 quality；不进入提示词正文"
                            className="studio-music-prompt-panel__select studio-music-prompt-panel__select--iconOnly"
                            placeholder="分辨率"
                            value={(visiblePromptPanel.node.data as ImageNodeData).cloudImageResolutionTier ?? '1k'}
                            options={CLOUD_IMAGE_RESOLUTION_PANEL_OPTIONS}
                            renderButtonContent={({ value: v }) => (
                              <CloudResolutionGlyph tier={(v as CloudImageResolutionTier) ?? '1k'} />
                            )}
                            onChange={(picked) => {
                              updateNodeData(visiblePromptPanel.node.id, {
                                kind: 'image',
                                cloudImageResolutionTier: picked as CloudImageResolutionTier,
                              } as Partial<StudioNodeData>)
                            }}
                          />
                        </div>
                        <div className="studio-music-prompt-panel__footEnd">
                          {promptPanelFootPointsHint != null ? (
                            <span
                              className="studio-music-prompt-panel__footPoints"
                              title="预估单次执行预扣积分（与预扣接口一致）"
                            >
                              <Zap
                                className="studio-music-prompt-panel__footPointsIcon"
                                size={17}
                                strokeWidth={2.35}
                                aria-hidden
                              />
                              积分 {Math.round(promptPanelFootPointsHint)}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="studio-music-prompt-panel__submit"
                            onClick={() => void executePromptPanelFromPanel(visiblePromptPanel)}
                            title="执行当前节点工作流；长任务在后台跑时仍可再次提交，仅最后一次完成的任务会写回节点"
                          >
                            ↑
                          </button>
                        </div>
                      </>
                    ) : (
                    <>
                    <div className="studio-music-prompt-panel__footMain">
                    {promptPanelPickerMode === 'workflow' ? (
                      <div className="studio-music-prompt-panel__workflowRow">
                        <PromptPanelDropdown
                          ariaLabel="选择工作流模板"
                          className="studio-music-prompt-panel__select"
                          placeholder="选择工作流"
                          value={promptPanelWorkflowSelectValue}
                          options={promptPanelWorkflowDropdownOptions}
                          title={
                            promptPanelExampleWorkflowKey
                              ? '单击展开列表；双击可打开「我的示例工程」'
                              : undefined
                          }
                          onMainButtonDoubleClick={
                            promptPanelExampleWorkflowKey
                              ? () => setCloudWorkflowExampleModalOpen(true)
                              : undefined
                          }
                          onChange={(picked) => {
                            const wfKind = visiblePromptPanel.kind
                            if (executionProvider === 'cloud') {
                              const cloudList = cloudWorkflowMetaList.filter(
                                (w) => !w.nodeKind || w.nodeKind === wfKind,
                              )
                              const hit = cloudList.find((w) => w.id === picked)
                              if (hit) {
                                updateNodeData(visiblePromptPanel.node.id, {
                                  kind: wfKind,
                                  model: hit.name,
                                  workflowEntryId: hit.id,
                                } as Partial<StudioNodeData>)
                              }
                              return
                            }
                            const list = nodeConfigs[wfKind].workflows
                            const pickedEntry =
                              list.find((item) => item.name === picked) ??
                              list.find((item) => item.name.trim() === picked.trim()) ??
                              findWorkflowEntryByPreferredName(list, picked)
                            if (pickedEntry) {
                              selectNodeWorkflow(wfKind, pickedEntry.id)
                            }
                            updateNodeData(visiblePromptPanel.node.id, {
                              kind: wfKind,
                              model: picked,
                              /** 与执行逻辑一致：以条目 id 为准，不依赖全局 selectedWorkflowId */
                              workflowEntryId: pickedEntry?.id,
                            } as Partial<StudioNodeData>)
                          }}
                        />
                        {executionMode === 'custom' && promptPanelExampleWorkflowKey ? (
                          <button
                            type="button"
                            className="studio-prompt-workflow-examples-btn"
                            title="打开与此工作流绑定的示例画布（也可双击左侧工作流名称）"
                            onClick={() => setCloudWorkflowExampleModalOpen(true)}
                          >
                            示例
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <PromptPanelDropdown
                        ariaLabel="选择云端模型"
                        className="studio-music-prompt-panel__select"
                        placeholder="选择模型"
                        value={promptPanelModelSelectValue}
                        options={promptPanelModelOptions}
                        onChange={(pickedId) => {
                          const kind = visiblePromptPanel.kind
                          if (pickedId === 'custom-current') return
                          const assistDecoded = tryDecodeCloudAssistModelPick(pickedId)
                          if (assistDecoded) {
                            const ak = studioNodeKindToAssistKind(kind)
                            if (!ak) return
                            const ep = findAssistEndpoint(ak, assistDecoded.endpointId, assistCatalog)
                            if (!ep) return
                            updateNodeData(visiblePromptPanel.node.id, {
                              kind,
                              cloudAssistModelPick: pickedId,
                              cloudSelfPresetId: undefined,
                              cloudModelName: assistDecoded.model,
                              cloudModelUrl: ep.baseUrl,
                              cloudApiKey: getAssistApiKey(ak),
                            } as any)
                            return
                          }
                          const preset = loadCloudSelfPresets().find((i) => i.id === pickedId)
                          if (!preset) return
                          updateNodeData(visiblePromptPanel.node.id, {
                            kind,
                            cloudAssistModelPick: undefined,
                            cloudSelfPresetId: preset.id,
                            cloudModelName: preset.model,
                            cloudModelUrl: preset.baseUrl,
                            cloudApiKey: String((preset as any).apiKey || ''),
                          } as any)
                        }}
                      />
                    )}
                    {visiblePromptPanel.kind === 'text' ? (
                      <div
                        ref={symbolSplitMenuRootRef}
                        className="nodrag pp-select studio-music-prompt-panel__splitSymbolMenu"
                        data-open={symbolSplitMenuOpen ? '1' : '0'}
                      >
                        <button
                          type="button"
                          className="nodrag studio-music-prompt-panel__splitSelect"
                          aria-label="符号拆分"
                          title="点击后在菜单中选择 ### 或 /// 作为分段标记"
                          aria-haspopup="listbox"
                          aria-expanded={symbolSplitMenuOpen}
                          onClick={() => setSymbolSplitMenuOpen((o) => !o)}
                        >
                          符号拆分
                        </button>
                        {symbolSplitMenuOpen ? (
                          <div className="pp-select__menu" role="listbox" aria-label="选择分段标记">
                            <button
                              type="button"
                              role="option"
                              className="pp-select__item"
                              onClick={() => {
                                setSymbolSplitMenuOpen(false)
                                splitTextNodeToStructuredNodes('###')
                              }}
                            >
                              ###
                            </button>
                            <button
                              type="button"
                              role="option"
                              className="pp-select__item"
                              onClick={() => {
                                setSymbolSplitMenuOpen(false)
                                splitTextNodeToStructuredNodes('///')
                              }}
                            >
                              ///
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    </div>
                    <div className="studio-music-prompt-panel__footEnd">
                      {promptPanelFootPointsHint != null ? (
                        <span
                          className="studio-music-prompt-panel__footPoints"
                          title="预估单次执行预扣积分（与预扣接口一致）"
                        >
                          <Zap
                            className="studio-music-prompt-panel__footPointsIcon"
                            size={17}
                            strokeWidth={2.35}
                            aria-hidden
                          />
                          积分 {Math.round(promptPanelFootPointsHint)}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="studio-music-prompt-panel__submit"
                        onClick={() => void executePromptPanelFromPanel(visiblePromptPanel)}
                        title="执行当前节点工作流；长任务在后台跑时仍可再次提交，仅最后一次完成的任务会写回节点"
                      >
                        ↑
                      </button>
                    </div>
                    </>
                    )}
                  </div>
                </div>
              </div>
              {cloudWorkflowExampleModalOpen && promptPanelExampleWorkflowKey
                ? createPortal(
                    <div
                      className="studio-workflow-examples-modal"
                      role="presentation"
                      onMouseDown={() => setCloudWorkflowExampleModalOpen(false)}
                    >
                      <div
                        className="studio-workflow-examples-modal__card"
                        role="dialog"
                        aria-modal="true"
                        aria-label="工作流示例工程"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div className="studio-workflow-examples-modal__head">
                          <div className="min-w-0">
                            <div className="studio-workflow-examples-modal__kicker">我的示例工程</div>
                            <div className="studio-workflow-examples-modal__title truncate" title={exampleWorkflowPanelLabel}>
                              {exampleWorkflowPanelLabel}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="studio-workflow-examples-modal__close"
                            aria-label="关闭"
                            onClick={() => setCloudWorkflowExampleModalOpen(false)}
                          >
                            ×
                          </button>
                        </div>
                        <p className="studio-workflow-examples-modal__hint">
                          与当前选中的 Comfy 工作流绑定，存在本机浏览器。列表中点「插入画布」会把该示例里的节点与连线**合并进当前画布**（落在视口中心附近，与粘贴一致）；「新标签」则在独立标签中打开整页工程。
                        </p>
                        <div className="studio-workflow-examples-modal__actions">
                          <button
                            type="button"
                            className="studio-workflow-examples-modal__btn studio-workflow-examples-modal__btn--primary"
                            onClick={() => {
                              const wfKey = promptPanelExampleWorkflowKey
                              if (!wfKey || !visiblePromptPanel) return
                              const r = pinCloudWorkflowExample(wfKey, {
                                name: `${activeProjectName} · 示例`,
                                snapshot: cloneCanvasSnapshot(getCanvasSnapshot()),
                                nodeKind: visiblePromptPanel.kind,
                              })
                              if (!r.ok) {
                                window.alert(r.message)
                                return
                              }
                              setCloudWorkflowExampleListTick((n) => n + 1)
                            }}
                          >
                            将当前画布存为示例
                          </button>
                        </div>
                        <div className="studio-workflow-examples-modal__list">
                          {cloudWorkflowExampleModalEntries.length === 0 ? (
                            <div className="studio-workflow-examples-modal__empty">
                              暂无保存的示例。搭好参考图/节点后点上方按钮即可固定为「此工作流」的示例工程。
                            </div>
                          ) : (
                            cloudWorkflowExampleModalEntries.map((en) => (
                              <div key={en.id} className="studio-workflow-examples-modal__row">
                                <div className="studio-workflow-examples-modal__rowMain min-w-0">
                                  <div className="studio-workflow-examples-modal__rowTitle truncate" title={en.name}>
                                    {en.name}
                                  </div>
                                  <div className="studio-workflow-examples-modal__rowMeta">
                                    {new Date(en.savedAt).toLocaleString('zh-CN')}
                                    {en.nodeKind ? ` · ${en.nodeKind}` : ''}
                                  </div>
                                </div>
                                <div className="studio-workflow-examples-modal__rowActions">
                                  <button
                                    type="button"
                                    className="studio-workflow-examples-modal__btn studio-workflow-examples-modal__btn--primary"
                                    onClick={() => {
                                      void (async () => {
                                        const snap = en.snapshot
                                        const incoming = snap.nodes as Node<StudioNodeData>[]
                                        if (!Array.isArray(incoming) || !incoming.length) return
                                        const bb = getNodesBounds(incoming)
                                        if (!bb) return
                                        const clipCx = (bb.minX + bb.maxX) / 2
                                        const clipCy = (bb.minY + bb.maxY) / 2
                                        let anchorX = clipCx
                                        let anchorY = clipCy
                                        const root = reactFlowRootRef.current
                                        if (root) {
                                          const r = root.getBoundingClientRect()
                                          if (r.width > 0 && r.height > 0) {
                                            const center = screenToFlowPosition({
                                              x: r.left + r.width / 2,
                                              y: r.top + r.height / 2,
                                            })
                                            anchorX = center.x
                                            anchorY = center.y
                                          }
                                        }
                                        await mergeSubgraphAtFlowCenter(
                                          incoming,
                                          (snap.edges || []) as Edge[],
                                          { x: anchorX, y: anchorY },
                                          {
                                            hydrateLocalAssets: true,
                                            historyLabel: `插入工作流示例「${en.name}」（${incoming.length} 个节点）`,
                                          },
                                        )
                                        setCloudWorkflowExampleModalOpen(false)
                                      })()
                                    }}
                                  >
                                    插入画布
                                  </button>
                                  <button
                                    type="button"
                                    className="studio-workflow-examples-modal__btn"
                                    onClick={() => {
                                      openImportedProjectInNewTab({
                                        version: 1,
                                        name: en.name,
                                        nodes: en.snapshot.nodes,
                                        edges: en.snapshot.edges,
                                        viewport: en.snapshot.viewport,
                                      })
                                      setCloudWorkflowExampleModalOpen(false)
                                    }}
                                  >
                                    新标签
                                  </button>
                                  <button
                                    type="button"
                                    className="studio-workflow-examples-modal__btn studio-workflow-examples-modal__btn--danger"
                                    onClick={() => {
                                      if (!promptPanelExampleWorkflowKey) return
                                      removeCloudWorkflowExample(promptPanelExampleWorkflowKey, en.id)
                                      setCloudWorkflowExampleListTick((n) => n + 1)
                                    }}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
              </>
            ) : null}
          </ReactFlow>
          <div
            className="absolute bottom-8 right-8 flex flex-col items-end gap-6 z-50 studio-flowid-map-ui [-webkit-tap-highlight-color:transparent] [&_button]:outline-none"
            data-studio-flowid-map-ui="1"
          >
            <div
              className={
                canvasDayMode
                  ? 'bg-[#FFFFFF] border border-[#E8E8E8] p-2 rounded-2xl shadow-[0_12px_40px_rgba(38,38,38,0.08)] flex items-center gap-2 pointer-events-auto backdrop-blur-xl'
                  : 'bg-[#111114] border border-white/10 p-1.5 rounded-full shadow-2xl flex items-center gap-3 pointer-events-auto backdrop-blur-xl'
              }
            >
              <button
                type="button"
                onClick={() => setShowMiniPreview((v) => !v)}
                aria-label="小地图"
                className={
                  canvasDayMode
                    ? `w-10 h-10 flex items-center justify-center transition-all rounded-xl ${
                        showMiniPreview
                          ? 'bg-[#F5F5F5] text-[#262626] ring-2 ring-[#E8E8E8]'
                          : 'bg-[#F5F5F5] text-[#525252] hover:bg-[#EEEEEE] hover:text-[#262626]'
                      }`
                    : `w-10 h-10 flex items-center justify-center transition-all bg-white/5 rounded-full ${
                        showMiniPreview ? 'text-orange-500' : 'text-white/40 hover:text-white'
                      }`
                }
              >
                <MapIcon className="w-4 h-4" aria-hidden />
              </button>
              <div className={canvasDayMode ? 'w-[1px] h-5 bg-[#E8E8E8]' : 'w-[1px] h-4 bg-white/10'} />
              <button
                type="button"
                onClick={() => setCanvasDayMode((v) => !v)}
                aria-pressed={canvasDayMode}
                aria-label={canvasDayMode ? '关闭日间模式' : '开启日间模式'}
                title={canvasDayMode ? '关闭日间模式（深色画布）' : '开启日间模式（浅色画布）'}
                className={
                  canvasDayMode
                    ? 'w-10 h-10 flex items-center justify-center rounded-xl bg-[#F5F5F5] text-[#525252] hover:bg-[#EEEEEE] hover:text-[#262626] transition-all'
                    : 'w-10 h-10 flex items-center justify-center rounded-full bg-transparent text-orange-500 transition-all hover:text-orange-400 active:bg-orange-500/15 active:text-orange-300'
                }
              >
                {canvasDayMode ? <Moon className="w-4 h-4" aria-hidden /> : <Sun className="w-4 h-4" aria-hidden />}
              </button>
              <div className={canvasDayMode ? 'w-[1px] h-5 bg-[#E8E8E8]' : 'w-[1px] h-4 bg-white/10'} />
              <div
                className={
                  canvasDayMode
                    ? 'flex items-center gap-0.5 rounded-xl bg-[#F5F5F5] px-1 py-0.5'
                    : 'flex items-center gap-1'
                }
              >
                <button
                  type="button"
                  onClick={() => zoomOut()}
                  aria-label="缩小"
                  className={
                    canvasDayMode
                      ? 'w-8 h-8 flex items-center justify-center rounded-lg text-[#525252] hover:bg-[#FFFFFF] hover:text-[#262626] transition-all text-sm font-light'
                      : 'w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-all text-sm font-light'
                  }
                >
                  −
                </button>
                <span
                  className={
                    canvasDayMode
                      ? 'text-[14px] font-black tracking-widest text-[#262626] min-w-[56px] text-center tabular-nums'
                      : 'text-[15px] font-black tracking-widest text-white/90 min-w-[60px] text-center'
                  }
                  title="节点编辑区视口缩放；与浏览器页面缩放无关。"
                >
                  {Math.round((Number.isFinite(viewport.zoom) ? viewport.zoom : getZoom()) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => zoomIn()}
                  aria-label="放大"
                  className={
                    canvasDayMode
                      ? 'w-8 h-8 flex items-center justify-center rounded-lg text-[#525252] hover:bg-[#FFFFFF] hover:text-[#262626] transition-all text-sm font-light'
                      : 'w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-all text-sm font-light'
                  }
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

