import { ChevronRight } from 'lucide-react'
import type { DramaShot } from '../../../lib/dramaProduction/types'

type Props = {
  shots: DramaShot[]
  maxThumbs?: number
}

/**
 * 聊天内分镜视频预览卡（「N 个视频」+ 缩略图）。
 */
export function DramaStoryboardVideoPreviewCard({ shots, maxThumbs = 6 }: Props) {
  const withVideo = shots.filter((s) => s.videoSrc?.trim())
  const count = withVideo.length
  if (!count) return null

  return (
    <div className="drama-storyboard-preview-card drama-storyboard-preview-card--video">
      <p className="drama-storyboard-preview-card__count">{count} 个视频</p>
      <div className="drama-storyboard-preview-card__row">
        {withVideo.slice(0, maxThumbs).map((s) => (
          <video
            key={s.index}
            className="drama-storyboard-preview-card__thumb drama-storyboard-preview-card__thumb--video"
            src={s.videoSrc}
            muted
            preload="metadata"
          />
        ))}
      </div>
      <button type="button" className="drama-storyboard-preview-card__detail">
        细节
        <ChevronRight size={12} aria-hidden />
      </button>
    </div>
  )
}
