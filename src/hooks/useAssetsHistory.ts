import { useCallback, useEffect, useState } from 'react'
import type { AssetItem, AssetKind, HistoryItem } from '../components/panels/types'
import { LEGACY_LOCAL_STORAGE_KEYS } from '../lib/legacyLocalStorageKeys'
import {
  readHistoryItemsFromIndexedDb,
  writeHistoryItemsToIndexedDb,
} from '../lib/historyIndexedDb'

const ASSET_STORAGE_KEY = 'flowid.assets.v1'
const HISTORY_STORAGE_KEY = 'flowid.history.v1'
const CLOUD_TASKS_STORAGE_KEY = 'flowid.cloud.tasks.v1'

function safeSetLocalStorageWithCompaction<T>(
  key: string,
  rows: T[],
  compactors: Array<(input: T[]) => T[]>,
): T[] {
  const candidates: T[][] = [rows, ...compactors.map((fn) => fn(rows))]
  for (const candidate of candidates) {
    try {
      localStorage.setItem(key, JSON.stringify(candidate))
      return candidate
    } catch {
      // try next compact level
    }
  }
  return rows
}

/**
 * 从 localStorage 读取素材列表。
 */
function loadAssets(): AssetItem[] {
  try {
    let raw = localStorage.getItem(ASSET_STORAGE_KEY)
    if (!raw) {
      const legacyKey = LEGACY_LOCAL_STORAGE_KEYS.assets
      const legacy = localStorage.getItem(legacyKey)
      if (legacy) {
        localStorage.setItem(ASSET_STORAGE_KEY, legacy)
        localStorage.removeItem(legacyKey)
        raw = legacy
      }
    }
    if (!raw) return []
    const parsed = JSON.parse(raw) as AssetItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 从 localStorage 读取操作历史。
 */
function loadHistory(): HistoryItem[] {
  try {
    let raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) {
      const legacyKey = LEGACY_LOCAL_STORAGE_KEYS.history
      const legacy = localStorage.getItem(legacyKey)
      if (legacy) {
        localStorage.setItem(HISTORY_STORAGE_KEY, legacy)
        localStorage.removeItem(legacyKey)
        raw = legacy
      }
    }
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryItem[]
    if (!Array.isArray(parsed)) return []
    // 兼容旧数据：早期音乐记录可能被写成 audio，这里自动迁移到 music 分类。
    return parsed.map((item) => {
      let next: HistoryItem = { ...item }
      // blob: 在刷新页面后会失效，持久化到历史里会导致缩略图裂图；去掉 src 保留文字记录。
      if (typeof next.src === 'string' && next.src.startsWith('blob:')) {
        next = { ...next, src: undefined }
      }
      const title = next.title || ''
      const text = next.text || ''
      const isMusicLike =
        next.kind === 'music' ||
        /^音乐节点/.test(title) ||
        text.includes('音乐生成成功') ||
        text.includes('音乐节点执行成功')
      if (!isMusicLike) return next
      return { ...next, kind: 'music' }
    })
  } catch {
    return []
  }
}

/**
 * 素材与历史统一管理：上传、删除、持久化与记录。
 */
export function useAssetsHistory({
  onAfterUpload,
}: {
  onAfterUpload?: () => void
}) {
  const [assets, setAssets] = useState<AssetItem[]>(() => loadAssets())
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => loadHistory())

  /**
   * 记录历史，最多保留 30 条。
   */
  const appendHistory = useCallback(
    (
      payload:
        | string
        | {
            text: string
            kind?: AssetKind | 'music' | 'action'
            src?: string
            title?: string
          },
    ) => {
      const next: HistoryItem =
        typeof payload === 'string'
          ? {
              id: crypto.randomUUID(),
              text: payload,
              createdAt: Date.now(),
              kind: 'action',
            }
          : {
              id: crypto.randomUUID(),
              text: payload.text,
              createdAt: Date.now(),
              kind: payload.kind ?? 'action',
              src: payload.src,
              title: payload.title,
            }
    setHistoryItems((prev) => [next, ...prev].slice(0, 30))
    },
    [],
  )

  useEffect(() => {
    const persisted = safeSetLocalStorageWithCompaction(
      ASSET_STORAGE_KEY,
      assets,
      [
        (arr) => arr.slice(0, 200),
        (arr) => arr.slice(0, 120),
        (arr) => arr.slice(0, 60),
      ],
    )
    if (persisted.length !== assets.length) {
      setAssets(persisted)
    }
  }, [assets])

  useEffect(() => {
    const compactHistory = (input: HistoryItem[], keep: number) =>
      input
        .slice(0, keep)
        .map((item) => ({ ...item, src: undefined }))

    const indexRows = compactHistory(historyItems, 30)
    const persisted = safeSetLocalStorageWithCompaction(
      HISTORY_STORAGE_KEY,
      indexRows,
      [
        (arr) => compactHistory(arr, 24),
        (arr) => compactHistory(arr, 12),
        (arr) => compactHistory(arr, 6),
      ],
    )
    // localStorage 仅保留轻量索引，完整记录以 IndexedDB 为主。
    if (persisted.length < indexRows.length) {
      console.warn('[Flowid] 历史索引写入 localStorage 时触发裁剪', {
        kept: persisted.length,
        total: indexRows.length,
      })
    }
  }, [historyItems])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const dbRows = await readHistoryItemsFromIndexedDb()
        if (cancelled || !Array.isArray(dbRows) || dbRows.length === 0) return
        setHistoryItems((prev) => (prev.length > 0 ? prev : dbRows.slice(0, 30)))
      } catch {
        // ignore indexeddb read errors
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void writeHistoryItemsToIndexedDb(historyItems).catch(() => {
      // ignore indexeddb write errors
    })
  }, [historyItems])

  /**
   * 上传文件并写入素材库，只接受图片/视频/音频。
   */
  const onUploadFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return

      const nextAssets: AssetItem[] = []
      Array.from(files).forEach((file) => {
        const mime = file.type
        let kind: AssetKind | null = null
        if (mime.startsWith('image/')) kind = 'image'
        if (mime.startsWith('video/')) kind = 'video'
        if (mime.startsWith('audio/')) kind = 'audio'
        if (!kind) return

        nextAssets.push({
          id: crypto.randomUUID(),
          name: file.name,
          kind,
          src: URL.createObjectURL(file),
          createdAt: Date.now(),
        })
      })

      if (nextAssets.length === 0) {
        window.alert('仅支持图片/视频/音频文件')
        return
      }

      setAssets((prev) => [...nextAssets, ...prev])
      appendHistory(`上传素材 ${nextAssets.length} 个`)
      onAfterUpload?.()
    },
    [appendHistory, onAfterUpload],
  )

  /**
   * 删除素材并释放 object URL。
   */
  const removeAsset = useCallback(
    (assetId: string) => {
      setAssets((prev) => {
        const target = prev.find((x) => x.id === assetId)
        if (target && target.src.startsWith('blob:')) {
          URL.revokeObjectURL(target.src)
        }
        return prev.filter((x) => x.id !== assetId)
      })
      appendHistory('删除素材 1 个')
    },
    [appendHistory],
  )

  /**
   * 批量删除历史记录。
   */
  const removeHistoryItems = useCallback((historyIds: string[]) => {
    if (!historyIds.length) return
    setHistoryItems((prev) => prev.filter((item) => !historyIds.includes(item.id)))
  }, [])

  /**
   * 记录云端异步任务（用于后续补轮询/结果恢复）。
   */
  const appendCloudTaskRecord = useCallback((payload: {
    taskId: string
    nodeId: string
    nodeKind: AssetKind | 'music' | 'action' | 'text' | 'script' | 'panorama'
    title?: string
  }) => {
    try {
      const taskId = String(payload.taskId || '').trim()
      const nodeId = String(payload.nodeId || '').trim()
      if (!taskId || !nodeId) return
      const raw = localStorage.getItem(CLOUD_TASKS_STORAGE_KEY)
      const prev = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : []
      const dedup = Array.isArray(prev)
        ? prev.filter((it) => String(it?.taskId || '').trim() !== taskId)
        : []
      const next = [
        {
          id: crypto.randomUUID(),
          taskId,
          nodeId,
          nodeKind: payload.nodeKind,
          title: String(payload.title || ''),
          createdAt: Date.now(),
        },
        ...dedup,
      ].slice(0, 100)
      localStorage.setItem(CLOUD_TASKS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [])

  return {
    assets,
    historyItems,
    appendHistory,
    appendCloudTaskRecord,
    onUploadFiles,
    removeAsset,
    removeHistoryItems,
  }
}
