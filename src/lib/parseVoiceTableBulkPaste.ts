import type { ComfyVoiceTableRow } from '../types'
import { COMFY_VOICE_TABLE_LANGUAGE_OPTIONS } from './comfyVoiceTable8'

const LANG_SET = new Set<string>(COMFY_VOICE_TABLE_LANGUAGE_OPTIONS as readonly string[])

export type ParseVoiceTableBulkPasteResult = {
  rows: ComfyVoiceTableRow[]
  skippedLines: number
  truncated: boolean
}

function emptyRow(): ComfyVoiceTableRow {
  return { roleName: '', sampleLine: '', voiceInstruct: '', language: 'Auto' }
}

/** 解析单行 `角色###代表台词###声音设定`；可选第四段 `###语言`（须为下拉里已有项）。 */
export function parseVoiceTableBulkPasteLine(line: string): ComfyVoiceTableRow | null {
  const raw = String(line || '').trim()
  if (!raw) return null
  if (raw.startsWith('（') || raw.startsWith('(')) return null
  const parts = raw.split('###').map((p) => p.trim())
  if (parts.length < 3) return null
  const roleName = String(parts[0] || '').trim()
  const sampleLine = String(parts[1] || '').trim()
  if (!roleName || !sampleLine) return null

  let language = 'Auto'
  let instructParts = parts.slice(2)
  const last = instructParts[instructParts.length - 1]
  if (instructParts.length >= 2 && last && LANG_SET.has(last)) {
    language = last
    instructParts = instructParts.slice(0, -1)
  }
  const voiceInstruct = instructParts.join('###').trim()
  if (!voiceInstruct) return null

  return { roleName, sampleLine, voiceInstruct, language }
}

/**
 * 多行粘贴：每行 `角色名称###代表台词###声音设定`（台词/声音内勿使用 ###，除非用第四段指定语言）。
 * 最多解析 8 路；超出部分丢弃并标记 truncated。
 */
export function parseVoiceTableBulkPaste(raw: string): ParseVoiceTableBulkPasteResult {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let skippedLines = 0
  const allValid: ComfyVoiceTableRow[] = []
  for (const line of lines) {
    const row = parseVoiceTableBulkPasteLine(line)
    if (!row) skippedLines += 1
    else allValid.push(row)
  }
  const truncated = allValid.length > 8
  const rows = allValid.slice(0, 8)
  return { rows, skippedLines, truncated }
}

/** 将解析结果铺平为表格行：至少 3 行、至多 8 行，不足补空行。 */
export function voiceTableRowsPaddedForUi(parsed: ComfyVoiceTableRow[]): ComfyVoiceTableRow[] {
  const maxSlots = 8
  const taken = parsed.slice(0, maxSlots)
  const targetLen = Math.min(maxSlots, Math.max(3, taken.length))
  const next = taken.map((r) => ({ ...r }))
  while (next.length < targetLen) next.push(emptyRow())
  return next
}
