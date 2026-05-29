import { ChevronRight } from 'lucide-react'

type Props = {
  title: string
  /** 是否展示 2×2 多视图缩略图 */
  showMultiview?: boolean
  mainImageSrc?: string
  multiViewSrcs?: string[]
}

/**
 * 聊天内场景预览卡（图二 / 图三：缩略图 + 细节链接）。
 */
export function DramaScenePreviewCard({ title, showMultiview, mainImageSrc, multiViewSrcs }: Props) {
  return (
    <div className="drama-scene-preview-card">
      <div className="drama-scene-preview-card__main">
        <div
          className="drama-scene-preview-card__thumb"
          aria-hidden
          style={
            mainImageSrc
              ? {
                  backgroundImage: `url(${mainImageSrc})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        />
        <div className="drama-scene-preview-card__info">
          <strong>{title}</strong>
          <button type="button" className="drama-scene-preview-card__detail">
            细节
            <ChevronRight size={12} aria-hidden />
          </button>
        </div>
      </div>
      {showMultiview ? (
        <div className="drama-scene-preview-card__grid">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="drama-scene-preview-card__grid-cell"
              aria-hidden
              style={
                multiViewSrcs?.[i]
                  ? {
                      backgroundImage: `url(${multiViewSrcs[i]})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
