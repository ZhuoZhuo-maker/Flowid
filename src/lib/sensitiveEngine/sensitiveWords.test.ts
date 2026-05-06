import { describe, expect, it, beforeEach } from 'vitest'
import {
  checkSensitiveWords,
  replaceSensitiveWords,
  replaceSensitiveWordsByLevel,
} from '../sensitiveWords'
import { __installFullEngineForTest, __resetEnginesForTest } from './engineFacade'
import type { SensitiveWord } from './types'

const tiny: SensitiveWord[] = [
  { word: '赌博', level: 'block', category: 'illegal' },
  { word: '赌', level: 'block', category: 'illegal' },
  { word: '炸弹', level: 'warning', category: 'violence' },
  { word: 'BADWORD', level: 'block', category: 'other' },
]

beforeEach(() => {
  __resetEnginesForTest()
  __installFullEngineForTest(tiny)
})

describe('checkSensitiveWords', () => {
  it('detects block word (case-insensitive ASCII)', () => {
    const r = checkSensitiveWords('hello BADword there')
    expect(r.hasSensitive).toBe(true)
    expect(r.level).toBe('block')
    expect(r.words.some((w) => w.word === 'BADWORD')).toBe(true)
  })

  it('each lexicon entry at most once (overlap 赌/赌博)', () => {
    const r = checkSensitiveWords('我赌博了')
    expect(r.words.length).toBe(2)
    expect(r.blockedCount).toBe(2)
  })

  it('warning level', () => {
    const r = checkSensitiveWords('这里有炸弹')
    expect(r.level).toBe('warning')
    expect(r.warningCount).toBe(1)
  })

  it('newline in text', () => {
    const r = checkSensitiveWords('a\n赌博\nb')
    expect(r.hasSensitive).toBe(true)
  })

  it('mixed Chinese and ASCII', () => {
    const r = checkSensitiveWords('前缀badword后缀赌博')
    expect(r.level).toBe('block')
    expect(r.words.some((w) => w.word === 'BADWORD')).toBe(true)
    expect(r.words.some((w) => w.word === '赌博')).toBe(true)
  })
})

describe('replaceSensitiveWords', () => {
  it('masks block and warning by default', () => {
    const out = replaceSensitiveWords('赌博与炸弹')
    expect(out).not.toContain('赌博')
    expect(out).not.toContain('炸弹')
    expect(out.includes('*')).toBe(true)
  })
})

describe('replaceSensitiveWordsByLevel', () => {
  it('only block', () => {
    const out = replaceSensitiveWordsByLevel('赌博与炸弹', ['block'])
    expect(out).not.toContain('赌博')
    expect(out).toContain('炸弹')
  })
})
