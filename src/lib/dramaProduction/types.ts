import type { CloudImageAspectKey } from '../../types'
import type { DramaAgentPersonaId } from './dramaAgentPersonas'

/** 短剧制片阶段（按序推进，可回退修改） */
export type DramaProductionPhase =
  | 'intake'
  | 'script_draft'
  | 'character_location'
  | 'compliance_review'
  | 'storyboard'
  | 'storyboard_images'
  | 'video_audio'
  | 'export'
  | 'done'

/** 项目级制作参数 */
export type DramaProductionSpec = {
  concept: string
  targetPlatform: string
  visualStyle: string
  aspect: CloudImageAspectKey | 'custom'
  customWidth?: number
  customHeight?: number
  shotCount: number
  toneNotes: string
  /** 分镜方案：多图参考 / 宫格图 */
  storyboardPlan?: DramaStoryboardPlanKind
  /** 分镜视频模型（如 Seedance 2.0） */
  videoModel?: string
  /** 视频档位：Pro 满血 / Fast 更快 */
  videoTier?: 'pro' | 'fast'
  /** 视频分辨率 */
  videoResolution?: '720p' | '480p'
}

export type DramaCharacter = {
  id: string
  name: string
  personality: string
  appearance: string
  background: string
  /** 角色设计图节点 id（单张设定） */
  designImageNodeId?: string
  /** 角色设计图 URL */
  designImageSrc?: string
  /** 角色概念图节点 id（三视图 / 设定图，画布） */
  imageNodeId?: string
  /** 角色概念图预览 URL（执行成功后写入） */
  imageSrc?: string
}

export type DramaLocation = {
  id: string
  name: string
  description: string
  visualStyle: string
  props: string[]
  /** 场景主图节点 id */
  mainImageNodeId?: string
  /** 场景主图 URL */
  mainImageSrc?: string
  /** 多视图 URL 列表 */
  multiViewSrcs?: string[]
}

/** 单镜头（分镜表一行） */
export type DramaShot = {
  index: number
  title: string
  scene: string
  shotType: string
  action: string
  dialogue: string
  imagePrompt: string
  videoPrompt: string
  /** 音频 / 环境音提示词 */
  audioPrompt?: string
  characterIds: string[]
  locationId: string
  /** 分镜图节点 id 列表（宫格多图时每镜多个） */
  imageNodeIds?: string[]
  /** 分镜图 URL 列表 */
  imageSrcs?: string[]
  /** 成片视频节点 id */
  videoNodeId?: string
  /** 成片视频 URL */
  videoSrc?: string
}

/** 分镜方案类型 */
export type DramaStoryboardPlanKind = 'multi-ref' | 'grid'

/** 合规 / 节奏审核记录 */
export type DramaReviewNote = {
  compliance: string
  plotRhythm: string
  passed: boolean
}

/** 短剧制片结构化状态（剧本 / 角色 / 分镜在 FlowID 侧本地映射，与右侧卡片同步） */
export type DramaProductionState = {
  version: 1
  toolId: 'short-drama'
  phase: DramaProductionPhase
  spec: DramaProductionSpec
  scriptBody: string
  characters: DramaCharacter[]
  locations: DramaLocation[]
  shots: DramaShot[]
  review: DramaReviewNote | null
  /** 当前群聊活跃专家（未设则按 phase 推断） */
  activeExpertId?: DramaAgentPersonaId
  /** 成片视频 URL（合成后） */
  finalVideoSrc?: string
  updatedAtMs: number
}

export function createInitialDramaProductionState(): DramaProductionState {
  const now = Date.now()
  return {
    version: 1,
    toolId: 'short-drama',
    phase: 'intake',
    spec: {
      concept: '',
      targetPlatform: '',
      visualStyle: '',
      aspect: '9:16',
      shotCount: 6,
      toneNotes: '',
    },
    scriptBody: '',
    characters: [],
    locations: [],
    shots: [],
    review: null,
    activeExpertId: 'art_director',
    updatedAtMs: now,
  }
}
