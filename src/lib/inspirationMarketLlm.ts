import { fetchOpenAICompat } from './openaiProxy'
import { normalizeOpenAICompatibleBaseUrl } from './openaiCompat'
import type { AiAssistantConfig } from './aiAssistantAgent'

export type InspirationPromptSegment = {
  id: string
  label: string
  text: string
  /** 展示用强调色 */
  color: string
}

function buildChatEndpoint(config: AiAssistantConfig): string {
  const rawEndpoint =
    config.provider === 'ollama'
      ? (config.endpoint.trim() || 'http://127.0.0.1:11434/v1/chat/completions')
      : config.endpoint.trim()
  const base = rawEndpoint ? `${normalizeOpenAICompatibleBaseUrl(rawEndpoint)}/v1/chat/completions` : ''
  return base
}

async function chatOnce(config: AiAssistantConfig, system: string, user: string): Promise<string> {
  const endpoint = buildChatEndpoint(config)
  const model = config.model.trim()
  if (!endpoint || !model) throw new Error('请先在画布「设置 → AI 助手」中配置聊天模型 endpoint 与 model')
  if (config.provider === 'cloud' && !config.apiKey.trim()) throw new Error('云端模型需填写 API Key')

  const res = await fetchOpenAICompat(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
    },
    json: {
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`模型请求失败 HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`)
  }
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }> }
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

function extractJsonObject(raw: string): string {
  const t = String(raw || '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}

const DEFAULT_COLORS = ['#2563eb', '#c026d3', '#ea580c', '#059669', '#ca8a04', '#7c3aed']

/**
 * 将整段提示词拆为可编辑块（仅依赖用户已配置的 AI 助手模型）。
 */
export async function destructurePromptWithLlm(
  fullPrompt: string,
  config: AiAssistantConfig,
): Promise<InspirationPromptSegment[]> {
  const system = `你是提示词编辑助手。用户会给你一条「生图/设计」类中文或英文提示词。
请把它拆成 3～10 个语义块，便于用户分别改写法、配色或构图描述。
只输出一个 JSON 对象，不要 Markdown，不要思考过程。格式严格为：
{"segments":[{"label":"块标题≤8字","text":"该块原文或精炼复述","color":"#RRGGBB"}]}
要求：segments 按在最终提示词中出现的顺序排列；text 总和应覆盖原提示词主要信息；color 使用不同的十六进制色便于区分。`

  const raw = await chatOnce(config, system, `原始提示词：\n${fullPrompt}`)
  const jsonText = extractJsonObject(raw)
  let parsed: { segments?: Array<{ label?: string; text?: string; color?: string }> }
  try {
    parsed = JSON.parse(jsonText) as typeof parsed
  } catch {
    throw new Error('模型返回不是合法 JSON，请重试或换模型')
  }
  const segs = Array.isArray(parsed.segments) ? parsed.segments : []
  const out: InspirationPromptSegment[] = []
  segs.forEach((s, i) => {
    const text = String(s.text || '').trim()
    if (!text) return
    const label = String(s.label || `模块${i + 1}`).trim().slice(0, 16)
    const color = String(s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]).trim()
    out.push({
      id: `seg-${i}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      text,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    })
  })
  if (!out.length) throw new Error('模型未返回有效 segments')
  return out
}

/**
 * 根据用户编辑后的块，合成一条新的完整提示词。
 */
export async function synthesizePromptWithLlm(
  segments: InspirationPromptSegment[],
  originalPrompt: string,
  config: AiAssistantConfig,
): Promise<string> {
  const system = `你是资深 Stable Diffusion / Midjourney 提示词编辑。
用户会给你「原始提示词」以及若干已编辑的语义块（带标题）。
请合并成一条连贯的最终提示词：中文为主，可保留必要的英文质量词；不要分点，不要 JSON，不要解释。`

  const lines = segments.map((s) => `【${s.label}】\n${s.text}`)
  const user = `原始提示词：\n${originalPrompt}\n\n--- 用户编辑块 ---\n${lines.join('\n\n')}`
  const text = await chatOnce(config, system, user)
  if (!text) throw new Error('模型返回为空')
  return text
}
