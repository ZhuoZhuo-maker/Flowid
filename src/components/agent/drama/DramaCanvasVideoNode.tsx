import { Download, Play, Sparkles } from 'lucide-react'
import type { DramaProductionState, DramaShot } from '../../../lib/dramaProduction/types'

type Props = {
  state: DramaProductionState
  shots: DramaShot[]
}

/**
 * 视频画布节点（图六：最终成片预览 + 下载）。
 */
export function DramaCanvasVideoNode({ state, shots }: Props) {
  const src =
    state.finalVideoSrc ||
    shots.map((s) => s.videoSrc).filter(Boolean).pop() ||
    ''

  return (
    <div className="drama-canvas-video">
      <article className="drama-canvas-video__card" data-drama-node-draggable>
        <header className="drama-canvas-video__head">
          <Sparkles size={16} aria-hidden />
          <span>艺术总监</span>
        </header>
        <div className="drama-canvas-video__preview">
          {src ? (
            <video src={src} controls className="drama-canvas-video__player" preload="metadata" />
          ) : (
            <div className="drama-canvas-video__placeholder">
              <Play size={32} aria-hidden />
              <span>分镜视频生成后将显示在此</span>
            </div>
          )}
        </div>
        <div className="drama-canvas-video__actions">
          <button type="button" className="drama-canvas-video__btn" disabled={!src}>
            <Download size={14} />
            下载视频
          </button>
          <button type="button" className="drama-canvas-video__btn drama-canvas-video__btn--primary" disabled={!src}>
            下载 1080p 高清视频
          </button>
        </div>
      </article>
    </div>
  )
}
