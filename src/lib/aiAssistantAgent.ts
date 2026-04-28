import type { Node } from '@xyflow/react'
import type { StudioNodeData, StudioNodeKind } from '../types'
import { fetchSystemPromptPresetText, loadActiveSystemPromptPresetId } from './systemPromptPresets'
import { normalizeOpenAICompatibleBaseUrl } from './openaiCompat'
import { fetchOpenAICompat } from './openaiProxy'

const AI_ASSISTANT_CONFIG_KEY = 'flowid.ai.assistant.config.v1'

export type AiAssistantProvider = 'ollama' | 'cloud'

export type AiAssistantConfig = {
  provider: AiAssistantProvider
  endpoint: string
  apiKey: string
  model: string
  /** 是否启用助手回复自动语音播报（TTS） */
  ttsEnabled: boolean
  /** TTS 服务 endpoint（OpenAI 兼容，默认 /v1/audio/speech） */
  ttsEndpoint: string
  /** TTS 服务 API Key（可选） */
  ttsApiKey: string
  /** TTS 模型名 */
  ttsModel: string
  /** TTS 音色 */
  ttsVoice: string
  /** TTS 克隆音色参考音频（Data URL） */
  ttsCloneAudioDataUrl: string
  /** TTS 克隆音色参考音频文件名 */
  ttsCloneAudioName: string
  /** 工作流执行中，是否暂停本地（Ollama）模型规划并进入队列 */
  pauseLocalModelWhenWorkflowRunning: boolean
  /** 是否在执行每条动作前弹确认 */
  confirmBeforeRun: boolean
}

export type AiAssistantAction =
  | { type: 'create_node'; kind: StudioNodeKind }
  | { type: 'connect_nodes'; sourceQuery: string; targetQuery: string }
  | { type: 'run_node'; targetQuery?: string; current?: boolean }

export function getDefaultAiAssistantConfig(): AiAssistantConfig {
  return {
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    apiKey: '',
    model: 'qwen3:14b',
    ttsEnabled: false,
    ttsEndpoint: 'http://127.0.0.1:7860/',
    ttsApiKey: '',
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: 'alloy',
    ttsCloneAudioDataUrl: '',
    ttsCloneAudioName: '',
    pauseLocalModelWhenWorkflowRunning: true,
    confirmBeforeRun: true,
  }
}

export function loadAiAssistantConfig(): AiAssistantConfig {
  try {
    const raw = localStorage.getItem(AI_ASSISTANT_CONFIG_KEY)
    if (!raw) return getDefaultAiAssistantConfig()
    const parsed = JSON.parse(raw) as Partial<AiAssistantConfig>
    const d = getDefaultAiAssistantConfig()
    return {
      provider: parsed.provider === 'cloud' ? 'cloud' : 'ollama',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : d.endpoint,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : d.apiKey,
      model: typeof parsed.model === 'string' ? parsed.model : d.model,
      ttsEnabled: typeof parsed.ttsEnabled === 'boolean' ? parsed.ttsEnabled : d.ttsEnabled,
      ttsEndpoint: typeof parsed.ttsEndpoint === 'string' ? parsed.ttsEndpoint : d.ttsEndpoint,
      ttsApiKey: typeof parsed.ttsApiKey === 'string' ? parsed.ttsApiKey : d.ttsApiKey,
      ttsModel: typeof parsed.ttsModel === 'string' ? parsed.ttsModel : d.ttsModel,
      ttsVoice: typeof parsed.ttsVoice === 'string' ? parsed.ttsVoice : d.ttsVoice,
      ttsCloneAudioDataUrl:
        typeof parsed.ttsCloneAudioDataUrl === 'string' ? parsed.ttsCloneAudioDataUrl : d.ttsCloneAudioDataUrl,
      ttsCloneAudioName:
        typeof parsed.ttsCloneAudioName === 'string' ? parsed.ttsCloneAudioName : d.ttsCloneAudioName,
      pauseLocalModelWhenWorkflowRunning:
        typeof parsed.pauseLocalModelWhenWorkflowRunning === 'boolean'
          ? parsed.pauseLocalModelWhenWorkflowRunning
          : d.pauseLocalModelWhenWorkflowRunning,
      confirmBeforeRun:
        typeof parsed.confirmBeforeRun === 'boolean' ? parsed.confirmBeforeRun : d.confirmBeforeRun,
    }
  } catch {
    return getDefaultAiAssistantConfig()
  }
}

