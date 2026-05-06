import type {
  AudioNodeData,
  ImageNodeData,
  ScriptNodeData,
  StudioNodeData,
  TextNodeData,
  VideoNodeData,
} from '../types'
import { SENSITIVE_CORE } from '../data/sensitiveCore'
import {
  checkSensitiveWordsSync,
  ensureLexiconLoading,
  replaceSensitiveWordsByLevelSync,
  replaceSensitiveWordsSync,
} from './sensitiveEngine/engineFacade'
import type { SensitiveWord } from './sensitiveEngine/types'

export type { SensitiveCategory, SensitiveLevel, SensitiveWord } from './sensitiveEngine/types'

export { awaitSensitiveLexiconSettled, ensureLexiconLoading, isLexiconReady } from './sensitiveEngine/engineFacade'

/**
 * 首包内置核心词（与 `public/lexicon/sensitive.json` 合并前的 fast path 子集）。
 * 主词库由 `npm run build:lexicon` 生成并由运行时按需加载，不再打进 bundle。
 */
export const sensitiveWordsDB: typeof SENSITIVE_CORE = SENSITIVE_CORE

export function checkSensitiveWords(text: string): {
  hasSensitive: boolean
  words: SensitiveWord[]
  level: 'warning' | 'block' | 'clean'
  blockedCount: number
  warningCount: number
} {
  ensureLexiconLoading()
  return checkSensitiveWordsSync(text)
}

export function replaceSensitiveWords(text: string, replaceChar: string = '*'): string {
  ensureLexiconLoading()
  return replaceSensitiveWordsSync(text, replaceChar)
}

export function replaceSensitiveWordsByLevel(
  text: string,
  levels: Array<'block' | 'warning'>,
  replaceChar: string = '*',
): string {
  ensureLexiconLoading()
  return replaceSensitiveWordsByLevelSync(text, levels, replaceChar)
}

export function canSend(
  text: string,
  blockWarning: boolean = false,
): {
  allowed: boolean
  reason?: string
  blockedCount?: number
} {
  const result = checkSensitiveWords(text)

  if (result.level === 'block') {
    return {
      allowed: false,
      reason: `消息包含 ${result.blockedCount} 个敏感词，已被拦截`,
      blockedCount: result.blockedCount,
    }
  }

  if (result.level === 'warning' && blockWarning) {
    return {
      allowed: false,
      reason: `消息包含 ${result.warningCount} 个敏感词（警告级），提交时已拦截，请修改后再执行`,
      blockedCount: 0,
    }
  }

  return { allowed: true }
}

export function collectUserFacingTextFromNodeData(data: StudioNodeData): string {
  switch (data.kind) {
    case 'text':
      return String((data as TextNodeData).body || '')
    case 'script':
      return String((data as ScriptNodeData).body || '')
    case 'image':
      return String((data as ImageNodeData).prompt || '')
    case 'video': {
      const vd = data as VideoNodeData
      const slots = [
        vd.prompt,
        vd.prompt2,
        vd.prompt3,
        vd.prompt4,
        ...(Array.isArray(vd.extraPrompts) ? vd.extraPrompts : []),
      ]
      return slots.map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n')
    }
    case 'audio':
    case 'music':
      return String((data as AudioNodeData).note || '')
    default:
      return ''
  }
}

export function sanitizeStudioNodeDataUserFields(data: StudioNodeData): Partial<StudioNodeData> {
  switch (data.kind) {
    case 'text': {
      const t = data as TextNodeData
      return { kind: 'text', body: replaceSensitiveWords(t.body || '') } as Partial<StudioNodeData>
    }
    case 'script': {
      const s = data as ScriptNodeData
      return { kind: 'script', body: replaceSensitiveWords(s.body || '') } as Partial<StudioNodeData>
    }
    case 'image': {
      const i = data as ImageNodeData
      return { kind: 'image', prompt: replaceSensitiveWords(i.prompt || '') } as Partial<StudioNodeData>
    }
    case 'video': {
      const v = data as VideoNodeData
      const ex = Array.isArray(v.extraPrompts)
        ? v.extraPrompts.map((s) => replaceSensitiveWords(String(s ?? '')))
        : undefined
      return {
        kind: 'video',
        prompt: replaceSensitiveWords(v.prompt || ''),
        prompt2: replaceSensitiveWords(v.prompt2 || ''),
        prompt3: replaceSensitiveWords(v.prompt3 || ''),
        prompt4: replaceSensitiveWords(v.prompt4 || ''),
        extraPrompts: ex,
      } as Partial<StudioNodeData>
    }
    case 'audio':
    case 'music': {
      const a = data as AudioNodeData
      return { kind: a.kind, note: replaceSensitiveWords(a.note || '') } as Partial<StudioNodeData>
    }
    default:
      return {}
  }
}

export function applySensitiveFilterToNodeDataPatch(patch: Partial<StudioNodeData>): Partial<StudioNodeData> {
  const out: Record<string, unknown> = { ...patch }
  const sf = (v: unknown) =>
    typeof v === 'string' ? replaceSensitiveWordsByLevel(v, ['block']) : v
  const keys = ['body', 'prompt', 'prompt2', 'prompt3', 'prompt4', 'note', 'title'] as const
  for (const k of keys) {
    if (k in patch && typeof (patch as Record<string, unknown>)[k] === 'string') {
      out[k] = sf((patch as Record<string, unknown>)[k])
    }
  }
  const ex = (patch as { extraPrompts?: unknown }).extraPrompts
  if ('extraPrompts' in patch && Array.isArray(ex)) {
    out.extraPrompts = ex.map((s) => replaceSensitiveWordsByLevel(String(s ?? ''), ['block']))
  }
  return out as Partial<StudioNodeData>
}
