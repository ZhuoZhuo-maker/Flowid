/**
 * 短剧 Agent UI 运行时状态（生成进度、选中风格、画布焦点等）。
 */

export type DramaCanvasFocus = 'script' | 'character' | 'scene' | 'storyboard'

export type DramaStoryboardGenPhase = 'idle' | 'images' | 'videos'

export type DramaStoryboardGenState = {
  running: boolean
  phase: DramaStoryboardGenPhase
  done: number
  total: number
  label: string
  elapsedSec: number
  maxSec: number
  imagesReady: boolean
  videosReady: boolean
}

export type DramaCharacterGenState = {
  running: boolean
  done: number
  total: number
  /** 当前步骤文案 */
  label: string
  elapsedSec: number
  maxSec: number
}

export type DramaSceneGenPhase = 'idle' | 'main' | 'multiview'

export type DramaSceneGenState = {
  running: boolean
  phase: DramaSceneGenPhase
  done: number
  total: number
  label: string
  elapsedSec: number
  maxSec: number
  mainImageReady: boolean
  multiViewReady: boolean
}

export type DramaImageGenMode = 'workflow' | 'cloud'

/** 单个制片环节的生成方式选择 */
export type DramaStageGenChoice = {
  mode: DramaImageGenMode
  workflowEntryId?: string
  workflowName?: string
  chosen: boolean
}

export type DramaUiState = {
  /** 自动制片：写入角色/场景/分镜后自动出图出视频（默认开启） */
  autoPilot: boolean
  /** @deprecated 全局出图方式，保留兼容；优先用 stageGenChoices */
  imageGenMode: DramaImageGenMode
  /** @deprecated 是否已全局确认出图方式 */
  imageGenModeChosen: boolean
  /** 各环节独立的工作流 / 云端选择 */
  stageGenChoices: Partial<Record<import('./dramaGenStages').DramaGenStage, DramaStageGenChoice>>
  selectedVisualStyle: string | null
  selectedSceneStyle: string | null
  characterGen: DramaCharacterGenState
  sceneGen: DramaSceneGenState
  storyboardGen: DramaStoryboardGenState
  canvasFocus: DramaCanvasFocus
}

const DEFAULT_STORYBOARD_GEN: DramaStoryboardGenState = {
  running: false,
  phase: 'idle',
  done: 0,
  total: 3,
  label: '生成分镜图',
  elapsedSec: 0,
  maxSec: 300,
  imagesReady: false,
  videosReady: false,
}

const DEFAULT_SCENE_GEN: DramaSceneGenState = {
  running: false,
  phase: 'idle',
  done: 0,
  total: 1,
  label: '生成场景图',
  elapsedSec: 0,
  maxSec: 60,
  mainImageReady: false,
  multiViewReady: false,
}

const DEFAULT_UI: DramaUiState = {
  autoPilot: true,
  imageGenMode: 'workflow',
  imageGenModeChosen: false,
  stageGenChoices: {},
  selectedVisualStyle: null,
  selectedSceneStyle: null,
  characterGen: { running: false, done: 0, total: 6, label: '生成角色图', elapsedSec: 0, maxSec: 60 },
  sceneGen: { ...DEFAULT_SCENE_GEN },
  storyboardGen: { ...DEFAULT_STORYBOARD_GEN },
  canvasFocus: 'script',
}

const uiByProject = new Map<string, DramaUiState>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

/** 读取项目 UI 状态 */
export function getDramaUiState(projectTabId: string): DramaUiState {
  if (!projectTabId) return { ...DEFAULT_UI, sceneGen: { ...DEFAULT_SCENE_GEN }, storyboardGen: { ...DEFAULT_STORYBOARD_GEN } }
  const raw = uiByProject.get(projectTabId) ?? DEFAULT_UI
  return {
    ...raw,
    stageGenChoices: { ...(raw.stageGenChoices ?? {}) },
    sceneGen: { ...DEFAULT_SCENE_GEN, ...raw.sceneGen },
    storyboardGen: { ...DEFAULT_STORYBOARD_GEN, ...raw.storyboardGen },
  }
}

/** 是否开启自动制片（默认开启）。 */
export function isDramaAutoPilot(projectTabId: string): boolean {
  if (!projectTabId) return true
  return getDramaUiState(projectTabId).autoPilot !== false
}

/** 合并更新 UI 状态 */
export function patchDramaUiState(projectTabId: string, patch: Partial<DramaUiState>): DramaUiState {
  if (!projectTabId) return { ...DEFAULT_UI }
  const cur = getDramaUiState(projectTabId)
  const next: DramaUiState = {
    ...cur,
    ...patch,
    stageGenChoices: patch.stageGenChoices
      ? { ...cur.stageGenChoices, ...patch.stageGenChoices }
      : cur.stageGenChoices,
    sceneGen: patch.sceneGen ? { ...cur.sceneGen, ...patch.sceneGen } : cur.sceneGen,
    characterGen: patch.characterGen ? { ...cur.characterGen, ...patch.characterGen } : cur.characterGen,
    storyboardGen: patch.storyboardGen ? { ...cur.storyboardGen, ...patch.storyboardGen } : cur.storyboardGen,
  }
  uiByProject.set(projectTabId, next)
  notify()
  return next
}

/** 订阅 UI 状态变化 */
export function subscribeDramaUiState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 启动角色图生成进度（模拟截图 0/6 → 6/6）
 * @param projectTabId 项目 id
 * @param total 角色总数
 */
