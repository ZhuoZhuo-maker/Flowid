import { useCallback, useEffect, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type {
  AudioNodeData,
  CloudWorkflowOverrideEntry,
  ImageNodeData,
  PanoramaNodeData,
  VideoNodeData,
  NodeRunProgress,
  NodeWorkflowConfig,
  ShortcutCommandId,
  StudioNodeData,
  StudioNodeKind,
  WorkflowExecutionMode,
  WorkflowProviderConfig,
  WorkflowProviderType,
} from '../types'
import {
  getDefaultWorkflowConfig,
  loadWorkflowConfig,
  saveWorkflowConfig,
  type WorkflowConfigSnapshot,
} from '../lib/workflowConfigStorage'
import {
  collectInboundAudioResolvedEntries,
  collectMentionAudioResolvedEntries,
  collectMentionImageResolvedEntries,
  collectMentionVideoResolvedEntries,
  collectUpstreamNodeIds,
  parseMentionRefs,
  resolveMentionRefToNode,
  resolveNodeMentionsInText,
} from '../lib/nodeMentions'
import {
  cloneNodeWithInboundTextNotePrepended,
  cloneNodeWithInboundTextPromptPrepended,
} from '../lib/studioPromptInheritance'
import {
  buildMusicFineTuneInjection,
  injectMusicWorkflowFineTune,
  musicFineTuneDraftFromAudioData,
} from '../lib/musicWorkflowFineTune'
import { matchStudioNodeWorkflow } from '../lib/matchStudioNodeWorkflow'
import { persistWorkflowJsonToDisk } from '../lib/localAssetDiskMirror'
import { normalizeOpenAICompatibleBaseUrl } from '../lib/openaiCompat'
import { fetchOpenAICompat } from '../lib/openaiProxy'
import { appendCloudCallLog } from '../lib/cloudCallLogs'
import {
  resolveDashscopeQwenImageSize,
  resolveOpenAiImageGenerationOutputParams,
} from '../lib/cloudImageGenerationParams'
import {
  cloudImageSubmitHeaders,
  isModelScopeInferenceBase,
  pollCloudImageTask,
  readCloudImageTaskId,
  readCloudImageUrlFromPayload,
} from '../lib/cloudAsyncImageApi'
import { loadLicenseServerConfig } from '../lib/licenseAccess'
import { getActiveCloudSelfDefaultsForNodeKind, type CloudSelfApiMode } from '../lib/cloudSelfPresets'
import {
  getAssistApiKey,
  studioNodeKindToAssistKind,
  tryDecodeCloudAssistModelPick,
} from '../lib/cloudAssistModelCatalog'
import { buildPointsReserveParams } from '../lib/pointsReserveMetadata'
import { fetchCloudWorkflowJson } from '../lib/cloudWorkflowsApi'
import {
  clampMultiangleHV,
  clampMultiangleZoom,
  FLOWID_MULTIANGLE_DEFAULT_H,
  FLOWID_MULTIANGLE_DEFAULT_V,
  FLOWID_MULTIANGLE_DEFAULT_ZOOM,
} from '../lib/comfyMultianglePlaceholders'
import {
  applyComfyVoiceTableRowsToPrompt,
  voiceTableRowHasContent,
} from '../lib/comfyVoiceTable8'
import {
  applyComfyTdRefAudioRoleRowsToPrompt,
  rebindTdMultiDialogSpeakersForRefRoleMap,
  resolveTdDefineSpeakerNodeIdsForRefSlots,
} from '../lib/comfyTdRefAudioRoleMap'
import {
  applyNoteToTdMultiSpeakerTemplatePrompt,
  normalizeTtsDialogueRoleColons,
  splitTdNoteIntoDialogueAndSpeakerJson,
  tryStructuredVoiceListToMultiDialogLines,
  workflowJsonUsesTdMultiDialog,
} from '../lib/comfyTdMultiDialogScript'
import {
  injectOutpaintPadsIntoComfyPrompt,
  resolveOutpaintPadsFromNode,
  workflowSupportsOutpaintPadControls,
} from '../lib/comfyOutpaintPrompt'
import {
  resolveComfyWorkflowWidthHeight,
  workflowJsonSupportsComfyGridPlaceholders,
  workflowJsonSupportsVariableRefCount,
  workflowJsonUsesQwenImageModel,
} from '../lib/comfyWorkflowOutputSize'
import {
  getLocalImageAssetObjectUrl,
  readLocalImageAssetBlob,
  resolveExistingComfyInputFilenameFromDesktop,
} from '../lib/localImageAssetStore'
import {
  buildComfyPromptDigest,
  checkComfyHealth,
  effectiveCloudComfyBaseUrl,
  type ComfyHistoryTaskFingerprint,
  type ComfyHistoryResultExpectation,
  pickLatestComfyAudioUrlFromHistory,
  pickLatestComfyMediaUrlFromHistory,
  pickComfyResultAudioUrlAsync,
  pickComfyResultImageUrl,
  pickComfyResultImageViewUrls,
  pickComfyResultVideoUrl,
  pickComfyVideoNodeResultViewUrls,
  isComfyViewUrlLikelyVideo,
  readFilenameFromComfyViewUrl,
  refetchHistoryEntryWithAudioOutput,
  refetchHistoryEntryWithRasterVisual,
  refetchHistoryEntryWithVideoOutput,
  submitComfyPrompt,
  type ComfyUploadedInputImage,
  uploadComfyInputBinaryFile,
  uploadComfyInputImageAsPng,
  verifyComfyMediaUrl,
  waitComfyHistory,
} from '../lib/comfyClient'
import { normalizeComfyLoaderModelPathsInPrompt } from '../lib/comfyModelPathNormalize'

type NodeInputRecord = Record<string, unknown>

/**
 * 宫格分割：收敛 Comfy history 中的多图列表，避免 temp 预览、重复文件名与中间节点刷屏。
 * @param urls 原始 view URL 列表（已按 output 优先排序）
 * @param options.filePrefix 工作流保存前缀（如 `宫格_`），有则优先只保留文件名含此前缀的图
 * @param options.expectedCount 期望分格数（水平 × 垂直）
 */
function filterGridSplitResultViewUrls(
  urls: string[],
  options: { filePrefix: string; expectedCount: number },
): string[] {
  const prefix = String(options.filePrefix || '').trim()
  const expected = Math.max(1, Math.min(25, options.expectedCount))
  const byFilename = new Map<string, string>()
  for (const url of urls) {
    const fn = readFilenameFromComfyViewUrl(url)?.trim()
    if (!fn) continue
    if (!byFilename.has(fn)) byFilename.set(fn, url)
  }
  let pool = [...byFilename.entries()].map(([fn, url]) => ({ fn, url }))
  if (prefix) {
    const prefixed = pool.filter((x) => x.fn.includes(prefix))
    if (prefixed.length) pool = prefixed
  }
  pool.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { numeric: true }))
  return pool.slice(0, expected).map((x) => x.url)
}

/**
 * 用户文案/文件名等插入到「已 JSON.stringify 过的工作流文本」中时，须按 JSON 字符串规则转义，
 * 否则台本里的换行、引号等会导致 `JSON.parse` 报 Bad control character。
 */
function escapeForJsonStringLiteralFragment(raw: string): string {
  return JSON.stringify(String(raw ?? '')).slice(1, -1)
}

/**
 * 音乐节点主文案在 `note`；工作流常用 `__PROMPT__` 占位时须用 note 回填，否则会保留模板默认句。
 * 配音节点仍以 `prompt` 为主（通常为空），不自动用整段台本顶替 __PROMPT__。
 */
function primaryPromptForWorkflowPlaceholder(inputs: NodeInputRecord): string {
  const p = String(inputs.prompt ?? '').trim()
  if (p) return String(inputs.prompt ?? '')
  if (inputs.kind === 'music') {
    return String(inputs.note ?? '').trim()
  }
  return String(inputs.prompt ?? '')
}

/** 工作流 JSON 字符串中的 `__PROMPTn__`（n≥2）按序替换；`__PROMPT__` 单独处理为第 1 路。 */
function getIndexedPromptValueForWorkflow(inputs: NodeInputRecord, slot: number): string {
  if (slot <= 1) return primaryPromptForWorkflowPlaceholder(inputs)
  if (slot === 2) return String((inputs as { prompt2?: string }).prompt2 ?? '')
  if (slot === 3) return String((inputs as { prompt3?: string }).prompt3 ?? '')
  if (slot === 4) return String((inputs as { prompt4?: string }).prompt4 ?? '')
  const extras = (inputs as { extraPrompts?: string[] }).extraPrompts ?? []
  return String(extras[slot - 5] ?? '')
}

function replaceIndexedPromptPlaceholders(serialized: string, nodeInputs: NodeInputRecord): string {
  let text = serialized.replaceAll(
    '__PROMPT__',
    escapeForJsonStringLiteralFragment(primaryPromptForWorkflowPlaceholder(nodeInputs)),
  )
  const seen = new Set<number>()
  const re = /__PROMPT(\d+)__/g
  let m: RegExpExecArray | null
  while ((m = re.exec(serialized)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n >= 2) seen.add(n)
  }
  for (const n of [...seen].sort((a, b) => b - a)) {
    const ph = `__PROMPT${n}__`
    text = text.split(ph).join(
      escapeForJsonStringLiteralFragment(getIndexedPromptValueForWorkflow(nodeInputs, n)),
    )
  }
  return text
}

/**
 * 工作流 JSON 中 `__REF_AUDIO_n__` 的路数 N（须从 1 连续到 N）。
 * 用户只上传 M 路（1≤M≤N）时仍只向 Comfy 上传 M 个文件；占位符替换时第 M+1…N 槽写入同一 Comfy 文件名（图定死 N 个 LoadAudio，不能留空占位符）。
 */
function resolveComfyRefAudioSlotCount(workflowJsonText: string): { count: number; gapError?: string } {
  const indices = new Set<number>()
  for (const m of String(workflowJsonText || '').matchAll(/__REF_AUDIO_(\d+)__/g)) {
    const n = parseInt(m[1] || '0', 10)
    if (Number.isFinite(n) && n >= 1) indices.add(Math.floor(n))
  }
  if (indices.size === 0) return { count: 0 }
  const max = Math.max(...indices)
  for (let i = 1; i <= max; i += 1) {
    if (!indices.has(i)) {
      return {
        count: 0,
        gapError: `工作流中 __REF_AUDIO_*__ 须从 1 连续编号到 ${max}（当前缺少 __REF_AUDIO_${i}__）。多人场景请保持 __REF_AUDIO_1__ … __REF_AUDIO_${max}__ 共 ${max} 路，与 Comfy 中说话人条数一致。`,
      }
    }
  }
  return { count: max }
}

/**
 * 单节点执行 Comfy 时的可选参数（进度回调等）。
 */
export type RunNodeWorkflowOptions = {
  onProgress?: (info: NodeRunProgress) => void
  /** 当前画布全部节点：用于从提示词 @ 引用合并图片 URL（与 Studio 中 `withResolvedNodeMentions` 一致）。 */
  allNodes?: Array<Node<StudioNodeData>>
  /** 画布连线：执行前把已连线的文字/剧本正文合并进单槽提示（见 `cloneNodeWithInboundTextPromptPrepended`）。 */
  studioEdges?: Edge[]
  /**
   * 执行前画布上该节点的原始提示词（未做 `withResolvedNodeMentions` 正文展开）。
   * 亦用于图节点 `extractNodeInputs` 的 @→参考图扫描：避免展开后的 JSON/长文里出现 `@图1` 等被误当成参考图。
   */
  rawPromptText?: string
  /** 执行前的原始说明文本（未做 @ 引用解析）。 */
  rawNoteText?: string
  /** 节点提示框切换：强制只走模型或只走工作流（ComfyUI） */
  executionTarget?: 'workflow' | 'model'
  /** 执行前预检查消息（用于 UI 提示，不依赖控制台）。 */
  onPreflightMessage?: (message: string) => void
  /** 执行入口传入的当前节点标题（以触发执行时的节点标题为准）。 */
  runNodeTitle?: string
  /**
   * 文本 Comfy：侧栏「系统提示词」当前内容（执行时优先于已保存项；无需先点「保存」）。
   */
  comfySystemPromptText?: string
}

type OfficialTemplateMeta = {
  id: string
  name: string
  version: string
  description?: string
  paramsSchema?: Record<string, unknown>
}

/**
 * 开发诊断日志开关：默认关闭，避免高频执行时控制台刷屏。
 * 需要排查时可在控制台手动开启：
 * localStorage.setItem('flowid.debug.comfy', '1')
 * 开启后会额外打印台本 __NOTE__ 组装、DialogueInference.script 等专项日志。
 */
function shouldLogComfyDebug(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return window.localStorage.getItem('flowid.debug.comfy') === '1'
  } catch {
    return false
  }
}

/** 控制台台本调试：字数、行数、是否仍含未展开的 @[标题](uuid) */
function devSummarizeNoteForComfyLog(text: string): {
  字数: number
  非空行数: number
  仍含未展开at引用: boolean
  前160字: string
  后160字: string
} {
  const s = String(text ?? '')
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const atMention = /@\[[^\]]+\]\([0-9a-fA-F-]{36}\)/.test(s)
  return {
    字数: s.length,
    非空行数: lines.length,
    仍含未展开at引用: atMention,
    前160字: s.length <= 160 ? s : `${s.slice(0, 160)}…`,
    后160字: s.length <= 160 ? '' : `…${s.slice(-160)}`,
  }
}

/**
 * 将上传的 JSON 归一化为 ComfyUI API `prompt` 对象。
 */
function normalizePromptShape(raw: Record<string, unknown>): Record<string, unknown> {
  const maybePrompt = raw.prompt
  if (maybePrompt && typeof maybePrompt === 'object' && !Array.isArray(maybePrompt)) {
    return maybePrompt as Record<string, unknown>
  }
  return raw
}

/**
 * 清理已知脏节点（历史遗留注入等）。
 */
function sanitizePromptNodes(prompt: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  delete cloned.__NODE_INPUTS__
  return cloned
}

/**
 * 校验是否为可提交的 ComfyUI API prompt。
 */
function validatePromptNodes(prompt: Record<string, unknown>) {
  const entries = Object.entries(prompt).filter(
    ([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value),
  )
  if (!entries.length) {
    throw new Error('工作流为空或格式不正确，请上传 ComfyUI API 格式工作流')
  }
  let hasOutput = false
  for (const [nodeId, nodeValue] of entries) {
    const node = nodeValue as Record<string, unknown>
    const classType = node.class_type
    const inputs = node.inputs
    if (!classType || typeof classType !== 'string') {
      throw new Error(`节点 ${nodeId} 缺少 class_type，请重新导出 API 工作流`)
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      throw new Error(`节点 ${nodeId} 缺少 inputs，请检查工作流是否损坏`)
    }
    const c = classType.toLowerCase()
    if (
      c.includes('save') ||
      c.includes('output') ||
      c.includes('preview') ||
      c.includes('viewer') ||
      c.includes('display')
    ) {
      hasOutput = true
    }
  }
  if (!hasOutput) {
    // 兼容三视图等工作流：部分输出节点命名不含 save/output，先允许提交，避免误拦截。
    // 若最终确实无可用产物，会在结果解析阶段给出明确错误。
    return
  }
}

/**
 * 提取节点输入字段，用于映射到 ComfyUI 工作流。
 *
 * @param allNodes 传入时可合并提示词/描述中的 @ 引用图片 URL，避免仅改文案未同步 `src` 时 Comfy 收不到图。
 */
type ExtractNodeInputsOpts = {
  /**
   * 仅图节点：用于解析 @→参考图 的文本。
   * 应传 `RunNodeWorkflowOptions.rawPromptText`（展开前）；若省略则退回 `node.data.prompt`（可能已是展开后的长 JSON）。
   */
  imageMentionRefPromptOverride?: string
  /**
   * 为 true 时：仅 `@[标题](节点uuid)` 带 id 的 @ 可进入参考图 URL 列表。
   * 用于云端多模态计费路径，避免无 id 的 `@[标题]` / `@图1` 仅靠标题撞名误绑到别的图节点。
   * （Comfy 工作流不传此项，仍允许旧式无 id 引用。）
   */
  imageMentionRefsRequireStableNodeId?: boolean
  /** 有边时：无 uuid 的 @ 仅在沿边向上的祖先节点中解析（与画布执行一致） */
  studioEdges?: Edge[]
}

/**
 * 从参考图列表中剔除「与画布主图同源」的项时，只应以节点 `data.src` 为准。
 * 若 `data.src` 为空却把 `mergedPairs[0]`（常为 @ 解析出的上游图）借作 `primarySrc`，
 * 再按 primary 去重会把唯一参考图删掉 → gpt-image-2 等路径 `refCount: 0`。
 */
async function normalisedCanvasPrimaryUrlForRefDedupe(
  rawDataSrc: unknown,
  rawSrcAssetId: unknown,
): Promise<string> {
  let u = String(rawDataSrc ?? '').trim()
  if (!u) return ''
  const aid = String(rawSrcAssetId ?? '').trim()
  if (u.startsWith('blob:') && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) return String(restored).trim()
  }
  return u
}

/**
 * 合并后的参考图对：有本地参考条或提示词 @ 时，不与画布主图 src 去重。
 * 图生视频首尾帧常见「主预览=首帧 + @ 两张」；去重会把首张 @ 吃掉，只剩 1 张有效输入。
 */
function filterMergedRefPairsAgainstCanvasPrimary(
  mergedPairs: Array<{ url: string; assetId?: string }>,
  dedupeRefUrl: string,
  hasExplicitRefInputs: boolean,
): Array<{ url: string; assetId?: string }> {
  if (hasExplicitRefInputs) {
    return mergedPairs.filter((p) => Boolean(p.url))
  }
  return mergedPairs.filter((p) => p.url && (!dedupeRefUrl || p.url !== dedupeRefUrl))
}

async function extractNodeInputs(
  node: Node<StudioNodeData>,
  allNodes?: Array<Node<StudioNodeData>>,
  extractOpts?: ExtractNodeInputsOpts,
): Promise<NodeInputRecord> {
  const common: NodeInputRecord = {
    title: node.data.title,
    kind: node.data.kind,
  }
  const mentionUpstreamScope =
    extractOpts?.studioEdges?.length && node.id
      ? collectUpstreamNodeIds(node.id, extractOpts.studioEdges)
      : undefined
  if (node.data.kind === 'group') {
    return common
  }
  if (node.data.kind === 'imageCompare') {
    return common
  }
  if (node.data.kind === 'text' || node.data.kind === 'script') {
    const mentionScanText =
      String(extractOpts?.imageMentionRefPromptOverride || '').trim() || String(node.data.body || '')
    let videoSrc = ''
    let videoSrcAssetId = ''
    if (allNodes?.length && mentionScanText.includes('@')) {
      const videoRefs = collectMentionVideoResolvedEntries(
        mentionScanText,
        allNodes,
        node.id,
        extractOpts?.studioEdges,
      )
      if (videoRefs.length > 0) {
        let u = String(videoRefs[0]!.url || '').trim()
        const aid = String(videoRefs[0]!.assetId || '').trim()
        if (!u && aid) {
          const restored = await getLocalImageAssetObjectUrl(aid)
          if (restored) u = restored
        }
        if (u.startsWith('blob:') && aid) {
          const restored = await getLocalImageAssetObjectUrl(aid)
          if (restored) u = restored
        }
        videoSrc = u
        videoSrcAssetId = aid
      }
    }
    return { ...common, body: node.data.body, refImages: '', videoSrc, videoSrcAssetId }
  }
  if (node.data.kind === 'image') {
    const promptText = String(node.data.prompt || '')
    const mentionScanText =
      String(extractOpts?.imageMentionRefPromptOverride || '').trim() || promptText
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const refIds = (node.data as any)?.referenceImageAssetIds as string[] | undefined

    const pairs: Array<{ url: string; assetId?: string }> = []
    // 1) @ 引用：按 nodeId 精确解析，尽量带上被引用节点的 srcAssetId
    if (allNodes?.length && mentionScanText.includes('@')) {
      const mentionRefs = parseMentionRefs(mentionScanText)
      for (const ref of mentionRefs) {
        if (extractOpts?.imageMentionRefsRequireStableNodeId && !String(ref.nodeId || '').trim()) {
          continue
        }
        const hit = resolveMentionRefToNode(ref, allNodes, node.id, undefined, mentionUpstreamScope)
        if (!hit) continue
        const kind = (hit.data as StudioNodeData).kind
        /** 仅静态图可进 LoadImage；视频/音频/音乐的 src 不是单张图输入 */
        if (kind !== 'image' && kind !== 'panorama') continue
        let u =
          kind === 'panorama'
            ? String((hit.data as any)?.rectilinearSrc || (hit.data as any)?.src || '').trim()
            : String((hit.data as any)?.src || '').trim()
        const aid = String((hit.data as any)?.srcAssetId || '').trim()

        if (!u && aid) {
          const restored = await getLocalImageAssetObjectUrl(aid)
          if (restored) {
            u = restored
          }
        }

        if (!u) {
          continue
        }
        pairs.push({ url: u, assetId: aid || undefined })
      }
    }

    // 2) 节点自身参考图：按 referenceImageSources 顺序，绑定同索引 assetId
    for (let i = 0; i < refs.length; i++) {
      let url = String(refs[i] || '').trim()
      if (!url) continue
      const aid = Array.isArray(refIds) && i < refIds.length ? String(refIds[i] || '').trim() : ''
      
      if (url.startsWith('blob:') && aid) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) {
          url = restored
        }
      }
      
      pairs.push({ url, assetId: aid || undefined })
    }

    // 去重：先按 url 去重（保留第一个有 assetId 的）
    const mergedPairs: Array<{ url: string; assetId?: string }> = []
    for (const p of pairs) {
      const existing = mergedPairs.find((x) => x.url === p.url)
      if (!existing) mergedPairs.push(p)
      else if (!existing.assetId && p.assetId) existing.assetId = p.assetId
    }

    let primarySrc = String(node.data.src || mergedPairs[0]?.url || '').trim()
    const primaryAssetId =
      String((node.data as any)?.srcAssetId || '').trim() ||
      (mergedPairs.find((p) => p.url === primarySrc)?.assetId ?? '')
    
    if (primarySrc.startsWith('blob:') && primaryAssetId) {
      const restored = await getLocalImageAssetObjectUrl(primaryAssetId)
      if (restored) {
        primarySrc = restored
      }
    }

    const dedupeRefUrl = await normalisedCanvasPrimaryUrlForRefDedupe(
      (node.data as ImageNodeData).src,
      (node.data as ImageNodeData).srcAssetId,
    )
    const hasExplicitRefInputs =
      refs.length > 0 || (mentionScanText.includes('@') && mergedPairs.length > 0)
    const purePairs = filterMergedRefPairsAgainstCanvasPrimary(
      mergedPairs,
      dedupeRefUrl,
      hasExplicitRefInputs,
    )
    const imgMatting = node.data as ImageNodeData
    const rawMp = imgMatting.mattingPoints
    const safeMp = (Array.isArray(rawMp) ? rawMp : []).map((p) => ({
      x: Math.max(0, Math.min(1, Number(p.x) || 0)),
      y: Math.max(0, Math.min(1, Number(p.y) || 0)),
      t: (p.t === 0 ? 0 : 1) as 0 | 1,
    }))
    const mattingPointsJson = JSON.stringify(safeMp)
    const iw = Math.max(0, Math.round(Number(imgMatting.mattingRefWidth) || 0))
    const ih = Math.max(0, Math.round(Number(imgMatting.mattingRefHeight) || 0))
    const toPixel = (p: { x: number; y: number }) => {
      if (iw > 0 && ih > 0) {
        return { x: Math.round(p.x * iw), y: Math.round(p.y * ih) }
      }
      return { x: p.x, y: p.y }
    }
    const posPx = safeMp.filter((p) => p.t === 1).map((p) => toPixel(p))
    const negPx = safeMp.filter((p) => p.t === 0).map((p) => toPixel(p))
    const mattingPositiveCoordsJson = JSON.stringify(posPx)
    const mattingNegativeCoordsJson = JSON.stringify(negPx)
    /** 与 `easy framesEditor` 的 `info` 字段对齐（见 flowid 导出 API 工作流） */
    const mattingFrameInfoJson = JSON.stringify({
      positive_coords: posPx,
      negative_coords: negPx,
      bbox: [] as number[],
      frame_index: 0,
    })
    const comfyMultiangleH = clampMultiangleHV(imgMatting.comfyMultiangleH, FLOWID_MULTIANGLE_DEFAULT_H)
    const comfyMultiangleV = clampMultiangleHV(imgMatting.comfyMultiangleV, FLOWID_MULTIANGLE_DEFAULT_V)
    const comfyMultiangleZoom = clampMultiangleZoom(imgMatting.comfyMultiangleZoom, FLOWID_MULTIANGLE_DEFAULT_ZOOM)
    const { width: comfyWorkflowWidth, height: comfyWorkflowHeight } = resolveComfyWorkflowWidthHeight(
      'image',
      imgMatting,
    )
    return {
      ...common,
      prompt: node.data.prompt,
      src: primarySrc,
      srcAssetId: primaryAssetId,
      refImages: purePairs.map((p) => p.url).join('\n'),
      refImageAssetIds: purePairs.map((p) => String(p.assetId || '').trim()).filter(Boolean),
      mattingPointsJson,
      mattingPositiveCoordsJson,
      mattingNegativeCoordsJson,
      mattingFrameInfoJson,
      comfyMultiangleH,
      comfyMultiangleV,
      comfyMultiangleZoom,
      comfyWorkflowWidth,
      comfyWorkflowHeight,
      comfyWorkflowStyleTone: String((imgMatting as ImageNodeData).comfyWorkflowStyleTone ?? '').trim(),
      comfyOutpaintLeft: imgMatting.comfyOutpaintLeft,
      comfyOutpaintTop: imgMatting.comfyOutpaintTop,
      comfyOutpaintRight: imgMatting.comfyOutpaintRight,
      comfyOutpaintBottom: imgMatting.comfyOutpaintBottom,
      gridImages: imgMatting.gridImages ?? [],
      gridImageAssetIds: imgMatting.gridImageAssetIds ?? [],
      gridHorizontal: imgMatting.gridHorizontal ?? 2,
      gridVertical: imgMatting.gridVertical ?? 2,
      gridRemoveEdge: imgMatting.gridRemoveEdge ?? true,
      gridRemoveStroke: imgMatting.gridRemoveStroke ?? 0,
      gridFilePrefix: imgMatting.gridFilePrefix ?? '宫格_',
      gridFormat: imgMatting.gridFormat ?? 'PNG',
    }
  }
  if (node.data.kind === 'video') {
    const p1 = String(node.data.prompt || '')
    const p2 = String((node.data as { prompt2?: string }).prompt2 || '')
    const p3 = String((node.data as { prompt3?: string }).prompt3 || '')
    const p4 = String((node.data as { prompt4?: string }).prompt4 || '')
    const pExtra = Array.isArray((node.data as { extraPrompts?: string[] }).extraPrompts)
      ? (node.data as { extraPrompts?: string[] }).extraPrompts!.map((s) => String(s || ''))
      : []
    const promptText = [p1, p2, p3, p4, ...pExtra].filter(Boolean).join('\n')
    const mentionScanText =
      String(extractOpts?.imageMentionRefPromptOverride || '').trim() || promptText
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const refIds = (node.data as any)?.referenceImageAssetIds as string[] | undefined

    const pairs: Array<{ url: string; assetId?: string }> = []
    if (allNodes?.length && mentionScanText.includes('@')) {
      const mentionRefs = parseMentionRefs(mentionScanText)
      for (const ref of mentionRefs) {
        const hit = resolveMentionRefToNode(ref, allNodes, node.id, undefined, mentionUpstreamScope)
        if (!hit) continue
        const kind = (hit.data as StudioNodeData).kind
        /** 仅静态图可进 LoadImage；@视频 / @音频 等不走此链 */
        if (kind !== 'image' && kind !== 'panorama') continue
        let u =
          kind === 'panorama'
            ? String((hit.data as any)?.rectilinearSrc || (hit.data as any)?.src || '').trim()
            : String((hit.data as any)?.src || '').trim()
        const aid = String((hit.data as any)?.srcAssetId || '').trim()

        if (!u && aid) {
          const restored = await getLocalImageAssetObjectUrl(aid)
          if (restored) {
            u = restored
          }
        }

        if (!u) {
          continue
        }
        pairs.push({ url: u, assetId: aid || undefined })
      }
    }

    for (let i = 0; i < refs.length; i++) {
      let url = String(refs[i] || '').trim()
      if (!url) continue
      const aid = Array.isArray(refIds) && i < refIds.length ? String(refIds[i] || '').trim() : ''

      if (url.startsWith('blob:') && aid) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) {
          url = restored
        }
      }

      pairs.push({ url, assetId: aid || undefined })
    }

    const mergedPairs: Array<{ url: string; assetId?: string }> = []
    for (const p of pairs) {
      const existing = mergedPairs.find((x) => x.url === p.url)
      if (!existing) mergedPairs.push(p)
      else if (!existing.assetId && p.assetId) existing.assetId = p.assetId
    }

    let primarySrc = String(node.data.src || mergedPairs[0]?.url || '').trim()
    const primaryAssetId =
      String((node.data as any)?.srcAssetId || '').trim() ||
      (mergedPairs.find((p) => p.url === primarySrc)?.assetId ?? '')

    if (primarySrc.startsWith('blob:') && primaryAssetId) {
      const restored = await getLocalImageAssetObjectUrl(primaryAssetId)
      if (restored) {
        primarySrc = restored
      }
    }

    const dedupeRefUrl = await normalisedCanvasPrimaryUrlForRefDedupe(
      (node.data as VideoNodeData).src,
      (node.data as VideoNodeData).srcAssetId,
    )
    const hasExplicitRefInputs =
      refs.length > 0 || (mentionScanText.includes('@') && mergedPairs.length > 0)
    const purePairs = filterMergedRefPairsAgainstCanvasPrimary(
      mergedPairs,
      dedupeRefUrl,
      hasExplicitRefInputs,
    )
    /** 第二路提示词映射到工作流 `__BODY__`（常见于图音视频：__PROMPT__ + __BODY__ 双文本口）。 */
    const bodyForWorkflow = String(p2 || '').trim()
    const vd = node.data as VideoNodeData
    const comfyMultiangleH = clampMultiangleHV(vd.comfyMultiangleH, FLOWID_MULTIANGLE_DEFAULT_H)
    const comfyMultiangleV = clampMultiangleHV(vd.comfyMultiangleV, FLOWID_MULTIANGLE_DEFAULT_V)
    const comfyMultiangleZoom = clampMultiangleZoom(vd.comfyMultiangleZoom, FLOWID_MULTIANGLE_DEFAULT_ZOOM)
    const { width: comfyWorkflowWidth, height: comfyWorkflowHeight } = resolveComfyWorkflowWidthHeight(
      'video',
      vd,
    )
    const audioMentionEntries =
      allNodes?.length && mentionScanText.includes('@')
        ? collectMentionAudioResolvedEntries(
            mentionScanText,
            allNodes,
            node.id,
            extractOpts?.studioEdges,
          )
        : []
    const inboundAudioEntries =
      allNodes?.length && extractOpts?.studioEdges?.length
        ? collectInboundAudioResolvedEntries(node.id, extractOpts.studioEdges, allNodes)
        : []
    const audioOrderedMerged: Array<{ url: string; assetId?: string }> = []
    const seenAudioUrl = new Set<string>()
    for (const e of [...audioMentionEntries, ...inboundAudioEntries]) {
      if (!e.url || seenAudioUrl.has(e.url)) continue
      seenAudioUrl.add(e.url)
      audioOrderedMerged.push(e)
    }
    return {
      ...common,
      prompt: node.data.prompt,
      prompt2: p2,
      prompt3: p3,
      prompt4: p4,
      ...(pExtra.length ? { extraPrompts: pExtra } : {}),
      body: bodyForWorkflow,
      src: primarySrc,
      srcAssetId: primaryAssetId,
      refImages: purePairs.map((p) => p.url).join('\n'),
      refImageAssetIds: purePairs.map((p) => String(p.assetId || '').trim()).filter(Boolean),
      comfyMultiangleH,
      comfyMultiangleV,
      comfyMultiangleZoom,
      comfyWorkflowWidth,
      comfyWorkflowHeight,
      comfyWorkflowStyleTone: String((vd as VideoNodeData).comfyWorkflowStyleTone ?? '').trim(),
      comfyOutpaintLeft: vd.comfyOutpaintLeft,
      comfyOutpaintTop: vd.comfyOutpaintTop,
      comfyOutpaintRight: vd.comfyOutpaintRight,
      comfyOutpaintBottom: vd.comfyOutpaintBottom,
      ...(audioOrderedMerged.length ? { audioOrderedRefEntries: audioOrderedMerged } : {}),
    }
  }
  if (node.data.kind === 'panorama') {
    const flat = String(node.data.rectilinearSrc || node.data.src || '').trim()
    return { ...common, prompt: '', src: flat, refImages: '' }
  }
  if (node.data.kind === 'music') {
    const noteText = String(node.data.note || '')
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const refIds = (node.data as any)?.referenceImageAssetIds as string[] | undefined
    const pairs: Array<{ url: string; assetId?: string }> = []
    if (allNodes?.length && noteText.includes('@')) {
      const mentionRefs = parseMentionRefs(noteText)
      for (const ref of mentionRefs) {
        const hit = resolveMentionRefToNode(ref, allNodes, node.id, undefined, mentionUpstreamScope)
        if (!hit) continue
        const kind = (hit.data as StudioNodeData).kind
        if (kind !== 'image' && kind !== 'panorama' && kind !== 'audio' && kind !== 'music') continue
        let u =
          kind === 'panorama'
            ? String((hit.data as any)?.rectilinearSrc || (hit.data as any)?.src || '').trim()
            : String((hit.data as any)?.src || '').trim()
        const aid = String((hit.data as any)?.srcAssetId || '').trim()
        if (!u && aid) {
          const restored = await getLocalImageAssetObjectUrl(aid)
          if (restored) u = restored
        }
        if (!u) continue
        pairs.push({ url: u, assetId: aid || undefined })
      }
    }
    for (let i = 0; i < refs.length; i++) {
      let url = String(refs[i] || '').trim()
      if (!url) continue
      const aid = Array.isArray(refIds) && i < refIds.length ? String(refIds[i] || '').trim() : ''
      if (url.startsWith('blob:') && aid) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) url = restored
      }
      pairs.push({ url, assetId: aid || undefined })
    }
    const mergedPairs: Array<{ url: string; assetId?: string }> = []
    for (const p of pairs) {
      const existing = mergedPairs.find((x) => x.url === p.url)
      if (!existing) mergedPairs.push(p)
      else if (!existing.assetId && p.assetId) existing.assetId = p.assetId
    }
    let primarySrc = String(node.data.src || '').trim() || mergedPairs[0]?.url || ''
    const primaryAssetId =
      String((node.data as any)?.srcAssetId || '').trim() ||
      (mergedPairs.find((p) => p.url === primarySrc)?.assetId ?? '')
    if (primarySrc.startsWith('blob:') && primaryAssetId) {
      const restored = await getLocalImageAssetObjectUrl(primaryAssetId)
      if (restored) primarySrc = restored
    }
    const dedupeRefUrl = await normalisedCanvasPrimaryUrlForRefDedupe(
      (node.data as AudioNodeData).src,
      (node.data as AudioNodeData).srcAssetId,
    )
    const hasExplicitRefInputsMusic =
      refs.length > 0 || (noteText.includes('@') && mergedPairs.length > 0)
    const purePairs = filterMergedRefPairsAgainstCanvasPrimary(
      mergedPairs,
      dedupeRefUrl,
      hasExplicitRefInputsMusic,
    )
    const noteResolved =
      allNodes?.length && noteText
        ? resolveNodeMentionsInText(noteText, allNodes, node.id, extractOpts?.studioEdges)
        : noteText
    return {
      ...common,
      note: noteResolved,
      src: primarySrc,
      srcAssetId: primaryAssetId,
      refImages: purePairs.map((p) => p.url).join('\n'),
      refImageAssetIds: purePairs.map((p) => String(p.assetId || '').trim()).filter(Boolean),
      audioOrderedRefEntries: dedupeOrderedAudioRefEntries(
        { url: primarySrc, assetId: primaryAssetId || undefined },
        purePairs.map((p) => ({ url: p.url, assetId: p.assetId })),
      ),
    }
  }
  const noteText = String(node.data.note || '')
  const audioRefs = node.data.referenceImageSources?.filter(Boolean) ?? []
  const refIds = (node.data as any)?.referenceImageAssetIds as string[] | undefined
  const pairs: Array<{ url: string; assetId?: string }> = []
  if (allNodes?.length && noteText.includes('@')) {
    const mentionRefs = parseMentionRefs(noteText)
    for (const ref of mentionRefs) {
      const hit = resolveMentionRefToNode(ref, allNodes, node.id, undefined, mentionUpstreamScope)
      if (!hit) continue
      const kind = (hit.data as StudioNodeData).kind
      /** 多路 __REF_AUDIO__：台本里 @ 配音/音乐 节点应计入参考音序列（原仅 image/panorama，导致 0 路音频）。 */
      if (kind !== 'image' && kind !== 'panorama' && kind !== 'audio' && kind !== 'music') continue
      let u =
        kind === 'panorama'
          ? String((hit.data as any)?.rectilinearSrc || (hit.data as any)?.src || '').trim()
          : String((hit.data as any)?.src || '').trim()
      const aid = String((hit.data as any)?.srcAssetId || '').trim()
      if (!u && aid) {
        const restored = await getLocalImageAssetObjectUrl(aid)
        if (restored) u = restored
      }
      if (!u) continue
      pairs.push({ url: u, assetId: aid || undefined })
    }
  }
  for (let i = 0; i < audioRefs.length; i++) {
    let url = String(audioRefs[i] || '').trim()
    if (!url) continue
    const aid = Array.isArray(refIds) && i < refIds.length ? String(refIds[i] || '').trim() : ''
    if (url.startsWith('blob:') && aid) {
      const restored = await getLocalImageAssetObjectUrl(aid)
      if (restored) url = restored
    }
    pairs.push({ url, assetId: aid || undefined })
  }
  const mergedPairs: Array<{ url: string; assetId?: string }> = []
  for (const p of pairs) {
    const existing = mergedPairs.find((x) => x.url === p.url)
    if (!existing) mergedPairs.push(p)
    else if (!existing.assetId && p.assetId) existing.assetId = p.assetId
  }
  let primarySrc = String(node.data.src || mergedPairs[0]?.url || '').trim()
  const primaryAssetId =
    String((node.data as any)?.srcAssetId || '').trim() ||
    (mergedPairs.find((p) => p.url === primarySrc)?.assetId ?? '')
  if (primarySrc.startsWith('blob:') && primaryAssetId) {
    const restored = await getLocalImageAssetObjectUrl(primaryAssetId)
    if (restored) primarySrc = restored
  }
  const dedupeRefUrlAudio = await normalisedCanvasPrimaryUrlForRefDedupe(
    (node.data as AudioNodeData).src,
    (node.data as AudioNodeData).srcAssetId,
  )
  const hasExplicitRefInputsAudio =
    audioRefs.length > 0 || (noteText.includes('@') && mergedPairs.length > 0)
  const purePairs = filterMergedRefPairsAgainstCanvasPrimary(
    mergedPairs,
    dedupeRefUrlAudio,
    hasExplicitRefInputsAudio,
  )
  const noteResolvedAudio =
    allNodes?.length && noteText
      ? resolveNodeMentionsInText(noteText, allNodes, node.id, extractOpts?.studioEdges)
      : noteText
  return {
    ...common,
    note: noteResolvedAudio,
    src: primarySrc,
    srcAssetId: primaryAssetId,
    refImages: purePairs.map((p) => p.url).join('\n'),
    refImageAssetIds: purePairs.map((p) => String(p.assetId || '').trim()).filter(Boolean),
    audioOrderedRefEntries: dedupeOrderedAudioRefEntries(
      { url: primarySrc, assetId: primaryAssetId || undefined },
      purePairs.map((p) => ({ url: p.url, assetId: p.assetId })),
    ),
  }
}

