import { useMemo, useState } from 'react'
import { Type, Image, Compass, Video, Mic, Music, FileText } from 'lucide-react'
import type { AddNodeMenuItem } from './types'
import type { LucideIcon } from 'lucide-react'

const KIND_ICON: Record<string, LucideIcon> = {
  text: Type,
  image: Image,
  panorama: Compass,
  video: Video,
  audio: Mic,
  music: Music,
  script: FileText,
}

const KIND_COLOR: Record<string, string> = {
  text: 'text-blue-500',
  image: 'text-orange-500',
  panorama: 'text-cyan-500',
  video: 'text-purple-500',
  audio: 'text-green-500',
  music: 'text-pink-500',
  script: 'text-indigo-500',
}

/**
 * 添加节点面板：与 @flowid (2) 同款布局/动效；条目与行为仍由上层 `addNodeItems` 驱动。
 */
export function AddNodePanel({ addNodeItems }: { addNodeItems: AddNodeMenuItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const displayItems = useMemo(() => {
    const baseItems = addNodeItems.filter((item) => item.id !== 'compose-video')
    const hasMusic = baseItems.some((item) => item.id === 'music')
    const audioItem = baseItems.find((item) => item.id === 'audio')
    return hasMusic || !audioItem
      ? baseItems
      : [
          ...baseItems,
          {
            ...audioItem,
            id: 'music',
            title: '音乐',
          },
        ]
  }, [addNodeItems])

  return (
    <div className="w-64 bg-[#111114] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
      <div className="text-[14px] font-mono uppercase tracking-[0.2em] text-white/50 mb-4 px-2">添加节点</div>
      <div className="space-y-1">
        {displayItems.map((item) => {
          const Icon = KIND_ICON[item.id] ?? FileText
          const colorClass = KIND_COLOR[item.id] ?? 'text-white/70'
          return (
            <button
              key={item.id}
              type="button"
              title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
              onClick={() => {
                setSelectedId(item.id)
                item.action()
              }}
              className={`w-full flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all text-left group ${
                selectedId === item.id ? 'bg-white/5' : ''
              }`}
            >
              <div
                className={`p-2 rounded-lg bg-white/5 group-hover:bg-white/10 ${colorClass} transition-colors shrink-0`}
              >
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-black uppercase text-white/90 group-hover:text-white">
                  {item.title}
                </div>
                {item.subtitle ? (
                  <div className="text-[13px] text-white/50 truncate">{item.subtitle}</div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
