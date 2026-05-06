/** 与历史 `sensitiveWords.ts` 中 `SensitiveWord` 一致，集中定义避免循环依赖 */
export type SensitiveLevel = 'warning' | 'block'
export type SensitiveCategory = 'political' | 'porn' | 'violence' | 'illegal' | 'ad' | 'other'

export interface SensitiveWord {
  word: string
  level: SensitiveLevel
  category: SensitiveCategory
}

export type LexiconJsonEntry = { w: string; lvl: 0 | 1; cat: number }

export interface LexiconJsonPayload {
  version: string
  builtAt: string
  total: number
  entries: LexiconJsonEntry[]
}

/** 轻量元数据，用于版本比对；命中 IndexedDB 时可跳过下载大 JSON */
export interface LexiconMetaPayload {
  version: string
  builtAt?: string
  total?: number
}

/** 与 JSON `cat` 数字互转 */
export const CAT_NUM: Record<SensitiveCategory, number> = {
  political: 0,
  porn: 1,
  violence: 2,
  illegal: 3,
  ad: 4,
  other: 5,
}

export const NUM_CAT: Record<number, SensitiveCategory> = {
  0: 'political',
  1: 'porn',
  2: 'violence',
  3: 'illegal',
  4: 'ad',
  5: 'other',
}

export function entryToWord(e: LexiconJsonEntry): SensitiveWord {
  const cat = NUM_CAT[e.cat] ?? 'other'
  return {
    word: e.w,
    level: e.lvl === 1 ? 'block' : 'warning',
    category: cat,
  }
}

export interface AcMatchInterval {
  start: number
  end: number
  word: string
  level: SensitiveLevel
  category: SensitiveCategory
}