/**
 * Comfy 图片/视频执行用的输入图 URL 序列。
 * 有「本地参考图 / @ 引用」合并进 refImages 时，**仅以参考图列表为准**，不再把节点主图 `src` 额外拼进序列
 *（避免「主图=第一张参考 + 参考区两张」被计成 3 张，首尾帧等工作流仅 2 槽时报错）。
 * 无参考图时退回节点主图 `src`（单图工作流）。
 */
/** 画布 URL 是否像音频（避免误进 LoadImage；数字人 LoadAudio 勿传无声 mp4 主槽）。 */
function isLikelyAudioMediaUrl(url: string): boolean {
  const raw = String(url || '').trim()
  if (!raw) return false
  if (isComfyViewUrlLikelyVideo(raw)) return false
  const path = raw.split(/[?#]/)[0].trim().toLowerCase()
  if (/\.(mp4|mov|mkv|avi|m4v|ogv)(\?|#|$)/i.test(path)) return false
  if (/\.(m4a|mp3|wav|flac|aac|ogg|opus|weba)(\?|#|$)/i.test(path)) return true
  const fn = readFilenameFromComfyViewUrl(raw)
  if (fn && /\.(mp4|mov|webm|mkv)/i.test(fn)) return false
  if (fn && /\.(m4a|mp3|wav|flac|aac|ogg|opus)/i.test(fn)) return true
  return false
}

/** Comfy 上传结果是否为图片文件（排除走 `/upload/image` 落盘的音频）。 */
function isComfyUploadedImageFile(item: ComfyUploadedInputImage): boolean {
  const f = String(item.filename || '').trim().toLowerCase()
  if (/\.(m4a|mp3|wav|flac|aac|ogg|opus|webm|weba)$/i.test(f)) return false
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(f)
}

type ComfyImageInputEntry = { url: string; assetId?: string }

function buildOrderedComfyImageInputEntries(
  rawSrc: string,
  rawSrcAssetId: string,
  rawRefImagesMultiline: string,
  refAssetIds?: string[],
): ComfyImageInputEntry[] {
  const refs = String(rawRefImagesMultiline || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: ComfyImageInputEntry[] = []
  const push = (url: string, assetId?: string) => {
    if (!url || seen.has(url) || isLikelyAudioMediaUrl(url)) return
    seen.add(url)
    out.push({ url, assetId: String(assetId || '').trim() || undefined })
  }
  if (refs.length > 0) {
    refs.forEach((url, i) => {
      const aid = Array.isArray(refAssetIds) && i < refAssetIds.length ? refAssetIds[i] : ''
      push(url, aid)
    })
    return out
  }
  const src = String(rawSrc || '').trim()
  if (src) push(src, rawSrcAssetId)
  return out
}

/**
 * 合并多路图片输入（本地参考图、@ 引用、上游连线），按 assetId 与 URL 去重保序。
 * @param {ComfyImageInputEntry[][]} lists
 */
function mergeComfyImageInputEntriesDeduped(...lists: ComfyImageInputEntry[][]): ComfyImageInputEntry[] {
  const seenUrl = new Set<string>()
  const seenAid = new Set<string>()
  const out: ComfyImageInputEntry[] = []
  for (const list of lists) {
    for (const e of list) {
      const url = String(e.url || '').trim()
      const aid = String(e.assetId || '').trim()
      if (!url && !aid) continue
      if (aid && seenAid.has(aid)) continue
      if (url && seenUrl.has(url)) continue
      if (aid) seenAid.add(aid)
      if (url) seenUrl.add(url)
      out.push({ url, assetId: aid || undefined })
    }
  }
  return out
}

/** 工作流是否依赖 Comfy LoadImage / __SRC__ 等图片文件名占位（含数字人、图生视频）。 */
function workflowJsonRequiresComfyImageUpload(workflowJsonText: string): boolean {
  const raw = String(workflowJsonText || '')
  return (
    /__SRC__/i.test(raw) ||
    /__REF_IMAGE/i.test(raw) ||
    /"class_type"\s*:\s*"LoadImage"/i.test(raw) ||
    /"class_type"\s*:\s*"ImageLoader"/i.test(raw)
  )
}

/**
 * 上传前尽量把失效的 blob/file 还原为可读 URL（IndexedDB / 桌面 input 镜像）。
 */
async function resolveCanvasUrlForComfyUpload(url: string, assetId?: string): Promise<string> {
  let u = String(url || '').trim()
  const aid = String(assetId || '').trim()
  if (!u && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) return restored
  }
  if ((/^(blob:|file:)/i.test(u) || /^[a-zA-Z]:[\\/]/.test(u)) && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) return restored
  }
  return u
}

/** 与参考音频上传序列一致：主槽 + refImages 行（URL 去重保序）。 */
function dedupeOrderedAudioInputUrls(rawSrc: string, refImageUrlLines: string[]): string[] {
  const seq = [String(rawSrc || '').trim(), ...refImageUrlLines.map((s) => s.trim()).filter(Boolean)].filter(
    Boolean,
  )
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of seq) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

type AudioRefUploadEntry = { url: string; assetId?: string }

/** 主槽 + 参考行，按 URL 去重保序；保留 assetId 供 blob 失效时从 IndexedDB 直读。 */
function dedupeOrderedAudioRefEntries(
  primary: { url: string; assetId?: string },
  refs: Array<{ url: string; assetId?: string }>,
): AudioRefUploadEntry[] {
  const seq: AudioRefUploadEntry[] = [
    { url: String(primary.url || '').trim(), assetId: primary.assetId },
    ...refs.map((r) => ({
      url: String(r.url || '').trim(),
      assetId: r.assetId,
    })),
  ].filter((e) => e.url)
  const seen = new Set<string>()
  const out: AudioRefUploadEntry[] = []
  for (const e of seq) {
    if (seen.has(e.url)) continue
    seen.add(e.url)
    out.push(e)
  }
  return out
}

/** 画布上哪路音频节点的 `src` 与待上传 URL 一致，则取其 `srcAssetId`（补全缺失的 IndexedDB 键）。 */
function resolveAudioSrcAssetIdFromCanvas(
  url: string,
  allNodes: Array<Node<StudioNodeData>>,
): string {
  const u = String(url || '').trim()
  if (!u) return ''
  for (const n of allNodes) {
    if (n.data.kind !== 'audio' && n.data.kind !== 'music') continue
    const src = String((n.data as { src?: string }).src || '').trim()
    if (src === u) {
      const id = String((n.data as { srcAssetId?: string }).srcAssetId || '').trim()
      if (id) return id
    }
  }
  return ''
}

function audioRefEntriesFromNodeInputs(ni: NodeInputRecord): AudioRefUploadEntry[] {
  const raw = (ni as { audioOrderedRefEntries?: unknown }).audioOrderedRefEntries
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((x) => ({
        url: String((x as { url?: string }).url ?? '').trim(),
        assetId: String((x as { assetId?: string }).assetId ?? '').trim() || undefined,
      }))
      .filter((e) => e.url)
  }
  const primaryUrl = String(ni.src ?? '').trim()
  const primaryAssetId = String((ni as { srcAssetId?: string }).srcAssetId ?? '').trim() || undefined
  return dedupeOrderedAudioRefEntries(
    {
      url: isLikelyAudioMediaUrl(primaryUrl) ? primaryUrl : '',
      assetId: isLikelyAudioMediaUrl(primaryUrl) ? primaryAssetId : undefined,
    },
    String((ni as { refImages?: string }).refImages ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => ({ url })),
  )
}

type VideoRefUploadEntry = { url: string; assetId: string }

/** 恢复视频 URL（含 blob + assetId 从 IndexedDB 回读）。 */
async function resolveVideoRefUploadEntry(entry: {
  url: string
  assetId?: string
}): Promise<VideoRefUploadEntry | null> {
  let u = String(entry.url || '').trim()
  const aid = String(entry.assetId || '').trim()
  if (!u && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) u = restored
  }
  if (u.startsWith('blob:') && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) u = restored
  }
  if (!u) return null
  return { url: u, assetId: aid }
}

/**
 * 文本/剧本节点执行 Comfy 时：从 @ 视频与上游连线视频节点收集待上传视频（去重保序）。
 */
async function collectTextNodeVideoRefEntries(
  node: Node<StudioNodeData>,
  nodeInputs: NodeInputRecord,
  allNodes?: Array<Node<StudioNodeData>>,
  edges?: Edge[],
  rawPromptText?: string,
): Promise<VideoRefUploadEntry[]> {
  const rawCandidates: Array<{ url: string; assetId: string }> = []
  const mentionText = String(rawPromptText ?? nodeInputs.body ?? '').trim()
  if (allNodes?.length && mentionText.includes('@')) {
    for (const e of collectMentionVideoResolvedEntries(mentionText, allNodes, node.id, edges)) {
      rawCandidates.push({ url: e.url, assetId: e.assetId })
    }
  }
  if (node.id && edges?.length && allNodes?.length) {
    const upstream = collectUpstreamNodeIds(node.id, edges)
    for (const nid of upstream) {
      const n = allNodes.find((x) => x.id === nid)
      if (n?.data.kind !== 'video') continue
      const u = String((n.data as VideoNodeData).src || '').trim()
      const aid = String((n.data as VideoNodeData).srcAssetId || '').trim()
      if (!u && !aid) continue
      if (rawCandidates.some((c) => (c.url && c.url === u) || (c.assetId && c.assetId === aid))) {
        continue
      }
      rawCandidates.push({ url: u, assetId: aid })
    }
  }
  const nodeVideoSrc = String((nodeInputs as { videoSrc?: string }).videoSrc ?? '').trim()
  const nodeVideoAid = String((nodeInputs as { videoSrcAssetId?: string }).videoSrcAssetId ?? '').trim()
  if (nodeVideoSrc || nodeVideoAid) {
    if (!rawCandidates.some((c) => (c.url && c.url === nodeVideoSrc) || (c.assetId && c.assetId === nodeVideoAid))) {
      rawCandidates.unshift({ url: nodeVideoSrc, assetId: nodeVideoAid })
    }
  }
  const out: VideoRefUploadEntry[] = []
  const seen = new Set<string>()
  for (const c of rawCandidates) {
    const resolved = await resolveVideoRefUploadEntry(c)
    if (!resolved || seen.has(resolved.url)) continue
    seen.add(resolved.url)
    out.push(resolved)
  }
  return out
}

type ImageRefUploadEntry = { url: string; assetId: string }

/** 恢复图片 URL（含 blob + assetId 从 IndexedDB 回读）。 */
async function resolveImageRefUploadEntry(entry: {
  url: string
  assetId?: string
}): Promise<ImageRefUploadEntry | null> {
  let u = String(entry.url || '').trim()
  const aid = String(entry.assetId || '').trim()
  if (!u && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) u = restored
  }
  if (u.startsWith('blob:') && aid) {
    const restored = await getLocalImageAssetObjectUrl(aid)
    if (restored) u = restored
  }
  if (!u) return null
  return { url: u, assetId: aid }
}

/**
 * 文本/剧本节点执行 Comfy 时：从 @ 图片/全景与上游连线图片节点收集待上传图片（去重保序）。
 */
async function collectTextNodeImageRefEntries(
  node: Node<StudioNodeData>,
  nodeInputs: NodeInputRecord,
  allNodes?: Array<Node<StudioNodeData>>,
  edges?: Edge[],
  rawPromptText?: string,
): Promise<ImageRefUploadEntry[]> {
  const rawCandidates: Array<{ url: string; assetId: string }> = []
  const mentionText = String(rawPromptText ?? nodeInputs.body ?? '').trim()
  if (allNodes?.length && mentionText.includes('@')) {
    for (const e of collectMentionImageResolvedEntries(mentionText, allNodes, node.id, edges)) {
      rawCandidates.push({ url: e.url, assetId: e.assetId })
    }
  }
  if (node.id && edges?.length && allNodes?.length) {
    const upstream = collectUpstreamNodeIds(node.id, edges)
    for (const nid of upstream) {
      const n = allNodes.find((x) => x.id === nid)
      if (!n) continue
      const k = n.data.kind
      if (k !== 'image' && k !== 'panorama') continue
      const u =
        k === 'panorama'
          ? String((n.data as PanoramaNodeData).rectilinearSrc || (n.data as PanoramaNodeData).src || '').trim()
          : String((n.data as ImageNodeData).src || '').trim()
      const aid = String((n.data as ImageNodeData).srcAssetId || '').trim()
      if (!u && !aid) continue
      if (
        rawCandidates.some(
          (c) =>
            (c.assetId && aid && c.assetId === aid) ||
            (c.url && u && c.url === u),
        )
      ) {
        continue
      }
      rawCandidates.push({ url: u, assetId: aid })
    }
  }
  const refLines = String(nodeInputs.refImages ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const refAids = Array.isArray(nodeInputs.refImageAssetIds)
    ? (nodeInputs.refImageAssetIds as string[])
    : []
  for (let i = 0; i < refLines.length; i += 1) {
    const u = refLines[i]!
    const aid = String(refAids[i] ?? '').trim()
    if (
      rawCandidates.some(
        (c) =>
          (c.assetId && aid && c.assetId === aid) ||
          (c.url && u && c.url === u),
      )
    ) {
      continue
    }
    rawCandidates.unshift({ url: u, assetId: aid })
  }
  const out: ImageRefUploadEntry[] = []
  const seenUrl = new Set<string>()
  const seenAid = new Set<string>()
  for (const c of rawCandidates) {
    const resolved = await resolveImageRefUploadEntry(c)
    if (!resolved) continue
    const aid = String(resolved.assetId || c.assetId || '').trim()
    if (aid && seenAid.has(aid)) continue
    if (seenUrl.has(resolved.url)) continue
    if (aid) seenAid.add(aid)
    seenUrl.add(resolved.url)
    out.push(resolved)
  }
  return out
}

/** 文本/剧本 @ 图片反推等与 image/video 共用 Comfy 图片上传链 */
function nodeKindUsesComfyImagePipeline(nodeKind: StudioNodeKind, imageEntryCount: number): boolean {
  if (nodeKind === 'image' || nodeKind === 'video') return true
  if ((nodeKind === 'text' || nodeKind === 'script') && imageEntryCount > 0) return true
  return false
}

/**
 * 在浏览器侧读取视频 metadata 时长（秒）；失败返回 null（如跨域或格式不支持）。
 */
function probeVideoDurationSeconds(mediaUrl: string): Promise<number | null> {
  const url = String(mediaUrl || '').trim()
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    const finish = (value: number | null) => {
      cleanup()
      resolve(value)
    }
    video.onloadedmetadata = () => {
      const d = Number(video.duration)
      finish(Number.isFinite(d) && d > 0 ? d : null)
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** 将探测到的秒数规范为提示词用的小数（最多 1 位）。 */
function normalizeVideoDurationSecForPrompt(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.round(raw * 10) / 10
}

/**
 * 视频反推：写入用户侧约束，要求分镜末段终点不超过源视频时长。
 */
function buildVideoReverseDurationConstraintLine(durationSec: number): string {
  const d = normalizeVideoDurationSecForPrompt(durationSec)
  if (d <= 0) return ''
  const lastStart = Math.max(0, Math.floor((d - 2) / 2) * 2)
  const lastEnd = d
  const lastSeg =
    lastStart >= lastEnd - 0.05
      ? `0-${lastEnd}秒`
      : `${lastStart}-${lastEnd}秒`
  return `源视频总时长：${d}秒。【强制】全程震撼分镜须从0秒起、最后一段终点为${lastEnd}秒（禁止出现${lastEnd}秒之后的时段，如禁止${Math.ceil(lastEnd) + 2}-${Math.ceil(lastEnd) + 4}秒）；约每2秒一段，末段可为${lastSeg}。`
}

/** 将时长约束并入文本节点正文（供 __BODY__ / LLM 用户消息读取）。 */
function augmentTextBodyForVideoReverse(body: string, durationSec: number): string {
  const line = buildVideoReverseDurationConstraintLine(durationSec)
  if (!line) return body
  const trimmed = String(body || '').trim()
  return trimmed ? `${line}\n\n${trimmed}` : line
}

/**
 * 开发环境控制台：截断 URL，避免 blob/data 过长刷屏。
 */
function devTruncateUrl(url: string, max = 120): string {
  const u = url.trim()
  if (u.length <= max) return u
  return `${u.slice(0, max)}…(共${u.length}字符)`
}

function devUrlKind(url: string): string {
  const u = String(url || '').trim().toLowerCase()
  if (!u) return 'empty'
  if (u.startsWith('data:')) return 'data'
  if (u.startsWith('blob:')) return 'blob'
  if (u.startsWith('file:')) return 'file'
  if (u.startsWith('https://')) return 'https'
  if (u.startsWith('http://')) return 'http'
  return 'other'
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const b64 = btoa(binary)
  const mime = blob.type || 'application/octet-stream'
  return `data:${mime};base64,${b64}`
}

async function ensureOpenAiImageUrlFromAssetId(assetId: string): Promise<string> {
  const id = String(assetId || '').trim()
  if (!id) return ''
  try {
    const blob = await readLocalImageAssetBlob(id)
    if (!blob) return ''
    return await blobToDataUrl(blob)
  } catch {
    return ''
  }
}

/**
 * 将本地 `blob:` / `file:` 等不可外网访问的引用图转为 `data:` URL，
 * 以便云端 OpenAI 兼容接口能真正“看到”参考图。
 */
async function ensureOpenAiImageUrl(raw: string): Promise<string> {
  const url = String(raw || '').trim()
  if (!url) return ''
  if (url.startsWith('data:')) return url
  // http(s) 直接透传（是否可访问由服务端决定）
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  // blob/file 等尝试读为 data url
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const b64 = btoa(binary)
    const mime = blob.type || 'application/octet-stream'
    return `data:${mime};base64,${b64}`
  } catch {
    return url
  }
}

function pickModelReferenceImages(
  nodeInputs: { src?: string; srcAssetId?: string; refImages?: string; refImageAssetIds?: string[] },
  max = 6,
  opts?: { includePrimaryCanvasImage?: boolean },
): Array<{ url?: string; assetId?: string }> {
  const out: Array<{ url?: string; assetId?: string }> = []
  const push = (item: { url?: string; assetId?: string }) => {
    const url = String(item.url || '').trim()
    const assetId = String(item.assetId || '').trim()
    if (!url && !assetId) return
    if (out.some((x) => String(x.assetId || '').trim() === assetId && assetId)) return
    if (out.some((x) => String(x.url || '').trim() === url && url)) return
    out.push({ url: url || undefined, assetId: assetId || undefined })
  }

  /**
   * 云端多模态计费按「参考图」张数与像素计；主预览 `src` 往往是**上一轮成图**。
   * 默认附带会导致每次生图都把整张旧图再当 vision 输入 → token/费用暴涨，且易产出异常黑图/混图。
   * 仅 @ 引用与「参考图条」应进入 refImages；需以当前主图作 img2img 时用户应显式加入参考条或 @ 自己链路。
   */
  const includePrimary = opts?.includePrimaryCanvasImage !== false
  if (includePrimary) {
    const srcAssetId = String((nodeInputs as any)?.srcAssetId || '').trim()
    const src = String((nodeInputs as any)?.src || '').trim()
    if (srcAssetId) push({ assetId: srcAssetId, url: src })
    else if (src) push({ url: src })
  }

  const refUrls = String((nodeInputs as any)?.refImages || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const refIds = Array.isArray((nodeInputs as any)?.refImageAssetIds)
    ? ((nodeInputs as any).refImageAssetIds as string[])
    : Array.isArray((nodeInputs as any)?.refImageAssetIds)
      ? ((nodeInputs as any).refImageAssetIds as string[])
      : Array.isArray((nodeInputs as any)?.refImageAssetIds)
        ? ((nodeInputs as any).refImageAssetIds as string[])
        : (Array.isArray((nodeInputs as any)?.referenceImageAssetIds)
            ? ((nodeInputs as any).referenceImageAssetIds as string[])
            : (Array.isArray((nodeInputs as any)?.refImageAssetIds)
                ? ((nodeInputs as any).refImageAssetIds as string[])
                : []))
  // 按 URL 顺序优先，但若有 assetId 则绑定上，避免 blob URL 失效导致无法上传
  for (let i = 0; i < refUrls.length && out.length < max; i += 1) {
    const url = refUrls[i]
    const aid = i < refIds.length ? String(refIds[i] || '').trim() : ''
    if (aid) push({ assetId: aid, url })
    else push({ url })
  }
  // 若有更多 assetId（但 URL 缺失），也补进来
  for (let i = refUrls.length; i < refIds.length && out.length < max; i += 1) {
    const aid = String(refIds[i] || '').trim()
    if (aid) push({ assetId: aid })
  }
  return out
}

/**
 * 开发环境控制台：将即将提交给 Comfy 的 `prompt` 压缩为每节点的 `class_type` 与 inputs 里可序列化字段的预览。
 */
function devSummarizeComfyPromptForLog(
  prompt: Record<string, unknown>,
  /** 默认放宽：大图工作流常 >32 节点，省略后无法核对尾帧 ImageLoader 等 */
  maxNodes = 96,
  maxStringPerField = 280,
): Array<{
  节点id: string
  class_type: string
  inputs预览: Record<string, string>
}> {
  const rows: Array<{
    节点id: string
    class_type: string
    inputs预览: Record<string, string>
  }> = []
  const keys = Object.keys(prompt)
  for (const id of keys) {
    if (rows.length >= maxNodes) break
    const raw = prompt[id]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type ?? '')
    const inputs = rec.inputs
    const preview: Record<string, string> = {}
    if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
      for (const [k, v] of Object.entries(inputs as Record<string, unknown>)) {
        if (typeof v === 'string') {
          preview[k] =
            v.length > maxStringPerField
              ? `${v.slice(0, maxStringPerField)}…(共${v.length}字)`
              : v
        } else if (typeof v === 'number' || typeof v === 'boolean') {
          preview[k] = String(v)
        } else if (Array.isArray(v)) {
          const j = JSON.stringify(v)
          preview[k] = j.length > 220 ? `${j.slice(0, 220)}…` : j
        } else if (v != null && typeof v === 'object') {
          preview[k] = '[联线/对象]'
        }
      }
    }
    rows.push({ 节点id: id, class_type: classType, inputs预览: preview })
  }
  if (keys.length > maxNodes) {
    rows.push({
      节点id: '…',
      class_type: `其余 ${keys.length - maxNodes} 个节点已省略`,
      inputs预览: {},
    })
  }
  return rows
}

/**
 * 开发环境：列出 prompt 内所有「加载图片」类节点的 `image` 文件名（不截断节点数量），便于核对首尾帧是否注入到不同节点。
 */
function devSummarizeComfyImageLoadNodesForLog(
  prompt: Record<string, unknown>,
): Array<{ 节点id: string; class_type: string; image字段: string }> {
  const rows: Array<{ 节点id: string; class_type: string; image字段: string }> = []
  for (const [id, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type ?? '')
    if (!/\b(LoadImage|ImageLoader)\b/i.test(classType) && !/Load Image/i.test(classType)) {
      continue
    }
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    const img = inp.image
    const imageStr = typeof img === 'string' ? img : img != null ? JSON.stringify(img) : ''
    rows.push({ 节点id: id, class_type: classType, image字段: imageStr })
  }
  rows.sort((a, b) => {
    const na = Number(a.节点id)
    const nb = Number(b.节点id)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return String(a.节点id).localeCompare(String(b.节点id))
  })
  return rows
}

/**
 * 将工作流对象里“值恰好等于占位符 token”的字符串替换为数值。
 * 用于像 `easy forLoopStart.total` 这类必须为 number 的输入字段。
 */
function replacePlaceholderStringWithNumber(
  value: unknown,
  token: string,
  numericValue: number,
): unknown {
  if (typeof value === 'string') {
    return value === token ? numericValue : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholderStringWithNumber(item, token, numericValue))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = replacePlaceholderStringWithNumber(v, token, numericValue)
    }
    return out
  }
  return value
}