export function startDramaCharacterGen(projectTabId: string, total: number): void {
  patchDramaUiState(projectTabId, {
    canvasFocus: 'character',
    characterGen: {
      running: true,
      done: 0,
      total,
      label: '生成角色图',
      elapsedSec: 0,
      maxSec: 60,
    },
  })
}

/** 推进角色图生成一步 */
export function tickDramaCharacterGen(projectTabId: string, done: number, elapsedSec?: number): void {
  const cur = getDramaUiState(projectTabId)
  const gen = cur.characterGen
  patchDramaUiState(projectTabId, {
    characterGen: {
      ...gen,
      done,
      elapsedSec: elapsedSec ?? gen.elapsedSec + 1,
      running: done < gen.total,
    },
  })
}

/** 读取某环节生成选择 */
export function getDramaStageGenChoice(
  projectTabId: string,
  stage: import('./dramaGenStages').DramaGenStage,
): DramaStageGenChoice | null {
  const hit = getDramaUiState(projectTabId).stageGenChoices[stage]
  return hit?.chosen ? hit : null
}

/** 写入某环节生成选择 */
export function setDramaStageGenChoice(
  projectTabId: string,
  stage: import('./dramaGenStages').DramaGenStage,
  choice: Omit<DramaStageGenChoice, 'chosen'> & { chosen?: boolean },
): void {
  const cur = getDramaUiState(projectTabId).stageGenChoices
  patchDramaUiState(projectTabId, {
    stageGenChoices: {
      ...cur,
      [stage]: { ...choice, chosen: choice.chosen !== false },
    },
    imageGenMode: choice.mode,
    imageGenModeChosen: true,
  })
}

/** 结束角色图生成 */
export function finishDramaCharacterGen(projectTabId: string): void {
  const cur = getDramaUiState(projectTabId)
  patchDramaUiState(projectTabId, {
    characterGen: { ...cur.characterGen, running: false, done: cur.characterGen.total },
  })
}

/**
 * 启动场景图生成（主图或多视图）
 * @param projectTabId 项目 id
 * @param phase 主图 / 多视图
 */
export function startDramaSceneGen(projectTabId: string, phase: 'main' | 'multiview'): void {
  patchDramaUiState(projectTabId, {
    canvasFocus: 'scene',
    sceneGen: {
      running: true,
      phase,
      done: 0,
      total: 1,
      label: '生成场景图',
      elapsedSec: 0,
      maxSec: phase === 'main' ? 60 : 45,
      mainImageReady: phase === 'multiview' ? getDramaUiState(projectTabId).sceneGen.mainImageReady : false,
      multiViewReady: false,
    },
  })
}

/** 推进场景图生成 */
export function tickDramaSceneGen(projectTabId: string, done: number, elapsedSec?: number): void {
  const cur = getDramaUiState(projectTabId)
  const gen = cur.sceneGen
  patchDramaUiState(projectTabId, {
    sceneGen: {
      ...gen,
      done,
      elapsedSec: elapsedSec ?? gen.elapsedSec + 2,
      running: done < gen.total,
    },
  })
}

/** 完成场景主图或多视图 */
export function finishDramaSceneGen(
  projectTabId: string,
  opts?: { mainOk?: boolean; multiOk?: boolean },
): void {
  const cur = getDramaUiState(projectTabId)
  patchDramaUiState(projectTabId, {
    sceneGen: {
      ...cur.sceneGen,
      running: false,
      done: cur.sceneGen.total,
      mainImageReady:
        opts?.mainOk === true
          ? true
          : opts?.mainOk === false
            ? false
            : cur.sceneGen.mainImageReady,
      multiViewReady:
        opts?.multiOk === true
          ? true
          : opts?.multiOk === false
            ? false
            : cur.sceneGen.multiViewReady,
      phase: 'idle',
    },
  })
}

/**
 * 启动分镜图 / 分镜视频生成进度
 * @param projectTabId 项目 id
 * @param phase 分镜图或分镜视频
 * @param total 总任务数
 */
export function startDramaStoryboardGen(
  projectTabId: string,
  phase: 'images' | 'videos',
  total: number,
): void {
  patchDramaUiState(projectTabId, {
    canvasFocus: 'storyboard',
    storyboardGen: {
      running: true,
      phase,
      done: 0,
      total,
      label: phase === 'images' ? '生成分镜图像' : '生成分镜视频',
      elapsedSec: 0,
      maxSec: phase === 'images' ? 180 : 300,
      imagesReady: phase === 'videos' ? getDramaUiState(projectTabId).storyboardGen.imagesReady : false,
      videosReady: false,
    },
  })
}

/** 推进分镜生成进度 */
export function tickDramaStoryboardGen(projectTabId: string, done: number, elapsedSec?: number): void {
  const cur = getDramaUiState(projectTabId)
  const gen = cur.storyboardGen
  patchDramaUiState(projectTabId, {
    storyboardGen: {
      ...gen,
      done,
      elapsedSec: elapsedSec ?? gen.elapsedSec + 2,
      running: done < gen.total,
    },
  })
}

/** 完成分镜图或分镜视频生成 */
export function finishDramaStoryboardGen(projectTabId: string, phase: 'images' | 'videos'): void {
  const cur = getDramaUiState(projectTabId)
  patchDramaUiState(projectTabId, {
    storyboardGen: {
      ...cur.storyboardGen,
      running: false,
      done: cur.storyboardGen.total,
      phase: 'idle',
      imagesReady: phase === 'images' || cur.storyboardGen.imagesReady,
      videosReady: phase === 'videos' || cur.storyboardGen.videosReady,
    },
  })
}
