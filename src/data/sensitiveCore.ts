import type { SensitiveWord } from '../lib/sensitiveEngine/types'

/**
 * 首包内置核心敏感词（离线/主词库加载前 fast path）。
 * 与 `public/lexicon/sensitive.json` 主词库合并由 `npm run build:lexicon` 产出。
 */
export const SENSITIVE_CORE: SensitiveWord[] = [
  { word: 'fa lun gong', level: 'block', category: 'political' },
  { word: 'tai du', level: 'block', category: 'political' },
  { word: 'zang du', level: 'block', category: 'political' },
  { word: 'jiang du', level: 'block', category: 'political' },
  { word: 'gong chan', level: 'block', category: 'political' },
  { word: '麻豆', level: 'block', category: 'porn' },
  { word: '91视频', level: 'block', category: 'porn' },
  { word: '黄色网站', level: 'block', category: 'porn' },
  { word: '裸聊', level: 'block', category: 'porn' },
  { word: '约炮', level: 'block', category: 'porn' },
  { word: '杀人', level: 'warning', category: 'violence' },
  { word: '炸弹', level: 'warning', category: 'violence' },
  { word: '恐怖袭击', level: 'warning', category: 'violence' },
  { word: '自杀', level: 'warning', category: 'violence' },
  { word: '毒品', level: 'block', category: 'illegal' },
  { word: '冰毒', level: 'block', category: 'illegal' },
  { word: '赌博', level: 'block', category: 'illegal' },
  { word: '诈骗', level: 'block', category: 'illegal' },
  { word: '刷单', level: 'warning', category: 'ad' },
]