/**
 * 从即将提交的 Comfy `prompt` 中提取 Qwen 相关节点的 `model` / `quantization`，便于对照本地 Comfy 报错。
 */
function summarizeQwenLikeNodesForLog(prompt: Record<string, unknown>): Array<{
  节点id: string
  class_type: string
  model: string
  quantization: string
}> {
  const rows: Array<{
    节点id: string
    class_type: string
    model: string
    quantization: string
  }> = []
  for (const [id, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type ?? '')
    if (!/\bqwen/i.test(classType)) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    const model =
      typeof inp.model === 'string'
        ? inp.model
        : inp.model != null
          ? JSON.stringify(inp.model)
          : '（无）'
    const quantization =
      typeof inp.quantization === 'string'
        ? inp.quantization
        : inp.quantization != null
          ? JSON.stringify(inp.quantization)
          : '（无）'
    rows.push({ 节点id: id, class_type: classType, model, quantization })
  }
  return rows
}

/**
 * 采样输出 `easy forLoopStart` 节点的 total 字段，便于确认 `__REF_COUNT__` 是否已转为 number。
 */
function summarizeForLoopStartTotalForLog(prompt: Record<string, unknown>): Array<{
  节点id: string
  class_type: string
  total值: unknown
  total类型: string
}> {
  const rows: Array<{
    节点id: string
    class_type: string
    total值: unknown
    total类型: string
  }> = []
  for (const [id, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type ?? '')
    if (classType !== 'easy forLoopStart') continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const total = (inputs as Record<string, unknown>).total
    rows.push({
      节点id: id,
      class_type: classType,
      total值: total,
      total类型: typeof total,
    })
  }
  return rows
}

/**
 * 将音乐节点“描述信息”兜底映射到 ComfyUI 常见正向提示词字段。
 * 优先保留已有占位符替换逻辑；当未使用占位符时再尝试自动注入。
 *
 * 注意：如 Ace Step 等图里「风格/歌词」常放在 `PrimitiveStringMultiline` 的 `inputs.value`，
 * 再以连线接入编码器；此时编码器上的 `tags`/`lyrics` 是 `[nodeId,0]` 而非字符串，
 * 仅靠 `__PROMPT__` 或 inputs 里的 `lyrics` 字符串无法替换，必须改 primitive 的 `value`。
 */
function injectMusicPromptFallback(
  prompt: Record<string, unknown>,
  note: string,
): Record<string, unknown> {
  const trimmedNote = note.trim()
  if (!trimmedNote) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const candidateKeys = new Set([
    'prompt',
    'positive',
    'positive_prompt',
    'main_prompt',
    'lyrics',
    'text',
    'caption',
    'description',
    'user_prompt',
    'gpt_prompt',
    'refined_prompt',
    'instruction',
    'instructions',
  ])
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '').toLowerCase()
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    if (
      typeof inputRecord.value === 'string' &&
      (classType.includes('primitivestringmultiline') || classType === 'primitivestring')
    ) {
      inputRecord.value = trimmedNote
    }
    for (const key of candidateKeys) {
      if (typeof inputRecord[key] === 'string') {
        inputRecord[key] = trimmedNote
      }
    }
  }
  return cloned
}

/**
 * 文本/剧本节点兜底：当工作流未使用 `__BODY__` 占位符时，
 * 自动将节点内容覆盖到常见文本输入字段（有输入即覆盖；无输入不改默认）。
 */
function injectTextBodyFallback(
  prompt: Record<string, unknown>,
  bodyText: string,
): Record<string, unknown> {
  const trimmed = bodyText.trim()
  if (!trimmed) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const exactCandidateKeys = new Set([
    'text',
    'prompt',
    'body',
    'content',
    'instruction',
    'instructions',
    'user_prompt',
    'user_input',
    'input_text',
    'query',
    'question',
    'message',
  ])
  const keywordCandidateKeys = ['prompt', 'text', 'instruction', 'content', 'query', 'question', 'message']
  const blockedExactKeys = new Set([
    'system_prompt',
    'system',
    'system_message',
    'preset_prompt',
    'prompt_style',
    'style',
    'template',
    'mode',
    'input_config',
    'config',
  ])
  const blockedKeywordParts = ['system', 'preset', 'style', 'template', 'config', 'mode', 'dropdown', 'select']
  let injectedCount = 0
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '').toLowerCase()
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    /**
     * 兼容 Comfy PrimitiveStringMultiline：其文本入口通常为 `inputs.value`，
     * 若不显式覆盖会一直沿用工作流默认文案。
     */
    if (classType.includes('primitivestringmultiline') && typeof inputRecord.value === 'string') {
      inputRecord.value = trimmed
      injectedCount += 1
      continue
    }
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      if (typeof rawValue !== 'string') continue
      const lower = String(rawKey || '').toLowerCase()
      if (blockedExactKeys.has(lower)) continue
      if (blockedKeywordParts.some((part) => lower.includes(part))) continue
      const keyMatched =
        exactCandidateKeys.has(lower) ||
        keywordCandidateKeys.some((part) => lower.includes(part))
      if (!keyMatched) continue
      inputRecord[rawKey] = trimmed
      injectedCount += 1
    }
  }
  if (shouldLogComfyDebug() && injectedCount > 0) {
    console.info('[Flowid Comfy] 文本节点兜底覆盖字段数', injectedCount)
  }
  return cloned
}

/**
 * 解析文本/剧本 Comfy 工作流的系统提示词：侧栏草稿优先，其次按工作流 id 读取已保存项。
 */
function resolveTextComfySystemPrompt(
  nodeKind: StudioNodeKind,
  wfEntryId: string,
  cloudWorkflowEntryId: string,
  savedByWorkflowId: Record<string, string> | undefined,
  override?: string,
): string {
  const fromOverride = String(override ?? '').trim()
  if (fromOverride) return fromOverride
  const k = String(wfEntryId || cloudWorkflowEntryId || '').trim()
  if (!(nodeKind === 'text' || nodeKind === 'script') || !k) return ''
  return String(savedByWorkflowId?.[k] ?? '').trim()
}

/**
 * 文本/剧本节点兜底：当工作流未使用 `__SYSTEM_PROMPT__` 占位符时，
 * 将侧栏系统提示词写入 LLM/VLM 节点的 system 类字段（如 llama_cpp_instruct_adv.system_prompt）。
 */
function injectTextSystemPromptFallback(
  prompt: Record<string, unknown>,
  systemText: string,
): Record<string, unknown> {
  const trimmed = systemText.trim()
  if (!trimmed) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const systemExactKeys = new Set([
    'system_prompt',
    'system',
    'system_message',
    'system_instruction',
    'sys_prompt',
  ])
  let injectedCount = 0
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      if (typeof rawValue !== 'string') continue
      const lower = String(rawKey || '').toLowerCase()
      if (!systemExactKeys.has(lower) && !lower.includes('system_prompt')) continue
      inputRecord[rawKey] = trimmed
      injectedCount += 1
    }
  }
  if (shouldLogComfyDebug() && injectedCount > 0) {
    console.info('[Flowid Comfy] 文本节点系统提示词兜底覆盖字段数', injectedCount)
  }
  return cloned
}

/**
 * 解析 Comfy 节点 inputs 中的 `[nodeId, slot]` 连线引用。
 */
function parseComfyInputLink(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1) return null
  const id = String(value[0] ?? '').trim()
  return id || null
}

/**
 * 读取 Comfy 文本类节点当前可写的 prompt 字段值。
 */
function readComfyTextNodePromptValue(nodeRecord: Record<string, unknown>): string {
  const classLower = String(nodeRecord.class_type || '').toLowerCase()
  const inputs = nodeRecord.inputs as Record<string, unknown> | undefined
  if (!inputs) return ''
  if (classLower.includes('primitivestringmultiline') && typeof inputs.value === 'string') {
    return String(inputs.value)
  }
  if (typeof inputs.text === 'string') return String(inputs.text)
  return ''
}

/**
 * 写入 Comfy 文本类节点的 prompt 字段（ShowText 等输出节点跳过）。
 */
function writeComfyTextNodePromptValue(nodeRecord: Record<string, unknown>, value: string): boolean {
  const classLower = String(nodeRecord.class_type || '').toLowerCase()
  if (classLower.includes('showtext')) return false
  const inputs = nodeRecord.inputs as Record<string, unknown> | undefined
  if (!inputs) return false
  if (classLower.includes('primitivestringmultiline') && typeof inputs.value === 'string') {
    inputs.value = value
    return true
  }
  if (typeof inputs.text === 'string') {
    inputs.text = value
    return true
  }
  return false
}

/**
 * 判断 CLIP 节点 `text` 是否为负向提示词（勿用用户正向文案覆盖）。
 */
function isClipNegativePromptText(oldValue: string): boolean {
  const v = String(oldValue || '').trim()
  if (!v) return false
  return (
    v.length > 64 &&
    /最差质量|低质量|low quality|jpeg compression|static,|noisy, harsh|bad anatomy|ugly|泛黄，发绿/i.test(v)
  )
}

/**
 * 是否允许用画布提示词覆盖工作流里已有的 `text` 字符串。
 * 保留负向 CLIP、Qwen 音效推断、showAnything 等内置长文案，避免首尾视频工作流整图校验失败。
 */
function shouldReplaceWorkflowPromptText(oldValue: string, classType: string): boolean {
  const v = String(oldValue || '').trim()
  if (!v) return true
  if (/__PROMPT\d*__/i.test(v)) return true
  const ct = String(classType || '').toLowerCase()
  if (ct.includes('cliptextencode')) {
    if (v.length > 64 && /最差质量|low quality|jpeg compression|static,|noisy, harsh/i.test(v)) {
      return false
    }
    return v.length < 12
  }
  if (ct.includes('primitivestringmultiline')) return true
  if (ct.includes('text multiline')) return true
  if (ct.includes('cr text') || ct.includes('jjktext')) return true
  return false
}

/**
 * 将 Wan 首尾帧节点的 positive 条件接到哪个 CLIPTextEncode（工作流 API 图里常为 `52`）。
 */
function findWanPositiveClipTextEncodeNodeId(prompt: Record<string, unknown>): string | null {
  let wanNodeId: string | null = null
  for (const [nodeId, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ct = String((raw as Record<string, unknown>).class_type || '')
    if (/WanFirstLastFrameToVideo/i.test(ct)) {
      wanNodeId = nodeId
      break
    }
  }
  if (!wanNodeId) return null
  const wanInputs = (prompt[wanNodeId] as Record<string, unknown>).inputs as Record<string, unknown>
  const pos = wanInputs?.positive
  if (!Array.isArray(pos) || pos.length < 1) return null
  const clipId = String(pos[0] ?? '').trim()
  return clipId && prompt[clipId] ? clipId : null
}

/**
 * 图片/视频节点兜底：当工作流未使用 __PROMPT__ 占位符时，
 * 自动把提示词映射到常见字段，避免“面板有文案但实际未注入”的情况。
 */
function injectVisualPromptFallback(
  prompt: Record<string, unknown>,
  visualPrompt: string,
  options?: {
    /**
     * 工作流 JSON 无 `__PROMPT__` 时（如电商模板）：用面板/继承后的正文强制覆盖模板内 CLIP 正向长句。
     */
    forceOverwriteTemplateClip?: boolean
  },
): Record<string, unknown> {
  const trimmed = visualPrompt.trim()
  if (!trimmed) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const wanPositiveClipId = findWanPositiveClipTextEncodeNodeId(cloned)
  const forceClip = options?.forceOverwriteTemplateClip === true
  const isNegativeLikeKey = (key: string): boolean => {
    const lower = key.toLowerCase()
    return (
      lower.includes('negative') ||
      lower.includes('neg_prompt') ||
      lower === 'neg' ||
      lower === 'uc'
    )
  }
  let injectedCount = 0
  let forcedPositiveClipDone = false
  for (const [nodeId, node] of Object.entries(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '')
    const classLower = classType.toLowerCase()
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    if (classLower.includes('primitivestringmultiline') && typeof inputRecord.value === 'string') {
      if (shouldReplaceWorkflowPromptText(String(inputRecord.value), classType)) {
        inputRecord.value = trimmed
        injectedCount += 1
      }
      continue
    }
    if (classLower.includes('text multiline') && typeof inputRecord.text === 'string') {
      if (shouldReplaceWorkflowPromptText(String(inputRecord.text), classType)) {
        inputRecord.text = trimmed
        injectedCount += 1
      }
      continue
    }
    if (
      (classLower.includes('cr text') || classLower.includes('jjktext')) &&
      typeof inputRecord.text === 'string'
    ) {
      const oldValue = String(inputRecord.text)
      const canForce = forceClip && !forcedPositiveClipDone && !isClipNegativePromptText(oldValue)
      if (shouldReplaceWorkflowPromptText(oldValue, classType) || canForce) {
        inputRecord.text = trimmed
        injectedCount += 1
        if (canForce) forcedPositiveClipDone = true
      }
      continue
    }
    if (!classLower.includes('cliptextencode')) continue
    const clipTextInput = inputRecord.text
    if (Array.isArray(clipTextInput)) {
      const srcId = parseComfyInputLink(clipTextInput)
      const srcNode = srcId ? (cloned[srcId] as Record<string, unknown> | undefined) : undefined
      if (srcNode) {
        const srcText = readComfyTextNodePromptValue(srcNode)
        const srcClass = String(srcNode.class_type || '')
        const canForce =
          forceClip && !forcedPositiveClipDone && !isClipNegativePromptText(srcText)
        if (
          (shouldReplaceWorkflowPromptText(srcText, srcClass) || canForce) &&
          !isClipNegativePromptText(srcText) &&
          (wanPositiveClipId == null || nodeId === wanPositiveClipId || canForce)
        ) {
          if (writeComfyTextNodePromptValue(srcNode, trimmed)) {
            injectedCount += 1
            if (canForce) forcedPositiveClipDone = true
          }
        }
      }
      continue
    }
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      if (rawKey !== 'text' || typeof rawValue !== 'string') continue
      if (isNegativeLikeKey(rawKey)) continue
      const oldValue = rawValue
      const canForce =
        forceClip && !forcedPositiveClipDone && !isClipNegativePromptText(oldValue)
      if (!shouldReplaceWorkflowPromptText(oldValue, classType) && !canForce) continue
      if (wanPositiveClipId && nodeId !== wanPositiveClipId && !canForce) continue
      inputRecord[rawKey] = trimmed
      injectedCount += 1
      if (canForce) forcedPositiveClipDone = true
    }
  }
  if (injectedCount > 0) return cloned
  return cloned
}

/** 工作流 JSON 是否含 `LoadAudio`（数字人 LTX 等），用于视频节点 @ 音频上传。 */
function workflowJsonHasLoadAudioNodes(workflowJsonText: string): boolean {
  return /"class_type"\s*:\s*"LoadAudio"/i.test(String(workflowJsonText || ''))
}

/** 工作流 JSON 是否含 `VHS_LoadVideo`（视频反推等），用于文本节点 @ 视频上传。 */
function workflowJsonHasVhsLoadVideoNodes(workflowJsonText: string): boolean {
  return /"class_type"\s*:\s*"VHS_LoadVideo"/i.test(String(workflowJsonText || ''))
}

function isComfyWorkflowVideoPlaceholder(value: string): boolean {
  const v = String(value || '').trim()
  return /__VIDEO__/i.test(v) || /__SRC__/i.test(v)
}

/**
 * 将 VHS_LoadVideo 里写死的模板文件名（如 `LTX2-pre_00001.mp4`）改为 `__VIDEO__`，
 * 避免本地覆盖/旧 Auth JSON 导致 Comfy 找不到视频。
 */
function normalizeWorkflowVhsLoadVideoInputsToPlaceholders(workflowJsonText: string): string {
  const raw = String(workflowJsonText || '').trim()
  if (!raw || !workflowJsonHasVhsLoadVideoNodes(raw)) return raw
  try {
    const prompt = JSON.parse(raw) as Record<string, unknown>
    let changed = false
    for (const node of Object.values(prompt)) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue
      const rec = node as Record<string, unknown>
      if (String(rec.class_type || '') !== 'VHS_LoadVideo') continue
      const inputs = rec.inputs
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
      const inp = inputs as Record<string, unknown>
      const val = inp.video
      if (Array.isArray(val) && val.length >= 2) continue
      if (typeof val !== 'string') continue
      const v = val.trim()
      if (!v || isComfyWorkflowVideoPlaceholder(v)) continue
      inp.video = '__VIDEO__'
      changed = true
    }
    return changed ? JSON.stringify(prompt) : raw
  } catch {
    return raw
  }
}

function isComfyWorkflowImagePlaceholder(value: string): boolean {
  const v = String(value || '').trim()
  return /__SRC__/i.test(v) || /__REF_IMAGE/i.test(v)
}

/**
 * 将 LoadImage 里写死的模板文件名（如 `图片节点1-2026-….png`）改为 `__SRC__`，避免本地覆盖/旧 Auth JSON 导致 Comfy 找不到图。
 */
function normalizeWorkflowLoadImageInputsToPlaceholders(workflowJsonText: string): string {
  const raw = String(workflowJsonText || '').trim()
  if (!raw || !/"class_type"\s*:\s*"LoadImage"/i.test(raw)) return raw
  try {
    const prompt = JSON.parse(raw) as Record<string, unknown>
    let changed = false
    for (const node of Object.values(prompt)) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue
      const rec = node as Record<string, unknown>
      if (!isComfyFileLoadImageNodeClass(String(rec.class_type || ''))) continue
      const inputs = rec.inputs
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
      const inp = inputs as Record<string, unknown>
      for (const key of Object.keys(inp)) {
        if (!/^image\d*$/iu.test(key)) continue
        const val = inp[key]
        if (Array.isArray(val) && val.length >= 2) continue
        if (typeof val !== 'string') continue
        const v = val.trim()
        if (!v || isComfyWorkflowImagePlaceholder(v)) continue
        inp[key] = '__SRC__'
        changed = true
      }
    }
    return changed ? JSON.stringify(prompt) : raw
  } catch {
    return raw
  }
}

/**
 * 有实际上传图时，强制写入主链路 LoadImage（覆盖模板残留名）。
 * 仅用于「单图」工作流；多图（首尾帧 @ 两张）须由 `injectVisualImageFallback` 按池序分发，不可全写主图。
 */
function forcePrimaryImageOnLinkedLoadImages(
  prompt: Record<string, unknown>,
  primaryFilename: string,
): Record<string, unknown> {
  const fn = String(primaryFilename || '').trim()
  if (!fn || !isComfyUploadedImageFile({ filename: fn, subfolder: '', type: 'input' })) return prompt
  const linked = collectLinkedLoadImageNodeIds(prompt)
  const targetIds =
    linked.size > 0
      ? [...linked]
      : Object.entries(prompt)
          .filter(([, n]) => {
            if (!n || typeof n !== 'object' || Array.isArray(n)) return false
            return isComfyFileLoadImageNodeClass(String((n as Record<string, unknown>).class_type || ''))
          })
          .map(([id]) => id)
  if (!targetIds.length) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  for (const nodeId of targetIds) {
    const node = cloned[nodeId]
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const inp = (node as Record<string, unknown>).inputs as Record<string, unknown>
    if (!inp || typeof inp !== 'object') continue
    for (const key of Object.keys(inp)) {
      if (!/^image\d*$/iu.test(key)) continue
      const val = inp[key]
      if (Array.isArray(val) && val.length >= 2) continue
      if (typeof val === 'string') inp[key] = fn
    }
  }
  return cloned
}

/**
 * 与 ComfyUI-PromptRelay 一致：local_prompts 以 ` | ` 分段。
 */
function countLtxLocalPromptSegments(localText: string): number {
  const t = String(localText || '').trim()
  if (!t) return 0
  const parts = t.split(/\s*\|\s*/u).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts.length : 1
}

/**
 * 将 segment_lengths 数量对齐到 local 段数（模板常为 7 段，用户 @ 剧本可能只有 4 段）。
 */
function normalizeLtxSegmentLengthsString(rawLengths: string, segmentCount: number): string {
  const n = Math.max(0, Math.floor(segmentCount))
  if (n <= 0) return String(rawLengths || '').trim()
  const nums = String(rawLengths || '')
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0)
  if (nums.length === n) return nums.join(',')
  if (nums.length > n) return nums.slice(0, n).join(',')
  const out = [...nums]
  const fallback = nums[nums.length - 1] ?? 150
  while (out.length < n) out.push(fallback)
  return out.join(',')
}

/**
 * 多段 local 文案统一为 ` | ` 分隔（PromptRelay 要求；避免仅用空行导致段数与 segment_lengths 不一致）。
 */
function normalizeLtxLocalPromptText(text: string): string {
  const t = String(text || '').trim()
  if (!t) return t
  if (/\|/u.test(t)) return t
  const blocks = t.split(/\n{2,}/u).map((s) => s.trim()).filter(Boolean)
  if (blocks.length > 1) return blocks.join(' | ')
  return t
}

/**
 * LTX 数字人：`PromptRelayEncode` 的 global/local 多行文本写入节点 81/61（`__PROMPT2__`→画面，`__PROMPT3__`→分段）。
 */
function injectLtxPromptRelayMultilineTexts(
  prompt: Record<string, unknown>,
  nodeInputs: NodeInputRecord,
): Record<string, unknown> {
  let relayId: string | null = null
  for (const [id, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (String((raw as Record<string, unknown>).class_type || '') === 'PromptRelayEncode') {
      relayId = id
      break
    }
  }
  if (!relayId) return prompt

  const relayInputs = (prompt[relayId] as Record<string, unknown>).inputs as Record<string, unknown>
  const readLinkId = (link: unknown): string => {
    if (!Array.isArray(link) || link.length < 1) return ''
    return String(link[0] ?? '').trim()
  }
  const globalNodeId = readLinkId(relayInputs.global_prompt)
  const localNodeId = readLinkId(relayInputs.local_prompts)

  const globalText = String((nodeInputs as { prompt2?: string }).prompt2 ?? '').trim()
  const localText = String((nodeInputs as { prompt3?: string }).prompt3 ?? '').trim()
  const fallbackPrompt = String(nodeInputs.prompt ?? '').trim()
  const resolvedGlobal = globalText || fallbackPrompt
  let resolvedLocal = localText
  if (!resolvedLocal && fallbackPrompt.includes('|')) {
    resolvedLocal = fallbackPrompt
  }
  resolvedLocal = normalizeLtxLocalPromptText(resolvedLocal)

  const cloned = structuredClone(prompt) as Record<string, unknown>
  const writeMultiline = (nodeId: string, text: string) => {
    if (!nodeId || !text) return
    const node = cloned[nodeId]
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const rec = node as Record<string, unknown>
    if (String(rec.class_type || '') !== 'Text Multiline') return
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return
    ;(inputs as Record<string, unknown>).text = text
  }
  writeMultiline(globalNodeId, resolvedGlobal)
  writeMultiline(localNodeId, resolvedLocal)

  const segCount = countLtxLocalPromptSegments(resolvedLocal)
  if (segCount > 0) {
    const relayNode = cloned[relayId] as Record<string, unknown>
    const relayInp = relayNode.inputs as Record<string, unknown>
    const rawLen = String(relayInp.segment_lengths ?? '').trim()
    if (rawLen) {
      relayInp.segment_lengths = normalizeLtxSegmentLengthsString(rawLen, segCount)
    }
  }
  return cloned
}

/**
 * 是否为应写入「已上传到 input 目录的文件名」的读图类节点。
 * 排除类名含 `loadimage` 子串但并非磁盘读图的节点（如 LoadImageMask），避免误改 inputs 触发 `/prompt` 400。
 */
function isComfyFileLoadImageNodeClass(classType: string): boolean {
  const raw = String(classType || '').trim()
  if (!raw) return false
  const compact = raw.toLowerCase().replace(/[\s_-]/g, '')
  /**
   * WAS / dzNodes「Load Image Advanced」等：API 常为 `class_type: ImageLoader`（compact=`imageloader`），
   * 不含子串 `loadimage`。若不识别，会落入通用 `image` 字段注入逻辑且始终用主图文件名，
   * 导致「首尾帧」等多图工作流两张槽都被写成首帧。
   */
  if (compact === 'imageloader') return true
  if (!compact.includes('loadimage')) return false
  if (compact.includes('mask')) return false
  return true
}

/**
 * 统计工作流内可接收图片文件名的 LoadImage 槽位总数（image/image1/image2...）。
 */
function countComfyFileLoadImageSlots(prompt: Record<string, unknown>): number {
  let slots = 0
  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    if (!isComfyFileLoadImageNodeClass(classType)) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    const localSlots = Object.keys(inputRecord).filter((k) => /^image\d*$/iu.test(k)).length
    // 兼容少数字段命名为 filename 的 LoadImage 变体
    if (localSlots > 0) {
      slots += localSlots
    } else if ('filename' in inputRecord) {
      slots += 1
    }
  }
  return slots
}

/**
 * 提取当前 prompt 中 LoadImage 节点的图片槽位写入结果，供执行前 UI 提示。
 */
function summarizeLoadImageSlotsForUi(prompt: Record<string, unknown>): string[] {
  const rows: string[] = []
  for (const [nodeId, node] of Object.entries(prompt)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    if (!isComfyFileLoadImageNodeClass(classType)) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    const slotPairs = Object.keys(inputRecord)
      .filter((k) => /^image\d*$/iu.test(k))
      .map((k) => `${k}=${String(inputRecord[k] ?? '').trim() || '（空）'}`)
    if (!slotPairs.length && 'filename' in inputRecord) {
      slotPairs.push(`filename=${String(inputRecord.filename ?? '').trim() || '（空）'}`)
    }
    if (!slotPairs.length) continue
    rows.push(`#${nodeId}: ${slotPairs.join(', ')}`)
  }
  return rows
}

/**
 * 提取最终 prompt 中 LoadImage 槽位里实际写入的文件名（用于提交前一致性校验）。
 */
function collectLoadImageAssignedFilenames(prompt: Record<string, unknown>): string[] {
  const names: string[] = []
  for (const node of Object.values(prompt)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    if (!isComfyFileLoadImageNodeClass(classType)) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    for (const key of Object.keys(inputRecord)) {
      if (!/^image\d*$/iu.test(key) && key !== 'filename') continue
      const value = inputRecord[key]
      if (typeof value !== 'string') continue
      const t = value.trim()
      if (!t) continue
      names.push(t)
    }
  }
  return names
}

/**
 * 计算“接入主生成链路”的 LoadImage 节点集合。
 */
