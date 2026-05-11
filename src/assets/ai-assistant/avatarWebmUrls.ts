/**
 * 打包后不能使用 `/src/assets/...`（仅 dev 有效）。用 import.meta.url 让 Vite 把 webm 打进 dist 并生成可加载 URL。
 */
export const AI_ASSISTANT_AVATAR_MEDIA_URLS = {
  listening: new URL('./倾听 listening（用户输入中）.webm', import.meta.url).href,
  thinking: new URL('./思考 thinking（请求模型中）.webm', import.meta.url).href,
  acting: new URL('./执行 acting（调用工具中）.webm', import.meta.url).href,
  talking: new URL('./说话 talking（回复中）.webm', import.meta.url).href,
  success: new URL('./成功 success.webm', import.meta.url).href,
  error: new URL('./失败报错 error_但不吓人.webm', import.meta.url).href,
} as const

export type AssistantAvatarMediaKey = keyof typeof AI_ASSISTANT_AVATAR_MEDIA_URLS
