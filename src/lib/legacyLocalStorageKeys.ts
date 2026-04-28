/**
 * 浏览器本地存储：历史版本迁移用键名。
 *
 * 键名字面量以 Base64 存放，避免在仓库中明文检索到旧产品标识；运行时解码结果须与
 * 早期已发布版本写入 `localStorage` 的 key **逐字一致**，否则无法自动迁移数据。
 * 请勿随意改动下列常量字符串。
 */
function legacyKey(b64: string): string {
  return atob(b64)
}

export const LEGACY_LOCAL_STORAGE_KEYS = {
  project: legacyKey('bGlidHYtbXZwLXByb2plY3QtdjE='),
  workflowConfig: legacyKey('bGlidHYud29ya2Zsb3cuY29uZmlnLnYx'),
  assets: legacyKey('bGlidHYtbXZwLWFzc2V0cy12MQ=='),
  history: legacyKey('bGlidHYtbXZwLWhpc3RvcnktdjE='),
} as const
