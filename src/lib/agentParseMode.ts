/**
 * 助手解析模式：规则引擎（本地） / 智能对话（与设置面板「AI 虚拟助手」同一套 endpoint + model）
 */

export type AgentParseMode = 'rules' | 'llm'

const STORAGE_KEY = 'flowid_ai_parse_mode'

/** 旧版存了 gpt-4o / claude-3.5，统一视为 llm */
export function normalizeStoredParseMode(raw: string | null): AgentParseMode {
  if (raw === 'rules') return 'rules'
  if (raw === 'llm' || raw === 'gpt-4o' || raw === 'claude-3.5') return 'llm'
  return 'rules'
}

export const AGENT_PARSE_MODE_LABELS: Record<AgentParseMode, string> = {
  rules: '规则引擎',
  llm: '智能对话',
}

/** 下拉展示用（纯文案，无图标） */
export const AGENT_PARSE_MODE_OPTIONS: {
  value: AgentParseMode
  label: string
  hint: string
}[] = [
  { value: 'rules', label: '规则引擎（快速，本地）', hint: '规则引擎' },
  {
    value: 'llm',
    label: '智能对话（使用设置中的模型）',
    hint: '与「设置 → AI 虚拟助手」相同',
  },
]

export function isAgentParseMode(x: string): x is AgentParseMode {
  return x === 'rules' || x === 'llm' || x === 'gpt-4o' || x === 'claude-3.5'
}

export function loadStoredAgentParseMode(): AgentParseMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return normalizeStoredParseMode(v)
  } catch {
    return 'rules'
  }
}

export function saveStoredAgentParseMode(mode: AgentParseMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}
