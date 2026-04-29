export {}

declare global {
  interface Window {
    flowidDesktop?: {
      /** 主进程发起 OpenAI 兼容请求（绕过渲染进程 CORS；不经过 auth /proxy/openai） */
      openAiCompatFetch?: (payload: {
        url: string
        method: 'GET' | 'POST'
        headers?: Record<string, string>
        json?: unknown
      }) => Promise<
        | {
            ok: true
            status: number
            statusText: string
            headers: Record<string, string>
            body: ArrayBuffer
          }
        | { ok: false; error: string }
      >
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<{ ok: boolean; hasUpdate?: boolean; reason?: string }>
      /** 读取本地 UTF-8 文件（桌面端） */
      readUtf8File?: (filePath: string) => Promise<{ ok: boolean; text?: string; error?: string }>
      /** 读取本地二进制文件（桌面端） */
      readBinaryFile?: (
        filePath: string,
      ) => Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>
      /** 读取目录下文件清单（桌面端；可选递归用于 output 历史） */
      readDirectory?: (
        dirPath: string,
        opts?: { recursive?: boolean; maxFiles?: number; maxDepth?: number },
      ) => Promise<{
        ok: boolean
        files?: Array<{ name: string; path: string; size: number; mtimeMs: number }>
        error?: string
      }>
      /** 删除文件（桌面端） */
      deleteFile?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      /** 写入本地 UTF-8 文件（桌面端） */
      writeUtf8File?: (
        filePath: string,
        text: string,
      ) => Promise<{ ok: boolean; error?: string }>
      /** 写入本地二进制文件（桌面端，用于镜像上传图/生成物到配置的 input/output） */
      writeBinaryFile?: (
        filePath: string,
        data: ArrayBuffer,
      ) => Promise<{ ok: boolean; error?: string }>
      /** 系统对话框选择 JSON 文件 */
      pickJsonFile?: (opts?: {
        defaultPath?: string
      }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      /** 系统对话框选择或新建 JSON 文件（保存路径） */
      saveJsonFile?: (opts?: {
        defaultPath?: string
      }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      /** 系统对话框选择文件夹 */
      pickDirectory?: (opts?: {
        defaultPath?: string
      }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      /** 确保目录存在（递归创建） */
      ensureDirectory?: (dirPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>
      /** 确保子目录存在（basePath/childName） */
      ensureSubdirectory?: (
        basePath: string,
        childName: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>
    }
  }
}
