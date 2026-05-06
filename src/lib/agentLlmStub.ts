import type { AiAssistantConfig } from './aiAssistantAgent'
import { chatMessagesWithModel } from './aiAssistantAgent'

export type LlmChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * 全屏助手「智能对话」：与画布侧助手相同，走设置里的 OpenAI 兼容接口与模型。
 */
export async function callLLM(messages: LlmChatTurn[], config: AiAssistantConfig): Promise<string> {
  const text = await chatMessagesWithModel(messages, config)
  if (text.trim()) return text
  if (config.provider === 'cloud' && !config.apiKey.trim()) {
    return '请先在「设置 → AI 虚拟助手」中填写云端 API Key。'
  }
  if (!config.endpoint.trim() || !config.model.trim()) {
    return '请先在「设置 → AI 虚拟助手」中配置接口地址与模型名称。'
  }
  return '模型未返回内容，请检查网络、服务状态或模型是否支持当前对话格式。'
}
