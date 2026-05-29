import { Gem } from 'lucide-react'

type Props = {
  credits?: number
}

/**
 * 工作区右上角积分与用户区（截图：200 FREE）。
 */
export function DramaAppTopBar({ credits = 200 }: Props) {
  return (
    <div className="drama-app-topbar">
      <div className="drama-app-topbar__credits">
        <span>{credits}</span>
        <span className="drama-app-topbar__credits-label">FREE</span>
        <Gem size={14} className="drama-app-topbar__gem" aria-hidden />
      </div>
      <div className="drama-app-topbar__avatar" aria-hidden />
    </div>
  )
}
