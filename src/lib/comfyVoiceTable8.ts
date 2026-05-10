import type { ComfyVoiceTableRow } from '../types'

/** 与 Comfy 节点下拉一致（界面展示）；提交时映射为节点常用英文枚举。 */
export const COMFY_VOICE_TABLE_LANGUAGE_OPTIONS = [
  'Auto',
  '中国人',
  'English',
  '日本人',
  'Korean',
  '法国人',
  '德国人',
  '西班牙人',
  '葡萄牙语',
  '俄罗斯人',
  '意大利人',
] as const

const UI_LANG_TO_COMFY: Record<string, string> = {
  Auto: 'Auto',
  中国人: 'Chinese',
  English: 'English',
  日本人: 'Japanese',
  Korean: 'Korean',
  法国人: 'French',
  德国人: 'German',
  西班牙人: 'Spanish',
  葡萄牙语: 'Portuguese',
  俄罗斯人: 'Russian',
  意大利人: 'Italian',
}

export function mapVoiceTableUiLangToComfy(ui: string): string {
  const t = String(ui || '').trim()
  return UI_LANG_TO_COMFY[t] ?? (t || 'Auto')
}

/** 当前绑定的工作流 JSON 是否为 8 路 FB 多人音色表（与云端无参多人图同构）。 */
export function workflowJsonSupportsVoiceTable8Slots(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  if (!s.includes('"class_type":"FB_Qwen3TTSRoleBank"')) return false
  if (!s.includes('"class_type":"FB_Qwen3TTSDialogueInference"')) return false
  const vd = s.match(/"class_type":"FB_Qwen3TTSVoiceDesign"/g)
  if (!vd || vd.length !== 8) return false
  const vc = s.match(/"class_type":"FB_Qwen3TTSVoiceClonePrompt"/g)
  if (!vc || vc.length !== 8) return false
  return s.includes('"role_name_8"')
}

/**
 * 与 `server/cloud-workflows.json` 中 ac275434 条目一致：RoleBank 槽位顺序 → VoiceDesign / VoiceClone 节点 id。
 * 用户表格第 i 行对应第 i 个槽位。
 */
const SLOT_DEF = [
  { vd: '6', clone: '7', roleKey: 'role_name_1' },
  { vd: '4', clone: '8', roleKey: 'role_name_2' },
  { vd: '5', clone: '16', roleKey: 'role_name_3' },
  { vd: '19', clone: '21', roleKey: 'role_name_4' },
  { vd: '20', clone: '23', roleKey: 'role_name_5' },
  { vd: '27', clone: '28', roleKey: 'role_name_6' },
  { vd: '25', clone: '29', roleKey: 'role_name_7' },
  { vd: '26', clone: '32', roleKey: 'role_name_8' },
] as const

export function voiceTableRowHasContent(r: ComfyVoiceTableRow | undefined): boolean {
  if (!r) return false
  return [r.roleName, r.sampleLine, r.voiceInstruct, r.language].some((x) => String(x || '').trim())
}

export function isFbEightSlotVoicePrompt(prompt: Record<string, unknown>): boolean {
  const rb = prompt['18']
  if (!rb || typeof rb !== 'object') return false
  const o = rb as { class_type?: string; inputs?: Record<string, unknown> }
  if (o.class_type !== 'FB_Qwen3TTSRoleBank') return false
  const ins = o.inputs
  if (!ins || typeof ins !== 'object') return false
  if (ins.role_name_8 === undefined) return false
  for (const { vd, clone } of SLOT_DEF) {
    const vdn = prompt[vd] as { class_type?: string } | undefined
    const cln = prompt[clone] as { class_type?: string } | undefined
    if (vdn?.class_type !== 'FB_Qwen3TTSVoiceDesign') return false
    if (cln?.class_type !== 'FB_Qwen3TTSVoiceClonePrompt') return false
  }
  return true
}

/** 将侧栏表格写入 prompt（仅覆盖有内容的字段；未填行保持工作流 JSON 原样）。 */
export function applyComfyVoiceTableRowsToPrompt(
  prompt: Record<string, unknown>,
  rows: ComfyVoiceTableRow[],
): void {
  if (!isFbEightSlotVoicePrompt(prompt)) return
  const rb = prompt['18'] as { inputs: Record<string, unknown> }
  for (let i = 0; i < SLOT_DEF.length; i += 1) {
    const row = rows[i]
    if (!voiceTableRowHasContent(row)) continue
    const { vd, clone, roleKey } = SLOT_DEF[i]
    const name = String(row!.roleName || '').trim()
    const line = String(row!.sampleLine || '').trim()
    const voice = String(row!.voiceInstruct || '').trim()
    const langRaw = String(row!.language || '').trim()

    if (name) rb.inputs[roleKey] = name
    const vNode = prompt[vd] as { inputs: Record<string, unknown> }
    const cNode = prompt[clone] as { inputs: Record<string, unknown> }
    if (line) {
      vNode.inputs.text = line
      cNode.inputs.ref_text = line
    }
    if (voice) vNode.inputs.instruct = voice
    if (langRaw) vNode.inputs.language = mapVoiceTableUiLangToComfy(langRaw)
  }
}
