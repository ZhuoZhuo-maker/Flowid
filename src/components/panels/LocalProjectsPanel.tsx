import { useCallback, useRef, useState } from 'react'
import type { ProjectSnapshot } from '../../types'
import {
  DEFAULT_WORKSPACE_LIBRARY_ID,
  deleteLibraryProject,
  listLibraryProjects,
  readLibraryProject,
  writeLibraryProject,
  createNewLibraryProjectId,
} from '../../lib/localProjectLibrary'
import { parseProjectFile } from '../../lib/persistence'

export type LocalProjectsPanelProps = {
  /** 关闭左侧面板 */
  onClose: () => void
  /** 从库中打开：传入完整快照与库 id */
  onOpenSnapshot: (snapshot: ProjectSnapshot, libraryId: string) => void
  /** 从 JSON 文件打开（无库 id） */
  onOpenImported: (snapshot: ProjectSnapshot) => void
  /** 将当前画布登记到本地库并绑定 libraryId */
  onRegisterCurrentToLibrary: (libraryId: string, snapshot: ProjectSnapshot) => void
  /** 当前工程快照（用于登记） */
  getCurrentSnapshot: () => ProjectSnapshot
  /** 当前标签名称 */
  currentProjectName: string
}

/**
 * 本地项目库：列出、打开、删除已保存工程；支持导入 JSON。
 */
export function LocalProjectsPanel({
  onClose,
  onOpenSnapshot,
  onOpenImported,
  onRegisterCurrentToLibrary,
  getCurrentSnapshot,
  currentProjectName,
}: LocalProjectsPanelProps) {
  const [rows, setRows] = useState(() => listLibraryProjects())
  const fileRef = useRef<HTMLInputElement | null>(null)
  const refresh = useCallback(() => {
    setRows(listLibraryProjects())
  }, [])

  const handleDelete = (id: string, name: string) => {
    if (id === DEFAULT_WORKSPACE_LIBRARY_ID) {
      window.alert('「主工作台」为当前浏览器默认工程，不能删除；可在画布中清空节点后保存覆盖。')
      return
    }
    if (!window.confirm(`确定删除本地项目「${name}」？`)) return
    deleteLibraryProject(id)
    refresh()
  }

  const handleOpen = (id: string) => {
    const snap = readLibraryProject(id)
    if (!snap) {
      window.alert('读取失败或文件已损坏')
      refresh()
      return
    }
    onOpenSnapshot(snap, id)
    onClose()
  }

  const handleRegister = () => {
    const snap = getCurrentSnapshot()
    const id = createNewLibraryProjectId()
    const named: ProjectSnapshot = { ...snap, name: currentProjectName || snap.name || '未命名项目' }
    writeLibraryProject(named, id)
    onRegisterCurrentToLibrary(id, named)
    refresh()
    window.alert('已将当前工程登记到本地项目库，之后 Ctrl+S 会同步更新该条目。')
  }

  return (
    <div className="local-projects-panel">
      <div className="local-projects-panel__head">
        <h2 className="local-projects-panel__title">本地项目</h2>
        <button type="button" className="local-projects-panel__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <p className="local-projects-panel__hint">
        列表与浏览器当前工程同步；主工作台会随编辑自动更新。<kbd>Ctrl</kbd>+<kbd>S</kbd> 会写入默认存档并更新已关联的库条目。
        <br />
        注意：浏览器把 <code>localhost</code> 与 <code>127.0.0.1</code> 视为不同来源，本地存档与工作流（localStorage）互不共享。开发服务已默认绑定 <code>127.0.0.1</code>；若仍用 <code>localhost</code> 打开，页面会自动跳到 <code>127.0.0.1</code> 以免读错数据。
      </p>
      <div className="local-projects-panel__actions">
        <button type="button" className="btn btn--chip btn--chip-primary" onClick={handleRegister}>
          将当前工程登记到库
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
        {rows.length === 0 ? (
          <li className="local-projects-panel__empty">暂无条目，可先「登记到库」或导入 JSON。</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="local-projects-panel__row">
              <button type="button" className="local-projects-panel__open" onClick={() => handleOpen(row.id)}>
                <span className="local-projects-panel__name">
                  {row.name}
                  {row.id === DEFAULT_WORKSPACE_LIBRARY_ID ? (
                    <span className="local-projects-panel__badge">主工作台</span>
                  ) : null}
                </span>
                <span className="local-projects-panel__date">
                  {new Date(row.updatedAt).toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                className="local-projects-panel__delete"
                onClick={() => handleDelete(row.id, row.name)}
              >
                删除
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
