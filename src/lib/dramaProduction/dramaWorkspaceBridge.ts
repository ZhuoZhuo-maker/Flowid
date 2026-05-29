/** 右侧制片画布导航 Tab */
export type DramaWorkspaceNavTab = 'overview' | 'script' | 'character' | 'scene' | 'storyboard' | 'video'

/** 兼容旧侧栏 script / character / storyboard / video */
export type DramaRailTabCompat = 'script' | 'character' | 'storyboard' | 'video'

let activeNavTab: DramaWorkspaceNavTab = 'overview'
const tabListeners = new Set<() => void>()
const stateListeners = new Set<() => void>()

/** 设置右侧画布导航 Tab */
export function setDramaWorkspaceNavTab(tab: DramaWorkspaceNavTab): void {
  if (activeNavTab === tab) return
  activeNavTab = tab
  tabListeners.forEach((fn) => fn())
}

export function getDramaWorkspaceNavTab(): DramaWorkspaceNavTab {
  return activeNavTab
}

/** @deprecated 使用 setDramaWorkspaceNavTab */
export function setDramaWorkspaceTab(tab: DramaRailTabCompat): void {
  setDramaWorkspaceNavTab(tab)
}

export function getDramaWorkspaceTab(): DramaRailTabCompat {
  const t = activeNavTab
  if (t === 'overview' || t === 'scene') return 'script'
  return t
}

export function subscribeDramaWorkspaceTab(listener: () => void): () => void {
  tabListeners.add(listener)
  return () => tabListeners.delete(listener)
}

export function notifyDramaStateChanged(): void {
  stateListeners.forEach((fn) => fn())
}

export function subscribeDramaStateChanged(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/** 生成进度时自动切到对应 Tab */
export function syncDramaNavFromCanvasFocus(focus: 'script' | 'character' | 'scene' | 'storyboard'): void {
  if (focus === 'storyboard') setDramaWorkspaceNavTab('storyboard')
  else if (focus === 'scene') setDramaWorkspaceNavTab('scene')
  else if (focus === 'character') setDramaWorkspaceNavTab('character')
}
