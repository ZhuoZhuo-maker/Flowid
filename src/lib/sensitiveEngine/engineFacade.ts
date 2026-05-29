import { SENSITIVE_CORE } from '../../data/sensitiveCore'
import { isSensitiveFilterEnabled } from '../sensitiveFilterConfig'
import { AhoCorasick } from './acEngine'
import {
  fetchLexiconJson,
  fetchLexiconMeta,
  loadLexiconFromCache,
  persistFetchedLexicon,
} from './lexiconLoader'
import type { SensitiveLevel, SensitiveWord } from './types'

let engineReady = false
let loadPromise: Promise<void> | null = null
let fullEngine: AhoCorasick | null = null

const fallbackEngine = new AhoCorasick(SENSITIVE_CORE)

/** 单次同步插入的最大词条数；再大则分帧插入，减轻「加载完词库后整页卡死」 */
const PATTERN_INSERT_CHUNK = 450

async function buildFullEngineBatched(words: readonly SensitiveWord[]): Promise<AhoCorasick> {
  const ac = new AhoCorasick([], { deferFailureLinks: true })
  for (let i = 0; i < words.length; i += PATTERN_INSERT_CHUNK) {
    ac.appendPatterns(words.slice(i, Math.min(i + PATTERN_INSERT_CHUNK, words.length)))
    if (i + PATTERN_INSERT_CHUNK < words.length) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
  }
  ac.seal()
  return ac
}

/** 让出主线程，避免 `alert()` 刚关闭或用户刚点击输入框时立刻跑大词表 AC 构建把 UI 卡死数秒 */
function yieldToMainForAcBuild(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0)
      })
    })
  })
}

/**
 * 全量 AC 构建 O(词表规模) 可能占用主线程数百毫秒～数秒；用 idle 时段执行并设 timeout 兜底，
 * 让关闭弹窗、点击输入框等操作有机会先被浏览器处理。
 */
function buildFullEngineWhenIdle(words: readonly SensitiveWord[]): Promise<void> {
  return new Promise((resolve) => {
    const run = async () => {
      try {
        await yieldToMainForAcBuild()
        fullEngine =
          words.length <= PATTERN_INSERT_CHUNK
            ? new AhoCorasick(words)
            : await buildFullEngineBatched(words)
      } catch {
        fullEngine = null
      } finally {
        engineReady = true
        resolve()
      }
    }
    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number
    }
    const kick = () => {
      void run()
    }
    if (typeof g.requestIdleCallback === 'function') {
      // 词表较大时 AC 构建仍可能 >600ms；略放宽 timeout，减少「点了发送却迟迟无反应」的体感
      g.requestIdleCallback(kick, { timeout: 1800 })
    } else {
      window.setTimeout(kick, 0)
    }
  })
}

function currentEngine(): AhoCorasick {
  return fullEngine ?? fallbackEngine
}

function startBackgroundLoad(): void {
  if (loadPromise) return
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  loadPromise = (async () => {
    try {
      let cacheBust: string | undefined
      try {
        const meta = await fetchLexiconMeta(base)
        cacheBust = meta.version
        const cached = await loadLexiconFromCache(meta.version)
        if (cached && cached.length > 0) {
          await yieldToMainForAcBuild()
          await buildFullEngineWhenIdle(cached)
          return
        }
      } catch {
        cacheBust = undefined
      }
      const data = await fetchLexiconJson(base, cacheBust)
      const words = await persistFetchedLexicon(data)
      await yieldToMainForAcBuild()
      await buildFullEngineWhenIdle(words)
    } catch {
      /* 无 lexicon 文件或 fetch 失败：仅用 fallback */
    }
  })()
}

export function ensureLexiconLoading(): void {
  if (!isSensitiveFilterEnabled()) return
  if (engineReady || loadPromise) return
  startBackgroundLoad()
}

export function isLexiconReady(): boolean {
  return engineReady
}

/**
 * 等待后台主词库加载尝试结束（成功切换全量 AC，或失败仍用内置小表）。
 * 在「发送/执行」等异步入口先 await 再 `canSend`，可避免首屏仅用 fallback 时漏拦主词库词条。
 */
export async function awaitSensitiveLexiconSettled(): Promise<void> {
  if (!isSensitiveFilterEnabled()) return
  ensureLexiconLoading()
  if (loadPromise) await loadPromise
}

export function checkSensitiveWordsSync(text: string): ReturnType<AhoCorasick['check']> {
  ensureLexiconLoading()
  return currentEngine().check(text)
}

export function replaceSensitiveWordsSync(text: string, replaceChar: string): string {
  ensureLexiconLoading()
  return currentEngine().replaceByLevels(text, new Set<SensitiveLevel>(['block', 'warning']), replaceChar)
}

export function replaceSensitiveWordsByLevelSync(
  text: string,
  levels: ReadonlyArray<SensitiveLevel>,
  replaceChar: string,
): string {
  ensureLexiconLoading()
  return currentEngine().replaceByLevels(text, new Set(levels), replaceChar)
}

export function __resetEnginesForTest(): void {
  engineReady = false
  loadPromise = null
  fullEngine = null
}

export function __installFullEngineForTest(words: SensitiveWord[]): void {
  fullEngine = new AhoCorasick(words)
  engineReady = true
}
