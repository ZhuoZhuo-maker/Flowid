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
export function AddNodePanel({
  addNodeItems,
  canvasDayMode = false,
}: {
  addNodeItems: AddNodeMenuItem[]
  /** 画布日间模式：白底面板与深灰文案 */
  canvasDayMode?: boolean
}) {
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
    <div
      className={
        canvasDayMode
          ? 'w-64 rounded-2xl border border-[#E8E8E8] bg-white p-4 shadow-xl'
          : 'w-64 rounded-2xl border border-white/10 bg-[#111114] p-4 shadow-2xl backdrop-blur-xl'
      }
    >
      <div
        className={
          canvasDayMode
            ? 'mb-4 px-2 font-mono text-[14px] uppercase tracking-[0.2em] text-[#525252]'
            : 'mb-4 px-2 font-mono text-[14px] uppercase tracking-[0.2em] text-white/50'
        }
      >
        添加节点
      </div>
      <div className="space-y-1">
        {displayItems.map((item) => {
          const Icon = KIND_ICON[item.id] ?? FileText
          const colorClass = KIND_COLOR[item.id] ?? (canvasDayMode ? 'text-[#525252]' : 'text-white/70')
          return (
            <button
              key={item.id}
              type="button"
              title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
              onClick={() => {
                setSelectedId(item.id)
                item.action()
              }}
              className={`group flex w-full items-center gap-4 rounded-xl p-3 text-left transition-all ${
                canvasDayMode
                  ? selectedId === item.id
                    ? 'bg-[#F5F5F5]'
                    : 'hover:bg-[#F5F5F5]'
                  : `hover:bg-white/5 ${selectedId === item.id ? 'bg-white/5' : ''}`
              }`}
            >
              <div
                className={
                  canvasDayMode
                    ? `shrink-0 rounded-lg bg-[#F5F5F5] p-2 transition-colors group-hover:bg-[#EBEBEB] ${colorClass}`
                    : `shrink-0 rounded-lg bg-white/5 p-2 transition-colors group-hover:bg-white/10 ${colorClass}`
                }
              >
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    canvasDayMode
                      ? 'text-[15px] font-black uppercase text-[#262626] group-hover:text-[#171717]'
                      : 'text-[15px] font-black uppercase text-white/90 group-hover:text-white'
                  }
                >
                  {item.title}
                </div>
                {item.subtitle ? (
                  <div
                    className={
                      canvasDayMode
                        ? 'truncate text-[13px] text-[#737373]'
                        : 'truncate text-[13px] text-white/50'
                    }
                  >
                    {item.subtitle}
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
