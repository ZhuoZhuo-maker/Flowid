import { useEffect, useMemo, useState } from 'react'

type WorkflowNodeRecord = Record<string, unknown>
type ComfyObjectInfoRecord = Record<string, unknown>

/**
 * 内嵌可视化参数编辑器：在设置弹窗内部展示参数编辑子页面。
 */
export function WorkflowVisualEditorInline({
  workflowName,
  workflowJsonText,
  resultNodeId,
  resultFieldPath,
  comfyBaseUrl,
  comfyApiKey,
  onSave,
  onBack,
}: {
  workflowName: string
  workflowJsonText: string
  resultNodeId: string
  resultFieldPath: string
  comfyBaseUrl: string
  comfyApiKey: string
  onSave: (next: { workflowJsonText: string; resultNodeId: string; resultFieldPath: string }) => void
  onBack: () => void
}) {
  const [hint, setHint] = useState('')
  const [mappingNodeId, setMappingNodeId] = useState(resultNodeId)
  const [mappingFieldPath, setMappingFieldPath] = useState(resultFieldPath)
  const [objectInfo, setObjectInfo] = useState<ComfyObjectInfoRecord>({})
  const [workflowNodes, setWorkflowNodes] = useState<Record<string, WorkflowNodeRecord>>(() => {
    try {
      const parsed = JSON.parse(workflowJsonText) as Record<string, unknown>
      if (parsed.prompt && typeof parsed.prompt === 'object' && !Array.isArray(parsed.prompt)) {
        return parsed.prompt as Record<string, WorkflowNodeRecord>
      }
      return parsed as Record<string, WorkflowNodeRecord>
    } catch {
      return {}
    }
  })

  const nodeEntries = useMemo(() => {
    return Object.entries(workflowNodes).filter(([, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const inputs = (value as WorkflowNodeRecord).inputs
      return Boolean(inputs && typeof inputs === 'object' && !Array.isArray(inputs))
    })
  }, [workflowNodes])

  useEffect(() => {
    const base = String(comfyBaseUrl || '').trim().replace(/\/+$/, '')
    if (!base) {
      setObjectInfo({})
      return
    }
    let cancelled = false
    const headers: HeadersInit = {}
    const token = String(comfyApiKey || '').trim()
    if (token) headers.Authorization = `Bearer ${token}`
    const readObjectInfo = async () => {
      try {
        const candidates = [`${base}/object_info`, `${base}/api/object_info`]
        /**
         * 本地 Comfy 在开发态优先走同源代理，避免浏览器直连 8188 出现 CORS/PNA 导致读取失败。
         */
        try {
          const url = new URL(base)
          const isLocalHost = ['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase())
          const isDefaultComfyPort = url.port === '8188'
          if (isLocalHost && isDefaultComfyPort) {
            candidates.unshift('/__comfy_local__/object_info', '/__comfy_local__/api/object_info')
          }
        } catch {
          // baseUrl 不是标准 URL 时忽略代理候选。
        }
        for (const url of candidates) {
          const response = await fetch(url, { headers })
          if (!response.ok) continue
          const json = (await response.json().catch(() => ({}))) as ComfyObjectInfoRecord
          if (!cancelled) setObjectInfo(json && typeof json === 'object' ? json : {})
          return
        }
        if (!cancelled) setObjectInfo({})
      } catch {
        if (!cancelled) setObjectInfo({})
      }
    }
    void readObjectInfo()
    return () => {
      cancelled = true
    }
  }, [comfyApiKey, comfyBaseUrl])

  /**
   * 从 Comfy 节点定义中提取下拉选项（仅识别枚举输入）。
   */
  const getInputEnumOptions = (classType: string, inputKey: string): string[] | null => {
    const classInfo = objectInfo[classType]
    if (!classInfo || typeof classInfo !== 'object' || Array.isArray(classInfo)) return null
    const input = (classInfo as Record<string, unknown>).input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const required = (input as Record<string, unknown>).required
    const optional = (input as Record<string, unknown>).optional
    const groups = [required, optional]
    for (const group of groups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) continue
      const def = (group as Record<string, unknown>)[inputKey]
      if (!Array.isArray(def) || def.length === 0) continue
      const first = def[0]
      /**
       * 仅将“明确枚举列表”识别为下拉：
       * - 常见 Comfy 形态：[[选项1, 选项2, ...], {...}]
       * - 避免把 ["STRING", {multiline:true}] 这类类型定义误判为下拉（应渲染文本输入）。
       */
      const options = Array.isArray(first)
        ? first
        : def.every((item) => typeof item === 'string' || typeof item === 'number')
          ? def
          : null
      if (!Array.isArray(options) || !options.length) continue
      const normalized = options
        .map((item) => (item == null ? '' : String(item).trim()))
        .filter(Boolean)
      if (normalized.length >= 2) return normalized
    }
    return null
  }

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

  const handleSave = () => {
    onSave({
      workflowJsonText: JSON.stringify(workflowNodes, null, 2),
      resultNodeId: mappingNodeId.trim(),
      resultFieldPath: mappingFieldPath.trim(),
    })
    setHint('参数已保存')
  }

  return (
    <div className="workflow-visual-page workflow-visual-page--inline workflow-visual-page--settings-skin">
      <header className="workflow-visual-page__header">
        <div>
          <h1 className="workflow-visual-page__title">{workflowName || '工作流参数编辑'}</h1>
          <p className="workflow-visual-page__hint">
            {hint || '当前为设置弹窗内参数子页面，保存后将直接回写当前工作流'}
          </p>
        </div>
        <div className="wf-editor-header-actions">
          <button type="button" className="wf-editor-btn--capsule" onClick={onBack}>
            返回列表
          </button>
          <button type="button" className="wf-editor-btn--sync" onClick={handleSave}>
            保存参数
          </button>
        </div>
      </header>
      <main className="workflow-visual-page__main">
        <section className="workflow-visual-group">
          <h2 className="workflow-visual-group__title">结果映射（当前工作流）</h2>
          <div className="workflow-visual-group__fields">
            <label className="workflow-visual-field">
              <span>结果节点ID</span>
              <input
                type="text"
                value={mappingNodeId}
                placeholder="如 5"
                onChange={(e) => setMappingNodeId(e.target.value)}
              />
            </label>
            <label className="workflow-visual-field">
              <span>结果字段路径</span>
              <input
                type="text"
                value={mappingFieldPath}
                placeholder="如 text.0"
                onChange={(e) => setMappingFieldPath(e.target.value)}
              />
            </label>
          </div>
        </section>
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
                      const enumOptionsRaw = getInputEnumOptions(classType, key)
                      const enumOptions = enumOptionsRaw ? Array.from(new Set(enumOptionsRaw)) : null
                      return (
                        <label key={id} className="workflow-visual-field">
                          <span>{key}</span>
                          {enumOptions ? (
                            <select
                              value={value}
                              onChange={(e) => updateInputValue(nodeId, key, e.target.value)}
                            >
                              {enumOptions.map((option, optionIndex) => (
                                <option key={`${id}-${option}-${optionIndex}`} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : multiline ? (
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
                              // 编辑中 JSON 可能临时不完整，不中断输入。
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

