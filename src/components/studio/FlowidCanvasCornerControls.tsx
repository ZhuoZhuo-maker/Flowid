import { Map as MapIcon, Moon, Sun } from 'lucide-react'

type Props = {
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  /** 小地图 / 重置视口 */
  onToggleMiniPreview?: () => void
  showMiniPreview?: boolean
  /** 日间 / 夜间画布 */
  canvasDayMode?: boolean
  onToggleDayMode?: () => void
}

/**
 * 画布右下角控件条（与 Studio 主画布一致：小地图 · 日/夜 · 缩放）。
 */
export function FlowidCanvasCornerControls({
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onToggleMiniPreview,
  showMiniPreview = false,
  canvasDayMode = false,
  onToggleDayMode,
}: Props) {
  const day = canvasDayMode

  return (
    <div
      className="absolute bottom-8 right-8 flex flex-col items-end gap-6 z-50 studio-flowid-map-ui [-webkit-tap-highlight-color:transparent] [&_button]:outline-none pointer-events-none"
      data-studio-flowid-map-ui="1"
    >
      <div
        className={
          day
            ? 'bg-[#FFFFFF] border border-[#E8E8E8] p-2 rounded-2xl shadow-[0_12px_40px_rgba(38,38,38,0.08)] flex items-center gap-2 pointer-events-auto backdrop-blur-xl'
            : 'bg-[#111114] border border-white/10 p-1.5 rounded-full shadow-2xl flex items-center gap-3 pointer-events-auto backdrop-blur-xl'
        }
      >
        {onToggleMiniPreview ? (
          <>
            <button
              type="button"
              onClick={onToggleMiniPreview}
              aria-label="小地图"
              title="小地图 / 重置视口"
              className={
                day
                  ? `w-10 h-10 flex items-center justify-center transition-all rounded-xl ${
                      showMiniPreview
                        ? 'bg-[#F5F5F5] text-[#262626] ring-2 ring-[#E8E8E8]'
                        : 'bg-[#F5F5F5] text-[#525252] hover:bg-[#EEEEEE] hover:text-[#262626]'
                    }`
                  : `w-10 h-10 flex items-center justify-center transition-all bg-white/5 rounded-full ${
                      showMiniPreview ? 'text-orange-500' : 'text-white/40 hover:text-white'
                    }`
              }
            >
              <MapIcon className="w-4 h-4" aria-hidden />
            </button>
            <div className={day ? 'w-[1px] h-5 bg-[#E8E8E8]' : 'w-[1px] h-4 bg-white/10'} />
          </>
        ) : null}
        {onToggleDayMode ? (
          <>
            <button
              type="button"
              onClick={onToggleDayMode}
              aria-pressed={day}
              aria-label={day ? '关闭日间模式' : '开启日间模式'}
              title={day ? '关闭日间模式（深色画布）' : '开启日间模式（浅色画布）'}
              className={
                day
                  ? 'w-10 h-10 flex items-center justify-center rounded-xl bg-[#F5F5F5] text-[#525252] hover:bg-[#EEEEEE] hover:text-[#262626] transition-all'
                  : 'w-10 h-10 flex items-center justify-center rounded-full bg-transparent text-orange-500 transition-all hover:text-orange-400 active:bg-orange-500/15 active:text-orange-300'
              }
            >
              {day ? <Moon className="w-4 h-4" aria-hidden /> : <Sun className="w-4 h-4" aria-hidden />}
            </button>
            <div className={day ? 'w-[1px] h-5 bg-[#E8E8E8]' : 'w-[1px] h-4 bg-white/10'} />
          </>
        ) : null}
        <div
          className={
            day ? 'flex items-center gap-0.5 rounded-xl bg-[#F5F5F5] px-1 py-0.5' : 'flex items-center gap-1'
          }
        >
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="缩小"
            className={
              day
                ? 'w-8 h-8 flex items-center justify-center rounded-lg text-[#525252] hover:bg-[#FFFFFF] hover:text-[#262626] transition-all text-sm font-light'
                : 'w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-all text-sm font-light'
            }
          >
            −
          </button>
          <span
            className={
              day
                ? 'text-[14px] font-black tracking-widest text-[#262626] min-w-[56px] text-center tabular-nums'
                : 'text-[15px] font-black tracking-widest text-white/90 min-w-[60px] text-center tabular-nums'
            }
            title="画布视口缩放"
          >
            {zoomPercent}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="放大"
            className={
              day
                ? 'w-8 h-8 flex items-center justify-center rounded-lg text-[#525252] hover:bg-[#FFFFFF] hover:text-[#262626] transition-all text-sm font-light'
                : 'w-8 h-8 flex items-center justify-center text-white/60 hover:text-white transition-all text-sm font-light'
            }
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
