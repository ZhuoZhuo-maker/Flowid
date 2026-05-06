/**
 * 浮动「智能体」窗口与 Studio 画布之间的解耦桥梁。
 * 浮动 UI 只调用 invoke；StudioApp 在挂载时 register 具体执行逻辑（可替换为后端任务队列等）。
 */

export type AgentSceneBatchPayload = {
  kind: 'scene-batch'
  /** 用户原始指令 */
  userPrompt: string
  /** 解析出的张数（示例） */
  sceneCount: number
  /** 预估积分 */
  points: number
}

export type AgentExecuteResult = {
  ok: boolean
  /** 展示给用户的完成说明 */
  summary: string
}

type AgentExecutor = (payload: AgentSceneBatchPayload) => Promise<AgentExecuteResult>

let executor: AgentExecutor | null = null

export function registerStudioAgentExecutor(fn: AgentExecutor | null): void {
  executor = fn
}

export async function invokeStudioAgentExecution(
  payload: AgentSceneBatchPayload,
): Promise<AgentExecuteResult> {
  if (!executor) {
    return { ok: false, summary: '编辑器尚未注册执行器，请刷新页面后重试。' }
  }
  return executor(payload)
}

import type { AgentParseMode } from './agentParseMode'

export type StudioAgentChatTurn = { role: 'user' | 'assistant'; content: string }

export type StudioAgentChatInvokeOptions = {
  /** 解析模式：规则引擎走本地指令；智能对话走设置中与助手相同的模型 */
  mode?: AgentParseMode
  /** 当前用户句之前的对话轮次（不含本次输入），供 LLM 上下文 */
  history?: StudioAgentChatTurn[]
}

/** 浮动纯聊：用户一句自然语言 → 编辑器内执行 → 返回若干条助手气泡文案 */
export type StudioAgentChatHandler = (
  text: string,
  options?: StudioAgentChatInvokeOptions,
) => Promise<string[]>

let chatHandler: StudioAgentChatHandler | null = null

export function registerStudioAgentChatHandler(fn: StudioAgentChatHandler | null): void {
  chatHandler = fn
}

export async function invokeStudioAgentChat(
  text: string,
  options?: StudioAgentChatInvokeOptions,
): Promise<string[]> {
  if (!chatHandler) {
    return ['助手未接入：请保持在 FlowID 工作区内打开对话窗口。']
  }
  return chatHandler(text, options)
}
