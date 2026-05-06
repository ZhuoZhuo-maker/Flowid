import { useEffect, useState } from 'react'

export type PointsTaskFailureToastState = {
  /** 单调递增，用于只保留最新一条并复位展开态 */
  id: number
  message: string
  errorFull?: string
}

type Props = {
  state: PointsTaskFailureToastState
  onClose: () => void
}

/**
 * 画布积分任务失败的全局 Toast：仅展示一条；失败原因过长时支持展开全文。
 */
export function PointsTaskFailureToast({ state, onClose }: Props) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [state.id])

  const fullText =
    state.errorFull != null && String(state.errorFull).trim()
      ? `任务失败：${String(state.errorFull).trim()}，积分已自动退还`
      : state.message

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        zIndex: 120000,
        maxWidth: 'min(520px, calc(100vw - 32px))',
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(40, 12, 14, 0.94)',
        border: '1px solid rgba(248, 81, 73, 0.55)',
        color: '#fecaca',
        fontSize: '14px',
        lineHeight: 1.45,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ wordBreak: 'break-word' }}>{expanded && state.errorFull ? fullText : state.message}</div>
        {state.errorFull ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 8,
              padding: '2px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.25)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {expanded ? '收起' : '展开'}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          flexShrink: 0,
          marginTop: -2,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(0,0,0,0.25)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        关闭
      </button>
    </div>
  )
}
