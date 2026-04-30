import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSnapshot } from '../../types'
import { parseProjectFile } from '../../lib/persistence'
import { loadLocalDiskPathsSettings, saveLocalDiskPathsSettings } from '../../lib/localDiskPathsSettings'

export type LocalProjectsPanelProps = {
  /** 关闭左侧面板 */
  onClose: () => void
  /** 从 JSON 文件打开 */
  onOpenImported: (snapshot: ProjectSnapshot) => void
}

/**
 * 本地项目（工程目录）：选择工程目录并从磁盘导入工程 JSON。
 */
export function LocalProjectsPanel({
  onClose,
  onOpenImported,
}: LocalProjectsPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dir, setDir] = useState(() => String(loadLocalDiskPathsSettings().flowidProjectJsonPath || '').trim())
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [files, setFiles] = useState<Array<{ path: string; name: string; mtimeMs: number }>>([])

  const desktop = (typeof window !== 'undefined' ? (window as any).flowidDesktop : null) as
    | {
        pickDirectory?: (opts?: { defaultPath?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
        readDirectory?: (path: string, opts?: { recursive?: boolean; maxFiles?: number; maxDepth?: number }) => Promise<{ ok: boolean; files?: any[]; error?: string }>
        readFileText?: (path: string) => Promise<{ ok: boolean; text?: string; error?: string }>
      }
    | null

  const refresh = useCallback(async () => {
    const target = String(dir || '').trim()
    if (!target) {
      setFiles([])
      return
    }
    if (!desktop?.readDirectory) {
      setErr('当前桌面端能力异常：无法读取工程目录。')
      setFiles([])
      return
    }
    setLoading(true)
    setErr('')
    try {
      const res = await desktop.readDirectory(target, { recursive: true, maxFiles: 2000, maxDepth: 4 })
      if (!res?.ok || !Array.isArray(res.files)) {
        setFiles([])
        setErr(res?.error || '读取目录失败')
        return
      }
      const mapped = res.files
        .filter((f) => String(f?.name || '').toLowerCase().endsWith('.json'))
        .filter((f) => !/^flowid\\.current\\.json$/i.test(String(f?.name || '').trim()))
        .map((f) => ({ path: String(f.path || ''), name: String(f.name || ''), mtimeMs: Number(f.mtimeMs || 0) }))
        .filter((f) => f.path && f.name)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 80)
      setFiles(mapped)
    } catch (e) {
      setErr(String((e as any)?.message || e || '读取目录失败'))
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [dir, desktop])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pickDir = useCallback(async () => {
    if (!desktop?.pickDirectory) {
      window.alert('当前桌面端能力异常：无法选择工程目录。')
      return
    }
    const res = await desktop.pickDirectory({ defaultPath: dir || undefined })
    if (!res.ok) {
      window.alert(res.error || '选择失败')
      return
    }
    if (res.canceled || !res.path) return
    const next = String(res.path || '').trim()
    setDir(next)
    saveLocalDiskPathsSettings({ flowidProjectJsonPath: next })
  }, [desktop, dir])

  const importFromPath = useCallback(
    async (filePath: string) => {
      const p = String(filePath || '').trim()
      if (!p) return
      if (!desktop?.readFileText) {
        window.alert('当前桌面端能力异常：无法读取文件内容。')
        return
      }
      setLoading(true)
      setErr('')
      try {
        const res = await desktop.readFileText(p)
        if (!res?.ok || !res.text) {
          window.alert(res?.error || '读取文件失败')
          return
        }
        const snap = parseProjectFile(String(res.text || ''))
        onOpenImported(snap)
        onClose()
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '导入失败')
      } finally {
        setLoading(false)
      }
    },
    [desktop, onClose, onOpenImported],
  )

  const hint = useMemo(() => {
    if (!dir) return '未选择工程目录。请先选择包含 Flowid 工程 JSON 的文件夹。'
    return `工程目录：${dir}`
  }, [dir])

  return (
    <div className="local-projects-panel">
      <div className="local-projects-panel__head">
        <h2 className="local-projects-panel__title">本地项目</h2>
        <button type="button" className="local-projects-panel__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <p className="local-projects-panel__hint">
        {hint}
      </p>
      <div className="local-projects-panel__actions">
        <button type="button" className="btn btn--chip btn--chip-primary" onClick={() => void pickDir()}>
          选择工程目录…
        </button>
        <button
          type="button"
          className="btn btn--chip btn--chip-light"
          onClick={() => fileRef.current?.click()}
        >
          从 JSON 导入…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              try {
                const snap = parseProjectFile(String(reader.result || ''))
                onOpenImported(snap)
                onClose()
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'JSON 解析失败')
              }
            }
            reader.readAsText(file, 'utf-8')
          }}
        />
      </div>
      <ul className="local-projects-panel__list" aria-label="已保存项目">
        {loading ? (
          <li className="local-projects-panel__empty">读取中…</li>
        ) : err ? (
          <li className="local-projects-panel__empty">{err}</li>
        ) : files.length === 0 ? (
          <li className="local-projects-panel__empty">目录下暂无工程 JSON（或尚未选择工程目录）。</li>
        ) : (
          files.map((f) => (
            <li key={f.path} className="local-projects-panel__row">
              <button type="button" className="local-projects-panel__open" onClick={() => void importFromPath(f.path)}>
                <span className="local-projects-panel__name">{f.name.replace(/\\.[^.]+$/, '') || f.name}</span>
                <span className="local-projects-panel__date">{new Date(f.mtimeMs || 0).toLocaleString()}</span>
              </button>
              <button type="button" className="local-projects-panel__delete" onClick={() => void importFromPath(f.path)}>
                导入
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
