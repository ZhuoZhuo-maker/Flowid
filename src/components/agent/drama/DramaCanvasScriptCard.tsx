import { ArrowRight, Flame } from 'lucide-react'

type Props = {
  title?: string
  body: string
  editable?: boolean
  onChange?: (body: string) => void
  onBlur?: () => void
}

/**
 * 右侧画布「我的剧本」节点（图二，可编辑）。
 */
export function DramaCanvasScriptCard({ title = '我的剧本', body, editable, onChange, onBlur }: Props) {
  return (
    <div className="drama-canvas-script">
      <article className="drama-canvas-script__card" data-drama-node-draggable>
        <header className="drama-canvas-script__head">
          <span className="drama-canvas-script__badge">
            <Flame size={14} aria-hidden />
            编剧
          </span>
        </header>
        <h2>{title}</h2>
        {editable && onChange ? (
          <textarea
            className="drama-canvas-script__edit"
            data-drama-wheel-scroll="1"
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            aria-label="剧本正文"
          />
        ) : (
          <pre className="drama-canvas-script__body" data-drama-wheel-scroll="1">
            {body.trim()}
          </pre>
        )}
        <button type="button" className="drama-canvas-script__view">
          查看
          <ArrowRight size={14} />
        </button>
      </article>
    </div>
  )
}
