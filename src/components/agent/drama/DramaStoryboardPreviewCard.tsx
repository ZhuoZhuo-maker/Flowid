import { ChevronRight } from 'lucide-react'
import type { DramaShot } from '../../../lib/dramaProduction/types'

type Props = {
  shots: DramaShot[]
  /** 展示缩略图数量上限 */
  maxThumbs?: number
}

/**
 * 聊天内分镜图预览卡（「N 个图片」+ 缩略图条）。
 */
export function DramaStoryboardPreviewCard({ shots, maxThumbs = 6 }: Props) {
  const thumbs = shots
    .flatMap((s) => s.imageSrcs ?? [])
    .filter(Boolean)
    .slice(0, maxThumbs)
  const count = shots.reduce((n, s) => n + (s.imageSrcs?.filter(Boolean).length ?? 0), 0) || shots.length

  if (!count) return null

  return (
    <div className="drama-storyboard-preview-card">
      <p className="drama-storyboard-preview-card__count">{count} 个图片</p>
      <div className="drama-storyboard-preview-card__row">
        {thumbs.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="drama-storyboard-preview-card__thumb"
            style={{
              backgroundImage: `url(${src})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            aria-hidden
          />
        ))}
        {!thumbs.length
          ? [0, 1, 2].map((i) => <div key={i} className="drama-storyboard-preview-card__thumb" aria-hidden />)
          : null}
      </div>
      <button type="button" className="drama-storyboard-preview-card__detail">
        细节
        <ChevronRight size={12} aria-hidden />
      </button>
    </div>
  )
}
