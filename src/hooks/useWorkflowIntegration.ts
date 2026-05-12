import { useCallback, useEffect, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type {
  AudioNodeData,
  CloudWorkflowOverrideEntry,
  ImageNodeData,
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
import { computeAccessState, loadLicenseServerConfig, loadLicenseSnapshotV2, saveLicenseSnapshotV2 } from '../lib/licenseAccess'
import { verifyLicenseRemote } from '../lib/licenseClient'
import { matchStudioNodeWorkflow } from '../lib/matchStudioNodeWorkflow'
import { persistWorkflowJsonToDisk } from '../lib/localAssetDiskMirror'
import { normalizeOpenAICompatibleBaseUrl } from '../lib/openaiCompat'
import { fetchOpenAICompat } from '../lib/openaiProxy'
import { appendCloudCallLog } from '../lib/cloudCallLogs'
import {
  resolveDashscopeQwenImageSize,
  resolveOpenAiImageGenerationOutputParams,
} from '../lib/cloudImageGenerationParams'
import { getActiveCloudSelfDefaultsForNodeKind } from '../lib/cloudSelfPresets'
import {
  getAssistApiKey,
  studioNodeKindToAssistKind,
  tryDecodeCloudAssistModelPick,
} from '../lib/cloudAssistModelCatalog'
import {
  apiPointsCancel,
  apiPointsConfirm,
  apiPointsConfirmFailure,
  apiPointsReserve,
} from '../lib/licensePointsApi'
import { emitPointsTaskFailure } from '../lib/pointsService'
import { buildPointsReserveParams } from '../lib/pointsReserveMetadata'
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
  resolveTdDefineSpeakerNodeIdsForRefSlots,
} from '../lib/comfyTdRefAudioRoleMap'
import {
  applyNoteToTdMultiSpeakerTemplatePrompt,
  normalizeTtsDialogueRoleColons,
  splitTdNoteIntoDialogueAndSpeakerJson,
  tryStructuredVoiceListToMultiDialogLines,
  workflowJsonUsesTdMultiDialog,
} from '../lib/comfyTdMultiDialogScript'
import { resolveComfyWorkflowWidthHeight } from '../lib/comfyWorkflowOutputSize'
import { readLocalImageAssetBlob, getLocalImageAssetObjectUrl } from '../lib/localImageAssetStore'
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
  readFilenameFromComfyViewUrl,
  refetchHistoryEntryWithAudioOutput,
  refetchHistoryEntryWithRasterVisual,
  submitComfyPrompt,
  type ComfyUploadedInputImage,
  uploadComfyInputBinaryFile,
  uploadComfyInputImageAsPng,
  verifyComfyMediaUrl,
  waitComfyHistory,
} from '../lib/comfyClient'

type NodeInputRecord = Record<string, unknown>

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
}

type OfficialTemplateMeta = {
  id: string
  name: string
  version: string
  description?: string
  paramsSchema?: Record<string, unknown>
}

