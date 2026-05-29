/** 短剧 Agent 角色人设（对齐参考截图） */
export type DramaAgentPersonaId =
  | 'art_director'
  | 'screenwriter'
  | 'character_designer'
  | 'scene_designer'
  | 'storyboard_designer'

export type DramaAgentPersona = {
  id: DramaAgentPersonaId
  name: string
  /** 状态文案 */
  statusIdle: string
  statusPlanning: string
  statusDone: string
  statusWorking: string
  /** CSS 修饰类 */
  toneClass: string
  emoji: string
}

/** 全部 Agent 人设 */
export const DRAMA_AGENT_PERSONAS: Record<DramaAgentPersonaId, DramaAgentPersona> = {
  art_director: {
    id: 'art_director',
    name: '艺术总监',
    statusIdle: '我可以帮您创作剧情故事短片',
    statusPlanning: '规划中',
    statusDone: '规划完成',
    statusWorking: '工作中…',
    toneClass: 'drama-agent-persona--pink',
    emoji: '🎨',
  },
  screenwriter: {
    id: 'screenwriter',
    name: '编剧',
    statusIdle: '准备撰写剧本',
    statusPlanning: '规划中',
    statusDone: '规划完成',
    statusWorking: '正在泡浓茶提神',
    toneClass: 'drama-agent-persona--purple',
    emoji: '✍️',
  },
  character_designer: {
    id: 'character_designer',
    name: '角色设计师',
    statusIdle: '准备角色设计',
    statusPlanning: '规划中',
    statusDone: '规划完成',
    statusWorking: '正在调配颜料',
    toneClass: 'drama-agent-persona--gold',
    emoji: '👑',
  },
  scene_designer: {
    id: 'scene_designer',
    name: '场景设计师',
    statusIdle: '准备场景设计',
    statusPlanning: '规划中',
    statusDone: '规划完成',
    statusWorking: '正在寻找灵感',
    toneClass: 'drama-agent-persona--red',
    emoji: '🔥',
  },
  storyboard_designer: {
    id: 'storyboard_designer',
    name: '分镜师',
    statusIdle: '准备分镜设计',
    statusPlanning: '规划中',
    statusDone: '规划完成',
    statusWorking: '正在梳理镜头',
    toneClass: 'drama-agent-persona--cyan',
    emoji: '🎬',
  },
}

/** 根据专家 role 字符串解析人设 */
export function resolveDramaPersona(expertRole?: string): DramaAgentPersona {
  const r = String(expertRole ?? '').trim()
  if (/编剧|screenwriter/i.test(r)) return DRAMA_AGENT_PERSONAS.screenwriter
  if (/分镜|storyboard/i.test(r)) return DRAMA_AGENT_PERSONAS.storyboard_designer
  if (/场景|scene/i.test(r)) return DRAMA_AGENT_PERSONAS.scene_designer
  if (/角色|character/i.test(r)) return DRAMA_AGENT_PERSONAS.character_designer
  return DRAMA_AGENT_PERSONAS.art_director
}
