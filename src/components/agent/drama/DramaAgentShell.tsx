import type { ReactNode } from 'react'
import { DramaGlobalRail } from './DramaGlobalRail'

type Props = {
  chat: ReactNode
  workspace: ReactNode
  onLogoClick?: () => void
  onHomeClick?: () => void
}

/** 短剧 Agent 分栏外壳：全局侧栏 + 左对话 + 右制片台 */
export function DramaAgentShell({ chat, workspace, onLogoClick, onHomeClick }: Props) {
  return (
    <div className="drama-agent-shell" data-drama-agent-shell="1">
      <DramaGlobalRail onLogoClick={onLogoClick} onHomeClick={onHomeClick} />
      <div className="drama-agent-shell__content">
        <aside className="drama-agent-shell__chat" aria-label="Agent 对话">
          {chat}
        </aside>
        <section className="drama-agent-shell__workspace" aria-label="制片工作区">
          {workspace}
        </section>
      </div>
    </div>
  )
}
