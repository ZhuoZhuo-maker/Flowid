import { ChevronRight, FileText } from 'lucide-react'

type Props = {
  synopsis: string
  hasScriptBody?: boolean
}

/**
 * 聊天区剧本梗概卡（图九）。
 */
export function DramaScriptSynopsisCard({ synopsis, hasScriptBody }: Props) {
  return (
    <div className="drama-script-synopsis">
      <h4>剧本梗概</h4>
      <pre className="drama-script-synopsis__body" data-drama-wheel-scroll="1">
        {synopsis}
      </pre>
      {hasScriptBody ? (
        <div className="drama-script-synopsis__link-row">
          <FileText size={14} aria-hidden />
          <span>剧本正文</span>
          <button type="button" className="drama-script-synopsis__detail">
            细节
            <ChevronRight size={12} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
