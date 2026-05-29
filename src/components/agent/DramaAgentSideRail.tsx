import { Clapperboard, Film, Users, Video } from 'lucide-react'

export type DramaRailTab = 'script' | 'character' | 'storyboard' | 'video'

const TABS: { id: DramaRailTab; label: string; icon: typeof Clapperboard }[] = [
  { id: 'script', label: '剧本', icon: Clapperboard },
  { id: 'character', label: '角色', icon: Users },
  { id: 'storyboard', label: '分镜', icon: Film },
  { id: 'video', label: '视频', icon: Video },
]

type Props = {
  activeTab: DramaRailTab
  onTabChange: (tab: DramaRailTab) => void
}

/** 非全屏分栏时的图标侧栏（普通短剧 split 备用） */
export function DramaAgentSideRail({ activeTab, onTabChange }: Props) {
  return (
    <nav
      className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-aw-border bg-[#fafafa] py-3"
      aria-label="短剧制片导航"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => onTabChange(id)}
            className={`flex w-10 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-bold transition-colors ${
              active
                ? 'bg-orange-100 text-orange-700'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
            }`}
          >
            <Icon size={18} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** 侧栏 Tab → 画布节点标题关键词 */
export function dramaRailTabNodeKeyword(tab: DramaRailTab): string {
  switch (tab) {
    case 'script':
      return '剧本'
    case 'character':
      return '项目设定'
    case 'storyboard':
      return '分镜'
    case 'video':
      return '镜头'
    default:
      return ''
  }
}
