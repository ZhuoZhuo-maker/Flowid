/**
 * TD `TDQwen3TTSMultiDialog` 的 `text` 字段需要「角色名: 台词」按行分隔；
 * 无参模板里常见 Python 风格列表 `[{'name':'旁白','instruct':'…','text':'…'}, …]`，
 * 若经 @ 文本节点原样进入 __NOTE__，Comfy 会把 `{'name'` 当成说话人前缀。此处在提交前转成行格式。
 */

function unescapePythonishString(s: string): string {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

/**
 * 将结构化角色台本（JSON 数组或类 Python repr 的单引号列表）转为 MultiDialog 文本。
 * 无法识别时返回 null，调用方应沿用原文。
 */
export function tryStructuredVoiceListToMultiDialogLines(raw: string): string | null {
  const s = String(raw ?? '').trim()
  if (!s.startsWith('[')) return null

  try {
    const j = JSON.parse(s) as unknown
    if (Array.isArray(j) && j.length > 0) {
      const lines: string[] = []
      for (const item of j) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const o = item as Record<string, unknown>
        const name = String(o.name ?? '').trim()
        const text = String(o.text ?? '').trim()
        if (name && text) lines.push(`${name}: ${text}`)
      }
      return lines.length ? lines.join('\n') : null
    }
  } catch {
    // 继续尝试单引号类 Python 列表
  }

  if (!/^\[\s*\{/.test(s) || !s.includes("'name'")) return null

  const lines: string[] = []
  const re =
    /'name'\s*:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?'text'\s*:\s*'((?:[^'\\]|\\.)*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const name = unescapePythonishString(m[1]!).trim()
    const text = unescapePythonishString(m[2]!).trim()
    if (name && text) lines.push(`${name}: ${text}`)
  }
  return lines.length ? lines.join('\n') : null
}

/** 工作流 JSON 文本中是否包含 TD 多人对白节点（与 __NOTE__ 注入目标一致）。 */
export function workflowJsonUsesTdMultiDialog(workflowJsonText: string): boolean {
  return String(workflowJsonText || '').includes('TDQwen3TTSMultiDialog')
}

/** 是否为 TD Batch 用的说话人列表（JSON / Python 单引号列表），用于与「角色: 台词」正文分段。 */
function blockLooksLikeTdSpeakerListJson(block: string): boolean {
  const b = block.trim()
  if (!b.startsWith('[')) return false
  return b.includes('"name"') || b.includes("'name'")
}

/**
 * 连线 + 侧栏会把多个文字节点拼成一段 note；若同时含「对白正文」与「说话人 JSON」，
 * 整段塞进 MultiDialog 会把 JSON 逐行当台词（控制台里 [、`、"name" 各一段）。按空行拆块后分流。
 */
/** 全角 `：` 可能导致 TD 无法识别说话人前缀，统一为半角 `: `（仅每行首个分隔）。 */
export function normalizeTtsDialogueRoleColons(text: string): string {
  const s = String(text ?? '')
  if (!s.includes('：')) return s
  return s.replace(/^([^\r\n]+?)[：]\s*/gm, (_, head) => `${String(head).trim()}: `)
}

function normalizeNoteNewlines(s: string): string {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
}

export function splitTdNoteIntoDialogueAndSpeakerJson(raw: string): {
  dialogue: string
  speakerJsonCandidate: string | null
} {
  const s = normalizeNoteNewlines(String(raw ?? '')).trim()
  if (!s) return { dialogue: '', speakerJsonCandidate: null }

  const blocks = s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  if (blocks.length <= 1) {
    const one = blocks[0] ?? ''
    if (blockLooksLikeTdSpeakerListJson(one)) {
      return { dialogue: '', speakerJsonCandidate: one }
    }
    /**
     * 单换行衔接：…台词\n[\n  { "name"…
     * 允许 `[` 前空白（从某些编辑器粘贴时常见）。
     */
    const nlBracket = /\n\s*\[/.exec(one)
    if (nlBracket && nlBracket.index !== undefined) {
      const left = one.slice(0, nlBracket.index).trim()
      const bracketPos = one.indexOf('[', nlBracket.index)
      if (bracketPos >= 0) {
        const right = one.slice(bracketPos).trim()
        if (left && blockLooksLikeTdSpeakerListJson(right)) {
          return { dialogue: left, speakerJsonCandidate: right }
        }
      }
    }
    return { dialogue: one, speakerJsonCandidate: null }
  }

  const jsonBlocks: string[] = []
  const textBlocks: string[] = []
  for (const b of blocks) {
    if (blockLooksLikeTdSpeakerListJson(b)) jsonBlocks.push(b)
    else textBlocks.push(b)
  }
  const speakerJsonCandidate = jsonBlocks.length ? jsonBlocks.join('\n\n') : null
  const dialogue = textBlocks.join('\n\n')
  return { dialogue, speakerJsonCandidate }
}

/**
 * TD「无参多人」模板：节点 8 常为 MultiDialog、节点 9 为 CR Text 说话人 JSON。
 * 若模板无 __NOTE__ 或用户用结构化列表更新说话人，在此统一覆盖，避免仍跑 Comfy 里写死的示例对白。
 */
export function applyNoteToTdMultiSpeakerTemplatePrompt(
  prompt: Record<string, unknown>,
  args: {
    dialogueText: string
    speakerListRaw: string
    hadNotePlaceholder: boolean
  },
): void {
  const anyMulti = Object.values(prompt).some(
    (v) =>
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      (v as { class_type?: string }).class_type === 'TDQwen3TTSMultiDialog',
  )
  if (!anyMulti) return

  const raw = String(args.speakerListRaw ?? '').trim()
  const structuredLines = tryStructuredVoiceListToMultiDialogLines(raw)
  const looksLikeSpeakerListJson =
    raw.startsWith('[') && (raw.includes("'name'") || raw.includes('"name"'))
  const dialogueToInject =
    args.hadNotePlaceholder ? null : (structuredLines ?? String(args.dialogueText ?? '').trim())

  for (const [, rawNode] of Object.entries(prompt)) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue
    const o = rawNode as { class_type?: string; inputs?: Record<string, unknown> }
    if (o.class_type === 'TDQwen3TTSMultiDialog' && o.inputs && typeof o.inputs === 'object') {
      if (dialogueToInject) {
        o.inputs.text = dialogueToInject
      }
    }
    if (
      (structuredLines || looksLikeSpeakerListJson) &&
      o.class_type === 'CR Text' &&
      o.inputs &&
      typeof o.inputs === 'object' &&
      typeof o.inputs.text === 'string'
    ) {
      const t = String(o.inputs.text || '').trim()
      if (t.startsWith('[')) {
        o.inputs.text = raw
      }
    }
  }
}
