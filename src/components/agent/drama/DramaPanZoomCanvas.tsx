import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent, type PointerEvent } from 'react'
import { FlowidCanvasCornerControls } from '../../studio/FlowidCanvasCornerControls'
import type { DramaWorkspaceNavTab } from '../../../lib/dramaProduction/dramaWorkspaceBridge'

type Props = {
  children: ReactNode
  initialZoom?: number
  /** 侧栏 Tab 切换时定位到总览内对应节点；overview 为整图复位 */
  focusStage?: DramaWorkspaceNavTab | null
}

/**
 * 查找节点内可滚动的区域（overflow:auto/scroll 且内容溢出）。
 * @param start 起始元素
 */
function findDramaScrollHost(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el) {
    if (el.dataset.dramaWheelScroll === '1') return el
    const style = window.getComputedStyle(el)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el
    }
    if (el.classList.contains('drama-panzoom__viewport')) break
    el = el.parentElement
  }
  return null
}

/**
 * @param el 滚动容器
 * @param deltaY 滚轮增量
 */
function canDramaScroll(el: HTMLElement, deltaY: number): boolean {
  const { scrollTop, scrollHeight, clientHeight } = el
  if (scrollHeight <= clientHeight + 1) return false
  if (deltaY < 0) return scrollTop > 0
  if (deltaY > 0) return scrollTop + clientHeight < scrollHeight - 1
  return false
}

/**
 * 短剧右侧画布：点阵底 + 拖动画布 + 滚轮缩放；右下角控件与 Studio 主画布一致。
 */
export function DramaPanZoomCanvas({ children, initialZoom = 0.9, focusStage = null }: Props) {
  const initialZoomRef = useRef(initialZoom)
  const [zoom, setZoom] = useState(initialZoom)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [canvasDayMode, setCanvasDayMode] = useState(false)
  const [mapActive, setMapActive] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    initialZoomRef.current = initialZoom
    setZoom(initialZoom)
    setOffset({ x: 0, y: 0 })
  }, [initialZoom])

  const clampZoom = (z: number) => Math.min(1.5, Math.max(0.15, z))

  const resetViewport = useCallback(() => {
    setZoom(initialZoomRef.current)
    setOffset({ x: 0, y: 0 })
  }, [])

  /** 将视口平移到总览内指定阶段节点 */
  useEffect(() => {
    if (!focusStage) return
    if (focusStage === 'overview') {
      resetViewport()
      return
    }
    const viewport = viewportRef.current
    const target = viewport?.querySelector(`[data-drama-stage="${focusStage}"]`) as HTMLElement | null
    if (!viewport || !target) return
    const targetZoom = 0.94
    const cx = target.offsetLeft + target.offsetWidth / 2
    const cy = target.offsetTop + target.offsetHeight / 2
    setZoom(targetZoom)
    setOffset({
      x: viewport.clientWidth / 2 - cx * targetZoom,
      y: viewport.clientHeight / 2 - cy * targetZoom,
    })
  }, [focusStage, children, resetViewport])

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const onNode = Boolean(target.closest('[data-drama-node-draggable]'))
    const scrollHost = findDramaScrollHost(target)

    if (onNode || scrollHost) {
      if (scrollHost && canDramaScroll(scrollHost, e.deltaY)) {
        e.preventDefault()
        scrollHost.scrollTop += e.deltaY
        return
      }
      /** 在卡片上但不滚动：只阻止画布缩放，不 zoom */
      e.preventDefault()
      return
    }

    e.preventDefault()
    setZoom((z) => clampZoom(z + (e.deltaY > 0 ? -0.06 : 0.06)))
  }, [])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-drama-node-draggable]')) return
      dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [offset.x, offset.y],
  )

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
  }, [])

  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onToggleMiniPreview = useCallback(() => {
    setMapActive((v) => !v)
    resetViewport()
  }, [resetViewport])

  return (
    <div className={`drama-panzoom${canvasDayMode ? ' drama-panzoom--day' : ''}`}>
      <div
        ref={viewportRef}
        className="drama-panzoom__viewport is-pan"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          className="drama-panzoom__stage"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        >
          {children}
        </div>
      </div>
      <FlowidCanvasCornerControls
        zoomPercent={Math.round(zoom * 100)}
        onZoomIn={() => setZoom((z) => clampZoom(z + 0.1))}
        onZoomOut={() => setZoom((z) => clampZoom(z - 0.1))}
        showMiniPreview={mapActive}
        onToggleMiniPreview={onToggleMiniPreview}
        canvasDayMode={canvasDayMode}
        onToggleDayMode={() => setCanvasDayMode((v) => !v)}
      />
    </div>
  )
}
