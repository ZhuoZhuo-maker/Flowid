import { useCallback, useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

type Props = {
  children: ReactNode
  /** 节点默认缩放 */
  defaultScale?: number
  className?: string
}

/**
 * 短剧画布节点：支持单独放大/缩小（不影响整画布缩放）。
 */
export function DramaResizableStage({ children, defaultScale = 1, className = '' }: Props) {
  const [scale, setScale] = useState(defaultScale)

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(0.65, Math.round((s - 0.1) * 100) / 100))
  }, [])

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(1.75, Math.round((s + 0.1) * 100) / 100))
  }, [])

  return (
    <div className={`drama-resizable-stage${className ? ` ${className}` : ''}`} data-drama-node-draggable>
      <span
        className="drama-resizable-stage__inner"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
      >
        {children}
      </span>
      <span className="drama-resizable-stage__zoom" role="group" aria-label="节点缩放">
        <button type="button" onClick={zoomOut} aria-label="缩小节点">
          <Minus size={12} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={zoomIn} aria-label="放大节点">
          <Plus size={12} />
        </button>
      </span>
    </div>
  )
}
