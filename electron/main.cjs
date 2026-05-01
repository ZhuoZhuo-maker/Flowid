const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const crypto = require('node:crypto')
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// 将 Chromium 磁盘缓存放到 userData 下，减少 Windows 上「Unable to move the cache / 拒绝访问」与多实例争用默认目录的问题。
try {
  const fsSync = require('node:fs')
  const cacheDir = path.join(app.getPath('userData'), 'chromium-cache')
  fsSync.mkdirSync(cacheDir, { recursive: true })
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir)
} catch {
  // ignore
}

function resolveAppIconPath() {
  // BrowserWindow icon 支持 png/ico。这里放在 electron/assets 里，开发/生产都能读到。
  // 注意：打包图标（exe/安装器）由 electron-builder 的 build/icon.ico 决定。
  const candidates = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.ico'),
  ]
  for (const p of candidates) {
    try {
      require('node:fs').accessSync(p)
      return p
    } catch {
      // ignore
    }
  }
  return undefined
}

/**
 * Windows 上部分核显/远程桌面环境会出现 Electron 偶发黑屏；
 * 关闭硬件加速可显著提升稳定性（Flowid 以 2D UI 为主，影响可接受）。
 */
app.disableHardwareAcceleration()

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
  const icon = resolveAppIconPath()
  const win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#060b16',
    show: false,
    ...(icon ? { icon } : null),
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

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.webContents.on('did-fail-load', async (_event, code, desc, url) => {
    const detail = `${String(desc || 'unknown')} (code=${code})\n${String(url || '')}`
    const result = await dialog.showMessageBox(win, {
      type: 'error',
      title: '页面加载失败',
      message: 'Flowid 页面加载失败，可能是开发服务未启动或网络/本地文件异常。',
      detail,
      buttons: ['重试', '关闭'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0 && !win.isDestroyed()) {
      if (isDev) {
        void win.loadURL('http://127.0.0.1:5173')
      } else {
        void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
      }
    } else if (!win.isDestroyed()) {
      win.close()
    }
  })

  win.webContents.on('render-process-gone', async (_event, details) => {
    const reason = String(details?.reason || 'unknown')
    const exitCode = Number(details?.exitCode ?? 0)
    const result = await dialog.showMessageBox(win, {
      type: 'error',
      title: '渲染进程异常退出',
      message: '界面进程异常退出（可能表现为黑屏）。',
      detail: `reason=${reason}, exitCode=${exitCode}`,
      buttons: ['重新加载', '关闭应用'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0 && !win.isDestroyed()) {
      win.reload()
    } else {
      app.quit()
    }
  })
}

/**
 * 绑定自动更新事件。
 * 说明：更新源地址由发布阶段配置；本地开发环境不会触发更新检查。
 */
function setupAutoUpdate() {
  if (isDev) return
  // 未配置更新源/未生成 app-update.yml 时，electron-updater 会报 ENOENT，影响首启体验；此时直接跳过。
  try {
    const updateYml = path.join(process.resourcesPath || '', 'app-update.yml')
    require('node:fs').accessSync(updateYml)
  } catch {
    return
  }
  autoUpdater.autoDownload = true
  // 关闭「退出时静默安装」：用户点「退出软件」时必须直接退出，不能在 quit 时再偷偷装更新。
  autoUpdater.autoInstallOnAppQuit = false

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
        message: '新版本已下载完成。请点击「立即更新」安装并重启；若不更新将退出软件。',
        buttons: ['立即更新', '退出软件'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall(false, true)
        } else {
          app.quit()
        }
      })
      .catch(() => {
        app.quit()
      })
  })

  void autoUpdater.checkForUpdates()
}

ipcMain.handle('desktop:get-app-version', () => app.getVersion())

/**
 * 获取稳定的机器标识（用于授权绑定）。
 * 注意：这是“桌面端最小可用实现”，若后续需要更强的防重装/换用户名能力，可替换为原生方案（如读取 Windows MachineGuid）。
 */
ipcMain.handle('desktop:get-machine-id', () => {
  try {
    const host = String(os.hostname() || '').trim()
    const user = (() => {
      try {
        return String(os.userInfo()?.username || '').trim()
      } catch {
        return ''
      }
    })()
    const base = [
      'flowid-machine-v1',
      process.platform,
      process.arch,
      host,
      user,
      app.getPath('userData'),
    ].join('|')
    const hex = crypto.createHash('sha256').update(base, 'utf8').digest('hex')
    return `MID-${hex.slice(0, 32)}`
  } catch {
    return 'MID-unknown'
  }
})

const OPENAI_COMPAT_FETCH_MAX_BYTES = 48 * 1024 * 1024

/**
 * 桌面端主进程转发 OpenAI 兼容请求（聊天 / TTS 等），避免渲染进程 CORS，且不强制经过用户自建的 auth 代理。
 * payload: { url, method: 'GET'|'POST', headers?, json? }
 */
ipcMain.handle('flowid:openai-compat-fetch', async (_event, payload) => {
  try {
    const url = String(payload?.url || '').trim()
    const methodRaw = String(payload?.method || 'GET').trim().toUpperCase()
    const method = methodRaw === 'POST' ? 'POST' : 'GET'
    const headers = payload?.headers && typeof payload.headers === 'object' ? payload.headers : {}
    const json = payload?.json
    let u
    try {
      u = new URL(url)
    } catch {
      return { ok: false, error: 'bad-url' }
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: 'unsupported-protocol' }
    }
    const upstream = await fetch(url, {
      method,
      headers,
      body: json != null && method !== 'GET' ? JSON.stringify(json) : undefined,
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > OPENAI_COMPAT_FETCH_MAX_BYTES) {
      return { ok: false, error: `response-too-large:${buf.length}` }
    }
    const headersOut = {}
    upstream.headers.forEach((v, k) => {
      headersOut[k] = v
    })
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return {
      ok: true,
      status: upstream.status,
      statusText: upstream.statusText || '',
      headers: headersOut,
      body,
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err || 'fetch-failed') }
  }
})

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

    /** @type {Array<{ name: string, path: string, size: number, mtimeMs: number, birthtimeMs: number }>} */
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
          const birth = Number(stat.birthtimeMs)
          const ctime = Number(stat.ctimeMs)
          const birthtimeMs =
            Number.isFinite(birth) && birth > 0 ? birth : Number.isFinite(ctime) && ctime > 0 ? ctime : stat.mtimeMs
          out.push({
            name: entry.name,
            path: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            birthtimeMs,
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
/** 渲染进程确认框（避免部分环境下 window.confirm 不可靠） */
ipcMain.handle('flowid:dialog-confirm', async (_event, payload) => {
  try {
    const message = String(payload?.message || '确认要执行此操作吗？').trim()
    const detail = typeof payload?.detail === 'string' ? payload.detail : undefined
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Flowid',
      message,
      detail,
    })
    return { ok: true, confirmed: r.response === 0 }
  } catch (err) {
    return { ok: false, confirmed: false, error: String(err?.message || err) }
  }
})

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
 * 重命名（移动）单个文件；目标父目录不存在时递归创建。
 */
ipcMain.handle('flowid:fs-rename-file', async (_event, fromPath, toPath) => {
  try {
    if (typeof fromPath !== 'string' || typeof toPath !== 'string') {
      return { ok: false, error: 'bad-args' }
    }
    const from = path.normalize(fromPath.trim())
    const to = path.normalize(toPath.trim())
    if (!from || !to) return { ok: false, error: 'empty-path' }
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.rename(from, to)
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
