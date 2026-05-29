const { contextBridge, ipcRenderer } = require('electron')
const fs = require('node:fs')

function getExeMtimeMsSync() {
  try {
    return fs.statSync(process.execPath).mtimeMs
  } catch {
    return 0
  }
}

/**
 * 暴露桌面端能力给前端。
 */
contextBridge.exposeInMainWorld('flowidDesktop', {
  /** 主进程原生确认框（删除等敏感操作） */
  confirmDialog: (payload) => ipcRenderer.invoke('flowid:dialog-confirm', payload),
  /** OpenAI 兼容 HTTP（主进程 fetch，供桌面端直连厂商 API） */
  openAiCompatFetch: (payload) => ipcRenderer.invoke('flowid:openai-compat-fetch', payload),
  /** 当前可执行文件 mtime（重装/覆盖安装后通常变化；用于用户协议是否需重显） */
  getExeMtimeMsSync: () => getExeMtimeMsSync(),
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
})