function buildLicenseHeaders(): Record<string, string> | null {
  const snap = loadLicenseSnapshotV2()
  if (!snap?.licenseCode || !snap?.machineId) return null
  return { 'x-license-code': snap.licenseCode, 'x-machine-id': snap.machineId }
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
    return { ...common, body: node.data.body, refImages: '' }
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
    
    const purePairs = mergedPairs.filter((p) => p.url && p.url !== primarySrc)
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
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const refIds = (node.data as any)?.referenceImageAssetIds as string[] | undefined

    const pairs: Array<{ url: string; assetId?: string }> = []
    if (allNodes?.length && promptText.includes('@')) {
      const mentionRefs = parseMentionRefs(promptText)
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

    const purePairs = mergedPairs.filter((p) => p.url && p.url !== primarySrc)
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
    const purePairs = mergedPairs.filter((p) => p.url && p.url !== primarySrc)
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
  const purePairs = mergedPairs.filter((p) => p.url && p.url !== primarySrc)
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
  return dedupeOrderedAudioRefEntries(
    {
      url: String(ni.src ?? '').trim(),
      assetId: String((ni as { srcAssetId?: string }).srcAssetId ?? '').trim() || undefined,
    },
    String((ni as { refImages?: string }).refImages ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => ({ url })),
  )
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
 * 图片/视频节点兜底：当工作流未使用 __PROMPT__ 占位符时，
 * 自动把提示词映射到常见字段，避免“面板有文案但实际未注入”的情况。
 */
function injectVisualPromptFallback(
  prompt: Record<string, unknown>,
  visualPrompt: string,
): Record<string, unknown> {
  const trimmed = visualPrompt.trim()
  if (!trimmed) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const exactCandidateKeys = new Set([
    'prompt',
    'text',
    'positive',
    'positive_prompt',
    'main_prompt',
    'caption',
    'description',
  ])
  const keywordCandidateKeys = ['prompt', 'text', 'caption', 'description', 'subject', 'query']
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
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '').toLowerCase()
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    /**
     * 兼容 Comfy PrimitiveStringMultiline：图片/视频工作流里常用它承载主提示词。
     */
    if (classType.includes('primitivestringmultiline') && typeof inputRecord.value === 'string') {
      inputRecord.value = trimmed
      injectedCount += 1
      continue
    }
    for (const [rawKey, rawValue] of Object.entries(inputRecord)) {
      if (typeof rawValue !== 'string') continue
      const key = String(rawKey)
      const lower = key.toLowerCase()
      const keyMatched =
        exactCandidateKeys.has(lower) ||
        keywordCandidateKeys.some((part) => lower.includes(part))
      if (!keyMatched || isNegativeLikeKey(lower)) continue
      inputRecord[key] = trimmed
      injectedCount += 1
    }
  }
  if (injectedCount > 0) return cloned
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
  const imagePool = normalized
  const primaryFilename = String(options?.primaryFilename || normalized[0]?.filename || '').trim()
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
          // 无可用输入图时清空槽位，避免继续沿用模板中的历史文件名。
          inputRecord[slotKey] = ''
          touchedKeys.add(slotKey)
          assignedInThisNode[slotKey] = '（已清空）'
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
    const licHeaders = buildLicenseHeaders()
    const fetchOpts: RequestInit = licHeaders ? { headers: { ...licHeaders } } : {}

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
      // 轻量：执行前尝试刷新授权（失败不阻断）
      try {
        const snap = loadLicenseSnapshotV2()
        if (snap) {
          const res = await verifyLicenseRemote(snap)
          if (res.ok) {
            const now = Date.now()
            saveLicenseSnapshotV2({
              ...snap,
              licenseCode: res.licenseCode,
              machineId: res.machineId,
              expiresAtMs: res.expiresAtMs,
              entitlements: res.entitlements,
              lastVerifiedAtMs: now,
              serverAnchor: { serverTimeMs: res.serverTimeMs, localTimeMs: now, updatedAtMs: now },
            })
          }
        }
      } catch {
        // ignore
      }
      const access = computeAccessState(loadLicenseSnapshotV2())
      if (access === 'expired') {
        throw new Error('您的授权已到期：请在「授权」里续费或刷新。')
      }
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

      const runWithPointsGuard = async (run: () => Promise<any>): Promise<any> => {
        const snapPoints = loadLicenseSnapshotV2()
        const lc = String(snapPoints?.licenseCode || '').trim()
        const mc = String(snapPoints?.machineId || '').trim()
        /**
         * 授权码 / 积分：仅绑定「云端 ComfyUI 工作流」。
         * OpenAI 兼容「云端模型」不校验授权、不预扣积分（用户自备 Key / 线路）。
         */
        const requiresLicenseForCloudComfy =
          executionTarget === 'workflow' && snapshot.executionProvider === 'cloud'
        const needsPointsReserve = requiresLicenseForCloudComfy
        if (requiresLicenseForCloudComfy && (!lc || !mc)) {
          throw new Error(
            '使用云端 Comfy 工作流前，请先在「设置 → 授权码」中完成激活（需有效授权码与机器码，且积分服务可访问）。',
          )
        }
        if (!needsPointsReserve || !lc || !mc) {
          return await run()
        }
        const dedupeKey = `${lc}_${node.id}_${Date.now()}`
        const rv = await apiPointsReserve({
          licenseCode: lc,
          machineCode: mc,
          dedupeKey,
          nodeKind,
          executionTarget,
          metadata: reserveMetadata,
        })
        if (!rv.success) {
          const code = String((rv as { error?: string }).error || '')
          if (code === 'need_pro_membership') {
            throw new Error(
              String(
                (rv as { message?: string }).message ||
                  '需要 Auth 会员（proTemplates）：请在环境变量 POINTS_PRO_MEMBERSHIP_NODE_KINDS 启用时，为预扣请求附带 JWT 会员码。',
              ),
            )
          }
          throw new Error(
            String(rv.message || '积分不足：请检查授权或启动 Auth 服务（npm run auth:dev / npm run dev，积分 API 在 /pts）'),
          )
        }
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
        const confirmWithRetries = async () => {
          const max = 5
          let lastMsg = 'confirm_failed'
          for (let i = 0; i < max; i += 1) {
            try {
              const c = await apiPointsConfirm({ licenseCode: lc, machineCode: mc, dedupeKey })
              if (c.success) return
              lastMsg = String(c.message || 'confirm_failed')
            } catch (e) {
              lastMsg = String((e as Error)?.message || e || 'confirm_failed')
            }
            await sleep(350 * (i + 1) * (i + 1))
          }
          await apiPointsConfirmFailure({
            licenseCode: lc,
            machineCode: mc,
            dedupeKey,
            errorText: lastMsg,
            metadata: { ...reserveMetadata, attempts: max },
          }).catch(() => {})
        }
        let out: any
        try {
          out = await run()
        } catch (err) {
          const msg = String((err as Error)?.message || err || '未知错误')
          await apiPointsCancel({
            licenseCode: lc,
            machineCode: mc,
            dedupeKey,
            cancelReason: 'failure',
            error: msg,
            metadata: { ...reserveMetadata, nodeId: node.id },
          }).catch(() => {})
          const reasonMax = 120
          const errRaw = msg.trim()
          const truncated = errRaw.length > reasonMax
          const errShort = truncated ? `${errRaw.slice(0, reasonMax)}…` : errRaw
          const toastShort = `任务失败：${errShort}，积分已自动退还`
          setLastExecutionMessage(`任务失败：${msg}，积分已自动退还`)
          emitPointsTaskFailure({
            message: toastShort,
            errorFull: truncated ? errRaw : undefined,
          })
          throw err
        }
        await confirmWithRetries()
        return out
      }

      return await runWithPointsGuard(async () => {
      if (executionTarget === 'model') {
        const nodeModel = String((node.data as any)?.cloudModelName || nodeConfig.cloudModelName || '').trim()
        const nodeBaseUrlRaw = String((node.data as any)?.cloudModelUrl || nodeConfig.cloudModelUrl || '')
        const nodeApiKey = String((node.data as any)?.cloudApiKey || nodeConfig.cloudApiKey || '').trim()

        const self = getActiveCloudSelfDefaultsForNodeKind(nodeKind)
        const model = nodeModel || self.model
        const baseUrl = normalizeOpenAICompatibleBaseUrl(nodeBaseUrlRaw || self.baseUrl || '')
        let apiKey = nodeApiKey || self.apiKey
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
                    prompt: promptForImage,
                    n: 1,
                    size: openAiImgOut.size,
                    ...(openAiImgOut.quality ? { quality: openAiImgOut.quality } : {}),
                    response_format: 'url',
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
              imageUrl = readImageUrl(json)
              if (!imageUrl) {
                throw new Error('云端生图调用成功但未返回图片 URL')
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
        const licenseHeaders = buildLicenseHeaders()
        if (!authBaseUrl || !licenseHeaders) {
          throw new Error('未配置授权服务地址或尚未激活授权，无法提交官方模板任务')
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
            ...licenseHeaders,
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
            {
              headers: {
                ...licenseHeaders,
              },
            },
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
        const authBaseUrl = String(loadLicenseServerConfig().baseUrl || '')
          .trim()
          .replace(/\/+$/, '')
        if (!authBaseUrl) {
          throw new Error('未配置授权服务地址，无法拉取云端工作流')
        }
        const wfRes = await fetch(
          `${authBaseUrl}/cloud-workflows/${encodeURIComponent(cloudWorkflowEntryId)}/workflow`,
        )
        const wfJson = (await wfRes.json().catch(() => ({}))) as {
          workflowJson?: string
          name?: string
          id?: string
          message?: string
        }
        const remoteJson = String(wfJson.workflowJson || '').trim()
        if (!wfRes.ok || !remoteJson) {
          throw new Error(
            String(wfJson.message || `无法拉取云端工作流 JSON（HTTP ${wfRes.status}）`),
          )
        }
        workflowSource = remoteJson
        remoteCloudPick = {
          id: String(wfJson.id || cloudWorkflowEntryId).trim(),
          name: String(wfJson.name || (node.data as { model?: string }).model || cloudWorkflowEntryId).trim(),
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
      const orderedInputImageUrls =
        nodeKind === 'image' || nodeKind === 'video'
          ? (
              nodeInputsRefImages
                ? [String((nodeInputs as any)?.src || ''), ...nodeInputsRefImages.split('\n')]
                : [rawSrc, ...refImageUrls]
            )
              .map((url) => String(url || '').trim())
              .filter(Boolean)
          : []
      const orderedInputAudioUrls =
        (nodeKind === 'audio' || nodeKind === 'music') && audioRefSlotCount > 0
          ? dedupeOrderedAudioInputUrls(rawSrc, refImageUrls)
          : []
      /** 实际上传参考音频所用的 URL 序列（上传前可能再 refresh，与 debug 一致） */
      let audioUploadSourceUrls = orderedInputAudioUrls
      const missingMentionRefs: string[] = []
      if (import.meta.env.DEV && (nodeKind === 'image' || nodeKind === 'video')) {
        console.info('[Flowid Diagnose] 输入图判定详情', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          rawPromptText: String(options?.rawPromptText ?? ''),
          当前src: rawSrc || '（空）',
          nodeInputs_refImages原始文本: rawRefImages || '（空）',
          最终输入序列URL: orderedInputImageUrls,
          缺失参考图URL: missingMentionRefs,
        })
      }
      if ((nodeKind === 'image' || nodeKind === 'video') && orderedInputImageUrls.length === 0 && nodeInputsRefImages) {
        throw new Error(
          `检测到提示词里有 @ 图片引用，但最终输入图为 0。请检查 @ 引用是否指向有效图片节点，或参考图是否已保存。`,
        )
      }
      if (nodeKind === 'image' || nodeKind === 'video') {
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
      if (nodeKind === 'image' || nodeKind === 'video') {
        const requiredInputImages = orderedInputImageUrls.length
        const loadImageSlotCount = countComfyFileLoadImageSlots(prompt)
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
      if (orderedInputImageUrls.length > 0 && (nodeKind === 'image' || nodeKind === 'video')) {
        for (let i = 0; i < orderedInputImageUrls.length; i += 1) {
          const url = orderedInputImageUrls[i]!
          const sourceLabel = mentionLabelByUrl.get(url) || `图${i + 1}`
          const currentLabel =
            String(options?.runNodeTitle || node.data.title || node.id).trim() || '当前节点'
          /** 上传命名采用“当前节点_来源节点_序号”，便于一一对应核对。 */
          const prefix = `${currentLabel}_${sourceLabel}_${i + 1}`
          try {
            const uploaded = await uploadToComfyInput(url, prefix)
            allUploads.push(uploaded)
          } catch (error) {
            uploadFailures.push({
              index: i + 1,
              url,
              reason: String((error as Error)?.message || error || '未知错误'),
            })
          }
        }
      }
      if (
        (nodeKind === 'audio' || nodeKind === 'music') &&
        audioRefSlotCount > 0 &&
        orderedInputAudioUrls.length > 0
      ) {
        let audioEntries = audioRefEntriesFromNodeInputs(nodeInputs as NodeInputRecord)
        try {
          const refreshedInputs = await extractNodeInputs(comfyInputNode, options?.allNodes, {
            studioEdges: options?.studioEdges,
          })
          const next = audioRefEntriesFromNodeInputs(refreshedInputs as NodeInputRecord)
          if (next.length > 0) {
            audioEntries = next
          }
        } catch {
          // 保持首次 extract；有 assetId 时仍可从 IndexedDB 直读
        }
        audioUploadSourceUrls = audioEntries.map((e) => e.url)
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
          const currentLabel =
            String(options?.runNodeTitle || node.data.title || node.id).trim() || '当前节点'
          const prefix = `${currentLabel}_ref_audio_${i + 1}`
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
      if (import.meta.env.DEV && uploadFailures.length > 0) {
        console.warn('[Flowid Diagnose] 上传失败明细（已跳过）', uploadFailures)
      }
      const primaryUpload = allUploads[0] ?? null
      const refUploads = allUploads.slice(1)
      if (import.meta.env.DEV && (nodeKind === 'image' || nodeKind === 'video')) {
        console.info('[Flowid Diagnose] 实际上传结果详情', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          主图上传文件名: primaryUpload?.filename || '（无）',
          参考图上传文件名: refUploads.map((item) => item.filename),
          参考图上传数量: refUploads.length,
        })
      }
      const comfySrc = primaryUpload?.filename ?? ''
      const comfyRefImages = refUploads.map((item) => item.filename).join('\n')
      const comfyFirstRefImage = refUploads[0]?.filename ?? ''
      /** 参考图计数占位符：用于 forLoop 等总数输入（当前按 1~5 夹取，满足常见批处理上限）。 */
      const comfyRefCount = Math.max(1, Math.min(5, refUploads.length))
      /** 主图优先，其次多参考图，供兜底注入 LoadImage / 三元组字段。 */
      const comfyInjectUploads: ComfyUploadedInputImage[] = [
        ...(primaryUpload ? [primaryUpload] : []),
        ...refUploads,
        ...audioUploadList,
      ]
      // 仅对“接入主链路”的多 LoadImage 做参考图缺失拦截；未连线占位节点不参与判断。
      if (nodeKind === 'image' || nodeKind === 'video') {
        const linkedLoadImageCount = collectLinkedLoadImageNodeIds(prompt).size
        if (linkedLoadImageCount > 1 && refUploads.length === 0) {
          throw new Error(
            `检测到当前工作流有 ${linkedLoadImageCount} 个已接入主链路的 LoadImage，但本次参考图上传数为 0。请先在「本地参考图」添加至少 1 张，或在提示词中使用 @图节点 引用后再执行（避免静默沿用旧值）。`,
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
        .replaceAll('__BODY__', escapeForJsonStringLiteralFragment(String(nodeInputs.body ?? '')))
        .replaceAll(
          '__SYSTEM_PROMPT__',
          escapeForJsonStringLiteralFragment(
            (() => {
              const k = String(wfEntryId || cloudWorkflowEntryId || '').trim()
              if (!(nodeKind === 'text' || nodeKind === 'script') || !k) return ''
              return String(snapshot.nodeConfigs.text.cloudWorkflowSystemPrompts?.[k] ?? '')
            })(),
          ),
        )
        .replaceAll('__SRC__', escapeForJsonStringLiteralFragment(comfySrc))
        .replaceAll('__NOTE__', escapeForJsonStringLiteralFragment(noteForWorkflow))
        .replaceAll('__REF_IMAGE__', escapeForJsonStringLiteralFragment(comfyFirstRefImage))
        .replaceAll('__REF_IMAGES__', escapeForJsonStringLiteralFragment(comfyRefImages))
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
        const w = Number((nodeInputs as NodeInputRecord).comfyWorkflowWidth)
        const h = Number((nodeInputs as NodeInputRecord).comfyWorkflowHeight)
        const dataWH = node.data as ImageNodeData | VideoNodeData
        const fallback = resolveComfyWorkflowWidthHeight(nodeKind, dataWH)
        const safeW = Number.isFinite(w) ? w : fallback.width
        const safeH = Number.isFinite(h) ? h : fallback.height
        prompt = replacePlaceholderStringWithNumber(prompt, '__WIDTH__', safeW) as Record<string, unknown>
        prompt = replacePlaceholderStringWithNumber(prompt, '__HEIGHT__', safeH) as Record<string, unknown>
      }
      // 图片/视频节点兜底：若工作流未写 __SRC__/__REF_IMAGES__，自动注入常见图片输入字段。
      if (
        (nodeKind === 'image' || nodeKind === 'video') &&
        (!serializedBefore.includes('__SRC__') || !serializedBefore.includes('__REF_IMAGES__'))
      ) {
        const linkedLoadImageNodeIds = collectLinkedLoadImageNodeIds(prompt)
        prompt = injectVisualImageFallback(prompt, comfyInjectUploads, {
          primaryFilename: primaryUpload?.filename,
          refFilenames: refUploads.map((item) => item.filename),
          linkedLoadImageNodeIds,
        })
      }
      if (import.meta.env.DEV && (nodeKind === 'image' || nodeKind === 'video')) {
        console.info('[Flowid Diagnose] 注入候选文件名池', {
          主图: primaryUpload?.filename || '（无）',
          参考图: refUploads.map((item) => item.filename),
          注入池顺序: comfyInjectUploads.map((item) => item.filename),
        })
      }
      if (nodeKind === 'image' || nodeKind === 'video') {
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
        typeof nodeInputs.body === 'string' &&
        !serializedBefore.includes('__BODY__')
      ) {
        prompt = injectTextBodyFallback(prompt, nodeInputs.body)
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
      if (
        (nodeKind === 'image' || nodeKind === 'video') &&
        typeof nodeInputs.prompt === 'string'
      ) {
        prompt = injectVisualPromptFallback(prompt, nodeInputs.prompt)
      }
      // tensor 链路场景：把上传后的文件名同步到上游读图节点（通常在 `LoadImage`）。
      // 仅在“本次只有一张上传图”时启用，避免多图（主图+参考图）场景把参考图槽位被主图反向覆盖。
      const totalUploads = (primaryUpload ? 1 : 0) + refUploads.length
      const propagateUpload =
        totalUploads === 1
          ? (primaryUpload ?? refUploads[0] ?? null)
          : null
      if ((nodeKind === 'image' || nodeKind === 'video') && propagateUpload) {
        prompt = propagateComfyFilenameToLinkedLoadImages(prompt, propagateUpload)
      }
      if (nodeKind === 'image' || nodeKind === 'video') {
        const expectedNames = comfyInjectUploads.map((item) => String(item.filename || '').trim()).filter(Boolean)
        const assignedNames = collectLoadImageAssignedFilenames(prompt)
        const missingAssigned = expectedNames.filter((name) => !assignedNames.includes(name))
        if (import.meta.env.DEV) {
          console.info('[Flowid Diagnose] 提交前图片注入校验', {
            期望文件名: expectedNames,
            槽位实际文件名: assignedNames,
            缺失文件名: missingAssigned,
          })
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
        nodeKind === 'image' || nodeKind === 'video'
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
      let previewUrl = pickComfyResultImageUrl({
        providerConfig: effectiveProviderConfig,
        historyEntry,
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
      /**
       * 图/视频：部分云端/反代会先返回「可轮询结束」的条目但 `outputs` 尚未含 SaveImage，
       * 或 `/history/{id}` 形态与全量 `/history` 不一致；再拉一次全量并取含栅格图的匹配条目。
       */
      if ((nodeKind === 'image' || nodeKind === 'video') && !previewUrl) {
        const recovered = await refetchHistoryEntryWithRasterVisual({
          providerConfig: effectiveProviderConfig,
          promptId,
        })
        if (recovered) {
          historyEntry = recovered
          previewUrl = pickComfyResultImageUrl({
            providerConfig: effectiveProviderConfig,
            historyEntry,
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
      let audioUrl = await pickComfyResultAudioUrlAsync({
        providerConfig: effectiveProviderConfig,
        historyEntry,
        excludeFilenames: uploadedInputFilenameSet,
      })
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
      const finalResultUrl = effectiveAudioUrl || effectiveMediaUrl
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
        let multi = pickComfyResultImageViewUrls({
          providerConfig: effectiveProviderConfig,
          historyEntry,
          allowFullEntryFallback: true,
          excludeFilenames: uploadedInputFilenameSet,
          omitStaticRasterFilenamesForVideoStrip: nodeKind === 'video',
        })
        multi = multi.filter((u) => !isInputEchoPreview(u))
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
      })
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
