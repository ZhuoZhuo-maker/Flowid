import type { AudioNodeData } from '../types'

/** 与云端「(语音转音乐)-音乐创作」等 Ace Step 工作流默认值对齐 */
export const DEFAULT_MUSIC_FINE_TUNE_DRAFT: MusicFineTuneDraft = {
  durationMinutes: 3,
  bpm: 98,
  timesignature: '4',
  language: 'zh',
  keyscale: 'D major',
}

export type MusicFineTuneDraft = {
  durationMinutes: 1 | 2 | 3 | 4
  bpm: number
  timesignature: string
  language: string
  keyscale: string
}

export const MUSIC_DURATION_MINUTES_OPTIONS = [1, 2, 3, 4] as const

export const MUSIC_TIMESIGNATURE_OPTIONS = ['2', '3', '4', '6'] as const

/** Ace Step / Comfy 侧语言代码（与常见枚举一致） */
export const MUSIC_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'en', label: '英语 (English)' },
  { value: 'ja', label: '日语 (Japanese)' },
  { value: 'zh', label: '中文 (简体)' },
  { value: 'es', label: '西班牙文 (Spanish)' },
  { value: 'de', label: '德语 (German)' },
  { value: 'fr', label: '法语 (French)' },
  { value: 'pt', label: '葡萄牙语 (Portuguese)' },
  { value: 'ru', label: '俄语 (Russian)' },
  { value: 'it', label: '意大利语 (Italian)' },
  { value: 'nl', label: '荷兰语 (Dutch)' },
  { value: 'pl', label: '波兰语 (Polish)' },
  { value: 'tr', label: '土耳其语 (Turkish)' },
  { value: 'vi', label: '越南语 (Vietnamese)' },
  { value: 'cs', label: '捷克语 (Czech)' },
  { value: 'fa', label: '波斯语 (Persian)' },
  { value: 'id', label: '印尼语 (Indonesian)' },
  { value: 'ko', label: '韩语 (Korean)' },
  { value: 'uk', label: '乌克兰语 (Ukrainian)' },
  { value: 'hu', label: '匈牙利语 (Hungarian)' },
  { value: 'ar', label: '阿拉伯语 (Arabic)' },
  { value: 'sv', label: '瑞典语 (Swedish)' },
  { value: 'ro', label: '罗马尼亚语 (Romanian)' },
  { value: 'el', label: '希腊语 (Greek)' },
]

const MAJ_ROOTS = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
] as const

const MIN_ROOTS = MAJ_ROOTS

export const MUSIC_KEYSCALE_OPTIONS: string[] = [
  ...MAJ_ROOTS.map((r) => `${r} major`),
  ...MIN_ROOTS.map((r) => `${r} minor`),
]

function clampDurationMinutes(raw: unknown): 1 | 2 | 3 | 4 {
  const n = Number(raw)
  if (n === 1 || n === 2 || n === 3 || n === 4) return n
  return DEFAULT_MUSIC_FINE_TUNE_DRAFT.durationMinutes
}

function clampBpm(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return DEFAULT_MUSIC_FINE_TUNE_DRAFT.bpm
  return Math.max(40, Math.min(240, n))
}

function normalizeTimesignature(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (MUSIC_TIMESIGNATURE_OPTIONS.includes(s as (typeof MUSIC_TIMESIGNATURE_OPTIONS)[number])) return s
  return DEFAULT_MUSIC_FINE_TUNE_DRAFT.timesignature
}

function normalizeLanguage(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (MUSIC_LANGUAGE_OPTIONS.some((o) => o.value === s)) return s
  return DEFAULT_MUSIC_FINE_TUNE_DRAFT.language
}

function normalizeKeyscale(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (MUSIC_KEYSCALE_OPTIONS.includes(s)) return s
  return DEFAULT_MUSIC_FINE_TUNE_DRAFT.keyscale
}

export function musicFineTuneDraftFromAudioData(data: AudioNodeData): MusicFineTuneDraft {
  return {
    durationMinutes: clampDurationMinutes(data.comfyMusicDurationMinutes),
    bpm: clampBpm(data.comfyMusicBpm),
    timesignature: normalizeTimesignature(data.comfyMusicTimesignature),
    language: normalizeLanguage(data.comfyMusicLanguage),
    keyscale: normalizeKeyscale(data.comfyMusicKeyscale),
  }
}

export function audioDataPatchFromMusicFineTuneDraft(draft: MusicFineTuneDraft): Partial<AudioNodeData> {
  return {
    comfyMusicDurationMinutes: draft.durationMinutes,
    comfyMusicBpm: clampBpm(draft.bpm),
    comfyMusicTimesignature: normalizeTimesignature(draft.timesignature),
    comfyMusicLanguage: normalizeLanguage(draft.language),
    comfyMusicKeyscale: normalizeKeyscale(draft.keyscale),
  }
}

export type MusicFineTuneInjection = {
  durationSec: number
  bpm: number
  timesignature: string
  language: string
  keyscale: string
}

export function buildMusicFineTuneInjection(draft: MusicFineTuneDraft): MusicFineTuneInjection {
  const durationSec = Math.round(draft.durationMinutes * 60)
  return {
    durationSec,
    bpm: clampBpm(draft.bpm),
    timesignature: normalizeTimesignature(draft.timesignature),
    language: normalizeLanguage(draft.language),
    keyscale: normalizeKeyscale(draft.keyscale),
  }
}

/**
 * 将侧栏「微调」写入 Ace Step 类音乐工作流 API prompt（按 class_type 识别，不依赖固定节点 id）。
 */
export function injectMusicWorkflowFineTune(
  prompt: Record<string, unknown>,
  tune: MusicFineTuneInjection,
): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const seconds = Math.max(60, Math.min(900, Math.round(tune.durationSec)))
  const bpm = Math.round(tune.bpm)
  const ts = String(tune.timesignature)
  const lang = String(tune.language)
  const ks = String(tune.keyscale)

  for (const [, raw] of Object.entries(cloned)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const nodeRecord = raw as Record<string, unknown>
    const classType = String(nodeRecord.class_type || '').toLowerCase()
    const inputs = nodeRecord.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const ir = inputs as Record<string, unknown>

    if (classType === 'textencodeacestepaudio1.5') {
      ir.bpm = bpm
      ir.duration = seconds
      ir.timesignature = ts
      ir.language = lang
      ir.keyscale = ks
      continue
    }

    if (classType.includes('emptyacestep') && classType.includes('latent') && classType.includes('audio')) {
      const sec = ir.seconds
      if (Array.isArray(sec) && sec.length >= 1) {
        const primId = String(sec[0])
        const prim = cloned[primId]
        if (prim && typeof prim === 'object' && !Array.isArray(prim)) {
          const pi = (prim as { inputs?: Record<string, unknown> }).inputs
          if (pi && 'value' in pi) {
            const v = pi.value
            if (typeof v === 'number' || typeof v === 'string') {
              pi.value = seconds
            }
          }
        }
      }
      ir.seconds = seconds
    }
  }

  return cloned
}
