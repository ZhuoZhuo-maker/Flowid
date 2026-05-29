import { Shuffle } from 'lucide-react'
import { useMemo, useState } from 'react'

const KEYWORD_GRADIENTS = [
  'linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #db2777 100%)',
  'linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #6366f1 100%)',
  'linear-gradient(135deg, #831843 0%, #be185d 50%, #9333ea 100%)',
  'linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #7c3aed 100%)',
  'linear-gradient(135deg, #713f12 0%, #d97706 50%, #db2777 100%)',
]

type Props = {
  options: string[]
  disabled?: boolean
  onPick: (option: string) => void
}

/**
 * 情绪关键词 3×2 网格（图五 / 图六）。
 */
export function DramaKeywordGrid({ options, disabled, onPick }: Props) {
  const keywords = useMemo(() => options.filter((o) => o !== '随机'), [options])
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="drama-keyword-grid">
      <p className="drama-keyword-grid__title">请选择一种情绪关键词：</p>
      <div className="drama-keyword-grid__cells">
        {keywords.map((kw, idx) => (
          <button
            key={kw}
            type="button"
            className={`drama-keyword-grid__cell${selected === kw ? ' is-selected' : ''}`}
            style={{ backgroundImage: KEYWORD_GRADIENTS[idx % KEYWORD_GRADIENTS.length] }}
            disabled={disabled}
            onClick={() => {
              setSelected(kw)
              onPick(kw)
            }}
          >
            {kw}
          </button>
        ))}
        <button
          type="button"
          className="drama-keyword-grid__cell drama-keyword-grid__cell--random"
          disabled={disabled}
          onClick={() => {
            const pick = keywords[Math.floor(Math.random() * keywords.length)] ?? keywords[0]
            if (pick) {
              setSelected(pick)
              onPick(pick)
            }
          }}
        >
          <Shuffle size={16} aria-hidden />
          随机
        </button>
      </div>
      <p className="drama-keyword-grid__hint">
        没找到合适的选项？如果你有其他想法，可以直接在下方输入框中输入。
      </p>
    </div>
  )
}