export function saveAiAssistantConfig(patch: Partial<AiAssistantConfig>): AiAssistantConfig {
  const next = { ...loadAiAssistantConfig(), ...patch }
  localStorage.setItem(AI_ASSISTANT_CONFIG_KEY, JSON.stringify(next))
  return next
}

function extractActionsFromText(rawText: string): AiAssistantAction[] {
  const m = rawText.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const obj = JSON.parse(m[0]) as { actions?: unknown[] }
    const list = Array.isArray(obj.actions) ? obj.actions : []
    const out: AiAssistantAction[] = []
    for (const item of list) {
      const v = item as Record<string, unknown>
      const t = String(v.type || '')
      if (t === 'create_node') {
        const kind = String(v.kind || '') as StudioNodeKind
        if (kind) out.push({ type: 'create_node', kind })
      } else if (t === 'connect_nodes') {
        const sourceQuery = String(v.sourceQuery || '').trim()
        const targetQuery = String(v.targetQuery || '').trim()
        if (sourceQuery && targetQuery) out.push({ type: 'connect_nodes', sourceQuery, targetQuery })
      } else if (t === 'run_node') {
        const targetQuery = String(v.targetQuery || '').trim()
        const current = Boolean(v.current)
        out.push({ type: 'run_node', targetQuery: targetQuery || undefined, current })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * 本地兜底规则：无模型配置或模型不可用时，仍可执行基础操作。
 */
export function planActionsWithRules(text: string): AiAssistantAction[] {
  const raw = text.trim()
  if (!raw) return []
  const kindMap: Array<{ key: string; kind: StudioNodeKind }> = [
    { key: '文本', kind: 'text' },
    { key: '剧本', kind: 'script' },
    { key: '图片', kind: 'image' },
    { key: '视频', kind: 'video' },
    { key: '音频', kind: 'audio' },
    { key: '音乐', kind: 'music' },
    { key: '全景', kind: 'panorama' },
  ]

  if (/(新建|创建|添加).*(节点)?/.test(raw)) {
    const matched = kindMap.find((k) => raw.includes(k.key))
    if (matched) return [{ type: 'create_node', kind: matched.kind }]
  }

  if (raw.includes('连接') && raw.includes('到')) {
    const m = raw.match(/连接\s*[“"「]?(.*?)[”"」]?\s*到\s*[“"「]?(.*?)[”"」]?$/)
    const sourceQuery = (m?.[1] || '').trim()
    const targetQuery = (m?.[2] || '').trim()
    if (sourceQuery && targetQuery) {
      return [{ type: 'connect_nodes', sourceQuery, targetQuery }]
    }
  }

  if (raw.includes('执行') || raw.includes('运行')) {
    const m = raw.match(/(?:执行|运行)\s*[“"「]?(.*?)[”"」]?$/)
    const q = String(m?.[1] || '').trim()
    if (!q || ['当前', '当前选中', '选中'].includes(q)) {
      return [{ type: 'run_node', current: true }]
    }
    return [{ type: 'run_node', targetQuery: q }]
  }

  return []
}

/**
 * 通过 OpenAI 兼容接口生成动作计划，失败时返回空数组，由调用方回退到规则模式。
 */
export async function planActionsWithModel(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  config: AiAssistantConfig,
): Promise<AiAssistantAction[]> {
  const rawEndpoint =
    config.provider === 'ollama'
      ? (config.endpoint.trim() || 'http://127.0.0.1:11434/v1/chat/completions')
      : config.endpoint.trim()
  const endpoint = rawEndpoint
    ? `${normalizeOpenAICompatibleBaseUrl(rawEndpoint)}/v1/chat/completions`
    : ''
  const apiKey = config.apiKey.trim()
  const model = config.model.trim()
  if (!endpoint || !model) return []
  if (config.provider === 'cloud' && !apiKey) return []
  const nodeBrief = nodes
    .slice(0, 80)
    .map((n) => ({ id: n.id, title: String(n.data.title || ''), kind: n.data.kind }))
  const systemPrompt =
    '你是 Flowid 助手。你只能输出 JSON：{"actions":[...]}，不要输出其它文字。动作 type 仅允许 create_node/connect_nodes/run_node。'
  const userPrompt = `用户需求：${text}\n当前节点列表：${JSON.stringify(nodeBrief)}`
  try {
    const res = await fetchOpenAICompat(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      json: {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = String(data.choices?.[0]?.message?.content || '')
    return extractActionsFromText(content)
  } catch {
    return []
  }
}

/**
 * 通过 OpenAI 兼容接口生成普通对话回复（非动作 JSON）。
 */
export async function chatReplyWithModel(
  text: string,
  config: AiAssistantConfig,
): Promise<string> {
  const rawEndpoint =
    config.provider === 'ollama'
      ? (config.endpoint.trim() || 'http://127.0.0.1:11434/v1/chat/completions')
      : config.endpoint.trim()
  const endpoint = rawEndpoint
    ? `${normalizeOpenAICompatibleBaseUrl(rawEndpoint)}/v1/chat/completions`
    : ''
  const apiKey = config.apiKey.trim()
  const model = config.model.trim()
  if (!endpoint || !model) return ''
  if (config.provider === 'cloud' && !apiKey) return ''
  /**
   * 清理推理模型可能输出的 think 标签，避免泄露中间思考。
   */
  const sanitizeChatText = (raw: string): string =>
    raw
      .replace(/<think[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/<\/?im_start>/gi, '')
      .replace(/<\/?im_end>/gi, '')
      .replace(/<\|im_start\|>/gi, '')
      .replace(/<\|im_end\|>/gi, '')
      .replace(/<\|endoftext\|>/gi, '')
      .replace(/<\|eot_id\|>/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  /**
   * 闲聊优先使用更小的本地模型，提升响应速度；失败后再回退用户主模型。
   */
  const getChatModelCandidates = (): string[] => {
    if (config.provider !== 'ollama') return [model]
    const preferred = ['yi:latest', 'qwen3:8b', 'deepseek-r1:1.5b']
    const dedup = new Set<string>()
    for (const m of [...preferred, model]) {
      const v = m.trim()
      if (!v) continue
      dedup.add(v)
    }
    return Array.from(dedup)
  }
  const requestReply = async (chatModel: string): Promise<string> => {
    const presetId = loadActiveSystemPromptPresetId()
    const presetSystemPrompt = presetId ? await fetchSystemPromptPresetText(presetId) : ''
    const res = await fetchOpenAICompat(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      json: {
        model: chatModel,
        temperature: 0.4,
        messages: [
          ...(presetSystemPrompt ? [{ role: 'system', content: presetSystemPrompt }] : []),
          {
            role: 'system',
            content:
              '你是 Flowid 的中文 AI 助手。当前用户可能在闲聊，也可能在咨询工作流。请直接自然回复，简洁、友好、可执行，不要输出 JSON，也不要输出思考过程。',
          },
          { role: 'user', content: text },
        ],
      },
    })
    if (!res.ok) return ''
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return sanitizeChatText(String(data.choices?.[0]?.message?.content || ''))
  }
  try {
    const candidates = getChatModelCandidates()
    for (const chatModel of candidates) {
      try {
        const reply = await requestReply(chatModel)
        if (reply) return reply
      } catch {
        // 单个候选模型失败时继续尝试下一个候选。
      }
    }
    return ''
  } catch {
    return ''
  }
}

