import type { ProjectSnapshot } from '../types'
import { isBundledPresetAssetPath } from './bundledPresetAssetPath'
import { isLocalGalleryBundleEnabled, resolveBundledGalleryUrl } from './localGalleryBundle'
import {
  isUserPresetBundledMediaPath,
  readUserPresetAssetBlob,
  stripUserLocalPresetCatalogId,
} from './userPresetTemplateStore'

const BUNDLED_ASSET_PREFIX = 'flowid-bundled/presets/assets/'

/**
 * 是否为随包预设媒体相对路径（导出脚本写入 workflow JSON）。
 */
export function isBundledPresetMediaPath(url: string): boolean {
  const u = String(url || '').trim().replace(/^\.?\/+/, '')
  return u.startsWith(BUNDLED_ASSET_PREFIX)
}

/**
 * 将随包相对路径解析为当前页面可加载的绝对 URL（仅本地画廊构建启用时处理）。
 */
export function resolveBundledPresetMediaUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw || !isBundledPresetMediaPath(raw)) return raw
  if (!isLocalGalleryBundleEnabled()) return raw
  return resolveBundledGalleryUrl(raw.replace(/^\.?\/+/, ''))
}

function rewriteUrlField(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  if (!t || !isBundledPresetMediaPath(t)) return value
  return resolveBundledPresetMediaUrl(t)
}

/**
 * 加载预设模板后：把节点内 `flowid-bundled/presets/assets/...` 转为可显示的绝对地址。
 */
export function hydratePresetSnapshotBundledMedia(snapshot: ProjectSnapshot): ProjectSnapshot {
  if (!isLocalGalleryBundleEnabled()) return snapshot
  const nodes = snapshot.nodes.map((node) => {
    const d = node.data as Record<string, unknown>
    if (!d || typeof d !== 'object') return node

    const next: Record<string, unknown> = { ...d }
    if (typeof next.src === 'string') next.src = rewriteUrlField(next.src) as string

    if (Array.isArray(next.referenceImageSources)) {
      next.referenceImageSources = next.referenceImageSources.map((u) => rewriteUrlField(u))
    }

    if (Array.isArray(next.resultThumbnails)) {
      next.resultThumbnails = next.resultThumbnails.map((thumb) => {
        if (!thumb || typeof thumb !== 'object') return thumb
        const t = { ...thumb } as { url?: string }
        if (typeof t.url === 'string') t.url = rewriteUrlField(t.url) as string
        return t
      })
    }

    return { ...node, data: next as typeof node.data }
  })
  return { ...snapshot, nodes }
}

const userPresetBlobUrlCache = new Map<string, string>()

async function resolveUserPresetMediaUrl(
  templateId: string,
  url: string,
): Promise<string> {
  const raw = String(url || '').trim().replace(/^\.?\/+/, '')
  if (!raw || !isUserPresetBundledMediaPath(raw)) return url
  const cacheKey = `${templateId}::${raw}`
  const cached = userPresetBlobUrlCache.get(cacheKey)
  if (cached) return cached
  const blob = await readUserPresetAssetBlob(templateId, raw)
  if (!blob) return url
  const objectUrl = URL.createObjectURL(blob)
  userPresetBlobUrlCache.set(cacheKey, objectUrl)
  return objectUrl
}

/**
 * 加载本机用户预设后：将 workflow 内随包相对路径转为 blob: URL。
 */
export async function hydrateUserPresetSnapshotMedia(
  snapshot: ProjectSnapshot,
  catalogId: string,
): Promise<ProjectSnapshot> {
  const templateId = stripUserLocalPresetCatalogId(catalogId)
  if (!templateId) return snapshot

  const rewrite = async (value: unknown): Promise<unknown> => {
    if (typeof value !== 'string') return value
    const t = value.trim()
    if (!t || (!isBundledPresetAssetPath(t) && !isUserPresetBundledMediaPath(t))) return value
    return resolveUserPresetMediaUrl(templateId, t)
  }

  const nodes = await Promise.all(
    snapshot.nodes.map(async (node) => {
      const d = node.data as Record<string, unknown>
      if (!d || typeof d !== 'object') return node
      const next: Record<string, unknown> = { ...d }
      if (typeof next.src === 'string') next.src = (await rewrite(next.src)) as string

      if (Array.isArray(next.referenceImageSources)) {
        next.referenceImageSources = await Promise.all(next.referenceImageSources.map((u) => rewrite(u)))
      }

      if (Array.isArray(next.resultThumbnails)) {
        next.resultThumbnails = await Promise.all(
          next.resultThumbnails.map(async (thumb) => {
            if (!thumb || typeof thumb !== 'object') return thumb
            const t = { ...thumb } as { url?: string }
            if (typeof t.url === 'string') t.url = (await rewrite(t.url)) as string
            return t
          }),
        )
      }

      if (Array.isArray(next.resultSources)) {
        next.resultSources = (await Promise.all(next.resultSources.map((u) => rewrite(u)))) as string[]
      }

      if (typeof next.compareSrcA === 'string') next.compareSrcA = (await rewrite(next.compareSrcA)) as string
      if (typeof next.compareSrcB === 'string') next.compareSrcB = (await rewrite(next.compareSrcB)) as string

      return { ...node, data: next as typeof node.data }
    }),
  )

  return { ...snapshot, nodes }
}
