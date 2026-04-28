const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('workflowAnalyzerDesktop', {
  pickFile: () => ipcRenderer.invoke('analyzer:pick-file'),
})
