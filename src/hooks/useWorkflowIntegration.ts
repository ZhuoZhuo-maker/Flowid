import { useCallback, useEffect, useState } from 'react'
import type { Node } from '@xyflow/react'
import type {
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
import { collectMentionImageSources, listMentionImageAttachments } from '../lib/nodeMentions'
import { fetchLicenseStatusRemote, loadAuthSession, saveAuthSession } from '../lib/auth'
import { loadAuthApiConfig } from '../lib/auth'
import {
  getLicenseSubmitBlockMessage,
  loadLocalLicenseSnapshot,
  saveLocalLicenseSnapshot,
} from '../lib/license'
import { matchStudioNodeWorkflow } from '../lib/matchStudioNodeWorkflow'
import { persistWorkflowJsonToDisk } from '../lib/localAssetDiskMirror'
import {
  buildComfyPromptDigest,
  checkComfyHealth,
  type ComfyHistoryTaskFingerprint,
  type ComfyHistoryResultExpectation,
  pickLatestComfyAudioUrlFromHistory,
  pickLatestComfyMediaUrlFromHistory,
  pickComfyResultAudioUrl,
  pickComfyResultImageUrl,
  refetchHistoryEntryWithRasterVisual,
  submitComfyPrompt,
  type ComfyUploadedInputImage,
  uploadComfyInputImageAsPng,
  verifyComfyMediaUrl,
  waitComfyHistory,
} from '../lib/comfyClient'

type NodeInputRecord = Record<string, unknown>

/**
 * 单节点执行 Comfy 时的可选参数（进度回调等）。
 */
export type RunNodeWorkflowOptions = {
  onProgress?: (info: NodeRunProgress) => void
  /** 当前画布全部节点：用于从提示词 @ 引用合并图片 URL（与 Studio 中 `withResolvedNodeMentions` 一致）。 */
  allNodes?: Array<Node<StudioNodeData>>
  /** 执行前的原始提示词文本（未做 @ 引用解析），用于准确诊断参考图是否进入上传链路。 */
  rawPromptText?: string
  /** 执行前的原始说明文本（未做 @ 引用解析）。 */
  rawNoteText?: string
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

/**
 * 开发诊断日志开关：默认关闭，避免高频执行时控制台刷屏。
 * 需要排查时可在控制台手动开启：
 * localStorage.setItem('flowid.debug.comfy', '1')
 */
function shouldLogComfyDebug(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return window.localStorage.getItem('flowid.debug.comfy') === '1'
  } catch {
    return false
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
function extractNodeInputs(
  node: Node<StudioNodeData>,
  allNodes?: Array<Node<StudioNodeData>>,
): NodeInputRecord {
  const common: NodeInputRecord = {
    title: node.data.title,
    kind: node.data.kind,
  }
  if (node.data.kind === 'group') {
    return common
  }
  if (node.data.kind === 'text' || node.data.kind === 'script') {
    return { ...common, body: node.data.body, refImages: '' }
  }
  if (node.data.kind === 'image' || node.data.kind === 'video') {
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const promptText = String(node.data.prompt || '')
    const fromMentions =
      allNodes?.length && promptText.includes('@')
        ? collectMentionImageSources(promptText, allNodes, node.id)
        : []
    /** 若提示词里存在 @ 引用，则以 @ 出现顺序优先，避免执行时主/参考顺序与文案不一致。 */
    const mergedRefs = Array.from(
      new Set(fromMentions.length > 0 ? [...fromMentions, ...refs] : [...refs, ...fromMentions]),
    )
    const primarySrc = (node.data.src || mergedRefs[0] || '').trim()
    const pureRefs = mergedRefs.filter((url) => String(url || '').trim() && String(url || '').trim() !== primarySrc)
    return {
      ...common,
      prompt: node.data.prompt,
      src: primarySrc,
      refImages: pureRefs.join('\n'),
    }
  }
  if (node.data.kind === 'panorama') {
    const flat = String(node.data.rectilinearSrc || node.data.src || '').trim()
    return { ...common, prompt: '', src: flat, refImages: '' }
  }
  if (node.data.kind === 'music') {
    const refs = node.data.referenceImageSources?.filter(Boolean) ?? []
    const noteText = String(node.data.note || '')
    const fromMentions =
      allNodes?.length && noteText.includes('@')
        ? collectMentionImageSources(noteText, allNodes, node.id)
        : []
    const mergedRefs = Array.from(
      new Set(fromMentions.length > 0 ? [...fromMentions, ...refs] : [...refs, ...fromMentions]),
    )
    const primarySrc = String(node.data.src || '').trim() || mergedRefs[0] || ''
    const pureRefs = mergedRefs.filter((url) => String(url || '').trim() && String(url || '').trim() !== primarySrc)
    return {
      ...common,
      note: node.data.note,
      src: primarySrc,
      refImages: pureRefs.join('\n'),
    }
  }
  const audioRefs = node.data.referenceImageSources?.filter(Boolean) ?? []
  const noteText = String(node.data.note || '')
  const fromMentions =
    allNodes?.length && noteText.includes('@')
      ? collectMentionImageSources(noteText, allNodes, node.id)
      : []
  const mergedRefs = Array.from(
    new Set(fromMentions.length > 0 ? [...fromMentions, ...audioRefs] : [...audioRefs, ...fromMentions]),
  )
  const primarySrc = (node.data.src || mergedRefs[0] || '').trim()
  const pureRefs = mergedRefs.filter((url) => String(url || '').trim() && String(url || '').trim() !== primarySrc)
  return {
    ...common,
    note: node.data.note,
    src: primarySrc,
    refImages: pureRefs.join('\n'),
  }
}

/**
 * 开发环境控制台：截断 URL，避免 blob/data 过长刷屏。
 */
function devTruncateUrl(url: string, max = 120): string {
  const u = url.trim()
  if (u.length <= max) return u
  return `${u.slice(0, max)}…(共${u.length}字符)`
}

/**
 * 开发环境控制台：将即将提交给 Comfy 的 `prompt` 压缩为每节点的 `class_type` 与 inputs 里可序列化字段的预览。
 */
function devSummarizeComfyPromptForLog(
  prompt: Record<string, unknown>,
  maxNodes = 32,
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
 * 从 `/view?...` URL 中提取 filename 参数，失败返回空串。
 */
function readFilenameFromComfyViewUrl(viewUrl: string | null | undefined): string {
  const raw = String(viewUrl || '').trim()
  if (!raw) return ''
  try {
    const absolute = raw.startsWith('http') ? raw : `${window.location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`
    const parsed = new URL(absolute)
    return String(parsed.searchParams.get('filename') || '').trim()
  } catch {
    const m = raw.match(/[?&]filename=([^&]+)/i)
    if (!m?.[1]) return ''
    try {
      return decodeURIComponent(m[1]).trim()
    } catch {
      return m[1].trim()
    }
  }
}

/**
 * 将音乐节点“描述信息”兜底映射到 ComfyUI 常见正向提示词字段。
 * 优先保留已有占位符替换逻辑；当未使用占位符时再尝试自动注入。
 */
function injectMusicPromptFallback(
  prompt: Record<string, unknown>,
  note: string,
): Record<string, unknown> {
  const trimmedNote = note.trim()
  if (!trimmedNote) return prompt
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const candidateKeys = [
    'prompt',
    'positive',
    'positive_prompt',
    'main_prompt',
    'lyrics',
    'text',
  ]
  let injected = false
  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const nodeRecord = node as Record<string, unknown>
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>
    for (const key of candidateKeys) {
      if (typeof inputRecord[key] === 'string') {
        inputRecord[key] = trimmedNote
        injected = true
        break
      }
    }
    if (injected) break
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
              baseUrl:
                snapshot.cloudEndpoints.find((item) => item.enabled && item.baseUrl.trim())
                  ?.baseUrl ?? '',
            }
      const result = await checkComfyHealth({ providerConfig })
      const prefix = provider === 'local' ? '本地' : '云端'
      setConnectionTestMessage(`${prefix}：${result.message}`)
      return result
    },
    [snapshot.cloud, snapshot.cloudEndpoints, snapshot.local],
  )

  const refreshOfficialTemplates = useCallback(async () => {
    const api = loadAuthApiConfig()
    const session = loadAuthSession()
    const base = String(api.baseUrl || '').trim().replace(/\/+$/, '')
    if (!base || !session?.token) {
      setOfficialTemplates([])
      return []
    }
    const response = await fetch(`${base}/templates`, {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    })
    const json = (await response.json().catch(() => ({}))) as {
      templates?: OfficialTemplateMeta[]
      message?: string
    }
    if (!response.ok) {
      throw new Error(String(json.message || `拉取官方模板失败：${response.status}`))
    }
    const list = Array.isArray(json.templates) ? json.templates : []
    setOfficialTemplates(list)
    return list
  }, [])


  const runNodeWorkflow = useCallback(
    async (node: Node<StudioNodeData>, options?: RunNodeWorkflowOptions) => {
      const authSession = loadAuthSession()
      if (authSession) {
        try {
          const remoteStatus = await fetchLicenseStatusRemote()
          if (remoteStatus) {
            saveLocalLicenseSnapshot({
              status: remoteStatus.licenseStatus,
              expiresAtMs: remoteStatus.expiresAtMs,
              lastNoticeAtMs: undefined,
            })
            saveAuthSession({
              ...authSession,
              account: remoteStatus.account,
              nickname: remoteStatus.nickname,
              machineCode: remoteStatus.machineCode || authSession.machineCode,
              licenseStatus: remoteStatus.licenseStatus,
              expiresAtMs: remoteStatus.expiresAtMs,
            })
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[Flowid Auth] 拉取授权状态失败，回退本地快照', error)
          }
        }
      }
      const licenseSnapshot = loadLocalLicenseSnapshot()
      const licenseBlockMessage = getLicenseSubmitBlockMessage(licenseSnapshot)
      if (licenseBlockMessage) {
        throw new Error(licenseBlockMessage)
      }
      if (node.data.kind === 'group') {
        throw new Error('分组节点不可执行')
      }
      if (node.data.kind === 'panorama') {
        throw new Error('VR360 全景节点为本地预览与导出工具，请在节点内使用「当前视角」，不参与 Comfy 执行')
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
              baseUrl:
                snapshot.cloudEndpoints.find(
                  (item) => item.enabled && item.baseUrl.trim(),
                )?.baseUrl ?? '',
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
      const nodeKind = node.data.kind
      const nodeConfig = snapshot.nodeConfigs[nodeKind]
      if (snapshot.executionMode === 'official') {
        const templateId = String(nodeConfig.officialTemplateId || '').trim()
        if (!templateId) {
          throw new Error('当前节点未选择官方模板，请到设置中为该节点类型选择模板')
        }
        const api = loadAuthApiConfig()
        const session = loadAuthSession()
        const authBaseUrl = String(api.baseUrl || '').trim().replace(/\/+$/, '')
        if (!authBaseUrl || !session?.token) {
          throw new Error('未配置认证服务地址或尚未登录，无法提交官方模板任务')
        }
        const nodeInputs = extractNodeInputs(node, options?.allNodes)
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
            Authorization: `Bearer ${session.token}`,
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
                Authorization: `Bearer ${session.token}`,
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
            const mediaUrls = statusJson.result?.mediaUrls ?? []
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
      /** 允许「仅在工作流列表中存 JSON、根编辑区为空」的配置，否则三视图等条目有内容也会被误拦在提交之前 */
      const hasUsableWorkflowTemplate =
        Boolean(nodeConfig.workflowJsonText.trim()) ||
        nodeConfig.workflows.some((item) => (item.jsonText || '').trim().length > 0)
      if (!hasUsableWorkflowTemplate) {
        throw new Error(
          `请先在「${nodeKind}」配置工作流：在设置中导入或粘贴至少一条工作流 JSON（或填写根编辑区）`,
        )
      }
      let prompt: Record<string, unknown>
      const { preferredName, byEntryId, byName, picked: pickedWorkflow } =
        matchStudioNodeWorkflow(
          node.data as { model?: string; workflowEntryId?: string },
          nodeConfig,
        )
      // 节点上写了名称但列表对不上时不再静默回退到全局，避免误跑成其它工作流（如 z-image）
      if (preferredName && !byEntryId && !byName) {
        throw new Error(
          `未找到工作流「${preferredName}」，请在下拉中重新选择，或在设置中核对名称是否与列表完全一致`,
        )
      }
      const workflowSource =
        (pickedWorkflow?.jsonText || '').trim() || nodeConfig.workflowJsonText.trim()
      if (!workflowSource) {
        throw new Error(
          `当前选中的工作流「${pickedWorkflow?.name || '（未命名）'}」JSON 为空，请到设置中打开该条目并重新保存`,
        )
      }
      /** 开发环境：在浏览器控制台（F12 → Console）打印本次实际解析到的工作流，便于核对是否串台 */
      if (shouldLogComfyDebug()) {
        const 匹配来源 =
          byEntryId != null
            ? '节点.workflowEntryId'
            : byName != null
              ? '节点.model'
              : '设置列表首条（置顶默认）'
        console.info('[Flowid Comfy] 本次执行工作流', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          节点类型: nodeKind,
          工作流名称: pickedWorkflow?.name,
          工作流条目id: pickedWorkflow?.id,
          匹配来源,
          节点model字段: preferredName || '（空）',
          workflowJson字符数: workflowSource.length,
        })
      }
      try {
        prompt = JSON.parse(workflowSource) as Record<string, unknown>
      } catch {
        throw new Error(`「${nodeKind}」工作流 JSON 解析失败`)
      }
      prompt = normalizePromptShape(prompt)
      prompt = sanitizePromptNodes(prompt)
      validatePromptNodes(prompt)
      const nodeInputs = extractNodeInputs(node, options?.allNodes)
      const rawSrc = String(nodeInputs.src ?? '').trim()
      const rawRefImages = String(nodeInputs.refImages ?? '')
      const refImageUrls = rawRefImages
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
      const promptOrNoteText =
        nodeKind === 'image' || nodeKind === 'video'
          ? String(options?.rawPromptText ?? node.data.prompt ?? '')
          : String(options?.rawNoteText ?? (node.data as { note?: string }).note ?? '')
      const mentionAttachments =
        (nodeKind === 'image' || nodeKind === 'video' || nodeKind === 'audio' || nodeKind === 'music') &&
        options?.allNodes?.length
          ? listMentionImageAttachments(promptOrNoteText, options.allNodes, node.id)
          : []
      const mentionImageUrls = mentionAttachments.map((item) => String(item.url || '').trim())
      /**
       * 图片输入统一策略：不区分主图/参考图，只看“最终输入序列”。
       * - 若提示框存在 @ 引用：严格按 @ 顺序作为输入序列；
       * - 否则：按节点现有 src + refImages 组装并去重。
       */
      const orderedInputImageUrls = (
        (nodeKind === 'image' || nodeKind === 'video') && mentionImageUrls.length > 0
          ? mentionImageUrls
          : [rawSrc, ...refImageUrls]
      ).filter((url) => String(url || '').trim())
      const missingMentionRefs = mentionImageUrls.filter((url) => !orderedInputImageUrls.includes(url))
      if (import.meta.env.DEV && (nodeKind === 'image' || nodeKind === 'video')) {
        console.info('[Flowid Diagnose] 输入图判定详情', {
          节点标题: node.data.title || node.id,
          节点id: node.id,
          rawPromptText: String(options?.rawPromptText ?? ''),
          当前src: rawSrc || '（空）',
          nodeInputs_refImages原始文本: rawRefImages || '（空）',
          mention解析URL: mentionImageUrls,
          最终输入序列URL: orderedInputImageUrls,
          缺失参考图URL: missingMentionRefs,
        })
      }
      if ((nodeKind === 'image' || nodeKind === 'video') && mentionImageUrls.length > 0 && orderedInputImageUrls.length === 0) {
        throw new Error(
          `检测到提示词里有 ${mentionImageUrls.length} 个 @ 图片引用，但最终输入图为 0。请检查 @ 引用是否指向有效图片节点。`,
        )
      }
      if ((nodeKind === 'image' || nodeKind === 'video') && missingMentionRefs.length > 0) {
        throw new Error(
          `图片输入组装不一致：@ 解析出 ${mentionImageUrls.length} 张，但最终仅组装 ${orderedInputImageUrls.length} 张。缺失 ${missingMentionRefs.length} 张（详见控制台 [Flowid Diagnose] 输入图判定详情）。`,
        )
      }
      if (nodeKind === 'image' || nodeKind === 'video') {
        const summary = `执行输入判定：输入图总数=${orderedInputImageUrls.length}（@引用=${mentionImageUrls.length}）`
        setLastExecutionMessage(summary)
      }
      if (nodeKind === 'image' || nodeKind === 'video') {
        const requiredInputImages = orderedInputImageUrls.length
        const loadImageSlotCount = countComfyFileLoadImageSlots(prompt)
        if (import.meta.env.DEV) {
          console.info('[Flowid Diagnose] 工作流图片槽位容量', {
            工作流名称: pickedWorkflow?.name || '（未命名）',
            工作流条目id: pickedWorkflow?.id || '（无）',
            需要图片数: requiredInputImages,
            LoadImage槽位数: loadImageSlotCount,
          })
        }
        if (requiredInputImages > 0 && loadImageSlotCount > 0 && loadImageSlotCount < requiredInputImages) {
          throw new Error(
            `当前工作流「${pickedWorkflow?.name || '（未命名）'}」仅有 ${loadImageSlotCount} 个图片输入槽位，但本次需要 ${requiredInputImages} 张。请切换到槽位更多的工作流，或减少图片数量。`,
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
      const mentionNodeIdByUrl = new Map<string, string>()
      for (const item of mentionAttachments) {
        const key = String(item.url || '').trim()
        if (!key || mentionLabelByUrl.has(key)) continue
        const rawMention = String(item.mention || '').trim()
        const labelMatch = rawMention.match(/^@\[(?<label>[^\]]+)\]/u)
        const idMatch = rawMention.match(/\((?<nid>[0-9a-fA-F-]{36})\)$/u)
        mentionLabelByUrl.set(key, labelMatch?.groups?.label?.trim() || `图${mentionLabelByUrl.size + 1}`)
        mentionNodeIdByUrl.set(key, idMatch?.groups?.nid?.trim() || '')
      }
      const uploadFailures: Array<{ index: number; url: string; reason: string }> = []
      const allUploads: ComfyUploadedInputImage[] = []
      if (orderedInputImageUrls.length > 0) {
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
        console.info('[Flowid Comfy] 组装前：节点提取的输入（占位符替换前）', {
          文本字数: extractedText.length,
          文本预览:
            extractedText.length > 500
              ? `${extractedText.slice(0, 500)}…(共${extractedText.length}字)`
              : extractedText || '（无）',
          主图原始地址: rawSrc ? devTruncateUrl(rawSrc) : '（无）',
          参考图原始条数: refImageUrls.length,
          Comfy主图文件名: comfySrc || '（无）',
          Comfy参考图文件名: refUploads.map((item) => item.filename),
        })
        console.info('[Flowid Comfy] 参考图上传顺序明细（原始URL -> Comfy文件名）', refUploadDebugRows)
        console.info(
          '[Flowid Comfy] 最终注入顺序（primary + refs）',
          [
            ...(primaryUpload
              ? [{ 类型: '主图', 原始URL: devTruncateUrl(rawSrc), Comfy文件名: primaryUpload.filename }]
              : []),
            ...refUploadDebugRows.map((row) => ({
              类型: '参考图',
              原始URL: row.原始URL,
              Comfy文件名: row.Comfy文件名,
            })),
          ],
        )
      }
      options?.onProgress?.({ percent: 4, label: '输入已准备，正在组装工作流…' })
      // 兼容简单占位符：把 "__PROMPT__"、"__BODY__"、"__SRC__" 自动替换。
      const serializedBefore = JSON.stringify(prompt)
      const text = serializedBefore
        .replaceAll('__PROMPT__', String(nodeInputs.prompt ?? ''))
        .replaceAll('__BODY__', String(nodeInputs.body ?? ''))
        .replaceAll('__SRC__', comfySrc)
        .replaceAll('__NOTE__', String(nodeInputs.note ?? ''))
        .replaceAll('__REF_IMAGE__', comfyFirstRefImage)
        .replaceAll('__REF_IMAGES__', comfyRefImages)
      prompt = JSON.parse(text) as Record<string, unknown>
      prompt = replacePlaceholderStringWithNumber(prompt, '__REF_COUNT__', comfyRefCount) as Record<
        string,
        unknown
      >
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
      // 音乐节点兜底：若工作流未使用 __NOTE__ 占位符，自动映射到常见正向提示词字段。
      if (
        nodeKind === 'music' &&
        typeof nodeInputs.note === 'string' &&
        !serializedBefore.includes('__NOTE__')
      ) {
        prompt = injectMusicPromptFallback(prompt, nodeInputs.note)
      }
      // 文本/剧本兜底：未使用 __BODY__ 时，有输入就覆盖工作流默认文本输入。
      if (
        (nodeKind === 'text' || nodeKind === 'script') &&
        typeof nodeInputs.body === 'string' &&
        !serializedBefore.includes('__BODY__')
      ) {
        prompt = injectTextBodyFallback(prompt, nodeInputs.body)
      }
      const selectedWorkflowName =
        pickedWorkflow?.name ||
        (typeof (node.data as { model?: string }).model === 'string'
          ? (node.data as { model?: string }).model || ''
          : '')
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
      const promptId = await submitComfyPrompt({
        providerConfig: effectiveProviderConfig,
        prompt,
      })
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
      const audioUrl = pickComfyResultAudioUrl({
        providerConfig: effectiveProviderConfig,
        historyEntry,
      })
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
      const finalResultUrl = verifiedAudioUrl || effectiveMediaUrl
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
      const mappedNodeId = pickedWorkflow?.resultNodeId || nodeConfig.resultNodeId
      const mappedFieldPath = pickedWorkflow?.resultFieldPath || nodeConfig.resultFieldPath
      const textResult =
        nodeKind === 'text' || nodeKind === 'script'
          ? extractComfyResultTextByMapping({
              historyEntry,
              nodeId: mappedNodeId,
              fieldPath: mappedFieldPath,
            }) ?? extractComfyResultText(historyEntry)
          : null
      return {
        previewUrl: effectiveMediaUrl,
        audioUrl: verifiedAudioUrl,
        resultUrl: finalResultUrl,
        textResult,
        historyEntry,
      }
    },
    [snapshot],
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
  }
}
