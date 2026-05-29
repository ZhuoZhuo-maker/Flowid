import type { DramaWorkspaceNavTab } from '../../../lib/dramaProduction/dramaWorkspaceBridge'
import type { DramaProductionState } from '../../../lib/dramaProduction/types'
import { isDramaNavTabUnlocked } from '../../../lib/dramaProduction/dramaWorkspaceProgress'

export type DramaNavTab = DramaWorkspaceNavTab

const TABS: { id: DramaNavTab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'script', label: '剧本' },
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'storyboard', label: '分镜' },
  { id: 'video', label: '视频' },
]

type Props = {
  activeTab: DramaNavTab
  state: DramaProductionState | null
  onTabChange: (tab: DramaNavTab) => void
}

/**
 * 右侧工作区竖向导航：仅展示已解锁 Tab（有数据后才出现）。
 */
export function DramaAgentSideNav({ activeTab, state, onTabChange }: Props) {
  const visibleTabs = TABS.filter(({ id }) => isDramaNavTabUnlocked(id, state))

  return (
    <nav className="drama-agent-side-nav" aria-label="制片导航">
      {visibleTabs.map(({ id, label }) => {
        const active = activeTab === id
        return (
          <button
            key={id}
            type="button"
            className={`drama-agent-side-nav__item${active ? ' is-active' : ''}`}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
