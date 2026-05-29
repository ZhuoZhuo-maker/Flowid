import { Loader2 } from 'lucide-react'

/**
 * 底部「工作中…」状态条（图七 / 等待 Agent）。
 */
export function DramaWorkingPill() {
  return (
    <div className="drama-agent-working">
      <Loader2 size={14} className="drama-agent-working__spin" aria-hidden />
      <span>工作中…</span>
    </div>
  )
}
