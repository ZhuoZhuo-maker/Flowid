import type { DramaCharacter, DramaLocation } from './types'
import { loadDramaProductionState, patchDramaProductionState } from './dramaStateStore'

/** 演示用默认角色（对齐截图六人） */
export const DEMO_DRAMA_CHARACTERS: DramaCharacter[] = [
  {
    id: 'char-linyu',
    name: '林宇',
    personality: '内向转学生，初到异世界高中',
    appearance: 'teenager boy, anxious expression, school uniform',
    background: '主角，拥有未知潜力',
  },
  {
    id: 'char-monitor',
    name: '班长',
    personality: '冷静可靠，班级管理者',
    appearance: 'student leader, confident posture',
    background: '掌握部分校园规则',
  },
  {
    id: 'char-liming',
    name: '李明',
    personality: '外向同学，爱展示超能力',
    appearance: 'energetic boy, playful smile',
    background: '林宇的第一个朋友',
  },
  {
    id: 'char-girl',
    name: '女同学',
    personality: '温柔观察型',
    appearance: 'girl with ribbon, curious eyes',
    background: '见证林宇适应过程',
  },
  {
    id: 'char-teacher',
    name: '老师',
    personality: '严肃但公正',
    appearance: 'adult teacher, glasses',
    background: '知晓部分世界秘密',
  },
  {
    id: 'char-zhangwei',
    name: '张伟',
    personality: '竞争型同学',
    appearance: 'athletic boy, sharp gaze',
    background: '与林宇形成对照',
  },
]

/** 演示用默认场景 */
export const DEMO_DRAMA_SCENE: DramaLocation = {
  id: 'loc-classroom',
  name: '异世界高二三班教室',
  description:
    '木质课桌整齐排列，窗外阳光 surreal 地洒入，空气中漂浮着魔法尘埃。黑板旁贴着超能力等级榜，整体氛围介于日常校园与奇幻之间。',
  visualStyle: '粗线条动力感卡通',
  props: ['课桌', '黑板', '窗外光斑'],
}

/**
 * 若角色列表为空则写入演示角色
 * @param projectTabId 项目 id
 * @returns 是否写入
 */
export function ensureDemoDramaCharacters(projectTabId: string): boolean {
  const state = loadDramaProductionState(projectTabId)
  if (!state || state.characters.length >= 3) return false
  patchDramaProductionState(projectTabId, { characters: DEMO_DRAMA_CHARACTERS })
  return true
}

/**
 * 写入演示场景
 * @param projectTabId 项目 id
 */
export function ensureDemoDramaScene(projectTabId: string): void {
  const state = loadDramaProductionState(projectTabId)
  if (!state) return
  if (state.locations.some((l) => l.id === DEMO_DRAMA_SCENE.id)) return
  patchDramaProductionState(projectTabId, { locations: [DEMO_DRAMA_SCENE] })
}

/**
 * 标记前 n 个角色已生成概念图（演示用）
 * @param projectTabId 项目 id
 * @param count 已生成数量
 */
export function markDramaCharacterImages(projectTabId: string, count: number): void {
  const state = loadDramaProductionState(projectTabId)
  if (!state) return
  const characters = state.characters.map((c, i) => ({
    ...c,
    appearance: i < count ? `${c.appearance} [image:ready]` : c.appearance.replace(' [image:ready]', ''),
  }))
  patchDramaProductionState(projectTabId, { characters })
}
