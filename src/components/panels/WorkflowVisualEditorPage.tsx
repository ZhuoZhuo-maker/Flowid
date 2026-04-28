import { useEffect, useMemo, useState } from 'react'
import type { StudioNodeKind } from '../../types'

type EditorSessionPayload = {
  sessionId: string
  kind: StudioNodeKind
  workflowId: string
  workflowName: string
  workflowJsonText: string
}

type WorkflowNodeRecord = Record<string, unknown>

function getSessionIdFromHash(): string | null {
  const hash = window.location.hash || ''
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const search = new URLSearchParams(query)
  return search.get('session')
}

/**
 * 工作流可视化参数编辑页（独立窗口）。
 */
export function WorkflowVisualEditorPage() {
  const [session, setSession] = useState<EditorSessionPayload | null>(null)
  const [workflowNodes, setWorkflowNodes] = useState<Record<string, WorkflowNodeRecord>>({})
  const [hint, setHint] = useState('正在加载工作流参数...')

  useEffect(() => {
    const sessionId = getSessionIdFromHash()
    if (!sessionId) {
      setHint('缺少会话参数，无法打开编辑器')
      return
    }
    const raw = window.localStorage.getItem(`flowid.workflow-editor.session.${sessionId}`)
    if (!raw) {
      setHint('找不到编辑会话，请返回设置面板重新双击工作流')
      return
    }
    try {
      const payload = JSON.parse(raw) as EditorSessionPayload
      const parsed = JSON.parse(payload.workflowJsonText) as Record<string, unknown>
      const normalized =
        parsed.prompt && typeof parsed.prompt === 'object' && !Array.isArray(parsed.prompt)
          ? (parsed.prompt as Record<string, WorkflowNodeRecord>)
          : (parsed as Record<string, WorkflowNodeRecord>)
      setSession(payload)
      setWorkflowNodes(normalized)
      setHint('可视化参数已加载，修改后点击右上角保存')
    } catch {
      setHint('工作流 JSON 解析失败，请检查源文件')
    }
  }, [])

  const nodeEntries = useMemo(() => {
    return Object.entries(workflowNodes).filter(([, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const inputs = (value as WorkflowNodeRecord).inputs
      return Boolean(inputs && typeof inputs === 'object' && !Array.isArray(inputs))
    })
  }, [workflowNodes])

  const updateInputValue = (nodeId: string, inputKey: string, value: unknown) => {
    setWorkflowNodes((prev) => {
      const node = prev[nodeId]
      if (!node || typeof node !== 'object' || Array.isArray(node)) return prev
      const inputs = (node as WorkflowNodeRecord).inputs
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return prev
      return {
        ...prev,
        [nodeId]: {
          ...(node as WorkflowNodeRecord),
          inputs: {
            ...(inputs as Record<string, unknown>),
            [inputKey]: value,
          },
        },
      }
    })
  }

  const saveAndClose = () => {
    if (!session) return
    const nextJsonText = JSON.stringify(workflowNodes, null, 2)
    const result = {
      sessionId: session.sessionId,
      kind: session.kind,
      workflowId: session.workflowId,
      workflowName: session.workflowName,
      workflowJsonText: nextJsonText,
    }
    window.localStorage.setItem(
      `flowid.workflow-editor.result.${session.sessionId}`,
      JSON.stringify(result),
    )
    window.close()
    setHint('已保存参数，可返回原窗口继续操作')
  }

  return (
    <div className="workflow-visual-page workflow-visual-page--settings-skin">
      <header className="workflow-visual-page__header">
        <div>
          <h1 className="workflow-visual-page__title">{session?.workflowName || '工作流参数编辑'}</h1>
          <p className="workflow-visual-page__hint">{hint}</p>
        </div>
        <button type="button" className="wf-editor-btn--sync" onClick={saveAndClose}>
          保存并关闭
        </button>
      </header>
      <main className="workflow-visual-page__main">
        {nodeEntries.length === 0 ? (
          <div className="workflow-visual-page__empty">未检测到可编辑参数节点</div>
        ) : (
          nodeEntries.map(([nodeId, nodeValue]) => {
            const node = nodeValue as WorkflowNodeRecord
            const classType = String(node.class_type || 'UnknownNode')
            const inputs = node.inputs as Record<string, unknown>
            return (
              <section className="workflow-visual-group" key={nodeId}>
                <h2 className="workflow-visual-group__title">
                  {classType}（#{nodeId}）
                </h2>
                <div className="workflow-visual-group__fields">
                  {Object.entries(inputs).map(([key, value]) => {
                    const id = `${nodeId}-${key}`
                    if (typeof value === 'boolean') {
                      return (
                        <label key={id} className="workflow-visual-field workflow-visual-field--checkbox">
                          <span>{key}</span>
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => updateInputValue(nodeId, key, e.target.checked)}
                          />
                        </label>
                      )
                    }
                    if (typeof value === 'number') {
                      return (
                        <label key={id} className="workflow-visual-field">
                          <span>{key}</span>
                          <input
                            type="number"
                            value={value}
                            onChange={(e) =>
                              updateInputValue(
                                nodeId,
                                key,
                                Number.isNaN(Number(e.target.value))
                                  ? 0
                                  : Number(e.target.value),
                              )
                            }
                          />
                        </label>
                      )
                    }
                    if (typeof value === 'string') {
                      const multiline = value.length > 42 || value.includes('\n')
                      return (
                        <label key={id} className="workflow-visual-field">
                          <span>{key}</span>
                          {multiline ? (
                            <textarea
                              value={value}
                              onChange={(e) => updateInputValue(nodeId, key, e.target.value)}
                            />
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => updateInputValue(nodeId, key, e.target.value)}
                            />
                          )}
                        </label>
                      )
                    }
                    return (
                      <label key={id} className="workflow-visual-field">
                        <span>{key}</span>
                        <textarea
                          value={JSON.stringify(value, null, 2)}
                          onChange={(e) => {
                            try {
                              updateInputValue(nodeId, key, JSON.parse(e.target.value))
                            } catch {
                              // 编辑中可能尚未形成合法 JSON，不打断输入。
                            }
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </main>
    </div>
  )
}

