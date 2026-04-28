const path = require('node:path')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('node:fs')

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'analyzer-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win.loadFile(path.join(__dirname, 'analyzer.html'))
}

ipcMain.handle('analyzer:pick-file', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 ComfyUI 工作流 JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths.length) return null
  const filePath = result.filePaths[0]
  const content = fs.readFileSync(filePath, 'utf8')
  return { filePath, content }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