function collectLinkedLoadImageNodeIds(prompt: Record<string, unknown>): Set<string> {
  const upstreamByNode = new Map<string, Set<string>>()
  const loadImageNodeIds = new Set<string>()
  const outputLikeNodeIds = new Set<string>()
  for (const [nodeId, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    const classLower = classType.toLowerCase()
    if (isComfyFileLoadImageNodeClass(classType)) {
      loadImageNodeIds.add(nodeId)
    }
    if (
      classLower.includes('save') ||
      classLower.includes('output') ||
      classLower.includes('preview') ||
      classLower.includes('viewer') ||
      classLower.includes('display')
    ) {
      outputLikeNodeIds.add(nodeId)
    }
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const parents = new Set<string>()
    for (const value of Object.values(inputs as Record<string, unknown>)) {
      if (!isComfyTensorLinkValue(value)) continue
      const fromNodeId = String(value[0] ?? '').trim()
      if (fromNodeId) parents.add(fromNodeId)
    }
    if (parents.size > 0) {
      upstreamByNode.set(nodeId, parents)
    }
  }
  if (!loadImageNodeIds.size || !outputLikeNodeIds.size) return new Set()
  const reachable = new Set<string>()
  const queue = Array.from(outputLikeNodeIds)
  while (queue.length > 0) {
    const current = queue.pop() as string
    if (reachable.has(current)) continue
    reachable.add(current)
    const parents = upstreamByNode.get(current)
    if (!parents) continue
    parents.forEach((p) => {
      if (!reachable.has(p)) queue.push(p)
    })
  }
  return new Set(Array.from(loadImageNodeIds).filter((nodeId) => reachable.has(nodeId)))
}

/**
 * 找出未接入主生成链路的 LoadImage 节点（常见于模板残留占位图）。
 * 规则：从输出类节点（save/output/preview/viewer/display）向上游回溯，
 * 未被回溯命中的 LoadImage 视为“未接入主链路”。
 */
function collectUnlinkedLoadImageNodeHints(prompt: Record<string, unknown>): string[] {
  const loadImageMeta = new Map<string, string>()
  const linkedLoadImageIds = collectLinkedLoadImageNodeIds(prompt)
  for (const [nodeId, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    if (isComfyFileLoadImageNodeClass(classType)) {
      loadImageMeta.set(nodeId, classType || 'LoadImage')
    }
  }
  if (!loadImageMeta.size) return []
  const unlinked = Array.from(loadImageMeta.entries())
    .filter(([nodeId]) => !linkedLoadImageIds.has(nodeId))
    .map(([nodeId, classType]) => `#${nodeId}(${classType})`)
  return unlinked
}

/**
 * 图片/视频节点兜底：当工作流未使用 __SRC__/__REF_IMAGES__ 占位符时，
 * 将已上传到 Comfy 的参考图（含 subfolder/type）注入常见图片输入字段。
 */
function injectVisualImageFallback(
  prompt: Record<string, unknown>,
  uploads: ComfyUploadedInputImage[],
  options?: {
    primaryFilename?: string
    refFilenames?: string[]
    linkedLoadImageNodeIds?: Set<string>
  },
): Record<string, unknown> {
  if (!uploads.length) return prompt
  const normalized = uploads
    .map((u) => ({
      filename: u.filename.trim(),
      subfolder: (u.subfolder || '').trim(),
      type: (u.type || 'input').trim() || 'input',
    }))
    .filter((u) => u.filename)
  if (!normalized.length) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const imagePool = normalized.filter((u) => isComfyUploadedImageFile(u))
  if (!imagePool.length) return prompt
  const uploadedNameSet = new Set(imagePool.map((u) => u.filename.trim()).filter(Boolean))
  const primaryFilename = String(options?.primaryFilename || imagePool[0]?.filename || '').trim()
  const refFilenames = (options?.refFilenames ?? [])
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  const exactPrimaryKeys = new Set([
    'image',
    'filename',
    'input_image',
    'source_image',
    'src_image',
    'init_image',
    'reference_image',
    'ref_image',
  ])
  const numberedRefKeyPattern = /^(ref|reference|input|image|img)[_\- ]?(image|img)?[_\- ]?(\d+)$/i
  const imageLikeExtPattern = /\.(png|jpe?g)$/i
  let poolIndex = 0

  type PoolItem = (typeof imagePool)[number]
  const consumeImage = (): PoolItem | null => {
    if (!imagePool.length) return null
    if (poolIndex >= imagePool.length) {
      return imagePool[imagePool.length - 1]!
    }
    const value = imagePool[poolIndex]!
    poolIndex += 1
    return value
  }
  /**
   * 根据文件名从上传池中构造可写入项（仅保留 filename；subfolder/type 由 Comfy 默认 input 处理）。
   */
  const poolItemFromFilename = (filename: string): PoolItem | null => {
    const normalized = String(filename || '').trim()
    if (!normalized) return null
    return { filename: normalized, subfolder: '', type: 'input' }
  }

  const pickFilenameForKey = (lowerKey: string): string | null => {
    if (primaryFilename && /^(image|input_image|source_image|src_image|init_image|filename)$/i.test(lowerKey)) {
      return primaryFilename
    }
    // ref1/ref_1/reference1/img2/image2 => 优先第 1 张参考图（n=1）。
    const m = lowerKey.match(/(?:ref|reference|img|image)[_\- ]*(?:image|img)?[_\- ]*(\d+)/i)
    if (m?.[1]) {
      const idx = Number.parseInt(m[1], 10)
      if (Number.isFinite(idx) && idx > 0) {
        if (lowerKey.includes('ref') || lowerKey.includes('reference')) {
          return refFilenames[idx - 1] ?? refFilenames[refFilenames.length - 1] ?? null
        }
        // image1 通常是主图；image2 开始映射参考图。
        if (idx === 1) return primaryFilename || refFilenames[0] || null
        return refFilenames[idx - 2] ?? refFilenames[refFilenames.length - 1] ?? null
      }
    }
    if (lowerKey.includes('ref') || lowerKey.includes('reference')) {
      return refFilenames[0] ?? null
    }
    return null
  }

  const isLikelyImageFilename = (raw: string): boolean => {
    const v = raw.trim()
    if (!v) return false
    return imageLikeExtPattern.test(v)
  }

  const isComfyTensorLink = (value: unknown): value is [unknown, unknown] => {
    if (!Array.isArray(value) || value.length < 2) return false
    const a = value[0]
    const b = value[1]
    const isLinkableId =
      typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a.trim()))
    const isSlot =
      typeof b === 'number' ||
      (typeof b === 'string' && /^\d+$/.test(b)) ||
      b === null ||
      b === undefined ||
      b === ''
    return isLinkableId && isSlot
  }

  const isExcludedGenericImageKey = (lower: string): boolean => {
    if (
      lower.includes('prefix') ||
      lower.includes('directory') ||
      lower.includes('folder') ||
      lower.includes('seed') ||
      lower.includes('steps') ||
      lower.includes('cfg') ||
      lower.includes('sampler') ||
      lower.includes('scheduler') ||
      lower.includes('denoise') ||
      lower.includes('prompt') ||
      lower.includes('caption') ||
      lower.includes('description')
    ) {
      return true
    }
    // 避免把纯文本字段当成图片路径误注入。
    if (lower === 'text' || lower === 'string' || lower === 'note' || lower === 'body') return true
    return false
  }

  const nodeSlotDebugRows: Array<{
    节点id: string
    class_type: string
    槽位写入: Record<string, string>
  }> = []
  for (const [nodeId, node] of Object.entries(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const rawClassType = String(nodeRecord.class_type || '')
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    const touchedKeys = new Set<string>()
    // 对 LoadImage 类节点：`image` / `image1` 等槽位写入「纯文件名」字符串（与 Comfy 内 exists_annotated_filepath / endswith 校验一致）。
    if (isComfyFileLoadImageNodeClass(rawClassType)) {
      const linkedSet = options?.linkedLoadImageNodeIds
      if (linkedSet && linkedSet.size > 0 && !linkedSet.has(nodeId)) {
        continue
      }
      let firstAssigned: PoolItem | null = null
      const assignedInThisNode: Record<string, string> = {}
      for (const slotKey of Object.keys(inputRecord)) {
        if (!/^image\d*$/iu.test(slotKey)) continue
        const slotVal = inputRecord[slotKey]
        if (!(isComfyTensorLink(slotVal) || typeof slotVal === 'string' || Array.isArray(slotVal))) {
          continue
        }
        const lowerSlotKey = slotKey.toLowerCase()
        const hasExplicitIndex = /\d+$/u.test(lowerSlotKey)
        // 对单槽位 `image`：按全局输入池顺序分发，避免多个 LoadImage 都被“主图优先”覆盖成同一张。
        const preferred = hasExplicitIndex ? pickFilenameForKey(lowerSlotKey) : null
        const picked =
          (preferred ? poolItemFromFilename(preferred) : null) ||
          consumeImage()
        if (!picked) {
          const existing =
            typeof inputRecord[slotKey] === 'string' ? String(inputRecord[slotKey]).trim() : ''
          // 有本次上传图时：模板里历史 png 名（未实际上传）必须覆盖，不能「保留」导致 Comfy 找不到文件。
          const keepExisting =
            existing &&
            isLikelyImageFilename(existing) &&
            !(
              imagePool.length > 0 &&
              (existing.includes('__SRC__') ||
                existing.includes('__REF_IMAGE__') ||
                !uploadedNameSet.has(existing))
            )
          if (keepExisting) {
            assignedInThisNode[slotKey] = `（保留 ${existing}）`
            continue
          }
          const fallbackPick =
            consumeImage() ||
            (primaryFilename ? poolItemFromFilename(primaryFilename) : null)
          if (fallbackPick) {
            inputRecord[slotKey] = fallbackPick.filename
            touchedKeys.add(slotKey)
            assignedInThisNode[slotKey] = fallbackPick.filename
            if (!firstAssigned) firstAssigned = fallbackPick
          } else {
            // 无可用输入图时清空槽位，避免继续沿用模板中的历史文件名。
            inputRecord[slotKey] = ''
            touchedKeys.add(slotKey)
            assignedInThisNode[slotKey] = '（已清空）'
          }
        } else {
          inputRecord[slotKey] = picked.filename
          touchedKeys.add(slotKey)
          assignedInThisNode[slotKey] = picked.filename
          if (!firstAssigned) firstAssigned = picked
        }
      }
      if (typeof inputRecord.filename === 'string' && firstAssigned) {
        inputRecord.filename = firstAssigned.filename
        touchedKeys.add('filename')
        assignedInThisNode.filename = firstAssigned.filename
      }
      if (Object.keys(assignedInThisNode).length > 0) {
        nodeSlotDebugRows.push({
          节点id: nodeId,
          class_type: rawClassType || '（空）',
          槽位写入: assignedInThisNode,
        })
      }
    }
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      const key = String(rawKey)
      if (touchedKeys.has(key)) continue
      const lower = key.toLowerCase()
      const isExcludedKey = isExcludedGenericImageKey(lower)
      const looksLikeImageField =
        exactPrimaryKeys.has(lower) ||
        (lower.includes('image') && !lower.includes('save') && !lower.includes('output')) ||
        (lower.includes('img') && !lower.includes('save') && !lower.includes('output')) ||
        (!isExcludedKey &&
          (lower.includes('path') ||
            lower.includes('file') ||
            lower.includes('url') ||
            lower.includes('src') ||
            lower.includes('input')))
      if (!looksLikeImageField) continue

      if (Array.isArray(rawValue)) {
        // ComfyUI 连线引用：[upstreamNodeId, outputSlot]
        if (isComfyTensorLink(rawValue)) {
          continue
        }
        const arr = rawValue as unknown[]
        const first = typeof arr[0] === 'string' ? arr[0].trim() : ''
        const canReplaceArray =
          !first ||
          isLikelyImageFilename(first) ||
          first.includes('__SRC__') ||
          first.includes('__REF_IMAGE__')
        if (!canReplaceArray) continue
        const preferred = pickFilenameForKey(lower)
        const next = preferred ? { filename: preferred, subfolder: '', type: 'input' } : consumeImage()
        if (!next) continue
        // 仅标准 LoadImage 的 `image` 用三元组；image1 等自定义端口多为「路径字符串」校验，列表会触发 400
        inputRecord[key] = next.filename
        touchedKeys.add(key)
        continue
      }

      if (typeof rawValue !== 'string') continue
      const oldValue = rawValue.trim()
      const canReplace =
        !oldValue ||
        imageLikeExtPattern.test(oldValue) ||
        oldValue.includes('__SRC__') ||
        oldValue.includes('__REF_IMAGE__')
      if (!canReplace) continue
      if (numberedRefKeyPattern.test(lower) && imagePool.length > 0) {
        const preferred = pickFilenameForKey(lower)
        const ref = preferred ? { filename: preferred, subfolder: '', type: 'input' } : consumeImage()
        if (ref) {
          inputRecord[key] = ref.filename
          touchedKeys.add(key)
        }
        continue
      }
      const preferred = pickFilenameForKey(lower)
      const next = preferred ? { filename: preferred, subfolder: '', type: 'input' } : consumeImage()
      if (next) {
        inputRecord[key] = next.filename
        touchedKeys.add(key)
      }
    }

    // 二次兜底：有些自定义节点字段名不含 image/img，但值本身就是 png/jpg 文件名。
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      const key = String(rawKey)
      if (touchedKeys.has(key)) continue
      const lower = key.toLowerCase()
      if (isExcludedGenericImageKey(lower)) continue
      if (Array.isArray(rawValue)) {
        if (isComfyTensorLink(rawValue)) {
          continue
        }
        const arr = rawValue as unknown[]
        const first = typeof arr[0] === 'string' ? arr[0].trim() : ''
        if (!isLikelyImageFilename(first)) continue
        const canReplaceArray =
          !first ||
          isLikelyImageFilename(first) ||
          first.includes('__SRC__') ||
          first.includes('__REF_IMAGE__')
        if (!canReplaceArray) continue
        const next = consumeImage()
        if (!next) continue
        inputRecord[key] = next.filename
        touchedKeys.add(key)
        continue
      }
      if (typeof rawValue !== 'string') continue
      const oldValue = rawValue.trim()
      if (!isLikelyImageFilename(oldValue)) continue
      const canReplace =
        !oldValue ||
        imageLikeExtPattern.test(oldValue) ||
        oldValue.includes('__SRC__') ||
        oldValue.includes('__REF_IMAGE__')
      if (!canReplace) continue
      const preferred = pickFilenameForKey(lower)
      const next = preferred ? { filename: preferred, subfolder: '', type: 'input' } : consumeImage()
      if (next) {
        inputRecord[key] = next.filename
        touchedKeys.add(key)
      }
    }
  }
  if (import.meta.env.DEV && nodeSlotDebugRows.length > 0) {
    console.info('[Flowid Diagnose] LoadImage 槽位写入明细', nodeSlotDebugRows)
  }
  return cloned
}

/**
 * 修复 ComfyUI API prompt 中常见的连线引用形态问题：
 * - `[nodeId,]` / `[nodeId, null]` / `[nodeId, ""]` 等缺省输出槽位时，默认补齐为 0
 *
 * 说明：ComfyUI 的连线引用通常是 `[upstreamNodeId, outputIndex]`，不是 LoadImage 的文件名数组。
 */
function repairComfyWorkflowTensorLinks(prompt: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const isLinkableId = (value: unknown): boolean =>
    typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))

  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      if (!Array.isArray(rawValue) || rawValue.length < 2) continue
      const upstream = rawValue[0]
      const slot = rawValue[1]
      if (!isLinkableId(upstream)) continue
      const slotMissing =
        slot === null ||
        slot === undefined ||
        (typeof slot === 'string' && slot.trim() === '')
      if (!slotMissing) continue
      inputRecord[rawKey] = [upstream, 0, ...rawValue.slice(2)]
    }
  }
  return cloned
}

type VaeLinkSource = { nodeId: string; outputSlot: number; kind: 'vae_loader' | 'checkpoint' }

/**
 * 为 VAEDecode / VAEEncode* 等节点补上缺失或无效的 `vae` 张量连线。
 * 部分从画布导出的 API JSON 会丢 `vae` 口，Comfy 报 required_input_missing；若图中已有 VAELoader / CheckpointLoaderSimple，则自动接到其 VAE 输出。
 */
function injectMissingVaeInputLinks(prompt: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const nodeEntries = Object.entries(cloned).filter(
    ([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v),
  ) as Array<[string, Record<string, unknown>]>

  const sources: VaeLinkSource[] = []
  for (const [id, node] of nodeEntries) {
    const ct = String(node.class_type || '').trim()
    if (ct === 'VAELoader') {
      sources.push({ nodeId: id, outputSlot: 0, kind: 'vae_loader' })
      continue
    }
    if (ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader') {
      // 标准 CheckpointLoader：0=MODEL, 1=CLIP, 2=VAE
      sources.push({ nodeId: id, outputSlot: 2, kind: 'checkpoint' })
    }
  }
  const chosen =
    sources.find((item) => item.kind === 'vae_loader') ?? (sources.length ? sources[0]! : null)
  if (!chosen) return cloned

  const needsVaeInput = (classType: string): boolean => {
    const c = classType.trim()
    return (
      c === 'VAEDecode' ||
      c === 'VAEDecodeTiled' ||
      c === 'VAEEncode' ||
      c === 'VAEEncodeForInpaint' ||
      c === 'VAEEncodeTiled' ||
      c === 'VAEEncodeArgMax'
    )
  }

  const isUsableVaeLink = (value: unknown): boolean => {
    if (!isComfyTensorLinkValue(value)) return false
    const arr = value as unknown[]
    const up = arr[0]
    const slot = arr[1]
    const idOk =
      typeof up === 'number' ||
      (typeof up === 'string' && up.trim() !== '' && /^\d+$/.test(up.trim()))
    const slotOk =
      typeof slot === 'number' ||
      (typeof slot === 'string' && slot.trim() !== '' && /^\d+$/.test(slot.trim()))
    return idOk && slotOk
  }

  for (const [, node] of nodeEntries) {
    const ct = String(node.class_type || '')
    if (!needsVaeInput(ct)) continue
    const inputs = node.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    if (isUsableVaeLink(inputRecord.vae)) continue
    inputRecord.vae = [chosen.nodeId, chosen.outputSlot]
  }
  return cloned
}

/**
 * 从 tensor 连线形态中提取上游节点 id（兼容 number / "4" 两种形态）。
 */
function readTensorUpstreamIdFromLink(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1) return null
  const raw = value[0]
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d+$/.test(trimmed)) return trimmed
  }
  return null
}

/**
 * 判断是否为 ComfyUI API 中的 tensor 连线引用：`[upstreamNodeId, outputSlot]`。
 */
function isComfyTensorLinkValue(value: unknown): value is [unknown, unknown] {
  if (!Array.isArray(value) || value.length < 2) return false
  const a = value[0]
  const b = value[1]
  const idOk = typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a.trim()))
  const slotOk =
    typeof b === 'number' ||
    (typeof b === 'string' && /^\d+$/.test(b.trim())) ||
    b === null ||
    b === undefined ||
    (typeof b === 'string' && b.trim() === '')
  return idOk && slotOk
}

/** 查找 `WanFirstLastFrameToVideo` 节点 id。 */
function findWanFirstLastFrameNodeId(prompt: Record<string, unknown>): string | null {
  for (const [nodeId, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (/WanFirstLastFrameToVideo/i.test(String((raw as Record<string, unknown>).class_type || ''))) {
      return nodeId
    }
  }
  return null
}

/** 沿 tensor 上游 BFS，找到首个读图类节点（LoadImage / ImageLoader 等）。 */
function findUpstreamComfyImageLoaderNodeId(
  prompt: Record<string, unknown>,
  startNodeId: string,
): string | null {
  const visited = new Set<string>()
  const queue = [String(startNodeId || '').trim()].filter(Boolean)
  while (queue.length) {
    const curr = queue.shift()!
    if (visited.has(curr)) continue
    visited.add(curr)
    const node = prompt[curr]
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const classType = String((node as Record<string, unknown>).class_type || '')
    if (isComfyFileLoadImageNodeClass(classType)) return curr
    const inputs = (node as Record<string, unknown>).inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    for (const value of Object.values(inputs as Record<string, unknown>)) {
      if (!isComfyTensorLinkValue(value)) continue
      const up = readTensorUpstreamIdFromLink(value)
      if (up && !visited.has(up)) queue.push(up)
    }
  }
  return null
}

/** 向指定读图节点写入 Comfy input 目录中的文件名（跳过仍为 tensor 连线的槽位）。 */
function writeComfyImageLoaderNodeFilename(
  prompt: Record<string, unknown>,
  loaderNodeId: string,
  filename: string,
): void {
  const fn = String(filename || '').trim()
  if (!fn) return
  const node = prompt[loaderNodeId]
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const inputRecord = (node as Record<string, unknown>).inputs as Record<string, unknown>
  if (!inputRecord || typeof inputRecord !== 'object') return
  for (const key of Object.keys(inputRecord)) {
    if (!/^image\d*$/iu.test(key) && key !== 'filename') continue
    const slotVal = inputRecord[key]
    if (isComfyTensorLinkValue(slotVal)) continue
    if (typeof slotVal === 'string') inputRecord[key] = fn
  }
}

/**
 * Wan 首尾帧：按 `start_image` / `end_image` 链路分别写入首帧、尾帧文件名。
 * 上传顺序与面板 @ 顺序一致：第 1 张 → 首帧，第 2 张 → 尾帧。
 */
function injectWanFirstLastFrameImageLoaderFilenames(
  prompt: Record<string, unknown>,
  uploads: ComfyUploadedInputImage[],
): Record<string, unknown> {
  const pool = uploads.filter((u) => isComfyUploadedImageFile(u) && String(u.filename || '').trim())
  if (pool.length < 2) return prompt
  const wanId = findWanFirstLastFrameNodeId(prompt)
  if (!wanId) return prompt
  const wanNode = prompt[wanId] as Record<string, unknown>
  const wanInputs = wanNode.inputs as Record<string, unknown> | undefined
  if (!wanInputs) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const assign = (linkKey: 'start_image' | 'end_image', upload: ComfyUploadedInputImage) => {
    const link = wanInputs[linkKey]
    const root = readTensorUpstreamIdFromLink(link)
    if (!root) return
    const loaderId = findUpstreamComfyImageLoaderNodeId(cloned, root)
    if (!loaderId) return
    writeComfyImageLoaderNodeFilename(cloned, loaderId, upload.filename)
  }
  assign('start_image', pool[0]!)
  assign('end_image', pool[1]!)
  return cloned
}

/**
 * 将已上传到 Comfy input 的图片文件名，沿 tensor 连线向上游同步到 `LoadImage` 节点。
 *
 * 背景：很多工作流（尤其带后处理节点）不会把 `LoadImage` 放在当前节点的 inputs 字符串里，
 * 而是用 `[upstreamNodeId, outputSlot]` 连接；此时必须更新上游 `LoadImage` 的 `inputs.image`。
 */
function propagateComfyFilenameToLinkedLoadImages(
  prompt: Record<string, unknown>,
  uploaded: ComfyUploadedInputImage | null,
): Record<string, unknown> {
  if (!uploaded?.filename?.trim()) return prompt
  const trimmed = uploaded.filename.trim()
  const cloned = structuredClone(prompt) as Record<string, unknown>

  const isTensorLink = (value: unknown): value is [unknown, unknown] => isComfyTensorLinkValue(value)

  const readUpstreamId = (link: [unknown, unknown]): string | null =>
    readTensorUpstreamIdFromLink(link)

  const tryWriteLoadImageFilename = (nodeId: string): boolean => {
    const node = cloned[nodeId]
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const nodeRecord = node as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '')
    if (!isComfyFileLoadImageNodeClass(classType)) return false
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return false
    const inputRecord = inputs as Record<string, unknown>
    let wrote = false
    for (const slotKey of Object.keys(inputRecord)) {
      if (!/^image\d*$/iu.test(slotKey)) continue
      const slotVal = inputRecord[slotKey]
      // 有上传图时须覆盖「连线张量」：[id,0] 在部分 LoadImage 变体里会走 filepath 校验并报 endswith
      if (
        isComfyTensorLinkValue(slotVal) ||
        typeof slotVal === 'string' ||
        Array.isArray(slotVal)
      ) {
        inputRecord[slotKey] = trimmed
        wrote = true
      }
    }
    if (typeof inputRecord.filename === 'string') {
      inputRecord.filename = trimmed
      wrote = true
    }
    if (typeof inputRecord.file === 'string') {
      inputRecord.file = trimmed
      wrote = true
    }
    if (typeof inputRecord.path === 'string') {
      inputRecord.path = trimmed
      wrote = true
    }
    if (typeof inputRecord.filepath === 'string') {
      inputRecord.filepath = trimmed
      wrote = true
    }
    return wrote
  }

  const collectUpstreamLinksFromNode = (startId: string): string[] => {
    const queue: string[] = [startId]
    const visited = new Set<string>(queue)
    const upstreamIds: string[] = []
    while (queue.length) {
      const curr = queue.shift()!
      const node = cloned[curr]
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue
      const inputs = (node as Record<string, unknown>).inputs
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
      for (const value of Object.values(inputs as Record<string, unknown>)) {
        if (!isTensorLink(value)) continue
        const up = readUpstreamId(value)
        if (!up || visited.has(up)) continue
        visited.add(up)
        upstreamIds.push(up)
        queue.push(up)
      }
    }
    return upstreamIds
  }

  /**
   * 仅在“确实存在上传后的参考图文件名”时，才把读图节点文件名写入工作流。
   *
   * 重要：纯文生图工作流也可能包含默认 `LoadImage`（占位/风格参考），
   * 若在无参考图输入时全图替换，会把文生图链路误伤。
   */
  for (const nodeId of Object.keys(cloned)) {
    tryWriteLoadImageFilename(nodeId)
  }

  // 兼容兜底：仍尝试沿 tensor 上游再追一遍（对少数特殊节点命名有补充价值）。
  const roots = new Set<string>()
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const inputs = (node as Record<string, unknown>).inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    for (const [rawKey, rawValue] of Object.entries(inputs as Record<string, unknown>)) {
      const lower = String(rawKey).toLowerCase()
      if (!lower.includes('image') && lower !== 'img' && !lower.includes('imgs')) continue
      if (!isTensorLink(rawValue)) continue
      const up = readUpstreamId(rawValue as [unknown, unknown])
      if (up) roots.add(up)
    }
  }
  for (const rootId of roots) {
    const chain = collectUpstreamLinksFromNode(rootId)
    const ordered = [rootId, ...chain].reverse()
    for (const id of ordered) {
      tryWriteLoadImageFilename(id)
    }
  }

  return cloned
}

/** 将已上传的音频文件名写入工作流内所有 `LoadAudio` 节点（无 `__REF_AUDIO_n__` 占位时兜底）。 */
function propagateComfyFilenameToLoadAudioNodes(
  prompt: Record<string, unknown>,
  uploaded: ComfyUploadedInputImage | null,
): Record<string, unknown> {
  if (!uploaded?.filename?.trim()) return prompt
  const trimmed = uploaded.filename.trim()
  const cloned = structuredClone(prompt) as Record<string, unknown>
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    if (String(rec.class_type || '') !== 'LoadAudio') continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    if (typeof inp.audio === 'string' && !/^__REF_AUDIO_\d+__$/i.test(inp.audio.trim())) {
      inp.audio = trimmed
    } else if (typeof inp.audio === 'string') {
      inp.audio = trimmed
    }
  }
  return cloned
}

/** 将已上传的视频文件名写入工作流内所有 `VHS_LoadVideo` 节点（无 `__VIDEO__` 占位时兜底）。 */
function propagateComfyFilenameToVhsLoadVideoNodes(
  prompt: Record<string, unknown>,
  uploaded: ComfyUploadedInputImage | null,
): Record<string, unknown> {
  if (!uploaded?.filename?.trim()) return prompt
  const trimmed = uploaded.filename.trim()
  const cloned = structuredClone(prompt) as Record<string, unknown>
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    if (String(rec.class_type || '') !== 'VHS_LoadVideo') continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    if (typeof inp.video === 'string') {
      inp.video = trimmed
    }
  }
  return cloned
}

/**
 * 生成 Comfy 常用量级的随机 seed（安全整数内）。
 */
function randomComfyStyleSeed(): number {
  const u = new Uint32Array(2)
  crypto.getRandomValues(u)
  const n = (u[0] % 10_000_000) * 1_000_000_000 + (u[1] % 1_000_000_000)
  const cap = Number.MAX_SAFE_INTEGER
  return (n % cap) + 1
}

/**
 * 将 prompt 内 KSampler 系列节点的 `inputs.seed` 替换为随机值（提交 Comfy 前调用）。
 */
function randomizeKsamplerSeedsInPrompt(prompt: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    const classType = String(rec.class_type || '')
    const compact = classType.toLowerCase().replace(/[\s_-]/g, '')
    if (!compact.includes('ksampler')) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    if (!('seed' in inp)) continue
    const s = inp.seed
    if (typeof s === 'number' && Number.isFinite(s)) {
      inp.seed = randomComfyStyleSeed()
    } else if (typeof s === 'string' && /^\d+$/.test(s.trim())) {
      inp.seed = randomComfyStyleSeed()
    }
  }
  return cloned
}

/**
 * 根据节点类型提供更合理的最小等待时长（秒）。
 */
function getNodeTimeoutFloorSec(kind: StudioNodeKind): number {
  if (kind === 'video') return 1800
  if (kind === 'music' || kind === 'audio') return 900
  if (kind === 'image') return 480
  return 300
}

/**
 * 从 history 条目里提取 Comfy 校验类错误（如 output 被忽略），用于前端明确报错。
 */
function extractComfyValidationIssue(historyEntry: Record<string, unknown>): string | null {
  const status = historyEntry.status
  if (!status || typeof status !== 'object' || Array.isArray(status)) return null
  const messages = (status as Record<string, unknown>).messages
  if (!Array.isArray(messages)) return null
  for (const item of messages) {
    const raw = JSON.stringify(item ?? '').toLowerCase()
    if (
      raw.includes('failed to validate prompt') ||
      raw.includes('output will be ignored') ||
      raw.includes('validation') ||
      raw.includes('is_changed') ||
      raw.includes('unexpected keyword argument')
    ) {
      return 'Comfy 工作流校验未通过，输出节点被忽略（请检查节点参数与插件版本兼容性）'
    }
  }
  return null
}

/**
 * 从 Comfy history 条目中提取文本结果（优先 outputs，其次 ui）。
 */
function extractComfyResultText(historyEntry: Record<string, unknown>): string | null {
  const textCandidates: string[] = []
  const pushCandidate = (raw: string) => {
    const t = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!t) return
    // 过滤明显的“连线索引/占位”输出，避免把 ["3",0] 这类值误当正文。
    if (/^\[?\s*"?\d+"?\s*,\s*\d+\s*\]?$/.test(t)) return
    if (/^\d+$/.test(t)) return
    if (t.length <= 2) return
    textCandidates.push(t)
  }
  const walk = (value: unknown) => {
    if (value == null) return
    if (typeof value === 'string') {
      pushCandidate(value)
      return
    }
    if (Array.isArray(value)) {
      // 形如 ["3",0] 的连线索引数组：直接跳过。
      if (
        value.length === 2 &&
        typeof value[0] === 'string' &&
        /^\d+$/.test(value[0].trim()) &&
        typeof value[1] === 'number'
      ) {
        return
      }
      for (const item of value) walk(item)
      return
    }
    if (typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (Array.isArray(record.text)) {
      for (const item of record.text) walk(item)
    }
    if (Array.isArray(record.texts)) {
      for (const item of record.texts) walk(item)
    }
    for (const child of Object.values(record)) walk(child)
  }
  const outputs = (historyEntry.outputs ?? historyEntry.output) as unknown
  walk(outputs)
  if (!textCandidates.length) {
    walk(historyEntry.ui)
  }
  // 过滤掉尺寸类中间文本（如 "1371x765"）与纯符号串。
  const semantic = textCandidates.filter(
    (item) =>
      !/^\d+\s*[x×]\s*\d+$/i.test(item) &&
      !/^[[\]{}'",:;_\-+*/\\|]+$/.test(item),
  )
  if (!semantic.length) return null
  // 优先返回信息量更高的文本（长度较长、含中文/英文语义）。
  const uniq = Array.from(new Set(semantic)).sort((a, b) => b.length - a.length)
  return uniq.join('\n').trim() || null
}

/**
 * 按用户配置的节点 id + 字段路径，从 history 条目中提取文本。
 * 示例：nodeId=5, fieldPath=text.0（等价 outputs["5"].text[0]）。
 */
function extractComfyResultTextByMapping(args: {
  historyEntry: Record<string, unknown>
  nodeId?: string
  fieldPath?: string
}): string | null {
  const nodeId = String(args.nodeId || '').trim()
  const fieldPath = String(args.fieldPath || '').trim()
  if (!fieldPath) return null
  const outputsRaw = (args.historyEntry.outputs ?? args.historyEntry.output) as unknown
  if (!outputsRaw || typeof outputsRaw !== 'object' || Array.isArray(outputsRaw)) return null
  const outputs = outputsRaw as Record<string, unknown>
  const base = nodeId ? outputs[nodeId] : outputs
  if (!base || typeof base !== 'object' || Array.isArray(base)) return null
  const segs = fieldPath
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!segs.length) return null
  let curr: unknown = base
  for (const seg of segs) {
    if (curr == null) return null
    if (Array.isArray(curr)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= curr.length) return null
      curr = curr[idx]
      continue
    }
    if (typeof curr !== 'object') return null
    curr = (curr as Record<string, unknown>)[seg]
  }
  if (typeof curr === 'string') {
    const text = curr.trim()
    return text || null
  }
  if (Array.isArray(curr)) {
    const parts = curr
      .filter((item) => typeof item === 'string')
      .map((item) => String(item).trim())
      .filter(Boolean)
    return parts.length ? parts.join('\n') : null
  }
  return null
}

