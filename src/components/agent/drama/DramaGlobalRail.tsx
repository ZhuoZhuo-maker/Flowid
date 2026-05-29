import { Home } from 'lucide-react'
import { FlowidMark } from '../../FlowidMark'

type Props = {
  /** 点击 Logo 返回首页 / 项目档案 */
  onLogoClick?: () => void
  /** 点击首页图标返回项目页 */
  onHomeClick?: () => void
}

/**
 * 最左侧极窄导航栏：FlowID 图标 + 首页。
 */
export function DramaGlobalRail({ onLogoClick, onHomeClick }: Props) {
  return (
    <nav className="drama-global-rail" aria-label="全局导航">
      <button
        type="button"
        className="drama-global-rail__brand drama-global-rail__brand-btn"
        title="返回项目档案"
        aria-label="返回项目档案"
        onClick={onLogoClick}
      >
        <FlowidMark className="drama-global-rail__logo" />
      </button>
      <button
        type="button"
        className="drama-global-rail__btn drama-global-rail__btn--active"
        title="项目"
        aria-label="返回项目页"
        onClick={onHomeClick}
      >
        <Home size={18} />
      </button>
    </nav>
  )
}
