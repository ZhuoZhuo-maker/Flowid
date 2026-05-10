export {}

declare global {
  interface Window {
    flowidDesktop?: {
      /** 主进程确认对话框，返回是否点了「确定」 */
      confirmDialog?: (payload: {
        message: string
        detail?: string
      }) => Promise<{ ok: boolean; confirmed?: boolean; error?: string }>
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
      /** 获取稳定机器码（用于授权绑定） */
      getMachineId?: () => Promise<string>
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
        files?: Array<{ name: string; path: string; size: number; mtimeMs: number; birthtimeMs?: number }>
        error?: string
      }>
      /** 删除文件（桌面端） */
      deleteFile?: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      /** 重命名 / 移动文件（桌面端） */
      renameFile?: (
        fromPath: string,
        toPath: string,
      ) => Promise<{ ok: boolean; error?: string }>
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
      /** 默认数据根目录及六项路径（桌面端；与 `flowid-zy` 安装约定一致） */
      getDefaultLocalStoragePaths?: () => Promise<
        | {
            ok: true
            root: string
            paths: {
              inputPath: string
              outputPath: string
              workflowPath: string
              flowidProjectJsonPath: string
              materialLibraryPath: string
              systemPromptCoverPath: string
            }
          }
        | { ok: false; error?: string }
      >
      /** 确保子目录存在（basePath/childName） */
      ensureSubdirectory?: (
        basePath: string,
        childName: string,
      ) => Promise<{ ok: boolean; path?: string; error?: string }>
      /** 查询本机积分行（无记录时 row 为 null） */
      pointsGet?: (licenseCode: string) => Promise<{
        ok: boolean
        row?: {
          code: string
          machine_code: string | null
          points: number
          total_earned: number
          total_spent: number
          bind_time: string | null
          expire_time: string | null
          status: string
          created_at: string | null
        } | null
        error?: string
      }>
      pointsBind?: (payload: {
        licenseCode: string
        machineCode: string
        expireTimeIso?: string | null
      }) => Promise<{ ok: boolean; error?: string }>
      pointsAdjust?: (payload: {
        licenseCode: string
        machineCode: string
        amount: number
        type: string
        description?: string
      }) => Promise<
        | { ok: true; before_points: number; after_points: number }
        | { ok: false; error: string; before_points?: number }
      >
      pointsLog?: (payload: {
        licenseCode: string
        limit?: number
      }) => Promise<{
        ok: boolean
        rows?: Array<{
          id: number
          license_code: string
          amount: number
          type: string
          description: string
          before_points: number
          after_points: number
          created_at: string
        }>
        error?: string
      }>
    }
  }
}
