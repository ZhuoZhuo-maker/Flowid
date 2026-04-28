/**
 * File System Access API 补充类型（部分 TS DOM lib 未包含）。
 */
export {}

type FlowidFilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

type FlowidOpenFilePickerOptions = {
  multiple?: boolean
  types?: FlowidFilePickerAcceptType[]
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: FlowidOpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
    /** 选择本地文件夹（Chromium File System Access API） */
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}
