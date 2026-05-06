/**
 * 从 App 壳（项目档案/预设模板顶栏）请求打开画布内的「系统设置」，并切到指定侧栏项。
 * 由 StudioApp 在挂载时 register，卸载时 unregister。
 */
let openDeviceActivation: (() => void) | null = null

export function registerStudioDeviceActivationOpener(fn: (() => void) | null): void {
  openDeviceActivation = fn
}

/** 进入工作区并打开设置 → 侧栏「授权码」 */
export function openStudioSettingsDeviceActivation(): void {
  openDeviceActivation?.()
}
