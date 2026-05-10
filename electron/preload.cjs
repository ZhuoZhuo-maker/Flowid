const { contextBridge, ipcRenderer } = require('electron')

/**
 * 暴露桌面端能力给前端。
 */
contextBridge.exposeInMainWorld('flowidDesktop', {
  /** 主进程原生确认框（删除等敏感操作） */
  confirmDialog: (payload) => ipcRenderer.invoke('flowid:dialog-confirm', payload),
  /** OpenAI 兼容 HTTP（主进程 fetch，供桌面端直连厂商 API） */
  openAiCompatFetch: (payload) => ipcRenderer.invoke('flowid:openai-compat-fetch', payload),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  getMachineId: () => ipcRenderer.invoke('desktop:get-machine-id'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  readUtf8File: (filePath) => ipcRenderer.invoke('flowid:fs-read-utf8', filePath),
  readBinaryFile: (filePath) => ipcRenderer.invoke('flowid:fs-read-binary', filePath),
  readDirectory: (dirPath, opts) => ipcRenderer.invoke('flowid:fs-read-directory', dirPath, opts),
  deleteFile: (filePath) => ipcRenderer.invoke('flowid:fs-delete-file', filePath),
  renameFile: (fromPath, toPath) => ipcRenderer.invoke('flowid:fs-rename-file', fromPath, toPath),
  writeUtf8File: (filePath, text) => ipcRenderer.invoke('flowid:fs-write-utf8', filePath, text),
  writeBinaryFile: (filePath, data) => {
    /** 统一成 ArrayBuffer，避免 Uint8Array 经 IPC 后形态不一致导致主进程拒写 */
    let payload = data
    if (data instanceof Uint8Array) {
      const u8 = data
      payload = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    }
    return ipcRenderer.invoke('flowid:fs-write-binary', filePath, payload)
  },
  pickJsonFile: (opts) => ipcRenderer.invoke('flowid:dialog-pick-json-file', opts),
  saveJsonFile: (opts) => ipcRenderer.invoke('flowid:dialog-save-json-file', opts),
  pickDirectory: (opts) => ipcRenderer.invoke('flowid:dialog-pick-directory', opts),
  ensureDirectory: (dirPath) => ipcRenderer.invoke('flowid:fs-ensure-directory', dirPath),
  /** 默认 `{盘符或用户目录}/flowid-zy` 下六项本地存储绝对路径（与安装包约定） */
  getDefaultLocalStoragePaths: () => ipcRenderer.invoke('flowid:get-default-local-storage-paths'),
  ensureSubdirectory: (basePath, childName) =>
    ipcRenderer.invoke('flowid:fs-ensure-subdirectory', basePath, childName),
  /** 本地积分 SQLite（userData/flowid-points.sqlite3） */
  pointsGet: (licenseCode) => ipcRenderer.invoke('flowid:points-get', { licenseCode }),
  pointsBind: (payload) => ipcRenderer.invoke('flowid:points-bind', payload),
  pointsAdjust: (payload) => ipcRenderer.invoke('flowid:points-adjust', payload),
  pointsLog: (payload) => ipcRenderer.invoke('flowid:points-log', payload),
})
