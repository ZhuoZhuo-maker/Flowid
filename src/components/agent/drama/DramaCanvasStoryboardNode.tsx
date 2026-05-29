import { Film, Pencil, Play, Plus } from 'lucide-react'
import type { DramaLocation, DramaShot } from '../../../lib/dramaProduction/types'

type Props = {
  shots: DramaShot[]
  location?: DramaLocation | null
  imagesReady?: boolean
  variant?: 'flow' | 'board'
  onEditShot?: (index: number, patch: Partial<DramaShot>) => void
}

/** 分镜是否已有出图 */
export function shotHasImages(shot: DramaShot): boolean {
  return Boolean(shot.imageSrcs?.some((s) => s?.trim()))
}

function gridLayout(panelCount: number): { cols: number; rows: number; count: number } {
  if (panelCount >= 9) return { cols: 3, rows: 3, count: 9 }
  if (panelCount >= 6) return { cols: 3, rows: 2, count: 6 }
  if (panelCount >= 3) return { cols: 3, rows: 1, count: 3 }
  return { cols: 1, rows: 1, count: Math.max(panelCount, 1) }
}

/**
 * 分镜画布：flow=纵向流程；board=分镜 Tab 横向镜头卡（图五）。
 */
export function DramaCanvasStoryboardNode({
  shots,
  location,
  imagesReady,
  variant = 'flow',
  onEditShot,
}: Props) {
  const sceneThumb = location?.mainImageSrc
  const isBoard = variant === 'board'

  return (
    <div className={`drama-canvas-flow drama-canvas-flow--storyboard${isBoard ? ' drama-canvas-flow--storyboard-board' : ''}`}>
      {!isBoard && location ? (
        <>
          <article className="drama-canvas-flow__scene-node has-main-image drama-canvas-flow__scene-node--compact" data-drama-node-draggable>
            <header className="drama-canvas-flow__scene-head">
              <Film size={16} aria-hidden />
              <span>场景</span>
            </header>
            <div
              className="drama-canvas-flow__scene-main-img drama-canvas-flow__scene-main-img--compact"
              aria-label={location.name}
              style={
                sceneThumb
                  ? { backgroundImage: `url(${sceneThumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : undefined
              }
            />
          </article>
          <div className="drama-canvas-flow__connector drama-canvas-flow__connector--down" aria-hidden />
        </>
      ) : null}

      <article className="drama-canvas-flow__storyboard-stack" data-drama-node-draggable>
        <header className="drama-canvas-flow__group-head">
          <Film size={16} className="drama-canvas-flow__group-icon" aria-hidden />
          <span>分镜师</span>
        </header>

        <div className={`drama-canvas-flow__shot-list${isBoard ? ' drama-canvas-flow__shot-list--board' : ''}`}>
          {shots.map((shot, shotIdx) => {
            const hasImg = shotHasImages(shot) || imagesReady
            const hasVideo = Boolean(shot.videoSrc?.trim())
            const panelCount = shot.imageSrcs?.length || (hasImg ? 9 : 0)
            const { cols, rows, count } = gridLayout(panelCount)
            const cells =
              shot.imageSrcs?.length && shot.imageSrcs.length > 0
                ? shot.imageSrcs.slice(0, count)
                : hasImg
                  ? Array.from({ length: count }, () => '')
                  : []
            const heroSrc = cells[0] || ''

            if (isBoard) {
              return (
                <div key={shot.index} className="drama-canvas-flow__shot-card drama-canvas-flow__shot-card--board">
                  <div className="drama-canvas-flow__shot-label">
                    镜头 {shot.index}
                    <button type="button" className="drama-canvas-flow__shot-edit" aria-label="编辑">
                      <Pencil size={12} />
                    </button>
                  </div>
                  <div
                    className="drama-canvas-flow__shot-hero"
                    style={heroSrc ? { backgroundImage: `url(${heroSrc})`, backgroundSize: 'cover' } : undefined}
                  />
                  <textarea
                    className="drama-canvas-flow__shot-desc drama-canvas-flow__shot-desc--edit"
                    value={[shot.action, shot.dialogue].filter(Boolean).join('\n')}
                    onChange={(e) => onEditShot?.(shotIdx, { action: e.target.value })}
                    aria-label={`镜头 ${shot.index} 描述`}
                  />
                  {hasVideo && shot.videoSrc ? (
                    <video className="drama-canvas-flow__shot-video" src={shot.videoSrc} controls preload="metadata" />
                  ) : (
                    <button type="button" className="drama-canvas-flow__gen-btn">
                      生成视频
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              )
            }

            return (
              <div key={shot.index} className="drama-canvas-flow__shot-card">
                <div className="drama-canvas-flow__shot-label">镜头 {shot.index}</div>
                {cells.length ? (
                  <div
                    className="drama-canvas-flow__shot-grid"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: rows > 1 ? `repeat(${rows}, 1fr)` : undefined,
                    }}
                  >
                    {cells.map((src, i) => (
                      <div
                        key={`${shot.index}-${i}`}
                        className="drama-canvas-flow__shot-grid-cell"
                        style={
                          src
                            ? { backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="drama-canvas-flow__shot-grid drama-canvas-flow__shot-grid--empty">
                    <div className="drama-canvas-flow__shot-grid-cell" />
                  </div>
                )}
                <p className="drama-canvas-flow__shot-desc">
                  {[shot.action, shot.dialogue].filter(Boolean).join('\n')}
                </p>
                {hasVideo && shot.videoSrc ? (
                  <video className="drama-canvas-flow__shot-video" src={shot.videoSrc} controls preload="metadata" />
                ) : (
                  <button type="button" className="drama-canvas-flow__gen-btn">
                    生成视频
                    <Plus size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {isBoard ? (
          <button type="button" className="drama-canvas-flow__preview-final">
            <Play size={14} />
            预览最终视频
          </button>
        ) : null}
      </article>
    </div>
  )
}
