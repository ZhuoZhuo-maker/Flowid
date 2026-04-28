const path = require('node:path')
const fs = require('node:fs/promises')
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

/**
 * 顶部菜单：便于打开开发者工具（用户无需记忆快捷键组合时可走菜单）。
 */
function installApplicationMenu() {
  const template = [
    {
      label: '视图',
      submenu: [
        {
          label: '开发者工具',
          accelerator: 'Ctrl+Shift+I',
          click: () => {
            const w = BrowserWindow.getFocusedWindow()
            if (w && !w.isDestroyed()) w.webContents.toggleDevTools()
          },
        },
        {
          label: '重新加载页面',
          accelerator: 'Ctrl+R',
          click: () => {
            const w = BrowserWindow.getFocusedWindow()
            if (w && !w.isDestroyed()) w.reload()
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * 统一应用标识：Windows 任务栏/Jumplist 尽量显示为 Flowid，而非 Electron。
 */
app.setName('Flowid')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.flowid.desktop')
}

/**
 * 创建桌面主窗口。
 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
}

/**
 * 绑定自动更新事件。
 * 说明：更新源地址由发布阶段配置；本地开发环境不会触发更新检查。
 */
function setupAutoUpdate() {
  if (isDev) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => {
    dialog.showMessageBox({
      type: 'warning',
      title: '自动更新提示',
      message: '检测更新失败，可稍后重试。',
      detail: String(error?.message || error || '未知错误'),
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: '新版本已下载完成，是否立即重启更新？',
        buttons: ['立即更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  void autoUpdater.checkForUpdatesAndNotify()
}

ipcMain.handle('desktop:get-app-version', () => app.getVersion())

/**
 * 读取 UTF-8 文本文件（供 Flowid 工程 JSON 等使用）。
 */
ipcMain.handle('flowid:fs-read-utf8', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const text = await fs.readFile(filePath.trim(), 'utf8')
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 读取二进制文件（桌面端）。
 */
ipcMain.handle('flowid:fs-read-binary', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const fp = path.normalize(filePath.trim())
    const buf = await fs.readFile(fp)
    const payload = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return { ok: true, data: payload }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 读取目录下文件清单（支持递归），用于桌面端历史面板按 output 目录展示最近产物。
 */
ipcMain.handle('flowid:fs-read-directory', async (_event, dirPath, opts) => {
  try {
    if (typeof dirPath !== 'string' || !dirPath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const base = path.normalize(dirPath.trim())
    const cfg = opts && typeof opts === 'object' ? opts : {}
    const recursive = Boolean(cfg.recursive)
    const maxFilesRaw = Number(cfg.maxFiles)
    const maxDepthRaw = Number(cfg.maxDepth)
    const maxFiles = Number.isFinite(maxFilesRaw) ? Math.min(Math.max(50, maxFilesRaw), 10_000) : 2000
    const maxDepth = Number.isFinite(maxDepthRaw) ? Math.min(Math.max(0, maxDepthRaw), 10) : 4

    /** @type {Array<{ name: string, path: string, size: number, mtimeMs: number }>} */
    const out = []
    /** @type {Array<{ dir: string, depth: number }>} */
    const queue = [{ dir: base, depth: 0 }]

    while (queue.length && out.length < maxFiles) {
      const { dir, depth } = queue.shift()
      let dirents
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of dirents) {
        if (out.length >= maxFiles) break
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (recursive && depth < maxDepth) {
            queue.push({ dir: fullPath, depth: depth + 1 })
          }
          continue
        }
        if (!entry.isFile()) continue
        try {
          const stat = await fs.stat(fullPath)
          out.push({
            name: entry.name,
            path: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          })
        } catch {
          // ignore
        }
      }
    }

    return { ok: true, files: out }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 写入 UTF-8 文本；自动创建父目录。
 */
ipcMain.handle('flowid:fs-write-utf8', async (_event, filePath, text) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    if (typeof text !== 'string') {
      return { ok: false, error: 'bad-text' }
    }
    const fp = filePath.trim()
    await fs.mkdir(path.dirname(fp), { recursive: true })
    await fs.writeFile(fp, text, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 将 IPC 传入的多种二进制形态统一为 Node Buffer（Electron 克隆后有时是 Uint8Array / 带 byteLength 的纯对象）。
 */
function ipcPayloadToBuffer(payload) {
  if (payload == null) return null
  if (Buffer.isBuffer(payload)) return payload
  if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload))
  if (ArrayBuffer.isView(payload)) {
    const v = payload
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  }
  if (typeof payload.byteLength === 'number' && Array.isArray(payload?.data)) {
    try {
      return Buffer.from(payload.data)
    } catch {
      return null
    }
  }
  return null
}

/**
 * 写入二进制文件（图片/音视频等）；自动创建父目录。
 */
ipcMain.handle('flowid:fs-write-binary', async (_event, filePath, payload) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const buf = ipcPayloadToBuffer(payload)
    if (!buf || !buf.length) {
      return { ok: false, error: `bad-buffer:${typeof payload}` }
    }
    const fp = path.normalize(filePath.trim())
    await fs.mkdir(path.dirname(fp), { recursive: true })
    await fs.writeFile(fp, buf)
    return { ok: true }
  } catch (err) {
    console.error('[Flowid main] flowid:fs-write-binary', err)
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 删除文件（桌面端）。
 */
ipcMain.handle('flowid:fs-delete-file', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const fp = path.normalize(filePath.trim())
    await fs.unlink(fp)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 选择单个 JSON 文件（默认打开路径可选）。
 */
ipcMain.handle('flowid:dialog-pick-json-file', async (_event, opts) => {
  try {
    const win = BrowserWindow.getFocusedWindow()
    const defaultPath = opts && typeof opts.defaultPath === 'string' ? opts.defaultPath : undefined
    const res = await dialog.showOpenDialog(win ?? undefined, {
      title: '选择 JSON 文件',
      properties: ['openFile'],
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePaths?.length) {
      return { ok: true, canceled: true }
    }
    return { ok: true, path: res.filePaths[0] }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 选择（或新建）Flowid 工程 JSON 文件路径。
 * - 允许用户直接输入新文件名；
 * - 若未带 `.json` 后缀会自动补齐。
 */
ipcMain.handle('flowid:dialog-save-json-file', async (_event, opts) => {
  try {
    const win = BrowserWindow.getFocusedWindow()
    const defaultPath = opts && typeof opts.defaultPath === 'string' ? opts.defaultPath : undefined
    const res = await dialog.showSaveDialog(win ?? undefined, {
      title: '选择或新建 Flowid 工程文件',
      defaultPath,
      filters: [{ name: 'Flowid 工程 JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) {
      return { ok: true, canceled: true }
    }
    const picked = String(res.filePath).trim()
    if (!picked) return { ok: true, canceled: true }
    const finalPath = picked.toLowerCase().endsWith('.json') ? picked : `${picked}.json`
    return { ok: true, path: finalPath }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 选择文件夹。
 */
ipcMain.handle('flowid:dialog-pick-directory', async (_event, opts) => {
  try {
    const win = BrowserWindow.getFocusedWindow()
    const defaultPath = opts && typeof opts.defaultPath === 'string' ? opts.defaultPath : undefined
    const res = await dialog.showOpenDialog(win ?? undefined, {
      title: '选择文件夹',
      properties: ['openDirectory'],
      defaultPath,
    })
    if (res.canceled || !res.filePaths?.length) {
      return { ok: true, canceled: true }
    }
    return { ok: true, path: res.filePaths[0] }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 确保目录存在（递归创建）。
 */
ipcMain.handle('flowid:fs-ensure-directory', async (_event, dirPath) => {
  try {
    if (typeof dirPath !== 'string' || !dirPath.trim()) {
      return { ok: false, error: 'empty-path' }
    }
    const p = dirPath.trim()
    await fs.mkdir(p, { recursive: true })
    return { ok: true, path: p }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

/**
 * 在 basePath 下确保子目录存在，并返回子目录完整路径。
 */
ipcMain.handle('flowid:fs-ensure-subdirectory', async (_event, basePath, childName) => {
  try {
    if (typeof basePath !== 'string' || !basePath.trim()) {
      return { ok: false, error: 'empty-base-path' }
    }
    if (typeof childName !== 'string' || !childName.trim()) {
      return { ok: false, error: 'empty-child-name' }
    }
    const base = basePath.trim()
    const child = childName.trim()
    const full = path.join(base, child)
    await fs.mkdir(full, { recursive: true })
    return { ok: true, path: full }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
})

ipcMain.handle('desktop:check-for-updates', async () => {
  if (isDev) return { ok: false, reason: 'dev-mode' }
  const result = await autoUpdater.checkForUpdates()
  return { ok: true, hasUpdate: Boolean(result?.updateInfo?.version) }
})

app.whenReady().then(() => {
  installApplicationMenu()
  createMainWindow()
  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