/**
 * 是否为“必须提供图片输入”的工作流（例如三视图/多视图/参考图驱动）。
 * 仅基于当前节点选择的工作流名称做判断，不做上游自动猜图注入。
 */
function requiresImageInputByWorkflowName(workflowName: string): boolean {
  const name = workflowName.trim().toLowerCase()
  if (!name) return false
  return (
    name.includes('三视图') ||
    name.includes('多视图') ||
    name.includes('参考图') ||
    name.includes('image2image') ||
    name.includes('img2img')
  )
}

/**
 * 工作流配置与执行入口（本地/云端统一）。
 */
export function useWorkflowIntegration() {
  const [snapshot, setSnapshot] = useState<WorkflowConfigSnapshot>(() =>
    loadWorkflowConfig(),
  )
  const [lastExecutionMessage, setLastExecutionMessage] = useState('')
  const [connectionTestMessage, setConnectionTestMessage] = useState('')
  const [officialTemplates, setOfficialTemplates] = useState<OfficialTemplateMeta[]>([])
  useEffect(() => {
    saveWorkflowConfig(snapshot)
  }, [snapshot])

  const updateExecutionProvider = useCallback((provider: WorkflowProviderType) => {
    setSnapshot((prev) => ({ ...prev, executionProvider: provider }))
  }, [])

  const updateExecutionMode = useCallback((mode: WorkflowExecutionMode) => {
    setSnapshot((prev) => ({ ...prev, executionMode: mode }))
  }, [])

  const setRandomizeKsamplerSeedsOnRun = useCallback((value: boolean) => {
    setSnapshot((prev) => ({ ...prev, randomizeKsamplerSeedsOnRun: value }))
  }, [])

  const updateProviderConfig = useCallback(
    (
      provider: WorkflowProviderType,
      patch: Partial<WorkflowProviderConfig>,
    ) => {
      setSnapshot((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], ...patch },
      }))
    },
    [],
  )

  /**
   * 新增云端 ComfyUI 地址配置。
   */
  const addCloudEndpoint = useCallback(() => {
    setSnapshot((prev) => ({
      ...prev,
      cloudEndpoints: [
        ...prev.cloudEndpoints,
        {
          id: crypto.randomUUID(),
          name: `云端-${prev.cloudEndpoints.length + 1}`,
          baseUrl: '',
          enabled: true,
        },
      ],
    }))
  }, [])

  /**
   * 更新某个云端 ComfyUI 地址配置。
   */
  const updateCloudEndpoint = useCallback(
    (
      endpointId: string,
      patch: Partial<{ name: string; baseUrl: string; enabled: boolean }>,
    ) => {
      setSnapshot((prev) => ({
        ...prev,
        cloudEndpoints: prev.cloudEndpoints.map((item) =>
          item.id === endpointId ? { ...item, ...patch } : item,
        ),
      }))
    },
    [],
  )

  const removeCloudEndpoint = useCallback((endpointId: string) => {
    setSnapshot((prev) => ({
      ...prev,
      cloudEndpoints:
        prev.cloudEndpoints.length <= 1
          ? prev.cloudEndpoints
          : prev.cloudEndpoints.filter((item) => item.id !== endpointId),
    }))
  }, [])

  /**
   * 更新某一类节点的工作流配置。
   */
  const updateNodeConfig = useCallback(
    (kind: StudioNodeKind, patch: Partial<NodeWorkflowConfig>) => {
      setSnapshot((prev) => {
        const safePatch =
          prev.executionMode === 'official'
            ? {
                ...patch,
                workflowJsonText: undefined,
                workflowName: undefined,
                workflows: undefined,
                selectedWorkflowId: undefined,
                settingsEditTarget: undefined,
                cloudSettingsSelectedWorkflowId: undefined,
                cloudWorkflowOverrides: undefined,
                cloudWorkflowSystemPrompts: undefined,
              }
            : patch
        return {
          ...prev,
          nodeConfigs: {
            ...prev.nodeConfigs,
            [kind]: {
              ...prev.nodeConfigs[kind],
              ...safePatch,
            },
          },
        }
      })
    },
    [],
  )

  /**
   * 将当前编辑区 JSON 保存为某一类型的工作流条目。
   */
  const saveNodeWorkflow = useCallback(
    (kind: StudioNodeKind, name: string) => {
      const safeName = name.trim() || `${kind}-workflow-${Date.now()}`
      setSnapshot((prev) => {
        const curr = prev.nodeConfigs[kind]
        const jsonText = curr.workflowJsonText.trim()
        if (!jsonText) return prev
        const existing = curr.workflows.find((item) => item.name === safeName)
        const nextId = existing?.id ?? crypto.randomUUID()
        const nextItem = {
          id: nextId,
          name: safeName,
          jsonText: curr.workflowJsonText,
          createdAt: existing?.createdAt ?? Date.now(),
          resultNodeId: existing?.resultNodeId || '',
          resultFieldPath: existing?.resultFieldPath || '',
        }
        const nextList = existing
          ? curr.workflows.map((item) => (item.id === nextId ? nextItem : item))
          : [nextItem, ...curr.workflows]
        queueMicrotask(() => {
          void persistWorkflowJsonToDisk(safeName, jsonText)
        })
        return {
          ...prev,
          nodeConfigs: {
            ...prev.nodeConfigs,
            [kind]: {
              ...curr,
              workflowName: safeName,
              workflows: nextList,
              selectedWorkflowId: nextId,
            },
          },
        }
      })
    },
    [],
  )

  /**
   * 选择某个工作流并回填到编辑区。
   */
  const selectNodeWorkflow = useCallback((kind: StudioNodeKind, workflowId: string) => {
    setSnapshot((prev) => {
      const curr = prev.nodeConfigs[kind]
      const picked = curr.workflows.find((item) => item.id === workflowId)
      if (!picked) return prev
      return {
        ...prev,
        nodeConfigs: {
          ...prev.nodeConfigs,
          [kind]: {
            ...curr,
            selectedWorkflowId: picked.id,
            workflowName: picked.name,
            workflowJsonText: picked.jsonText,
          },
        },
      }
    })
  }, [])

  /**
   * 更新指定工作流条目的附加配置（如结果映射）。
   */
  const updateNodeWorkflowEntry = useCallback(
    (
      kind: StudioNodeKind,
      workflowId: string,
      patch: Partial<{
        name: string
        jsonText: string
        resultNodeId: string
        resultFieldPath: string
      }>,
    ) => {
      setSnapshot((prev) => {
        const curr = prev.nodeConfigs[kind]
        const list = curr.workflows
        const idx = list.findIndex((item) => item.id === workflowId)
        if (idx < 0) return prev
        const target = list[idx]!
        const nextItem = {
          ...target,
          ...patch,
        }
        if (typeof nextItem.jsonText === 'string' && nextItem.jsonText.trim()) {
          queueMicrotask(() => {
            void persistWorkflowJsonToDisk(nextItem.name, nextItem.jsonText)
          })
        }
        const nextList = list.map((item) => (item.id === workflowId ? nextItem : item))
        const isSelected = curr.selectedWorkflowId === workflowId
        return {
          ...prev,
          nodeConfigs: {
            ...prev.nodeConfigs,
            [kind]: {
              ...curr,
              workflows: nextList,
              workflowName: isSelected ? nextItem.name : curr.workflowName,
              workflowJsonText: isSelected ? nextItem.jsonText : curr.workflowJsonText,
            },
          },
        }
      })
    },
    [],
  )

  /**
   * 删除某个工作流。
   */
  const removeNodeWorkflow = useCallback((kind: StudioNodeKind, workflowId: string) => {
    setSnapshot((prev) => {
      const curr = prev.nodeConfigs[kind]
      const nextList = curr.workflows.filter((item) => item.id !== workflowId)
      const nextSelected =
        curr.selectedWorkflowId === workflowId ? nextList[0]?.id : curr.selectedWorkflowId
      const nextPicked = nextList.find((item) => item.id === nextSelected)
      return {
        ...prev,
        nodeConfigs: {
          ...prev.nodeConfigs,
          [kind]: {
            ...curr,
            workflows: nextList,
            selectedWorkflowId: nextSelected,
            workflowName: nextPicked?.name ?? curr.workflowName,
            workflowJsonText: nextPicked?.jsonText ?? curr.workflowJsonText,
          },
        },
      }
    })
  }, [])

  /**
   * 清空某一类型下的全部工作流条目（保留当前编辑区文本，不自动覆盖）。
   */
  const clearNodeWorkflows = useCallback((kind: StudioNodeKind) => {
    setSnapshot((prev) => {
      const curr = prev.nodeConfigs[kind]
      return {
        ...prev,
        nodeConfigs: {
          ...prev.nodeConfigs,
          [kind]: {
            ...curr,
            workflows: [],
            selectedWorkflowId: undefined,
          },
        },
      }
    })
  }, [])

  /**
   * 置顶某个工作流：保持原有条目内容，仅调整列表顺序。
   */
  const pinNodeWorkflowToTop = useCallback((kind: StudioNodeKind, workflowId: string) => {
    setSnapshot((prev) => {
      const curr = prev.nodeConfigs[kind]
      const index = curr.workflows.findIndex((item) => item.id === workflowId)
      if (index <= 0) return prev
      const picked = curr.workflows[index]
      const nextList = [picked, ...curr.workflows.filter((item) => item.id !== workflowId)]
      return {
        ...prev,
        nodeConfigs: {
          ...prev.nodeConfigs,
          [kind]: {
            ...curr,
            workflows: nextList,
          },
        },
      }
    })
  }, [])

  /**
   * 更新快捷键设置。
   */
  const updateShortcutConfig = useCallback(
    (patch: Partial<WorkflowConfigSnapshot['shortcuts']>) => {
      setSnapshot((prev) => ({
        ...prev,
        shortcuts: { ...prev.shortcuts, ...patch },
      }))
    },
    [],
  )

  const updateShortcutBinding = useCallback(
    (command: ShortcutCommandId, binding: string) => {
      setSnapshot((prev) => ({
        ...prev,
        shortcuts: {
          ...prev.shortcuts,
          bindings: {
            ...prev.shortcuts.bindings,
            [command]: binding,
          },
        },
      }))
    },
    [],
  )

  /**
   * 测试本地或云端 ComfyUI 连通性。
   */
  const testProviderConnection = useCallback(
    async (provider: WorkflowProviderType) => {
      const providerConfig =
        provider === 'local'
          ? {
              ...snapshot.local,
              // 本地 ComfyUI 不走鉴权，避免旧配置里残留 token 导致 403。
              apiKey: '',
            }
          : {
              ...snapshot.cloud,
              baseUrl: effectiveCloudComfyBaseUrl(
                snapshot.cloudEndpoints.find((item) => item.enabled && item.baseUrl.trim())?.baseUrl ?? '',
              ),
            }
      const result = await checkComfyHealth({ providerConfig })
      const prefix = provider === 'local' ? '本地' : '云端'
      setConnectionTestMessage(`${prefix}：${result.message}`)
      return result
    },
    [snapshot.cloud, snapshot.cloudEndpoints, snapshot.local],
  )

  const refreshOfficialTemplates = useCallback(async () => {
    const base = String(loadLicenseServerConfig().baseUrl || '').trim().replace(/\/+$/, '')
    if (!base) {
      setOfficialTemplates([])
      return []
    }
    const fetchOpts: RequestInit = {}

    const parseTemplatesPayload = (raw: unknown): OfficialTemplateMeta[] => {
      const j = raw as {
        templates?: unknown
        groups?: Array<{ items?: unknown }>
        message?: string
      }
      if (Array.isArray(j.templates)) {
        return j.templates
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
          .map((row) => ({
            id: String(row.id || '').trim(),
            name: String(row.name || row.id || '').trim(),
            version: String(row.version || '1.0.0').trim() || '1.0.0',
            description: row.description != null ? String(row.description) : undefined,
            paramsSchema:
              row.paramsSchema && typeof row.paramsSchema === 'object' && !Array.isArray(row.paramsSchema)
                ? (row.paramsSchema as Record<string, unknown>)
                : undefined,
          }))
          .filter((x) => x.id)
      }
      const groups = Array.isArray(j.groups) ? j.groups : []
      const out: OfficialTemplateMeta[] = []
      for (const g of groups) {
        const items = Array.isArray(g?.items) ? g.items : []
        for (const rawItem of items) {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue
          const row = rawItem as Record<string, unknown>
          const id = String(row.id || '').trim()
          if (!id) continue
          out.push({
            id,
            name: String(row.name || id).trim(),
            version: String(row.version || '1.0.0').trim() || '1.0.0',
            description: row.description != null ? String(row.description) : undefined,
            paramsSchema:
              row.paramsSchema && typeof row.paramsSchema === 'object' && !Array.isArray(row.paramsSchema)
                ? (row.paramsSchema as Record<string, unknown>)
                : undefined,
          })
        }
      }
      return out
    }

    /** Auth 列表在 GET /templates/groups（公开）；旧 /templates 会 302 且 JSON 不含 templates[] */
    const response = await fetch(`${base}/templates/groups`, fetchOpts)
    const json = (await response.json().catch(() => ({}))) as { message?: string }
    if (!response.ok) {
      throw new Error(String((json as { message?: string }).message || `拉取官方模板失败：${response.status}`))
    }
    const list = parseTemplatesPayload(json)
    setOfficialTemplates(list)
    return list
  }, [])


  const runNodeWorkflow = useCallback(
    async (node: Node<StudioNodeData>, options?: RunNodeWorkflowOptions) => {
      if (node.data.kind === 'group') {
        throw new Error('分组节点不可执行')
      }
      if (node.data.kind === 'panorama') {
        throw new Error('VR360 全景节点为本地预览与导出工具，请在节点内使用「当前视角」，不参与 Comfy 执行')
      }
      if (node.data.kind === 'imageCompare') {
        throw new Error('对比节点为本地双图预览，无需执行工作流')
      }

      const reserveParams = buildPointsReserveParams(node, snapshot, {
        executionTarget: options?.executionTarget,
      })
      const { nodeKind, executionTarget, metadata: reserveMeta } = reserveParams
      const nodeConfig = snapshot.nodeConfigs[nodeKind]

      let reserveMetadata = { ...reserveMeta }
      if (snapshot.executionMode === 'official') {
        const tid = String(nodeConfig.officialTemplateId || '').trim()
        const tpl = officialTemplates.find((t) => t.id === tid)
        const tn = String(tpl?.name || '').trim()
        if (tn) {
          reserveMetadata = { ...reserveMetadata, workflowName: tn }
        }
        if (snapshot.executionProvider === 'local') {
          reserveMetadata = { ...reserveMetadata, pointsBillingKind: 'local_workflow' }
        }
      }

      return await (async () => {
      if (executionTarget === 'model') {
        const nodeModel = String((node.data as any)?.cloudModelName || nodeConfig.cloudModelName || '').trim()
        const nodeBaseUrlRaw = String((node.data as any)?.cloudModelUrl || nodeConfig.cloudModelUrl || '')
        const nodeApiKey = String((node.data as any)?.cloudApiKey || nodeConfig.cloudApiKey || '').trim()

        const self = getActiveCloudSelfDefaultsForNodeKind(nodeKind)
        const cloudApiMode: CloudSelfApiMode = self.apiMode || 'auto'
        const model = nodeModel || self.model
        const baseUrl = normalizeOpenAICompatibleBaseUrl(nodeBaseUrlRaw || self.baseUrl || '')
        let apiKey = nodeApiKey || self.apiKey
        const preferAsyncImage =
          cloudApiMode !== 'openai' &&
          (cloudApiMode === 'async' || (cloudApiMode === 'auto' && isModelScopeInferenceBase(baseUrl)))
        const assistPickRaw = String((node.data as any)?.cloudAssistModelPick || '').trim()
        if (tryDecodeCloudAssistModelPick(assistPickRaw)) {
          const ak = studioNodeKindToAssistKind(String(nodeKind))
          if (ak) {
            const fromAssist = getAssistApiKey(ak)
            if (fromAssist) apiKey = fromAssist
          }
        }

        if (!baseUrl || !model) {
          throw new Error('未配置云端模型（模型名/地址）。请先在「设置 - 云端模型」里填写 API 地址并选择默认模型。')
        }
        if (!apiKey) {
          throw new Error('未填写 API Key。请先在「设置 - 云端模型」里填写 API Key。')
        }
        const modelPromptNode =
          nodeKind === 'image' && options?.studioEdges?.length && options?.allNodes?.length
            ? cloneNodeWithInboundTextPromptPrepended(
                node,
                options.studioEdges,
                options.allNodes,
                undefined,
              )
            : node
        const inputText =
          nodeKind === 'text' || nodeKind === 'script'
            ? String((node.data as any)?.body || '').trim()
            : nodeKind === 'image'
              ? String((modelPromptNode.data as any)?.prompt || '').trim()
              : nodeKind === 'video'
                ? [
                    String((node.data as any)?.prompt || '').trim(),
                    String((node.data as any)?.prompt2 || '').trim(),
                    String((node.data as any)?.prompt3 || '').trim(),
                    String((node.data as any)?.prompt4 || '').trim(),
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : nodeKind === 'audio' || nodeKind === 'music'
                  ? String((node.data as any)?.note || '').trim()
                  : ''
        if (!inputText) {
          throw new Error('输入内容为空，无法调用模型。请先在节点提示框填写内容再执行。')
        }

        // 记录一次“云端模型提交”（不包含轮询/重试）
        try {
          appendCloudCallLog({ nodeKind, model, count: 1 })
        } catch {
          // ignore
        }

        const shouldRetryRateLimit = (status: number, payload: any): boolean => {
          if (status === 429) return true
          const msg = String(payload?.error?.message || payload?.message || '').toLowerCase()
          return msg.includes('rate limit') || msg.includes('rate-limit') || msg.includes('too many requests')
        }
        const requestWithBackoff = async (
          endpoint: string,
          req: { method: 'GET' | 'POST'; headers?: Record<string, string>; json?: unknown },
          options?: { maxAttempts?: number },
        ): Promise<{ ok: boolean; status: number; json: any; response: Response }> => {
          const maxAttempts = Math.max(1, options?.maxAttempts ?? 3)
          let last: { ok: boolean; status: number; json: any; response: Response } | null = null
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const response = await fetchOpenAICompat(endpoint, req)
            const json = (await response.json().catch(() => ({}))) as any
            last = { ok: response.ok, status: response.status, json, response }
            if (response.ok) return last
            if (!shouldRetryRateLimit(response.status, json) || attempt >= maxAttempts) return last
            const waitMs = attempt === 1 ? 1200 : attempt === 2 ? 2600 : 4200
            options?.maxAttempts
            await new Promise((resolve) => setTimeout(resolve, waitMs))
          }
          return last as { ok: boolean; status: number; json: any; response: Response }
        }
        if (nodeKind === 'image') {
          options?.onProgress?.({ percent: 8, label: '正在调用云端生图模型…' })
          const normalizePromptForCloudImage = (raw: string): string => {
            const s = String(raw || '')
            // 保留 @ 引用中的文本语义，仅移除链接壳（例如：@[女模特](node-id) -> 女模特）。
            const withoutMentions = s.replace(/@\[(.*?)\]\([^)]+\)/g, '$1')
            // 过滤本地/临时 URL，避免百炼返回 url error。
            const withoutLocalUrls = withoutMentions
              .replace(/\bblob:[^\s)]+/gi, ' ')
              .replace(/\bfile:[^\s)]+/gi, ' ')
              .replace(/\bdata:[^\s)]+/gi, ' ')
            // @ 解析后可能含 http(s) 链接；对 qwen-image 文生图接口同样会触发 url error，统一剥离。
            const withoutHttpUrls = withoutLocalUrls.replace(/\bhttps?:\/\/[^\s)]+/gi, ' ')
            // 兼容 MJ 风格尾参数（--ar/--v/--style...）：百炼接口通常不识别，可能报 url error。
            const withoutMjArgs = withoutHttpUrls
              .replace(/--ar\s+\S+/gi, ' ')
              .replace(/--v\s+\S+/gi, ' ')
              .replace(/--style\s+\S+/gi, ' ')
              .replace(/--q\s+\S+/gi, ' ')
              .replace(/--chaos\s+\S+/gi, ' ')
              .replace(/--seed\s+\S+/gi, ' ')
            return withoutMjArgs.replace(/\s{2,}/g, ' ').trim()
          }
          const promptForImage = normalizePromptForCloudImage(inputText) || inputText
          const imageNodeData = node.data as ImageNodeData
          const cloudAspect = imageNodeData.cloudImageAspect
          const cloudTier = imageNodeData.cloudImageResolutionTier
          const openAiImgOut = resolveOpenAiImageGenerationOutputParams({
            model,
            aspect: cloudAspect,
            tier: cloudTier,
          })
          const isDashscopeQwenImage =
            /dashscope\.aliyuncs\.com|dashscope-intl\.aliyuncs\.com/i.test(baseUrl) &&
            /^qwen-image/i.test(model)
          const readImageUrl = (payload: any): string => {
            const candidates = [
              payload?.data?.[0]?.url,
              payload?.output?.results?.[0]?.url,
              payload?.output?.images?.[0]?.url,
              payload?.output?.result_url,
              payload?.output?.image_url,
              payload?.output?.imageUrl,
              payload?.output?.image_url,
              payload?.output?.url,
              payload?.task_result?.images?.[0]?.url,
              payload?.task_result?.results?.[0]?.url,
              payload?.task_result?.output?.images?.[0]?.url,
              payload?.task_result?.output?.results?.[0]?.url,
              payload?.task_result?.url,
              payload?.result?.url,
              payload?.url,
            ]
            for (const item of candidates) {
              const v = String(item || '').trim()
              if (v) return v
            }
            return ''
          }
          const readTaskId = (payload: any): string => {
            const candidates = [
              payload?.task_id,
              payload?.taskId,
              payload?.id,
              payload?.request_id,
              payload?.requestId,
              payload?.output?.task_id,
              payload?.output?.taskId,
              payload?.output?.id,
            ]
            for (const item of candidates) {
              const v = String(item || '').trim()
              if (v) return v
            }
            return ''
          }
          let imageUrl = ''
          let json: any = null
          let createErr = ''
          if (isDashscopeQwenImage) {
            const isIntl = /dashscope-intl\.aliyuncs\.com/i.test(baseUrl)
            const host = isIntl ? 'https://dashscope-intl.aliyuncs.com' : 'https://dashscope.aliyuncs.com'
            const endpoint = `${host}/api/v1/services/aigc/multimodal-generation/generation`
            const nodeInputs = await extractNodeInputs(node, options?.allNodes, {
              studioEdges: options?.studioEdges,
              imageMentionRefPromptOverride: options?.rawPromptText,
              imageMentionRefsRequireStableNodeId: true,
            })
            const refCandidates = pickModelReferenceImages(nodeInputs as any, 4, {
              includePrimaryCanvasImage: false,
            })
            const dashscopeRefImages = (
              await Promise.all(
                refCandidates.map(async (c) => {
                  const fromAsset = c.assetId ? await ensureOpenAiImageUrlFromAssetId(c.assetId) : ''
                  if (fromAsset) return fromAsset
                  return c.url ? await ensureOpenAiImageUrl(c.url) : ''
                }),
              )
            ).filter(Boolean)
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.log('[Flowid cloud-image] dashscope refs', {
                nodeId: node.id,
                model,
                endpoint,
                refCount: dashscopeRefImages.length,
                refs: dashscopeRefImages.map((u) => ({ kind: devUrlKind(u), url: devTruncateUrl(u, 140) })),
              })
            }
            try {
              const call = await requestWithBackoff(
                endpoint,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                  },
                  json: {
                    model,
                    input: {
                      messages: [
                        {
                          role: 'user',
                          // DashScope multimodal-generation: content item keys are `text` / `image`
                          content:
                            dashscopeRefImages.length > 0
                              ? [{ text: promptForImage }, ...dashscopeRefImages.map((image) => ({ image }))]
                              : [{ text: promptForImage }],
                        },
                      ],
                    },
                    parameters: {
                      size: resolveDashscopeQwenImageSize(cloudAspect, cloudTier),
                      image_count: 1,
                    },
                  },
                },
                { maxAttempts: 3 },
              )
              const res = call.response
              const candidateJson = call.json
              if (!res.ok) {
                const msg = String(candidateJson?.error?.message || candidateJson?.message || `HTTP ${res.status}`)
                throw new Error(`${endpoint} -> ${msg}`)
              }
              json = candidateJson
              imageUrl = readImageUrl(candidateJson)
              if (!imageUrl) {
                const taskId = readTaskId(candidateJson)
                if (!taskId) throw new Error(`${endpoint} -> 调用成功但未返回图片 URL / taskId`)
                const pollCandidates = [
                  `${host}/api/v1/tasks/${encodeURIComponent(taskId)}`,
                ]
                const deadline = Date.now() + 300_000
                while (Date.now() < deadline && !imageUrl) {
                  options?.onProgress?.({ percent: 48, label: '云端生图生成中…' })
                  for (const pollUrl of pollCandidates) {
                    const statusRes = await fetchOpenAICompat(pollUrl, {
                      method: 'GET',
                      headers: { Authorization: `Bearer ${apiKey}` },
                    })
                    if (!statusRes.ok) continue
                    const statusJson = (await statusRes.json().catch(() => ({}))) as any
                    imageUrl = readImageUrl(statusJson)
                    if (imageUrl) {
                      json = statusJson
                      break
                    }
                    const taskStatus = String(
                      statusJson?.output?.task_status || statusJson?.output?.status || statusJson?.status || '',
                    )
                      .trim()
                      .toUpperCase()
                    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
                      const msg = String(
                        statusJson?.output?.results?.[0]?.code ||
                          statusJson?.output?.results?.[0]?.message ||
                          statusJson?.message ||
                          '任务失败',
                      )
                      throw new Error(`${pollUrl} -> ${msg}`)
                    }
                  }
                  if (!imageUrl) await new Promise((resolve) => setTimeout(resolve, 2000))
                }
                if (!imageUrl) {
                  createErr = `${endpoint} -> 任务仍在处理中（taskId=${taskId}），请稍后重试`
                }
              }
            } catch (error) {
              createErr = String((error as Error)?.message || error)
            }
            if (!imageUrl) {
              throw new Error(`云端生图调用失败：${createErr || '未匹配到可用接口'}`)
            }
          } else {
            const endpoint = `${baseUrl}/v1/images/generations`
            // 若存在参考图，优先走 Responses 多模态（input_image + image_generation tool）
            const nodeInputs = await extractNodeInputs(node, options?.allNodes, {
              studioEdges: options?.studioEdges,
              imageMentionRefPromptOverride: options?.rawPromptText,
              imageMentionRefsRequireStableNodeId: true,
            })
            const refCandidates = pickModelReferenceImages(nodeInputs as any, 4, {
              includePrimaryCanvasImage: false,
            })
            const refImages = (
              await Promise.all(
                refCandidates.map(async (c) => {
                  const fromAsset = c.assetId ? await ensureOpenAiImageUrlFromAssetId(c.assetId) : ''
                  if (fromAsset) return fromAsset
                  return c.url ? await ensureOpenAiImageUrl(c.url) : ''
                }),
              )
            ).filter(Boolean)

            const supportsResponsesVision =
              /^gpt-image-2/i.test(model) || /openai\.com|api\.openai\.com/i.test(baseUrl)

            if (refImages.length > 0 && supportsResponsesVision) {
              const responsesEndpoint = `${baseUrl}/v1/responses`
              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.log('[Flowid cloud-image] responses (multimodal)', {
                  nodeId: node.id,
                  model,
                  endpoint: responsesEndpoint,
                  size: openAiImgOut.size,
                  quality: openAiImgOut.quality,
                  refCount: refImages.length,
                  refs: refImages.map((u) => ({ kind: devUrlKind(u), url: devTruncateUrl(u, 140) })),
                })
              }
              const resp = await fetchOpenAICompat(responsesEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                json: {
                  model,
                  input: [
                    {
                      role: 'user',
                      content: [
                        { type: 'input_text', text: promptForImage },
                        ...refImages.map((image_url) => ({ type: 'input_image', image_url, detail: 'low' })),
                      ],
                    },
                  ],
                  tools: [
                    {
                      type: 'image_generation',
                      ...(openAiImgOut.quality ? { quality: openAiImgOut.quality } : {}),
                      ...(openAiImgOut.size ? { size: openAiImgOut.size } : {}),
                    },
                  ],
                },
              })
              const respJson = (await resp.json().catch(() => ({}))) as any
              if (!resp.ok) {
                const msg = String(respJson?.error?.message || respJson?.message || `HTTP ${resp.status}`)
                throw new Error(`云端生图调用失败：${responsesEndpoint} -> ${msg}`)
              }
              const imageBase64 = String(
                (Array.isArray(respJson?.output)
                  ? respJson.output.find((o: any) => o?.type === 'image_generation_call')?.result
                  : '') || '',
              ).trim()
              if (!imageBase64) {
                throw new Error('云端生图调用成功但未返回 image_generation_call.result（base64）')
              }
              json = respJson
              imageUrl = `data:image/png;base64,${imageBase64}`
            } else {
              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.log('[Flowid cloud-image] images/generations (text-only)', {
                  nodeId: node.id,
                  model,
                  endpoint,
                  size: openAiImgOut.size,
                  quality: openAiImgOut.quality,
                  refCount: refImages.length,
                  note:
                    refImages.length > 0
                      ? '当前端点通常不支持参考图（仅 prompt 文生图）。如需参考图请使用支持 /v1/responses 或 images/edits 的服务。'
                      : '无参考图，走文生图端点。',
                })
              }
              const submitHeaders = preferAsyncImage
                ? cloudImageSubmitHeaders(apiKey, baseUrl)
                : {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                  }
              const call = await requestWithBackoff(
                endpoint,
                {
                  method: 'POST',
                  headers: submitHeaders,
                  json: {
                    model,
                    prompt: promptForImage,
                    n: 1,
                    size: openAiImgOut.size,
                    ...(openAiImgOut.quality ? { quality: openAiImgOut.quality } : {}),
                    ...(preferAsyncImage ? {} : { response_format: 'url' }),
                  },
                },
                { maxAttempts: 3 },
              )
              const res = call.response
              json = call.json
              if (!res.ok) {
                const msg = String(json?.error?.message || json?.message || `HTTP ${res.status}`)
                throw new Error(`云端生图调用失败：${endpoint} -> ${msg}`)
              }
              imageUrl = readImageUrl(json) || readCloudImageUrlFromPayload(json)
              if (!imageUrl) {
                const taskId = readCloudImageTaskId(json) || readTaskId(json)
                if (taskId) {
                  imageUrl = await pollCloudImageTask({
                    baseUrl,
                    apiKey,
                    taskId,
                    onProgress: (label) => options?.onProgress?.({ percent: 48, label }),
                  })
                }
              }
              if (!imageUrl) {
                throw new Error('云端生图调用成功但未返回图片 URL / taskId')
              }
            }
          }
          options?.onProgress?.({ percent: 96, label: '模型已返回，正在回填…' })
          return {
            previewUrl: imageUrl,
            audioUrl: null,
            resultUrl: imageUrl,
            historyEntry: json,
            resultViewUrls: imageUrl ? [imageUrl] : undefined,
          }
        }
        if (nodeKind === 'video') {
          options?.onProgress?.({ percent: 8, label: '正在调用云端视频模型…' })
          const generationCandidates = [
            `${baseUrl}/v2/videos/generations`,
            `${baseUrl}/v1/videos/generations`,
            `${baseUrl}/v1/video/generations`,
          ]
          const readVideoUrl = (payload: any): string => {
            const candidates = [
              payload?.data?.[0]?.url,
              payload?.data?.[0]?.video_url,
              payload?.output?.video_url,
              payload?.output?.url,
              payload?.result?.url,
              payload?.video_url,
              payload?.url,
            ]
            for (const item of candidates) {
              const v = String(item || '').trim()
              if (v) return v
            }
            return ''
          }
          const readTaskId = (payload: any): string => {
            const candidates = [
              payload?.id,
              payload?.task_id,
              payload?.taskId,
              payload?.data?.id,
              payload?.output?.task_id,
            ]
            for (const item of candidates) {
              const v = String(item || '').trim()
              if (v) return v
            }
            return ''
          }
          let createJson: any = null
          let createRes: Response | null = null
          let createErr = ''
          for (const endpoint of generationCandidates) {
            try {
                const call = await requestWithBackoff(
                  endpoint,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${apiKey}`,
                    },
                    json: {
                      model,
                      prompt: inputText,
                    },
                  },
                  { maxAttempts: 3 },
                )
                const res = call.response
                const json = call.json
                if (!res.ok) {
                  const msg = String(json?.error?.message || json?.message || `HTTP ${res.status}`)
                  createErr = `${endpoint} -> ${msg}`
                  continue
                }
                createRes = res
                createJson = json
              break
              } catch (error) {
                createErr = `${endpoint} -> ${String((error as Error)?.message || error)}`
              }
          }
          if (!createRes || !createJson) {
            throw new Error(`云端视频调用失败：${createErr || '未匹配到可用接口'}`)
          }
          let videoUrl = readVideoUrl(createJson)
          if (!videoUrl) {
            const taskId = readTaskId(createJson)
            if (!taskId) {
              throw new Error('云端视频调用成功但未返回视频 URL / taskId')
            }
            const pollCandidates = [
              `${baseUrl}/v2/videos/generations/${encodeURIComponent(taskId)}`,
              `${baseUrl}/v1/videos/generations/${encodeURIComponent(taskId)}`,
              `${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
            ]
            const deadline = Date.now() + 180_000
            while (Date.now() < deadline && !videoUrl) {
              options?.onProgress?.({ percent: 48, label: '云端视频生成中…' })
              for (const pollUrl of pollCandidates) {
                try {
                  const statusRes = await fetchOpenAICompat(pollUrl, {
                    method: 'GET',
                    headers: {
                      Authorization: `Bearer ${apiKey}`,
                    },
                  })
                  const statusJson = (await statusRes.json().catch(() => ({}))) as any
                  if (!statusRes.ok) continue
                  videoUrl = readVideoUrl(statusJson)
                  if (videoUrl) {
                    createJson = statusJson
                    break
                  }
                  const statusText = String(
                    statusJson?.status || statusJson?.state || statusJson?.output?.status || '',
                  )
                    .trim()
                    .toLowerCase()
                  if (statusText === 'failed' || statusText === 'error') {
                    const msg = String(statusJson?.error?.message || statusJson?.message || '生成失败')
                    throw new Error(msg)
                  }
                } catch (error) {
                  createErr = String((error as Error)?.message || error)
                }
              }
              if (videoUrl) break
              await new Promise((resolve) => setTimeout(resolve, 2000))
            }
          }
          if (!videoUrl) {
            throw new Error(`云端视频任务超时或无结果 URL${createErr ? `：${createErr}` : ''}`)
          }
          options?.onProgress?.({ percent: 96, label: '模型已返回，正在回填…' })
          return {
            previewUrl: videoUrl,
            audioUrl: null,
            resultUrl: videoUrl,
            historyEntry: createJson,
            resultViewUrls: videoUrl ? [videoUrl] : undefined,
          }
        }
        const systemPrompt =
          nodeKind === 'audio' || nodeKind === 'music'
            ? '你是配音/音乐生成提示词助手。请把用户描述改写成更清晰可执行的提示词，输出纯文本，不要解释。'
            : nodeKind === 'script'
              ? '你是分镜/脚本生成助手。请根据用户输入输出结构清晰、可直接用于短片/漫剧的脚本正文，输出纯文本，不要解释。'
              : '你是 Flowid 文本节点助手。请直接输出最终文本，不要输出额外解释。'
        options?.onProgress?.({ percent: 8, label: '正在调用云端模型…' })
        const nodeInputs = await extractNodeInputs(node, options?.allNodes, {
          studioEdges: options?.studioEdges,
        })
        const refCandidates = pickModelReferenceImages(nodeInputs as any, 6)
        const refImages = (
          await Promise.all(
            refCandidates.map(async (c) => {
              const fromAsset = c.assetId ? await ensureOpenAiImageUrlFromAssetId(c.assetId) : ''
              if (fromAsset) return fromAsset
              return c.url ? await ensureOpenAiImageUrl(c.url) : ''
            }),
          )
        ).filter(Boolean)
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('[Flowid cloud-model] chat/completions refs', {
            nodeId: node.id,
            kind: nodeKind,
            model,
            endpoint: `${baseUrl}/v1/chat/completions`,
            refCount: refImages.length,
            refs: refImages.map((u) => ({ kind: devUrlKind(u), url: devTruncateUrl(u, 140) })),
          })
        }
        const endpoint = `${baseUrl}/v1/chat/completions`
        const userContent =
          refImages.length > 0
            ? ([
                { type: 'text', text: inputText },
                ...refImages.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } })),
              ] as any)
            : inputText
        const res = await fetchOpenAICompat(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          json: {
            model,
            temperature: 0.7,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
          },
        })
        const json = (await res.json().catch(() => ({}))) as any
        if (!res.ok) {
          const msg = String(json?.error?.message || json?.message || `HTTP ${res.status}`)
          throw new Error(`云端模型调用失败：${msg}`)
        }
        const content = String(json?.choices?.[0]?.message?.content || '').trim()
        options?.onProgress?.({ percent: 96, label: '模型已返回，正在回填…' })
        return {
          previewUrl: null,
          audioUrl: null,
          resultUrl: null,
          textResult: content,
          historyEntry: json,
        }
      }

      const targetProvider = snapshot.executionProvider
      const providerConfig =
        targetProvider === 'local'
          ? {
              ...snapshot.local,
              // 本地模式强制不带 Authorization，避免提交被 403 拒绝。
              apiKey: '',
            }
          : {
              ...snapshot.cloud,
              baseUrl: effectiveCloudComfyBaseUrl(
                snapshot.cloudEndpoints.find((item) => item.enabled && item.baseUrl.trim())?.baseUrl ?? '',
              ),
            }
      if (!providerConfig.enabled) {
        throw new Error(
          targetProvider === 'local'
            ? '本地执行未启用，请先在设置中开启'
            : '云端执行未启用，请先在设置中开启',
        )
      }
      if (!providerConfig.baseUrl.trim()) {
        throw new Error(
          targetProvider === 'local'
            ? '请先填写本地 ComfyUI 地址'
            : '请先填写云端 ComfyUI 地址',
        )
      }
      if (snapshot.executionMode === 'official') {
        const templateId = String(nodeConfig.officialTemplateId || '').trim()
        if (!templateId) {
          throw new Error('当前节点未选择官方模板，请到设置中为该节点类型选择模板')
        }
        const authBaseUrl = String(loadLicenseServerConfig().baseUrl || '').trim().replace(/\/+$/, '')
        if (!authBaseUrl) {
          throw new Error('未配置 Auth 服务地址，无法提交官方模板任务（开发环境请运行 npm run auth:dev）')
        }
        const officialInputNode =
          nodeKind === 'image' && options?.studioEdges?.length && options?.allNodes?.length
            ? cloneNodeWithInboundTextPromptPrepended(
                node,
                options.studioEdges,
                options.allNodes,
                undefined,
              )
            : node
        const nodeInputs = await extractNodeInputs(officialInputNode, options?.allNodes, {
          studioEdges: options?.studioEdges,
        })
        const rawRefImages = String(nodeInputs.refImages ?? '')
        const refImageUrls = rawRefImages
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
        options?.onProgress?.({ percent: 5, label: '官方模板任务提交中…' })
        const submitRes = await fetch(`${authBaseUrl}/tasks/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateId,
            params: {
              prompt: String(nodeInputs.prompt ?? ''),
              body: String(nodeInputs.body ?? ''),
              note: String(nodeInputs.note ?? ''),
              src: String(nodeInputs.src ?? ''),
              ref_images: refImageUrls.join('\n'),
              ref_count: refImageUrls.length,
              title: String(nodeInputs.title ?? ''),
            },
            provider: {
              baseUrl: providerConfig.baseUrl,
              apiKey: providerConfig.apiKey || '',
            },
          }),
        })
        const submitJson = (await submitRes.json().catch(() => ({}))) as {
          taskId?: string
          message?: string
        }
        if (!submitRes.ok || !submitJson.taskId) {
          throw new Error(String(submitJson.message || `官方模板提交失败：${submitRes.status}`))
        }
        const taskId = submitJson.taskId
        const timeoutMs = Math.max(300, providerConfig.timeoutSec || 300) * 1000
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const statusRes = await fetch(
            `${authBaseUrl}/tasks/${encodeURIComponent(taskId)}/status`,
            {},
          )
          const statusJson = (await statusRes.json().catch(() => ({}))) as {
            status?: string
            result?: { mediaUrls?: string[]; history?: Record<string, unknown> }
            error?: string
            message?: string
          }
          if (!statusRes.ok) {
            throw new Error(String(statusJson.message || `官方模板状态查询失败：${statusRes.status}`))
          }
          const status = String(statusJson.status || '').trim()
          if (status === 'error') {
            throw new Error(String(statusJson.error || '官方模板任务执行失败'))
          }
          if (status === 'success') {
            const mediaUrls = (statusJson.result?.mediaUrls ?? [])
              .map((u) => String(u || '').trim())
              .filter(Boolean)
            const outputUrl = mediaUrls[0] || ''
            const outputLower = outputUrl.toLowerCase()
            const isAudio =
              outputLower.endsWith('.mp3') ||
              outputLower.endsWith('.wav') ||
              outputLower.endsWith('.flac') ||
              outputLower.endsWith('.m4a') ||
              outputLower.endsWith('.ogg') ||
              outputLower.endsWith('.aac')
            return {
              previewUrl: isAudio ? null : outputUrl || null,
              audioUrl: isAudio ? outputUrl : null,
              resultUrl: outputUrl || null,
              historyEntry: statusJson.result?.history ?? {},
              resultViewUrls:
                !isAudio && (nodeKind === 'image' || nodeKind === 'video') && mediaUrls.length
                  ? mediaUrls
                  : undefined,
            }
          }
          options?.onProgress?.({
            percent: status === 'running' || status === 'submitting' ? 48 : 18,
            label: status === 'running' || status === 'submitting' ? '官方模板任务执行中…' : '官方模板任务排队中…',
          })
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        throw new Error('官方模板任务超时，请稍后重试')
      }
      const isCloudCustom = targetProvider === 'cloud' && snapshot.executionMode === 'custom'
      const cloudWorkflowEntryId = isCloudCustom
        ? String((node.data as { workflowEntryId?: string }).workflowEntryId || '').trim()
        : ''
      const rootWorkflowJson = nodeConfig.workflowJsonText.trim()
      /** 云端自定义：仅允许「已选云端条目 id」或根 JSON；不依赖本地 workflows 列表是否有内容。 */
      const hasUsableWorkflowTemplate = isCloudCustom
        ? Boolean(cloudWorkflowEntryId) || Boolean(rootWorkflowJson)
        : Boolean(rootWorkflowJson) ||
          nodeConfig.workflows.some((item) => (item.jsonText || '').trim().length > 0)
      if (!hasUsableWorkflowTemplate) {
        throw new Error(
          isCloudCustom
            ? `请先在底部面板选择云端工作流，或在「${nodeKind}」设置中填写根工作流 JSON`
            : `请先在「${nodeKind}」配置工作流：在设置中导入或粘贴至少一条工作流 JSON（或填写根编辑区）`,
        )
      }
      let prompt: Record<string, unknown>
      type RemoteCloudPick = { id: string; name: string }
      let remoteCloudPick: RemoteCloudPick | null = null
      let workflowSource = ''
      if (isCloudCustom && cloudWorkflowEntryId) {
        const wfResult = await fetchCloudWorkflowJson(cloudWorkflowEntryId)
        const remoteJson = String(wfResult.workflowJson || '').trim()
        if (!wfResult.ok || !remoteJson) {
          throw new Error(
            String(
              wfResult.message ||
                (wfResult.status != null
                  ? `无法拉取云端工作流 JSON（HTTP ${wfResult.status}）`
                  : '无法拉取云端工作流 JSON'),
            ),
          )
        }
        workflowSource = remoteJson
        remoteCloudPick = {
          id: String(wfResult.id || cloudWorkflowEntryId).trim(),
          name: String(
            wfResult.name || (node.data as { model?: string }).model || cloudWorkflowEntryId,
          ).trim(),
        }
        const ovId = String(remoteCloudPick.id || cloudWorkflowEntryId).trim()
        const rawOv = ovId ? nodeConfig.cloudWorkflowOverrides?.[ovId] : undefined
        const ov: CloudWorkflowOverrideEntry | null =
          rawOv && typeof rawOv === 'object' && String(rawOv.jsonText || '').trim()
            ? rawOv
            : rawOv && typeof rawOv === 'string' && rawOv.trim()
              ? { jsonText: rawOv.trim() }
              : null
        if (ov?.jsonText) {
          workflowSource = ov.jsonText
          if (import.meta.env.DEV && (nodeKind === 'image' || nodeKind === 'video')) {
            console.warn(
              '[Flowid Comfy] 当前使用「设置 → 云端工作流」里保存的本地 JSON 覆盖；若仍出现模板旧图名，请清除该条覆盖或重新从服务器拉取后再保存',
              { 工作流id: ovId, 名称: remoteCloudPick?.name || cloudWorkflowEntryId },
            )
          }
        }
      } else if (isCloudCustom && rootWorkflowJson) {
        workflowSource = rootWorkflowJson
      }
      const { preferredName, byEntryId, byName, picked: pickedWorkflow } =
        matchStudioNodeWorkflow(
          node.data as { model?: string; workflowEntryId?: string },
          nodeConfig,
        )
      if (!workflowSource) {
        // 节点上写了名称但列表对不上时不再静默回退到全局，避免误跑成其它工作流（如 z-image）
        if (preferredName && !byEntryId && !byName) {
          throw new Error(
            `未找到工作流「${preferredName}」，请在下拉中重新选择，或在设置中核对名称是否与列表完全一致`,
          )
        }
        workflowSource =
          (pickedWorkflow?.jsonText || '').trim() || nodeConfig.workflowJsonText.trim()
      }
      if (!workflowSource) {
        throw new Error(
          `当前选中的工作流「${pickedWorkflow?.name || '（未命名）'}」JSON 为空，请到设置中打开该条目并重新保存`,
        )
      }
      const workflowSourceBeforeNormalize = workflowSource
      workflowSource = normalizeWorkflowLoadImageInputsToPlaceholders(workflowSource)
      workflowSource = normalizeWorkflowVhsLoadVideoInputsToPlaceholders(workflowSource)
      if (
        import.meta.env.DEV &&
        workflowSource !== workflowSourceBeforeNormalize &&
        (nodeKind === 'image' || nodeKind === 'video')
      ) {
        console.info(
          '[Flowid Comfy] 已将工作流 LoadImage 中的模板历史文件名改为 __SRC__（常见于设置里保存了旧版云端 JSON 覆盖）',
        )
      }
      const wfLabel =
        remoteCloudPick?.name ||
        pickedWorkflow?.name ||
        (typeof (node.data as { model?: string }).model === 'string'
          ? String((node.data as { model?: string }).model || '')
          : '') ||
        '（未命名）'
      const wfEntryId = remoteCloudPick?.id || pickedWorkflow?.id || ''
      const cloudOvId = String(wfEntryId || cloudWorkflowEntryId || '').trim()
      const cloudOvRaw =
        isCloudCustom && cloudOvId ? nodeConfig.cloudWorkflowOverrides?.[cloudOvId] : undefined
      const cloudOv: CloudWorkflowOverrideEntry | null =
        cloudOvRaw && typeof cloudOvRaw === 'object' && String(cloudOvRaw.jsonText || '').trim()
          ? cloudOvRaw
          : cloudOvRaw && typeof cloudOvRaw === 'string' && cloudOvRaw.trim()
            ? { jsonText: cloudOvRaw.trim() }
            : null
      const wfResultNodeId =
        (cloudOv?.resultNodeId ? String(cloudOv.resultNodeId) : '') ||
        pickedWorkflow?.resultNodeId ||
        nodeConfig.resultNodeId
      const wfResultFieldPath =
        (cloudOv?.resultFieldPath ? String(cloudOv.resultFieldPath) : '') ||
        pickedWorkflow?.resultFieldPath ||
        nodeConfig.resultFieldPath
      /** 开发环境：在浏览器控制台（F12 → Console）打印本次实际解析到的工作流，便于核对是否串台 */
      if (shouldLogComfyDebug()) {
        const 匹配来源 = remoteCloudPick
          ? '授权服务 /cloud-workflows/:id/workflow'
          : byEntryId != null
            ? '节点.workflowEntryId'
            : byName != null
              ? '节点.model'
              : '设置列表首条（置顶默认）/根 JSON'
        console.info('[Flowid Comfy] 本次执行工作流', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          节点类型: nodeKind,
          工作流名称: wfLabel,
          工作流条目id: wfEntryId || '（无）',
          匹配来源,
          节点model字段: preferredName || '（空）',
          workflowJson字符数: workflowSource.length,
        })
      }
      const audioRefResolved = resolveComfyRefAudioSlotCount(workflowSource)
      const audioRefSlotCount = audioRefResolved.count
      if (audioRefResolved.gapError) {
        throw new Error(audioRefResolved.gapError)
      }
      try {
        prompt = JSON.parse(workflowSource) as Record<string, unknown>
      } catch {
        throw new Error(`「${nodeKind}」工作流 JSON 解析失败`)
      }
      prompt = normalizePromptShape(prompt)
      prompt = sanitizePromptNodes(prompt)
      validatePromptNodes(prompt)
      const comfyInputNode =
        nodeKind === 'image' && options?.studioEdges?.length && options?.allNodes?.length
          ? cloneNodeWithInboundTextPromptPrepended(
              node,
              options.studioEdges,
              options.allNodes,
              workflowSource,
            )
          : (nodeKind === 'audio' || nodeKind === 'music') &&
              options?.studioEdges?.length &&
              options?.allNodes?.length
            ? cloneNodeWithInboundTextNotePrepended(
                node,
                options.studioEdges,
                options.allNodes,
                workflowSource,
              )
            : node
      const nodeInputs = await extractNodeInputs(comfyInputNode, options?.allNodes, {
        studioEdges: options?.studioEdges,
        imageMentionRefPromptOverride: options?.rawPromptText,
      })
      if (
        shouldLogComfyDebug() &&
        (nodeKind === 'audio' || nodeKind === 'music') &&
        workflowSource.includes('__NOTE__')
      ) {
        const noteOnPreparedNode = String((node.data as { note?: string }).note ?? '')
        const noteAfterEdgeMerge = String((comfyInputNode.data as { note?: string }).note ?? '')
        const noteResolvedForWf = String((nodeInputs as { note?: string }).note ?? '')
        console.info('[Flowid Comfy][台本] __NOTE__ 注入链路（extractNodeInputs 之后）', {
          工作流含__NOTE__: true,
          入参节点侧栏note: devSummarizeNoteForComfyLog(noteOnPreparedNode),
          连线合并后note: devSummarizeNoteForComfyLog(noteAfterEdgeMerge),
          已合并连线文本剧本: noteAfterEdgeMerge !== noteOnPreparedNode,
          合并原文_尚未TD对白与JSON拆分: devSummarizeNoteForComfyLog(noteResolvedForWf),
          说明:
            '本条仍是侧栏/@/连线合并后的全文；TD 无参多人会在组装 JSON 前再拆分「对白」与「说话人 JSON」。实际写入 __NOTE__ 请看稍后日志「TD 分段与最终写入 __NOTE__」。',
        })
      }
      const rawSrc = String(nodeInputs.src ?? '').trim()
      const rawRefImages = String(nodeInputs.refImages ?? '')
      const refImageUrls = rawRefImages
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
      /**
       * 图片输入统一策略：不区分主图/参考图，只看“最终输入序列”。
       * 使用 extractNodeInputs 返回的已恢复 URL，避免使用失效的 blob URL。
       */
      const nodeInputsRefImages = String((nodeInputs as any)?.refImages || '').trim()
      const refImagesMultiline = nodeInputsRefImages || rawRefImages
      const refImageAssetIds = Array.isArray((nodeInputs as NodeInputRecord).refImageAssetIds)
        ? ((nodeInputs as NodeInputRecord).refImageAssetIds as string[])
        : []
      const srcAssetId = String((nodeInputs as NodeInputRecord).srcAssetId || '').trim()
      const workflowHasComfyLoadImage = workflowJsonRequiresComfyImageUpload(workflowSource)
      let textComfyImageEntries: ImageRefUploadEntry[] = []
      if ((nodeKind === 'text' || nodeKind === 'script') && workflowHasComfyLoadImage) {
        textComfyImageEntries = await collectTextNodeImageRefEntries(
          comfyInputNode,
          nodeInputs as NodeInputRecord,
          options?.allNodes,
          options?.studioEdges,
          options?.rawPromptText,
        )
      }
      let orderedImageInputEntries: ComfyImageInputEntry[] =
        nodeKind === 'image' || nodeKind === 'video'
          ? buildOrderedComfyImageInputEntries(
              rawSrc,
              srcAssetId,
              refImagesMultiline,
              refImageAssetIds,
            )
          : mergeComfyImageInputEntriesDeduped(
              buildOrderedComfyImageInputEntries(
                rawSrc,
                srcAssetId,
                refImagesMultiline,
                refImageAssetIds,
              ),
              textComfyImageEntries.map((e) => ({
                url: e.url,
                assetId: e.assetId || undefined,
              })),
            )
      let orderedInputImageUrls = orderedImageInputEntries.map((e) => e.url)
      const videoAudioEntries =
        nodeKind === 'video' ? audioRefEntriesFromNodeInputs(nodeInputs as NodeInputRecord) : []
      const orderedInputAudioUrls =
        (nodeKind === 'audio' || nodeKind === 'music') && audioRefSlotCount > 0
          ? dedupeOrderedAudioInputUrls(rawSrc, refImageUrls)
          : nodeKind === 'video' &&
              videoAudioEntries.length > 0 &&
              (audioRefSlotCount > 0 || workflowJsonHasLoadAudioNodes(workflowSource))
            ? videoAudioEntries.map((e) => e.url)
            : []
      /** 实际上传参考音频所用的 URL 序列（上传前可能再 refresh，与 debug 一致） */
      let audioUploadSourceUrls = orderedInputAudioUrls
      const missingMentionRefs: string[] = []
      if (import.meta.env.DEV && nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        console.info('[Flowid Diagnose] 输入图判定详情', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          rawPromptText: String(options?.rawPromptText ?? ''),
          当前src: rawSrc || '（空）',
          nodeInputs_refImages原始文本: rawRefImages || '（空）',
          统计策略: refImagesMultiline.trim() ? '仅参考图（不计主图 src）' : '无参考图，使用主图 src',
          最终输入序列URL: orderedInputImageUrls,
          缺失参考图URL: missingMentionRefs,
        })
      }
      if (
        (nodeKind === 'text' || nodeKind === 'script') &&
        workflowHasComfyLoadImage &&
        orderedInputImageUrls.length === 0
      ) {
        const hadMention = String(options?.rawPromptText || '').includes('@')
        throw new Error(
          hadMention
            ? '当前工作流需要图片输入，但未能从 @ 引用解析到有效图片。请确认图片节点有图且 @ 指向正确，或将图片节点连到本节点上游后再执行。'
            : '当前工作流需要图片输入，但未检测到可上传的图片。请在提示词中用 @ 引用「图片节点」，或将图片节点连到本节点上游后再执行。',
        )
      }
      if ((nodeKind === 'image' || nodeKind === 'video') && orderedInputImageUrls.length === 0 && nodeInputsRefImages) {
        const hadImageMention = /@[^\s@]+?\([^)]+\)/.test(
          String(options?.rawPromptText || (nodeInputs as { prompt?: string }).prompt || ''),
        )
        throw new Error(
          hadImageMention
            ? '检测到 @ 图片引用，但图片节点主槽为空或参考图 blob 已失效。请打开「图片节点2」确认有图并重新上传/保存画布，侧栏 @1 参考图也需有效。'
            : '检测到参考图配置，但无法解析为可上传图片。请重新上传侧栏本地参考图或 @ 有效图片节点。',
        )
      }
      if (nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        const summary = `执行输入判定：输入图总数=${orderedInputImageUrls.length}`
        setLastExecutionMessage(summary)
      }
      if ((nodeKind === 'audio' || nodeKind === 'music') && audioRefSlotCount > 0) {
        const nIn = orderedInputAudioUrls.length
        if (nIn < 1) {
          throw new Error(
            `当前工作流含 __REF_AUDIO_1__ … __REF_AUDIO_${audioRefSlotCount}__（模板最多 ${audioRefSlotCount} 路）。请至少在节点主音频槽或底部「本地参考音/图」区提供 1 个有效音频；当前 0 个。`,
          )
        }
        if (nIn > audioRefSlotCount) {
          throw new Error(
            `当前工作流最多接收 ${audioRefSlotCount} 路参考音频，本次有 ${nIn} 个。请删减参考条或 @ 引用数量，或换用更多槽位的工作流。`,
          )
        }
        const padHint =
          nIn < audioRefSlotCount
            ? `；另 ${audioRefSlotCount - nIn} 个 Comfy 音频槽用末路文件名占位（不多传文件）`
            : ''
        setLastExecutionMessage(`执行输入判定：参考音频 ${nIn} 路（模板 ${audioRefSlotCount} 槽${padHint}）`)
      }
      if (shouldLogComfyDebug() && (nodeKind === 'audio' || nodeKind === 'music')) {
        const srcNonEmpty = Boolean(rawSrc)
        const srcLooksLocal = srcNonEmpty && /^(blob:|file:|data:)/i.test(rawSrc)
        console.info('[Flowid Comfy][上传] 向 Comfy 上传文件与否（与云端/本地无关，只看工作流占位符）', {
          工作流__REF_AUDIO槽位数: audioRefSlotCount,
          将参与上传的参考音频URL数: orderedInputAudioUrls.length,
          节点主槽src非空: srcNonEmpty,
          主槽src形态为本地预览: srcLooksLocal,
          是否执行上传循环: audioRefSlotCount > 0 && orderedInputAudioUrls.length > 0,
          说明:
            audioRefSlotCount === 0
              ? '当前工作流 JSON 里没有 __REF_AUDIO_1__ 等占位符（常见「无参」多人 TTS）。Flowid 只通过 POST /prompt 提交 JSON（台本在 Dialogue 的 script、音色在 RoleBank/VoiceDesign），不会调用上传接口往 Comfy input 丢文件；侧栏 blob:/file: 仅为画布预览，不是「漏传」。若需要参考音，请换带 __REF_AUDIO_n__ 的模板。'
              : '将把参考音频上传到 Comfy 再替换 __REF_AUDIO_*；请保证主槽或参考区有有效音频 URL。',
        })
      }
      if (nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        const loadImageSlotCount = countComfyFileLoadImageSlots(prompt)
        /**
         * 图生文等单槽工作流：同一图经「本地参考 + @ 引用 + 上游连线」可能被计为 2 张，合并后只上传首张。
         */
        if (
          loadImageSlotCount === 1 &&
          orderedImageInputEntries.length > 1 &&
          (nodeKind === 'text' || nodeKind === 'script')
        ) {
          const mergedFromCount = orderedImageInputEntries.length
          orderedImageInputEntries = orderedImageInputEntries.slice(0, 1)
          orderedInputImageUrls = orderedImageInputEntries.map((e) => e.url)
          setLastExecutionMessage(
            `图生文单图工作流：合并了 ${mergedFromCount} 路图片来源（本地参考、@、连线可能重复），已自动使用首张上传。`,
          )
        }
        const requiredInputImages = orderedInputImageUrls.length
        if (import.meta.env.DEV) {
          console.info('[Flowid Diagnose] 工作流图片槽位容量', {
            工作流名称: wfLabel,
            工作流条目id: wfEntryId || '（无）',
            需要图片数: requiredInputImages,
            LoadImage槽位数: loadImageSlotCount,
          })
        }
        if (requiredInputImages > 0 && loadImageSlotCount > 0 && loadImageSlotCount < requiredInputImages) {
          throw new Error(
            `当前工作流「${wfLabel}」仅有 ${loadImageSlotCount} 个图片输入槽位，但本次需要 ${requiredInputImages} 张。请切换到槽位更多的工作流，或减少图片数量。`,
          )
        }
      }
      const effectiveProviderConfig = {
        ...providerConfig,
        apiKey:
          targetProvider === 'cloud'
            ? nodeConfig.cloudApiKey || providerConfig.apiKey
            : providerConfig.apiKey,
        // 按节点类型设置最小超时：若用户配置更大值，优先使用用户配置。
        timeoutSec: Math.max(
          providerConfig.timeoutSec || 0,
          getNodeTimeoutFloorSec(nodeKind),
        ),
      }
      const uploadCache = new Map<string, ComfyUploadedInputImage>()
      const uploadToComfyInput = async (url: string, filenamePrefix: string) => {
        const cached = uploadCache.get(url)
        if (cached) return cached
        options?.onProgress?.({ percent: 2, label: '正在读取并上传参考图…' })
        const uploaded = await uploadComfyInputImageAsPng({
          providerConfig: effectiveProviderConfig,
          imageUrl: url,
          filenamePrefix,
        })
        uploadCache.set(url, uploaded)
        return uploaded
      }
      const mentionLabelByUrl = new Map<string, string>()
      const uploadFailures: Array<{ index: number; url: string; reason: string }> = []
      const allUploads: ComfyUploadedInputImage[] = []
      const audioUploadList: ComfyUploadedInputImage[] = []
      if (orderedImageInputEntries.length > 0 && nodeKindUsesComfyImagePipeline(nodeKind, orderedImageInputEntries.length)) {
        for (let i = 0; i < orderedImageInputEntries.length; i += 1) {
          const { url: rawUrl, assetId: entryAssetId } = orderedImageInputEntries[i]!
          const url = await resolveCanvasUrlForComfyUpload(rawUrl, entryAssetId)
          const sourceLabel = mentionLabelByUrl.get(rawUrl) || mentionLabelByUrl.get(url) || `图${i + 1}`
          const currentLabel =
            String(options?.runNodeTitle || node.data.title || node.id).trim() || '当前节点'
          /** 上传命名采用“当前节点_来源节点_序号”，便于一一对应核对。 */
          const prefix = `${currentLabel}_${sourceLabel}_${i + 1}`
          try {
            const uploaded = await uploadToComfyInput(url, prefix)
            allUploads.push(uploaded)
          } catch (error) {
            const reused = await resolveExistingComfyInputFilenameFromDesktop({
              assetId: entryAssetId,
              uploadPrefix: prefix,
              allowNewestSingleImage: orderedImageInputEntries.length === 1,
            })
            if (reused) {
              const fallback: ComfyUploadedInputImage = {
                filename: reused,
                subfolder: '',
                type: 'input',
              }
              allUploads.push(fallback)
              uploadCache.set(rawUrl, fallback)
              if (url !== rawUrl) uploadCache.set(url, fallback)
              if (import.meta.env.DEV) {
                console.info('[Flowid Diagnose] HTTP 上传失败，复用 input 目录已有文件', {
                  序号: i + 1,
                  Comfy文件名: reused,
                  原因: String((error as Error)?.message || error || '未知错误'),
                })
              }
            } else {
              uploadFailures.push({
                index: i + 1,
                url: rawUrl,
                reason: String((error as Error)?.message || error || '未知错误'),
              })
            }
          }
        }
      }
      if (
        nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length) &&
        orderedInputImageUrls.length > 0 &&
        allUploads.length === 0 &&
        workflowJsonRequiresComfyImageUpload(workflowSource)
      ) {
        const detail =
          uploadFailures.length > 0
            ? uploadFailures.map((f) => `图${f.index}：${f.reason}`).join('；')
            : '请确认 Comfy 已启动、地址正确，且 /upload/image 可访问'
        throw new Error(
          `参考图上传到 Comfy 失败，已中止提交（避免 LoadImage 收到空文件名后 Comfy 误把 input 目录当图片打开）。${detail}`,
        )
      }
      if (
        orderedInputAudioUrls.length > 0 &&
        (((nodeKind === 'audio' || nodeKind === 'music') && audioRefSlotCount > 0) ||
          (nodeKind === 'video' &&
            (audioRefSlotCount > 0 || workflowJsonHasLoadAudioNodes(workflowSource))))
      ) {
        let audioEntries =
          nodeKind === 'video'
            ? videoAudioEntries
            : audioRefEntriesFromNodeInputs(nodeInputs as NodeInputRecord)
        try {
          const refreshedInputs = await extractNodeInputs(comfyInputNode, options?.allNodes, {
            studioEdges: options?.studioEdges,
            imageMentionRefPromptOverride: options?.rawPromptText,
          })
          const next = audioRefEntriesFromNodeInputs(refreshedInputs as NodeInputRecord)
          if (next.length > 0) {
            audioEntries = next
          }
        } catch {
          // 保持首次 extract；有 assetId 时仍可从 IndexedDB 直读
        }
        audioUploadSourceUrls = audioEntries.map((e) => e.url)
        if (shouldLogComfyDebug() && workflowJsonHasLoadAudioNodes(workflowSource)) {
          console.info('[Flowid Comfy][数字人] 将上传至 LoadAudio 的驱动音频', {
            路数: audioEntries.length,
            来源URL预览: audioEntries.map((e) => ({
              url: devTruncateUrl(e.url),
              有本地assetId: Boolean(e.assetId),
            })),
            说明:
              '须为 wav/mp3 等真音频；若误传视频节点主槽无声 mp4，云端会报 No audio stream found in the file。',
          })
        }
        const audioRefUploadCache = new Map<string, ComfyUploadedInputImage>()
        for (let i = 0; i < audioEntries.length; i += 1) {
          const { url, assetId } = audioEntries[i]!
          let aid = String(assetId || '').trim()
          if (!aid && /^(blob:|file:)/i.test(url) && options?.allNodes?.length) {
            aid = resolveAudioSrcAssetIdFromCanvas(url, options.allNodes)
          }
          const cacheKey = `${url}\0${aid}`
          options?.onProgress?.({
            percent: 3,
            label: `正在上传参考音频 ${i + 1}/${audioEntries.length}…`,
          })
          const hit = audioRefUploadCache.get(cacheKey)
          if (hit) {
            audioUploadList.push(hit)
            continue
          }
          const hostLabel =
            String(node.data.title || node.id).trim() ||
            String(options?.runNodeTitle || '').trim() ||
            'video'
          const prefix = `${hostLabel}_ref_audio_${i + 1}`
          let mediaUrl = url
          let revokeAfter: string | null = null
          if (aid && /^(blob:|file:)/i.test(url)) {
            const fromDb = await readLocalImageAssetBlob(aid)
            if (fromDb && fromDb.size > 0) {
              revokeAfter = URL.createObjectURL(fromDb)
              mediaUrl = revokeAfter
            }
          }
          try {
            const uploaded = await uploadComfyInputBinaryFile({
              providerConfig: effectiveProviderConfig,
              mediaUrl,
              filenamePrefix: prefix,
            })
            audioRefUploadCache.set(cacheKey, uploaded)
            audioUploadList.push(uploaded)
          } finally {
            if (revokeAfter) URL.revokeObjectURL(revokeAfter)
          }
        }
      }
      let videoUpload: ComfyUploadedInputImage | null = null
      let sourceVideoDurationSec = 0
      const workflowHasVhsLoadVideo = workflowJsonHasVhsLoadVideoNodes(workflowSource)
      if ((nodeKind === 'text' || nodeKind === 'script') && workflowHasVhsLoadVideo) {
        const videoEntries = await collectTextNodeVideoRefEntries(
          comfyInputNode,
          nodeInputs as NodeInputRecord,
          options?.allNodes,
          options?.studioEdges,
          options?.rawPromptText,
        )
        if (videoEntries.length === 0) {
          throw new Error(
            '当前工作流需要视频输入，但未检测到有效视频。请在提示词中用 @ 引用「视频节点」，或将视频节点连到本节点上游后再执行。',
          )
        }
        const { url, assetId } = videoEntries[0]!
        options?.onProgress?.({ percent: 2, label: '正在上传视频到 Comfy…' })
        let mediaUrl = url
        let revokeAfter: string | null = null
        const aid = String(assetId || '').trim()
        if (aid && /^(blob:|file:)/i.test(url)) {
          const fromDb = await readLocalImageAssetBlob(aid)
          if (fromDb && fromDb.size > 0) {
            revokeAfter = URL.createObjectURL(fromDb)
            mediaUrl = revokeAfter
          }
        }
        const probedDuration = await probeVideoDurationSeconds(mediaUrl)
        if (probedDuration != null && probedDuration > 0) {
          sourceVideoDurationSec = probedDuration
        }
        const hostLabel =
          String(node.data.title || node.id).trim() ||
          String(options?.runNodeTitle || '').trim() ||
          'text'
        try {
          videoUpload = await uploadComfyInputBinaryFile({
            providerConfig: effectiveProviderConfig,
            mediaUrl,
            filenamePrefix: `${hostLabel}_ref_video`,
            preferredExtension: '.mp4',
          })
        } catch (error) {
          throw new Error(
            `视频上传到 Comfy 失败：${String((error as Error)?.message || error || '未知错误')}。请确认 Comfy 已启动且 /upload/image 可访问。`,
          )
        } finally {
          if (revokeAfter) URL.revokeObjectURL(revokeAfter)
        }
        if (import.meta.env.DEV) {
          console.info('[Flowid Diagnose] 视频反推：已上传参考视频', {
            节点标题: node.data.title || node.id,
            Comfy文件名: videoUpload.filename,
            探测时长秒: sourceVideoDurationSec > 0 ? normalizeVideoDurationSecForPrompt(sourceVideoDurationSec) : '（未探测到）',
          })
        }
      }
      if (
        import.meta.env.DEV &&
        (nodeKind === 'text' || nodeKind === 'script') &&
        workflowHasComfyLoadImage &&
        textComfyImageEntries.length > 0
      ) {
        console.info('[Flowid Diagnose] 图片反推：已收集 @ 图片', {
          节点标题: node.data.title || node.id,
          图片数: textComfyImageEntries.length,
        })
      }
      if (import.meta.env.DEV && uploadFailures.length > 0) {
        console.warn('[Flowid Diagnose] 上传失败明细（已跳过）', uploadFailures)
      }
      /** 仅 @ / 参考图条、无独立主图 src 时：全部上传结果都视为参考图池，避免 slice(1) 少计一张。 */
      const refsOnlyImageInputs =
        refImagesMultiline.trim().length > 0 && !String(rawSrc || '').trim()
      const primaryUpload = refsOnlyImageInputs ? null : (allUploads[0] ?? null)
      const refUploads = refsOnlyImageInputs ? allUploads : allUploads.slice(1)
      if (import.meta.env.DEV && nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        console.info('[Flowid Diagnose] 实际上传结果详情', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          主图上传文件名: primaryUpload?.filename || '（无）',
          参考图上传文件名: refUploads.map((item) => item.filename),
          参考图上传数量: refUploads.length,
        })
      }
      const comfySrc = primaryUpload?.filename ?? refUploads[0]?.filename ?? ''
      const comfyVideoSrc = videoUpload?.filename ?? ''
      const comfyRefImages = refUploads.map((item) => item.filename).join('\n')
      const comfyFirstRefImage = refUploads[0]?.filename ?? ''
      /** 参考图计数占位符：用于 forLoop 等；张数=用户实际上传/引用的图，不再误用 slice 后的 ref 数。 */
      const comfyRefCount = Math.max(1, Math.min(5, orderedInputImageUrls.length))
      const isGridSplitWorkflow = workflowJsonSupportsComfyGridPlaceholders(workflowSource)
      /** 首尾帧须严格 2 张；多图编辑类（含云端无 __REF_COUNT__ 的 ImageReel 工作流）允许少于槽位数。 */
      const variableRefCountWorkflow =
        !findWanFirstLastFrameNodeId(prompt) &&
        workflowJsonSupportsVariableRefCount(workflowSource, wfLabel)
      // 宫格分割：按槽位 1~5 上传 gridImages（与 __GRID_IMAGE_n__ 下标对齐）
      const gridImageUploads: ComfyUploadedInputImage[] = []
      const rawGridImages = (nodeInputs as NodeInputRecord).gridImages
      const gridImages: string[] = Array.isArray(rawGridImages) ? rawGridImages.map((u) => String(u ?? '')) : []
      const rawGridAssetIds = (nodeInputs as NodeInputRecord).gridImageAssetIds
      const gridImageAssetIds: string[] = Array.isArray(rawGridAssetIds)
        ? rawGridAssetIds.map((u) => String(u ?? ''))
        : []
      const gridImageFilenames: string[] = Array.from({ length: 5 }, () => '')
      const gridUploadFailures: string[] = []
      for (let i = 0; i < 5; i += 1) {
        let url = String(gridImages[i] ?? '').trim()
        const aid = String(gridImageAssetIds[i] ?? '').trim()
        if ((!url || url.startsWith('blob:')) && aid) {
          try {
            const restored = await getLocalImageAssetObjectUrl(aid)
            if (restored) url = restored
          } catch {
            /* 本地资源读取失败时沿用原 URL */
          }
        }
        if (!url) continue
        const cached = uploadCache.get(url)
        if (cached) {
          gridImageUploads.push(cached)
          gridImageFilenames[i] = cached.filename
          continue
        }
        try {
          const uploaded = await uploadToComfyInput(url, `宫格_${i + 1}`)
          uploadCache.set(url, uploaded)
          gridImageUploads.push(uploaded)
          gridImageFilenames[i] = uploaded.filename
        } catch (error) {
          gridUploadFailures.push(
            `槽位${i + 1}：${String((error as Error)?.message || error || '上传失败')}`,
          )
        }
      }
      /** 仅图片进 LoadImage 注入池；音频只写 LoadAudio，避免 .m4a 被当成图片报 cannot identify image file。 */
      const comfyImageInjectUploads: ComfyUploadedInputImage[] = [
        ...(isGridSplitWorkflow ? gridImageUploads : []),
        ...(primaryUpload ? [primaryUpload] : []),
        ...refUploads,
      ].filter((u) => isComfyUploadedImageFile(u))
      const comfyInjectUploads: ComfyUploadedInputImage[] = [
        ...comfyImageInjectUploads,
        ...audioUploadList,
      ]
      const gridSourceUrls = gridImages.filter((u) => String(u || '').trim())
      // 仅对“接入主链路”的多 LoadImage 做参考图缺失拦截；宫格分割只需弹窗里的大图，不要求参考图张数=LoadImage 数。
      if (nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        const linkedLoadImageCount = collectLinkedLoadImageNodeIds(prompt).size
        if (isGridSplitWorkflow) {
          if (gridSourceUrls.length < 1) {
            throw new Error(
              `当前为宫格分割工作流：请在底部点「宫格分割」上传分镜联系表（至少 1 张），弹窗内点「保存」后再执行。无需在「本地参考图」重复上传。`,
            )
          }
          if (gridImageUploads.length < 1 || !gridImageFilenames[0]?.trim()) {
            const detail =
              gridUploadFailures.length > 0
                ? ` 详情：${gridUploadFailures.join('；')}`
                : ' 请重新在宫格弹窗上传大图并点「保存」。'
            throw new Error(
              `宫格分割图上传 Comfy 失败，请检查 Comfy 是否在线、代理是否关闭，以及图片是否有效（勿用已失效的 blob 链接）。${detail}`,
            )
          }
        } else if (
          !variableRefCountWorkflow &&
          linkedLoadImageCount > 1 &&
          orderedInputImageUrls.length < linkedLoadImageCount
        ) {
          throw new Error(
            `检测到当前工作流有 ${linkedLoadImageCount} 个已接入主链路的 LoadImage，但本次有效输入图为 ${orderedInputImageUrls.length} 张。请在「本地参考图」按顺序添加 ${linkedLoadImageCount} 张（首尾帧：先首帧后尾帧），或在提示词中用 @ 引用对应图片节点。`,
          )
        } else if (variableRefCountWorkflow && orderedInputImageUrls.length < 1) {
          throw new Error(
            '当前为多图编辑类工作流：请至少在提示词中用 @ 引用图片节点，或在「本地参考图」上传 1 张及以上参考图后再执行。',
          )
        }
      }
      if (shouldLogComfyDebug()) {
        const refSourceUrls = orderedInputImageUrls.slice(1)
        const refUploadDebugRows = refSourceUrls.map((url, idx) => ({
          序号: idx + 1,
          原始URL: devTruncateUrl(url),
          Comfy文件名: refUploads[idx]?.filename || '（上传失败/空）',
        }))
        const extractedText =
          nodeKind === 'image' || nodeKind === 'video'
            ? String(nodeInputs.prompt ?? '')
            : nodeKind === 'text' || nodeKind === 'script'
              ? String(nodeInputs.body ?? '')
              : String((nodeInputs as { note?: string }).note ?? '')
        console.info(
          `[Flowid Comfy] 组装前：节点提取的输入（占位符替换前${nodeKind === 'audio' ? '；TD 多人台本的对白/JSON 拆分在下一步' : ''}）`,
          {
            文本字数: extractedText.length,
            文本预览:
              extractedText.length > 500
                ? `${extractedText.slice(0, 500)}…(共${extractedText.length}字)`
                : extractedText || '（无）',
            主图原始地址: rawSrc ? devTruncateUrl(rawSrc) : '（无）',
            参考图原始条数: refImageUrls.length,
            Comfy主图文件名: comfySrc || '（无）',
            Comfy参考图文件名: refUploads.map((item) => item.filename),
          },
        )
        console.info('[Flowid Comfy] 参考图上传顺序明细（原始URL -> Comfy文件名）', refUploadDebugRows)
        const audioInjectDebugRows =
          nodeKind === 'audio' || nodeKind === 'music'
            ? audioUploadSourceUrls.map((url, idx) => ({
                序号: idx + 1,
                原始URL: devTruncateUrl(url),
                Comfy文件名: audioUploadList[idx]?.filename || '（未上传/空）',
              }))
            : []
        console.info(
          '[Flowid Comfy] 最终注入顺序（主图 + 参考图 + 参考音频；无槽位时数组为空属正常）',
          [
            ...(primaryUpload
              ? [{ 类型: '主图', 原始URL: devTruncateUrl(rawSrc), Comfy文件名: primaryUpload.filename }]
              : []),
            ...refUploadDebugRows.map((row) => ({
              类型: '参考图',
              原始URL: row.原始URL,
              Comfy文件名: row.Comfy文件名,
            })),
            ...audioInjectDebugRows.map((row) => ({
              类型: '参考音频',
              原始URL: row.原始URL,
              Comfy文件名: row.Comfy文件名,
            })),
          ],
        )
      }
      options?.onProgress?.({ percent: 4, label: '输入已准备，正在组装工作流…' })
      // 兼容简单占位符：把 "__PROMPT__"、"__PROMPTn__"、"__BODY__"、"__SRC__" 自动替换。
      const serializedBefore = JSON.stringify(prompt)
      const noteInputMerged = String(nodeInputs.note ?? '')
      let noteForWorkflow = noteInputMerged
      /** 有参/无参 TD：对白与说话人 JSON 分段；JSON 只更新 CR Text，勿拼进 MultiDialog。 */
      let noteRawPreservedForTdCrText = noteInputMerged
      if (nodeKind === 'audio' && workflowJsonUsesTdMultiDialog(serializedBefore)) {
        const split = splitTdNoteIntoDialogueAndSpeakerJson(noteInputMerged)
        noteRawPreservedForTdCrText = split.speakerJsonCandidate?.trim()
          ? split.speakerJsonCandidate.trim()
          : noteInputMerged
        if (split.dialogue.trim()) {
          noteForWorkflow = normalizeTtsDialogueRoleColons(split.dialogue.trim())
        } else {
          const fromStruct = tryStructuredVoiceListToMultiDialogLines(split.speakerJsonCandidate ?? '')
          noteForWorkflow = (fromStruct ?? split.speakerJsonCandidate ?? noteInputMerged).trim()
        }
      }
      if (
        (nodeKind === 'audio' || nodeKind === 'music') &&
        serializedBefore.includes('__NOTE__') &&
        workflowJsonUsesTdMultiDialog(serializedBefore)
      ) {
        const beforeNote = noteForWorkflow
        const converted = tryStructuredVoiceListToMultiDialogLines(beforeNote)
        if (converted) {
          noteForWorkflow = converted
          if (shouldLogComfyDebug()) {
            console.info('[Flowid Comfy][台本] TD MultiDialog：已将结构化列表转为「角色名: 台词」行（避免整段 JSON/Python 列表被当成一句对白）', {
              转换前预览: devSummarizeNoteForComfyLog(beforeNote),
              转换后预览: devSummarizeNoteForComfyLog(converted),
            })
          }
        }
      }
      if (
        shouldLogComfyDebug() &&
        nodeKind === 'audio' &&
        workflowSource.includes('__NOTE__') &&
        workflowJsonUsesTdMultiDialog(serializedBefore)
      ) {
        console.info('[Flowid Comfy][台本] TD 分段与最终写入 __NOTE__', {
          实际替换__NOTE__: devSummarizeNoteForComfyLog(noteForWorkflow),
          CR_Text说话人表原料: devSummarizeNoteForComfyLog(noteRawPreservedForTdCrText),
          说明:
            '「实际替换__NOTE__」应只有对白行（约十几行），不应再含 JSON；「CR_Text」在含说话人列表时应为整段 [...] JSON。',
        })
      }
      const videoDurationSecForPrompt =
        workflowHasVhsLoadVideo && sourceVideoDurationSec > 0
          ? normalizeVideoDurationSecForPrompt(sourceVideoDurationSec)
          : 0
      const textBodyForWorkflow =
        (nodeKind === 'text' || nodeKind === 'script') && videoDurationSecForPrompt > 0
          ? augmentTextBodyForVideoReverse(String(nodeInputs.body ?? ''), sourceVideoDurationSec)
          : String(nodeInputs.body ?? '')
      const resolvedTextSystemPromptForWorkflow = (() => {
        const base = resolveTextComfySystemPrompt(
          nodeKind,
          wfEntryId,
          cloudWorkflowEntryId,
          snapshot.nodeConfigs.text.cloudWorkflowSystemPrompts,
          options?.comfySystemPromptText,
        )
        if (!(nodeKind === 'text' || nodeKind === 'script') || videoDurationSecForPrompt <= 0) {
          return base
        }
        const line = buildVideoReverseDurationConstraintLine(sourceVideoDurationSec)
        return base ? `${base}\n\n${line}` : line
      })()
      const comfyVisualPrompt = String(nodeInputs.prompt ?? '')
      const outpaintPadsForWorkflow =
        (nodeKind === 'image' || nodeKind === 'video') &&
        workflowSupportsOutpaintPadControls(workflowSource, wfLabel)
          ? resolveOutpaintPadsFromNode(nodeInputs as NodeInputRecord)
          : null
      if (outpaintPadsForWorkflow) {
        const p = outpaintPadsForWorkflow
        options?.onPreflightMessage?.(
          `扩图边距：左 ${p.left} · 上 ${p.top} · 右 ${p.right} · 下 ${p.bottom}`,
        )
        if (import.meta.env.DEV) {
          console.info('[Flowid Comfy][扩图] 使用面板四向边距', p)
        }
      }
      let text = replaceIndexedPromptPlaceholders(serializedBefore, nodeInputs)
        .replaceAll(
          '__MATTING_POINTS_JSON__',
          escapeForJsonStringLiteralFragment(
            String((nodeInputs as { mattingPointsJson?: string }).mattingPointsJson ?? '[]'),
          ),
        )
        .replaceAll(
          '__MATTING_POSITIVE_COORDS_JSON__',
          escapeForJsonStringLiteralFragment(
            String((nodeInputs as { mattingPositiveCoordsJson?: string }).mattingPositiveCoordsJson ?? '[]'),
          ),
        )
        .replaceAll(
          '__MATTING_NEGATIVE_COORDS_JSON__',
          escapeForJsonStringLiteralFragment(
            String((nodeInputs as { mattingNegativeCoordsJson?: string }).mattingNegativeCoordsJson ?? '[]'),
          ),
        )
        .replaceAll(
          '__MATTING_FRAME_INFO_JSON__',
          escapeForJsonStringLiteralFragment(
            String(
              (nodeInputs as { mattingFrameInfoJson?: string }).mattingFrameInfoJson ??
                '{"positive_coords":[],"negative_coords":[],"bbox":[],"frame_index":0}',
            ),
          ),
        )
        .replaceAll('__BODY__', escapeForJsonStringLiteralFragment(textBodyForWorkflow))
        .replaceAll(
          '__SYSTEM_PROMPT__',
          escapeForJsonStringLiteralFragment(resolvedTextSystemPromptForWorkflow),
        )
        .replaceAll(
          '__VIDEO_DURATION_SEC__',
          videoDurationSecForPrompt > 0 ? String(videoDurationSecForPrompt) : '',
        )
        .replaceAll('__SRC__', escapeForJsonStringLiteralFragment(comfySrc))
        .replaceAll('__VIDEO__', escapeForJsonStringLiteralFragment(comfyVideoSrc))
        .replaceAll('__NOTE__', escapeForJsonStringLiteralFragment(noteForWorkflow))
        .replaceAll('__REF_IMAGE__', escapeForJsonStringLiteralFragment(comfyFirstRefImage))
        .replaceAll('__REF_IMAGES__', escapeForJsonStringLiteralFragment(comfyRefImages))
        // 宫格分割占位符替换
        .replaceAll('__GRID_HORIZONTAL__', String((nodeInputs as NodeInputRecord).gridHorizontal ?? 2))
        .replaceAll('__GRID_VERTICAL__', String((nodeInputs as NodeInputRecord).gridVertical ?? 2))
        .replaceAll('__GRID_REMOVE_EDGE__', String((nodeInputs as NodeInputRecord).gridRemoveEdge ?? true))
        .replaceAll('__GRID_REMOVE_STROKE__', String((nodeInputs as NodeInputRecord).gridRemoveStroke ?? 0))
        .replaceAll('__GRID_FILE_PREFIX__', escapeForJsonStringLiteralFragment(String((nodeInputs as NodeInputRecord).gridFilePrefix ?? '宫格_')))
        .replaceAll('__GRID_FORMAT__', String((nodeInputs as NodeInputRecord).gridFormat ?? 'PNG'))
        // __GRID_IMAGE_1__ ~ __GRID_IMAGE_5__ 动态替换
        .replaceAll('__GRID_IMAGE_1__', gridImageFilenames[0] ?? '')
        .replaceAll('__GRID_IMAGE_2__', gridImageFilenames[1] ?? '')
        .replaceAll('__GRID_IMAGE_3__', gridImageFilenames[2] ?? '')
        .replaceAll('__GRID_IMAGE_4__', gridImageFilenames[3] ?? '')
        .replaceAll('__GRID_IMAGE_5__', gridImageFilenames[4] ?? '')
        .replaceAll(
          '__STYLE_TONE__',
          escapeForJsonStringLiteralFragment(String((nodeInputs as NodeInputRecord).comfyWorkflowStyleTone ?? '')),
        )
        .replaceAll(
          '__CAM_PARAM_LINE__',
          escapeForJsonStringLiteralFragment(
            `(horizontal: ${clampMultiangleHV((nodeInputs as NodeInputRecord).comfyMultiangleH, FLOWID_MULTIANGLE_DEFAULT_H)}, vertical: ${clampMultiangleHV((nodeInputs as NodeInputRecord).comfyMultiangleV, FLOWID_MULTIANGLE_DEFAULT_V)}, zoom: ${clampMultiangleZoom((nodeInputs as NodeInputRecord).comfyMultiangleZoom, FLOWID_MULTIANGLE_DEFAULT_ZOOM)})`,
          ),
        )
      // 仅上传 M 个文件时：1…M 一一对应；M+1…N 仍须替换占位符（静态工作流有 N 个 LoadAudio），沿用末路 Comfy 文件名，不触发额外上传。
      if (audioRefSlotCount > 0 && audioUploadList.length > 0) {
        for (let slot = 1; slot <= audioRefSlotCount; slot += 1) {
          const idx = Math.min(slot - 1, audioUploadList.length - 1)
          text = text.replaceAll(
            `__REF_AUDIO_${slot}__`,
            escapeForJsonStringLiteralFragment(audioUploadList[idx]!.filename),
          )
        }
      }
      prompt = JSON.parse(text) as Record<string, unknown>
      if (outpaintPadsForWorkflow) {
        prompt = injectOutpaintPadsIntoComfyPrompt(prompt, outpaintPadsForWorkflow)
      }
      if (nodeKind === 'audio') {
        applyNoteToTdMultiSpeakerTemplatePrompt(prompt, {
          dialogueText: noteForWorkflow,
          speakerListRaw: noteRawPreservedForTdCrText,
          hadNotePlaceholder: serializedBefore.includes('__NOTE__'),
        })
        const vtRows = (node.data as AudioNodeData).comfyVoiceTableRows
        if (
          shouldLogComfyDebug() &&
          serializedBefore.includes('__NOTE__') &&
          Array.isArray(vtRows) &&
          vtRows.length > 0
        ) {
          const rowsDbg = vtRows.map((r, i) => {
            if (!voiceTableRowHasContent(r)) return null
            return {
              表格行: i + 1,
              角色名称: String(r.roleName || '').trim() || '（空）',
              样句字数: String(r.sampleLine || '').trim().length,
              声音设定字数: String(r.voiceInstruct || '').trim().length,
              语言: String(r.language || '').trim() || 'Auto',
            }
          })
          console.info('[Flowid Comfy][台本] 8路音色表（仅列有内容的行；样句进 VoiceDesign，全剧台本在 __NOTE__）', {
            有内容行数: rowsDbg.filter(Boolean).length,
            各行: rowsDbg.filter(Boolean),
          })
        }
        if (Array.isArray(vtRows) && vtRows.some(voiceTableRowHasContent)) {
          applyComfyVoiceTableRowsToPrompt(prompt, vtRows)
        }
        const tdRefRows = (node.data as AudioNodeData).comfyTdRefAudioRoleRows
        const tdSpeakerIds = resolveTdDefineSpeakerNodeIdsForRefSlots(serializedBefore)
        if (
          tdSpeakerIds &&
          tdSpeakerIds.length > 0 &&
          Array.isArray(tdRefRows) &&
          tdRefRows.some((r) => String(r?.roleName ?? '').trim())
        ) {
          applyComfyTdRefAudioRoleRowsToPrompt(prompt, tdRefRows, tdSpeakerIds, {
            /** 匹配表不含主预览（__REF_AUDIO_1__），行从第 2 路参考音起写 DefineSpeaker */
            skipLeadingSlots: 1,
          })
          rebindTdMultiDialogSpeakersForRefRoleMap(prompt, tdSpeakerIds, tdRefRows, {
            skipLeadingSlots: 1,
          })
          if (shouldLogComfyDebug()) {
            const multiEntry = Object.entries(prompt).find(
              ([, v]) =>
                v &&
                typeof v === 'object' &&
                !Array.isArray(v) &&
                (v as { class_type?: string }).class_type === 'TDQwen3TTSMultiDialog',
            )
            if (multiEntry) {
              const [, multiNode] = multiEntry
              const ins = (multiNode as { inputs?: Record<string, unknown> }).inputs ?? {}
              const wiring: Record<string, string> = {}
              for (const [k, v] of Object.entries(ins)) {
                if (!/^speaker_\d+$/.test(k) || !Array.isArray(v) || typeof v[0] !== 'string') continue
                const sp = prompt[v[0]] as { inputs?: { name?: unknown } } | undefined
                wiring[k] = String(sp?.inputs?.name ?? v[0]).trim()
              }
              console.info('[Flowid Comfy][台本] TD MultiDialog 说话人重绑（避免按 10 路模板轮询）', {
                说明:
                  'speaker_1 起仅接匹配表角色，不再接主预览「旁白」；多余 speaker_N 接到最后一角色。',
                最终speaker接线: wiring,
              })
            }
          }
        }
        if (shouldLogComfyDebug() && serializedBefore.includes('__NOTE__')) {
          const rbNode = prompt['18'] as
            | { class_type?: string; inputs?: Record<string, unknown> }
            | undefined
          if (rbNode?.class_type === 'FB_Qwen3TTSRoleBank' && rbNode.inputs) {
            const roleNames: Record<string, string> = {}
            for (let i = 1; i <= 8; i += 1) {
              roleNames[`role_name_${i}`] = String(rbNode.inputs[`role_name_${i}`] ?? '').trim()
            }
            console.info(
              '[Flowid Comfy][台本] RoleBank 最终角色名（Comfy 只认这些前缀；未在表里的台本行可能被跳过）',
              roleNames,
            )
          }
        }
        if (shouldLogComfyDebug() && serializedBefore.includes('__NOTE__')) {
          const dlgEntry = Object.entries(prompt).find(
            ([, v]) =>
              v &&
              typeof v === 'object' &&
              !Array.isArray(v) &&
              (v as { class_type?: string }).class_type === 'FB_Qwen3TTSDialogueInference',
          )
          if (dlgEntry) {
            const [, dlgNode] = dlgEntry
            const script = String((dlgNode as { inputs?: { script?: unknown } }).inputs?.script ?? '')
            const sum = devSummarizeNoteForComfyLog(script)
            const scriptLinePrefixes = [
              ...new Set(
                script
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => {
                    const m = /^([^:：]+)[:：]/.exec(l)
                    return m ? String(m[1]).trim() : ''
                  })
                  .filter(Boolean),
              ),
            ]
            console.info('[Flowid Comfy][台本] FB_Qwen3TTSDialogueInference 最终 script（已进 Comfy prompt）', {
              prompt节点id: dlgEntry[0],
              ...sum,
              台本行首角色去重列表: scriptLinePrefixes,
              对白行首格式提示:
                '每行须为「角色名:台词」或「角色名：台词」；行首角色名须出现在上方 RoleBank 最终角色名中，否则该句可能不合成。',
              全文预览:
                script.length > 900
                  ? `${script.slice(0, 420)}\n…(中略 ${script.length - 420 - 200} 字)…\n${script.slice(-200)}`
                  : script || '（空 — 检查 __NOTE__ 与 @ 引用）',
            })
          } else {
            console.info(
              '[Flowid Comfy][台本] 未找到 FB_Qwen3TTSDialogueInference 节点（当前工作流可能不是多人对白图）',
            )
          }
        }
      }
      prompt = replacePlaceholderStringWithNumber(prompt, '__REF_COUNT__', comfyRefCount) as Record<
        string,
        unknown
      >
      prompt = replacePlaceholderStringWithNumber(
        prompt,
        '__CAM_H__',
        clampMultiangleHV((nodeInputs as NodeInputRecord).comfyMultiangleH, FLOWID_MULTIANGLE_DEFAULT_H),
      ) as Record<string, unknown>
      prompt = replacePlaceholderStringWithNumber(
        prompt,
        '__CAM_V__',
        clampMultiangleHV((nodeInputs as NodeInputRecord).comfyMultiangleV, FLOWID_MULTIANGLE_DEFAULT_V),
      ) as Record<string, unknown>
      prompt = replacePlaceholderStringWithNumber(
        prompt,
        '__CAM_Z__',
        clampMultiangleZoom((nodeInputs as NodeInputRecord).comfyMultiangleZoom, FLOWID_MULTIANGLE_DEFAULT_ZOOM),
      ) as Record<string, unknown>
      if (nodeKind === 'image' || nodeKind === 'video') {
        const dataWH = node.data as ImageNodeData | VideoNodeData
        const resolvedWH = resolveComfyWorkflowWidthHeight(nodeKind, dataWH, serializedBefore)
        const w = Number((nodeInputs as NodeInputRecord).comfyWorkflowWidth)
        const h = Number((nodeInputs as NodeInputRecord).comfyWorkflowHeight)
        const safeW = Number.isFinite(w) ? w : resolvedWH.width
        const safeH = Number.isFinite(h) ? h : resolvedWH.height
        /** Qwen Image：必须用官方固定分辨率，忽略节点里残留的 GPT 表或 3072 等自定义宽高。 */
        const qwenWH = workflowJsonUsesQwenImageModel(serializedBefore)
          ? resolveComfyWorkflowWidthHeight(nodeKind, dataWH, serializedBefore)
          : null
        const finalW = qwenWH?.width ?? safeW
        const finalH = qwenWH?.height ?? safeH
        if (import.meta.env.DEV && qwenWH && (finalW !== safeW || finalH !== safeH)) {
          console.info('[Flowid Comfy] Qwen Image 工作流：已改用官方分辨率', {
            原提取宽高: { width: safeW, height: safeH },
            实际注入: { width: finalW, height: finalH },
          })
        }
        prompt = replacePlaceholderStringWithNumber(prompt, '__WIDTH__', finalW) as Record<string, unknown>
        prompt = replacePlaceholderStringWithNumber(prompt, '__HEIGHT__', finalH) as Record<string, unknown>
      }
      // 图片/视频/文本@图：有上传图时必注入 LoadImage；无占位符的工作流也走兜底。
      if (
        nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length) &&
        (comfyImageInjectUploads.length > 0 ||
          !serializedBefore.includes('__SRC__') ||
          !serializedBefore.includes('__REF_IMAGES__'))
      ) {
        const linkedLoadImageNodeIds = collectLinkedLoadImageNodeIds(prompt)
        prompt = injectVisualImageFallback(prompt, comfyImageInjectUploads, {
          primaryFilename: primaryUpload?.filename || gridImageFilenames[0]?.trim() || undefined,
          refFilenames: refUploads.map((item) => item.filename),
          linkedLoadImageNodeIds,
        })
      }
      if (isGridSplitWorkflow && nodeKind === 'image') {
        const assigned = collectLoadImageAssignedFilenames(prompt)
        const gridMain = gridImageFilenames[0]?.trim()
        if (!gridMain || !assigned.includes(gridMain)) {
          throw new Error(
            `宫格图文件名未写入 Comfy LoadImage（期望「${gridMain || '（空）'}」，槽位实际：${assigned.join('、') || '（无）'}）。请保存宫格后重试；若仍失败请重启 Flowid 再执行。`,
          )
        }
      }
      if (import.meta.env.DEV && nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        console.info('[Flowid Diagnose] 注入候选文件名池', {
          主图: primaryUpload?.filename || '（无）',
          参考图: refUploads.map((item) => item.filename),
          注入池顺序: comfyInjectUploads.map((item) => item.filename),
        })
      }
      if (nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        const slotRows = summarizeLoadImageSlotsForUi(prompt)
        if (slotRows.length > 0) {
          const uiMessage = `执行前 LoadImage 槽位：${slotRows.join(' | ')}`
          setLastExecutionMessage(uiMessage)
          options?.onPreflightMessage?.(uiMessage)
        }
      }
      // 修复 ComfyUI 连线引用缺槽位等问题，避免把 `[nodeId,]` 误判为文件名数组并写坏输入端。
      prompt = repairComfyWorkflowTensorLinks(prompt)
      // 补全 VAEDecode / VAEEncode* 上丢失的 vae 连线（常见于 API 导出断链）
      prompt = injectMissingVaeInputLinks(prompt)
      // 音乐节点：除 __PROMPT__/__NOTE__ 占位替换外，仍把侧栏/连线合并后的正文扫入常见文本槽，覆盖模板里写死的默认提示词。
      if (nodeKind === 'music' && typeof nodeInputs.note === 'string' && nodeInputs.note.trim()) {
        prompt = injectMusicPromptFallback(prompt, nodeInputs.note)
      }
      if (nodeKind === 'music') {
        const draft = musicFineTuneDraftFromAudioData(node.data as AudioNodeData)
        prompt = injectMusicWorkflowFineTune(prompt, buildMusicFineTuneInjection(draft))
      }
      // 文本/剧本兜底：未使用 __BODY__ 时，有输入就覆盖工作流默认文本输入。
      if (
        (nodeKind === 'text' || nodeKind === 'script') &&
        textBodyForWorkflow.trim() &&
        !serializedBefore.includes('__BODY__')
      ) {
        prompt = injectTextBodyFallback(prompt, textBodyForWorkflow)
      }
      const resolvedTextSystemPrompt = resolvedTextSystemPromptForWorkflow
      if (
        (nodeKind === 'text' || nodeKind === 'script') &&
        resolvedTextSystemPrompt &&
        !serializedBefore.includes('__SYSTEM_PROMPT__')
      ) {
        prompt = injectTextSystemPromptFallback(prompt, resolvedTextSystemPrompt)
      }
      const selectedWorkflowName = wfLabel
      const workflowNeedsImageInput = requiresImageInputByWorkflowName(selectedWorkflowName)
      // 图片/视频节点：允许纯图片输入（无文本提示词）执行，不再做空提示词拦截。
      if (nodeKind === 'image' || nodeKind === 'video') {
        const visualSrc = comfySrc.trim()
        const visualRefs = comfyRefImages.trim()
        if (workflowNeedsImageInput && !visualSrc && !visualRefs) {
          throw new Error(
            `当前工作流「${selectedWorkflowName}」要求图片输入，但未检测到 src/refImages。请先上传图片，或在提示词中使用 @图节点名 引用后再执行`,
          )
        }
      }
      // 图片/视频兜底：将节点提示词覆盖到正向候选字段，避免仍吃到工作流默认文案。
      if (nodeKind === 'image' || nodeKind === 'video') {
        const workflowHasPromptPlaceholder = serializedBefore.includes('__PROMPT__')
        if (typeof comfyVisualPrompt === 'string') {
          prompt = injectVisualPromptFallback(prompt, comfyVisualPrompt, {
            forceOverwriteTemplateClip:
              !workflowHasPromptPlaceholder && Boolean(String(comfyVisualPrompt || '').trim()),
          })
        }
        if (nodeKind === 'video') {
          prompt = injectLtxPromptRelayMultilineTexts(prompt, nodeInputs as NodeInputRecord)
        }
        if (import.meta.env.DEV && nodeKind === 'image' && !workflowHasPromptPlaceholder) {
          console.info('[Flowid Comfy][文生图] 无 __PROMPT__ 模板：已用面板/继承提示词覆盖 CLIP 正向', {
            工作流: wfLabel,
            提示词字数: String(comfyVisualPrompt || '').length,
            提示词预览: String(comfyVisualPrompt || '').slice(0, 120),
          })
        }
      }
      const wanPositiveClipId = findWanPositiveClipTextEncodeNodeId(prompt)
      if (nodeKind === 'video' && wanPositiveClipId) {
        const clipNode = prompt[wanPositiveClipId] as { inputs?: { text?: unknown } } | undefined
        const injectedPositive = String(clipNode?.inputs?.text ?? '').trim()
        if (!injectedPositive) {
          throw new Error(
            '首尾帧视频工作流：正向提示词未写入 CLIP 节点（面板提示词为空或未注入）。请填写英文/中文动作描述后再执行。',
          )
        }
      }
      // tensor 链路场景：把上传后的文件名同步到上游读图节点（通常在 `LoadImage`）。
      // 仅在“本次只有一张上传图”时启用，避免多图（主图+参考图）场景把参考图槽位被主图反向覆盖。
      const totalUploads = (primaryUpload ? 1 : 0) + refUploads.length
      const propagateUpload =
        totalUploads === 1
          ? (primaryUpload ?? refUploads[0] ?? null)
          : null
      if (
        nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length) &&
        propagateUpload &&
        isComfyUploadedImageFile(propagateUpload)
      ) {
        prompt = propagateComfyFilenameToLinkedLoadImages(prompt, propagateUpload)
      }
      if (nodeKind === 'video' && audioUploadList[0]) {
        prompt = propagateComfyFilenameToLoadAudioNodes(prompt, audioUploadList[0]!)
      }
      if ((nodeKind === 'text' || nodeKind === 'script') && videoUpload) {
        prompt = propagateComfyFilenameToVhsLoadVideoNodes(prompt, videoUpload)
      }
      const multiImageForComfyLoaders =
        orderedInputImageUrls.length > 1 || refUploads.length > 0 || totalUploads > 1
      if (
        nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length) &&
        primaryUpload?.filename &&
        isComfyUploadedImageFile(primaryUpload) &&
        !multiImageForComfyLoaders
      ) {
        prompt = forcePrimaryImageOnLinkedLoadImages(prompt, primaryUpload.filename)
      }
      if (nodeKind === 'video' && wanPositiveClipId) {
        prompt = injectWanFirstLastFrameImageLoaderFilenames(prompt, allUploads)
        const loaderNames = collectLoadImageAssignedFilenames(prompt)
        if (loaderNames.length >= 2 && loaderNames[0] === loaderNames[1]) {
          throw new Error(
            '首尾帧视频工作流：首帧与尾帧 Comfy 文件名相同。请确认提示词 @ 顺序为「先首帧、后尾帧」，或本地参考图按该顺序放 2 张不同图片。',
          )
        }
      }
      if (nodeKindUsesComfyImagePipeline(nodeKind, orderedInputImageUrls.length)) {
        const expectedNames = comfyImageInjectUploads
          .map((item) => String(item.filename || '').trim())
          .filter(Boolean)
        const assignedNames = collectLoadImageAssignedFilenames(prompt)
        const missingAssigned = expectedNames.filter((name) => !assignedNames.includes(name))
        if (import.meta.env.DEV) {
          console.info('[Flowid Diagnose] 提交前图片注入校验', {
            期望文件名: expectedNames,
            槽位实际文件名: assignedNames,
            缺失文件名: missingAssigned,
          })
        }
        const needsComfyImage =
          workflowNeedsImageInput ||
          workflowJsonRequiresComfyImageUpload(workflowSource) ||
          collectLinkedLoadImageNodeIds(prompt).size > 0
        if (needsComfyImage && expectedNames.length === 0 && orderedInputImageUrls.length > 0) {
          throw new Error(
            `参考图已准备 ${orderedInputImageUrls.length} 张，但上传到 Comfy 失败或未生成文件名。请确认 Comfy 已启动、图片节点 @ 引用有效，并查看控制台「上传失败明细」。`,
          )
        }
        if (needsComfyImage && expectedNames.length === 0) {
          const hadMentionInPanel = String(options?.rawPromptText || '').includes('@')
          throw new Error(
            hadMentionInPanel
              ? '当前工作流需要图片输入，但未能从 @ 引用解析到有效图片（常见原因：图片节点仅有本地资产 id、预览正常但 src 为空，或 @ 的节点不在上游连线内）。请重新打开图片节点确认有图，或把图片节点连到视频节点上游后再执行。'
              : '当前工作流需要图片输入，但未检测到可上传的图片。请在视频/图片节点上传主图，或在提示词中用 @ 引用「图片节点」后再执行。',
          )
        }
        const assignedBeforeSubmit = collectLoadImageAssignedFilenames(prompt)
        if (
          needsComfyImage &&
          workflowSource.includes('__SRC__') &&
          assignedBeforeSubmit.some((n) => !String(n || '').trim())
        ) {
          throw new Error(
            'LoadImage 主图文件名为空（多为上传失败）。请重新执行；桌面端可确认设置里「输入目录」与 Comfy input 一致，且目录内已有镜像 png。',
          )
        }
        if (
          workflowNeedsImageInput &&
          expectedNames.length > 0 &&
          missingAssigned.length === expectedNames.length
        ) {
          const unlinkedLoadImages = collectUnlinkedLoadImageNodeHints(prompt)
          const unlinkedSuffix = unlinkedLoadImages.length
            ? ` 未接入主链路的LoadImage：${unlinkedLoadImages.join(', ')}。`
            : ''
          throw new Error(
            `图片注入失败：工作流图片槽位未接收到本次上传文件名（仅收到提示词）。请检查该工作流的 LoadImage 连线是否接入主生成链路。${unlinkedSuffix}`,
          )
        }
      }
      if (snapshot.randomizeKsamplerSeedsOnRun) {
        prompt = randomizeKsamplerSeedsInPrompt(prompt)
      }
      if (shouldLogComfyDebug()) {
        console.info(
          '[Flowid Comfy] 即将提交：各节点 inputs 预览（最终 prompt；tensor 联线显示为 [联线/对象]）',
          devSummarizeComfyPromptForLog(prompt),
        )
        const imageLoads = devSummarizeComfyImageLoadNodesForLog(prompt)
        if (imageLoads.length) {
          console.info('[Flowid Comfy] 图片加载节点全量列表（首尾帧请核对各节点 image 是否不同）', imageLoads)
        }
      }
      const qwenLikeSummary = summarizeQwenLikeNodesForLog(prompt)
      if (shouldLogComfyDebug() && qwenLikeSummary.length) {
        console.info('[Flowid Comfy] 本次提交中的 Qwen 类节点（model / quantization）', qwenLikeSummary)
      }
      const loopTotalSummary = summarizeForLoopStartTotalForLog(prompt)
      if (shouldLogComfyDebug() && loopTotalSummary.length) {
        console.info('[Flowid Comfy] forLoopStart.total 最终值与类型', loopTotalSummary)
      }
      options?.onProgress?.({ percent: 5, label: '正在提交 Comfy 任务…' })
      const submittedAtMs = Date.now()
      const taskFingerprint: ComfyHistoryTaskFingerprint = {
        promptDigest: buildComfyPromptDigest(prompt),
      }
      if (shouldLogComfyDebug()) {
        const dlg = Object.entries(prompt).find(
          ([, v]) =>
            v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            (v as { class_type?: string }).class_type === 'FB_Qwen3TTSDialogueInference',
        )
        const scriptLen = dlg
          ? String((dlg[1] as { inputs?: { script?: unknown } }).inputs?.script ?? '').length
          : 0
        const promptJsonChars = JSON.stringify(prompt).length
        console.info('[Flowid Comfy] POST /prompt 实际提交体量（核对云端是否「像空的」）', {
          顶层节点数: Object.keys(prompt).length,
          Dialogue节点id: dlg?.[0] ?? '（未找到）',
          DialogueInference_script字数: scriptLen,
          prompt字段序列化字符数: promptJsonChars,
          说明1:
            '网页队列里不显示画布连线 ≠ 没提交：标准 API 只送 JSON，界面常常「看起来像空卡片」。',
          说明2:
            '请在云端 Comfy 打开 History，用本次 promptId 找条目，展开 outputs；若 script 字数与侧栏台本接近，则正文已在服务端。',
        })
      }
      prompt = await normalizeComfyLoaderModelPathsInPrompt(prompt, effectiveProviderConfig)
      const promptId = await submitComfyPrompt({
        providerConfig: effectiveProviderConfig,
        prompt,
      })
      if (shouldLogComfyDebug()) {
        console.info('[Flowid Comfy] 本次任务提交目标（请与 Comfy 终端所属服务对照）', {
          执行提供方: targetProvider,
          baseUrl: String(effectiveProviderConfig.baseUrl || '').trim() || '（空）',
          promptId,
          说明:
            '若此处 baseUrl 与本机 Comfy 启动地址（含端口）不一致，你看到的 got prompt / 耗时不代表本次 Flowid 提交；云端/反代时应在对应服务器上看日志。',
        })
      }
      options?.onProgress?.({ percent: 9, label: '任务已提交，等待执行…' })
      /** 与 `isHistoryEntryReady` 对齐：图/视频必须等 SaveImage 等真正写入，避免仅节点 14 的 `text: ["1371x765"]` + completed 误判 */
      const historyResultExpectation: ComfyHistoryResultExpectation =
        nodeKind === 'video'
          ? 'video'
          : nodeKind === 'image'
            ? 'visual'
            : nodeKind === 'audio' || nodeKind === 'music'
              ? 'audio'
              : 'general'
      let historyEntry = await waitComfyHistory({
        providerConfig: effectiveProviderConfig,
        promptId,
        onProgress: options?.onProgress,
        submittedAtMs,
        taskFingerprint,
        resultExpectation: historyResultExpectation,
      })
      options?.onProgress?.({ percent: 92, label: '任务已完成，正在解析输出…' })
      let previewUrl =
        nodeKind === 'video'
          ? pickComfyResultVideoUrl({
              providerConfig: effectiveProviderConfig,
              historyEntry,
              excludeFilenames: comfyInjectUploads.map((item) => String(item.filename || '').trim()).filter(Boolean),
              workflowPrompt: prompt,
            })
          : pickComfyResultImageUrl({
              providerConfig: effectiveProviderConfig,
              historyEntry,
              preferVideoOutput: false,
            })
      const uploadedInputFilenameSet = new Set(
        comfyInjectUploads.map((item) => String(item.filename || '').trim()).filter(Boolean),
      )
      const isInputEchoPreview = (url: string | null | undefined): boolean => {
        const fn = readFilenameFromComfyViewUrl(url)
        if (!fn) return false
        return uploadedInputFilenameSet.has(fn)
      }
      if ((nodeKind === 'image' || nodeKind === 'video') && isInputEchoPreview(previewUrl)) {
        if (import.meta.env.DEV) {
          console.warn('[Flowid Diagnose] 结果解析命中输入图回显，改为继续查找输出图', {
            previewUrl,
            filename: readFilenameFromComfyViewUrl(previewUrl),
            uploadedInputs: Array.from(uploadedInputFilenameSet),
          })
        }
        previewUrl = null
      }
      if (nodeKind === 'image' && !previewUrl) {
        const recovered = await refetchHistoryEntryWithRasterVisual({
          providerConfig: effectiveProviderConfig,
          promptId,
        })
        if (recovered) {
          historyEntry = recovered
          previewUrl = pickComfyResultImageUrl({
            providerConfig: effectiveProviderConfig,
            historyEntry,
            preferVideoOutput: false,
          })
          if (isInputEchoPreview(previewUrl)) {
            if (import.meta.env.DEV) {
              console.warn('[Flowid Diagnose] 二次解析仍命中输入图回显，置空等待后续兜底', {
                previewUrl,
                filename: readFilenameFromComfyViewUrl(previewUrl),
              })
            }
            previewUrl = null
          }
        }
      }
      /** 视频：等 VHS mp4 写入 history 后再解析（避免 PreviewImage png 导致黑屏） */
      if (nodeKind === 'video' && !previewUrl) {
        const recovered = await refetchHistoryEntryWithVideoOutput({
          providerConfig: effectiveProviderConfig,
          promptId,
        })
        if (recovered) {
          historyEntry = recovered
          previewUrl = pickComfyResultVideoUrl({
            providerConfig: effectiveProviderConfig,
            historyEntry,
            excludeFilenames: uploadedInputFilenameSet,
            workflowPrompt: prompt,
          })
          if (isInputEchoPreview(previewUrl)) {
            previewUrl = null
          }
        }
      }
      /** 图生视频_音：成片在 VHS；仅配音节点才依赖 PreviewAudio 作主结果 */
      let audioUrl =
        nodeKind === 'audio' || nodeKind === 'music'
          ? await pickComfyResultAudioUrlAsync({
              providerConfig: effectiveProviderConfig,
              historyEntry,
              excludeFilenames: uploadedInputFilenameSet,
            })
          : null
      if (!audioUrl && (nodeKind === 'audio' || nodeKind === 'music')) {
        const recovered = await refetchHistoryEntryWithAudioOutput({
          providerConfig: effectiveProviderConfig,
          promptId,
        })
        if (recovered) {
          historyEntry = recovered
          audioUrl = await pickComfyResultAudioUrlAsync({
            providerConfig: effectiveProviderConfig,
            historyEntry: recovered,
            excludeFilenames: uploadedInputFilenameSet,
          })
        }
      }
      /**
       * 仅配音/音乐节点需要「全量历史里找最近音频」兜底；图/视频节点不要扫，
       * 否则历史条目极多时 `fetch(/history)` 会长时间阻塞，界面卡在队列阶段的进度（如 48%）。
       */
      const shouldScanHistoryForAudioFallback =
        !audioUrl && (nodeKind === 'audio' || nodeKind === 'music')
      if (shouldScanHistoryForAudioFallback) {
        options?.onProgress?.({ percent: 95, label: '正在从历史记录查找音频…' })
      }
      const fallbackAudioUrl =
        audioUrl ??
        (shouldScanHistoryForAudioFallback
          ? await pickLatestComfyAudioUrlFromHistory({
              providerConfig: effectiveProviderConfig,
              excludeFilenames: uploadedInputFilenameSet,
            })
          : null)
      /**
       * 图片/视频节点只使用本次任务的输出，避免误拿到“输入参考图/历史最近图”回填成原图。
       * 文本等非视觉节点保留历史兜底能力，兼容部分工作流只在历史中产出媒体的情况。
       */
      const fallbackMediaUrl =
        previewUrl ??
        (nodeKind === 'image' || nodeKind === 'video'
          ? null
          : await pickLatestComfyMediaUrlFromHistory({
              providerConfig: effectiveProviderConfig,
            }))
      const verifiedAudioUrl = await verifyComfyMediaUrl({
        providerConfig: effectiveProviderConfig,
        mediaUrl: fallbackAudioUrl,
        timeoutMs: nodeKind === 'audio' || nodeKind === 'music' ? 25_000 : 10_000,
      })
      const verifiedMediaUrl = await verifyComfyMediaUrl({
        providerConfig: effectiveProviderConfig,
        mediaUrl: fallbackMediaUrl,
        timeoutMs: nodeKind === 'video' ? 90_000 : 10_000,
      })
      /**
       * 图片/视频：跨域直连 Comfy 时 `fetch(view)` 常因 CORS 失败，但 `<img>/<video src>` 仍可显示。
       * 校验失败时仍采用本次 history 解析出的 URL，避免节点拿不到图。
       */
      const effectiveMediaUrl =
        verifiedMediaUrl ||
        (nodeKind === 'image' || nodeKind === 'video' ? fallbackMediaUrl : null)
      /** 配音/音乐：与图/视频一致，校验失败（CORS/超时）时仍回填 history 解析出的 URL，交由播放器/桌面镜像处理。 */
      const effectiveAudioUrl =
        verifiedAudioUrl ||
        ((nodeKind === 'audio' || nodeKind === 'music') && fallbackAudioUrl ? fallbackAudioUrl : null)
      /** 图生视频（含 Foley 音效）：主预览必须是 mp4/webm，不能把 PreviewAudio 当成 resultUrl */
      const finalResultUrl =
        nodeKind === 'video'
          ? effectiveMediaUrl || effectiveAudioUrl
          : effectiveAudioUrl || effectiveMediaUrl
      if (
        shouldLogComfyDebug() &&
        nodeKind === 'video' &&
        effectiveAudioUrl &&
        !effectiveMediaUrl
      ) {
        console.warn('[Flowid Comfy][视频] 已解析到 PreviewAudio 但未解析到 VHS mp4，节点可能黑屏', {
          音频URL: effectiveAudioUrl,
          说明:
            '请确认 history 中 VHS_VideoCombine 含 gifs/videos；绝对路径 output/Video/… 已支持解析。',
        })
      }
      if (!finalResultUrl) {
        const issue = extractComfyValidationIssue(historyEntry)
        if (issue) {
          throw new Error(issue)
        }
      }
      const msg = finalResultUrl
        ? `执行完成：${node.data.title}，结果预览 ${finalResultUrl}`
        : `执行完成：${node.data.title}`
      setLastExecutionMessage(msg)
      const mappedNodeId = wfResultNodeId
      const mappedFieldPath = wfResultFieldPath
      const textResult =
        nodeKind === 'text' || nodeKind === 'script'
          ? extractComfyResultTextByMapping({
              historyEntry,
              nodeId: mappedNodeId,
              fieldPath: mappedFieldPath,
            }) ?? extractComfyResultText(historyEntry)
          : null
      let resultViewUrls: string[] | undefined
      if (nodeKind === 'image' || nodeKind === 'video') {
        /**
         * 视频：只收 VHS/Wan 成片与可播放 mp4，跳过中间 PreviewImage png（在 `<video>` 条里会显示黑块）。
         * 图片：仍收 history 内全部视觉输出。
         */
        let multi =
          nodeKind === 'video'
            ? pickComfyVideoNodeResultViewUrls({
                providerConfig: effectiveProviderConfig,
                historyEntry,
                excludeFilenames: uploadedInputFilenameSet,
                workflowPrompt: prompt,
              })
            : pickComfyResultImageViewUrls({
                providerConfig: effectiveProviderConfig,
                historyEntry,
                allowFullEntryFallback: true,
                excludeFilenames: uploadedInputFilenameSet,
                omitStaticRasterFilenamesForVideoStrip: false,
                dedupeByFilenameBasename: false,
              })
        multi = multi.filter((u) => !isInputEchoPreview(u))
        if (shouldLogComfyDebug() && nodeKind === 'video') {
          console.info('[Flowid Comfy][视频输出条] URL 数量与文件名', {
            条数: multi.length,
            文件名: multi.map((u) => readFilenameFromComfyViewUrl(u) || u),
            主预览URL: effectiveMediaUrl || '（无）',
            附带音频URL: effectiveAudioUrl || '（无）',
            说明:
              '图生视频_音：主预览须为 mp4；若仅有 PreviewAudio 而无 VHS 成片，请查 history 中 VHS_VideoCombine 节点。',
          })
        }
        if (isGridSplitWorkflow && nodeKind === 'image') {
          const gridPrefix = String((nodeInputs as NodeInputRecord).gridFilePrefix ?? '宫格_').trim()
          const gh = Number((nodeInputs as NodeInputRecord).gridHorizontal ?? 2)
          const gv = Number((nodeInputs as NodeInputRecord).gridVertical ?? 2)
          const expectedGrid = Math.max(1, Math.min(25, Math.round(gh) * Math.round(gv)))
          const before = multi.length
          multi = filterGridSplitResultViewUrls(multi, {
            filePrefix: gridPrefix,
            expectedCount: expectedGrid,
          })
          if (shouldLogComfyDebug()) {
            console.info('[Flowid Comfy][宫格] 输出条已按分格数过滤', {
              过滤前: before,
              过滤后: multi.length,
              期望张数: expectedGrid,
              水平: gh,
              垂直: gv,
              文件名前缀: gridPrefix || '（未设）',
            })
          }
        }
        if (!multi.length && effectiveMediaUrl) {
          multi = [effectiveMediaUrl]
        }
        resultViewUrls = multi.length ? multi : undefined
      }
      return {
        previewUrl: effectiveMediaUrl,
        audioUrl: effectiveAudioUrl,
        resultUrl: finalResultUrl,
        textResult,
        historyEntry,
        resultViewUrls,
      }
      })()
    },
    [snapshot, officialTemplates],
  )

  const resetWorkflowConfig = useCallback(() => {
    setSnapshot(getDefaultWorkflowConfig())
    setLastExecutionMessage('')
  }, [])

  return {
    executionMode: snapshot.executionMode,
    executionProvider: snapshot.executionProvider,
    localConfig: snapshot.local,
    cloudConfig: snapshot.cloud,
    nodeConfigs: snapshot.nodeConfigs,
    cloudEndpoints: snapshot.cloudEndpoints,
    shortcuts: snapshot.shortcuts,
    randomizeKsamplerSeedsOnRun: snapshot.randomizeKsamplerSeedsOnRun,
    lastExecutionMessage,
    connectionTestMessage,
    officialTemplates,
    updateExecutionMode,
    updateExecutionProvider,
    setRandomizeKsamplerSeedsOnRun,
    updateProviderConfig,
    updateNodeConfig,
    addCloudEndpoint,
    updateCloudEndpoint,
    removeCloudEndpoint,
    saveNodeWorkflow,
    selectNodeWorkflow,
    removeNodeWorkflow,
    updateNodeWorkflowEntry,
    clearNodeWorkflows,
    pinNodeWorkflowToTop,
    updateShortcutConfig,
    updateShortcutBinding,
    testProviderConnection,
    refreshOfficialTemplates,
    runNodeWorkflow,
    resetWorkflowConfig,
    /** 工作流配置快照（供画布积分预估等读取） */
    workflowSnapshot: snapshot,
  }
}
