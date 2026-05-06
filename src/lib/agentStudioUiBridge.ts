/**
 * 全屏助手工作台与画布 Studio UI 的轻量桥接（关闭助手并打开画布侧栏等）。
 */
type OpenCanvasSettingsFn = () => void

let openCanvasSettings: OpenCanvasSettingsFn | null = null

export function registerAgentOpenCanvasSettings(fn: OpenCanvasSettingsFn | null) {
  openCanvasSettings = fn
}

export function requestAgentOpenCanvasSettings() {
  openCanvasSettings?.()
}
