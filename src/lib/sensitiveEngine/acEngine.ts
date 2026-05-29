import type { AcMatchInterval, SensitiveLevel, SensitiveWord } from './types'

type TrieNode = {
  next: Map<string, number>
  fail: number
  /** 在此节点结束的词条（插入时挂到末节点） */
  out: SensitiveWord[]
}

function chKey(ch: string): string {
  return ch.toLowerCase()
}

/**
 * 词条为纯 `[A-Za-z0-9_]` 时，仅在与「标识符字符」不相连时计为命中，
 * 避免 `sm` 命中 `small`、`english_small_caps` 等子串误杀。
 * 含中文、空格、符号等的词条仍按子串匹配，以免漏拦中文组合词。
 */
function patternUsesAsciiIdentifierWordBoundaries(pattern: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(pattern)
}

function isAsciiIdentifierPart(ch: string): boolean {
  return ch.length > 0 && /[A-Za-z0-9_]/.test(ch)
}

function matchRespectsAsciiWordBoundary(text: string, start: number, end: number, patternWord: string): boolean {
  if (!patternUsesAsciiIdentifierWordBoundaries(patternWord)) return true
  if (start > 0 && isAsciiIdentifierPart(text[start - 1]!)) return false
  if (end < text.length && isAsciiIdentifierPart(text[end]!)) return false
  return true
}

/**
 * Aho-Corasick：多模式匹配，扫描长度 O(|text| + 命中数)，与词表规模近似线性仅在构建阶段。
 */
export class AhoCorasick {
  private nodes: TrieNode[] = []
  /** `deferFailureLinks` 为 true 时仅建树，须再调用 `seal()` 后方可匹配 */
  private sealed = false

  constructor(patterns: readonly SensitiveWord[], opts?: { deferFailureLinks?: boolean }) {
    this.nodes.push({ next: new Map(), fail: 0, out: [] })
    this.addPatternsInternal(patterns)
    if (opts?.deferFailureLinks) {
      this.sealed = false
      return
    }
    this.buildFailureLinks()
    this.sealed = true
  }

  /**
   * 在未 seal 前追加词条（用于主线程分帧构建，避免一次性插入数千词卡死 UI）。
   */
  appendPatterns(patterns: readonly SensitiveWord[]): void {
    if (this.sealed) {
      throw new Error('AhoCorasick: cannot appendPatterns after seal()')
    }
    this.addPatternsInternal(patterns)
  }

  /** 完成 fail 链；之后方可 `findAll` / `check` */
  seal(): void {
    if (this.sealed) return
    this.buildFailureLinks()
    this.sealed = true
  }

  private addPatternsInternal(patterns: readonly SensitiveWord[]): void {
    for (const p of patterns) {
      const w = String(p.word || '')
      if (!w) continue
      this.insert(w, p)
    }
  }

  private newNode(): number {
    const id = this.nodes.length
    this.nodes.push({ next: new Map(), fail: 0, out: [] })
    return id
  }

  /** 插入小写键路径；保留原始 SensitiveWord（含原文大小写） */
  private insert(rawWord: string, meta: SensitiveWord): void {
    let cur = 0
    for (let i = 0; i < rawWord.length; i++) {
      const k = chKey(rawWord[i]!)
      let nx = this.nodes[cur]!.next.get(k)
      if (nx === undefined) {
        nx = this.newNode()
        this.nodes[cur]!.next.set(k, nx)
      }
      cur = nx
    }
    this.nodes[cur]!.out.push(meta)
  }

  private buildFailureLinks(): void {
    const q: number[] = []
    const root = this.nodes[0]!
    for (const [, v] of root.next) {
      this.nodes[v]!.fail = 0
      q.push(v)
    }
    let qi = 0
    while (qi < q.length) {
      const u = q[qi++]!
      const nu = this.nodes[u]!
      for (const [ch, v] of nu.next) {
        q.push(v)
        let f = nu.fail
        while (f !== 0 && !this.nodes[f]!.next.has(ch)) {
          f = this.nodes[f]!.fail
        }
        const hit = this.nodes[f]!.next.get(ch)
        this.nodes[v]!.fail = hit === undefined ? 0 : hit
        // 输出：后缀命中在 fail 链上已单独遍历，此处不合并 out 到子节点，搜索时沿 fail 收集
      }
    }
  }

  /** 返回所有匹配区间（可能重叠）；索引基于传入的 `text`（应与扫描用文本一致） */
  findAll(text: string): AcMatchInterval[] {
    if (!this.sealed) {
      throw new Error('AhoCorasick: findAll before seal()')
    }
    const out: AcMatchInterval[] = []
    const n = text.length
    let state = 0
    for (let i = 0; i < n; i++) {
      const ch = chKey(text[i]!)
      while (state !== 0 && !this.nodes[state]!.next.has(ch)) {
        state = this.nodes[state]!.fail
      }
      const nx = this.nodes[state]!.next.get(ch)
      state = nx === undefined ? 0 : nx
      let tmp = state
      for (;;) {
        for (const pat of this.nodes[tmp]!.out) {
          const len = pat.word.length
          const start = i - len + 1
          if (start >= 0) {
            out.push({
              start,
              end: i + 1,
              word: pat.word,
              level: pat.level,
              category: pat.category,
            })
          }
        }
        if (tmp === 0) break
        tmp = this.nodes[tmp]!.fail
      }
    }
    return out.filter((m) => matchRespectsAsciiWordBoundary(text, m.start, m.end, m.word))
  }

  /** 与旧 `checkSensitiveWords` 一致：每个词表条目最多计一次（无论出现几次） */
  check(text: string): {
    hasSensitive: boolean
    words: SensitiveWord[]
    level: 'warning' | 'block' | 'clean'
    blockedCount: number
    warningCount: number
  } {
    const lower = text.toLowerCase()
    const intervals = this.findAll(lower)
    const seen = new Set<string>()
    const foundWords: SensitiveWord[] = []
    for (const m of intervals) {
      const key = `${m.level}\0${m.category}\0${m.word}`
      if (seen.has(key)) continue
      seen.add(key)
      foundWords.push({
        word: m.word,
        level: m.level,
        category: m.category,
      })
    }
    const blockedCount = foundWords.filter((w) => w.level === 'block').length
    const warningCount = foundWords.filter((w) => w.level === 'warning').length
    const hasSensitive = foundWords.length > 0
    const level = blockedCount > 0 ? 'block' : warningCount > 0 ? 'warning' : 'clean'
    return { hasSensitive, words: foundWords, level, blockedCount, warningCount }
  }

  /**
   * 替换：先收集允许级别内的所有区间，按起点升序、长度降序做非重叠选取（长词优先），
   * 再从后往前替换，避免索引位移。
   */
  replaceByLevels(text: string, levels: ReadonlySet<SensitiveLevel>, replaceChar: string): string {
    const lower = text.toLowerCase()
    const all = this.findAll(lower).filter((m) => levels.has(m.level))
    if (!all.length) return text
    const sorted = [...all].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
    const picked: AcMatchInterval[] = []
    for (const m of sorted) {
      let overlap = false
      for (const p of picked) {
        if (m.start < p.end && m.end > p.start) {
          overlap = true
          break
        }
      }
      if (!overlap) picked.push(m)
    }
    picked.sort((a, b) => b.start - a.start)
    let res = text
    for (const m of picked) {
      const len = m.end - m.start
      res = res.slice(0, m.start) + replaceChar.repeat(len) + res.slice(m.end)
    }
    return res
  }
}
