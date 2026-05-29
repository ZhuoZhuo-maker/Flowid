import { Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'

/** 默认视觉风格选项（对齐截图） */
export const DRAMA_VISUAL_STYLE_OPTIONS = [
  { id: 'american-comic', label: '经典美式漫画', gradient: 'linear-gradient(135deg,#1e3a5f,#dc2626)' },
  { id: 'fresh-illust', label: '精致清新通透', gradient: 'linear-gradient(135deg,#0891b2,#a7f3d0)' },
  { id: 'chibi', label: 'Q版萌绘', gradient: 'linear-gradient(135deg,#f472b6,#fde68a)' },
  { id: 'fantasy-book', label: '诡谲幻想绘本', gradient: 'linear-gradient(135deg,#4c1d95,#312e81)' },
  { id: 'fantasy-flat', label: '奇幻平涂', gradient: 'linear-gradient(135deg,#7c3aed,#06b6d4)' },
  { id: 'impression', label: '朦胧印象派', gradient: 'linear-gradient(135deg,#6366f1,#fbcfe8)' },
  { id: 'watercolor', label: '清新水彩画棒', gradient: 'linear-gradient(135deg,#34d399,#bfdbfe)' },
  { id: 'retro-light', label: '复古彩光', gradient: 'linear-gradient(135deg,#f59e0b,#db2777)' },
]

type Props = {
  disabled?: boolean
  variant?: 'character' | 'scene'
  onPick: (styleName: string) => void
}

/**
 * 视觉风格 4×2 网格 + Surprise Me / 上传风格（图二角色 / 图十场景）。
 */
export function DramaStyleGrid({ disabled, variant = 'character', onPick }: Props) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="drama-style-grid">
      <div className="drama-style-grid__cells">
        {DRAMA_VISUAL_STYLE_OPTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`drama-style-grid__cell${selected === s.label ? ' is-selected' : ''}`}
            style={{ backgroundImage: s.gradient }}
            disabled={disabled}
            onClick={() => {
              setSelected(s.label)
              onPick(variant === 'scene' ? `【用户选择】场景风格：${s.label}` : `【用户选择】${s.label}`)
            }}
          >
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="drama-style-grid__surprise"
        disabled={disabled}
        onClick={() => {
          const pick = DRAMA_VISUAL_STYLE_OPTIONS[Math.floor(Math.random() * DRAMA_VISUAL_STYLE_OPTIONS.length)]!
          setSelected(pick.label)
          onPick(variant === 'scene' ? `【用户选择】场景风格：${pick.label}` : `【用户选择】${pick.label}`)
        }}
      >
        <Sparkles size={16} aria-hidden />
        Surprise Me
      </button>
      <div className="drama-style-grid__upload-row">
        <button type="button" className="drama-style-grid__upload" disabled={disabled}>
          <Plus size={14} />
          上传风格
        </button>
        <span className="drama-style-grid__more">+ 156 种风格</span>
      </div>
      <p className="drama-style-grid__hint">
        如果没有你想要的风格，可以自己输入风格词，或者上传风格图。
      </p>
    </div>
  )
}
