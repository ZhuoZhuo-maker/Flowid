import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import type { ImageCompareNodeData, StudioNodeData } from '../../types'
import { NodeChrome } from './NodeChrome'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * ComfyUI / rgthree「Image Comparer」同款几何：
 * 底图 B、顶图 A 共用同一矩形与 object-fit:contain，仅用左侧 overflow 裁切顶图，
 * 保证两图 letterbox 一致，分割线滑动才是严格对齐的「同一画面」对比。
 */
const IMAGE_COMPARE_DRAG_HANDLE = '.studio-node__head'

export function ImageCompareNode({ id, data, selected }: NodeProps) {
  const d = data as ImageCompareNodeData
  const { updateNodeData } = useCanvasActions()
  const { setNodes } = useReactFlow()
  const [split, setSplit] = useState(0.5)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  const draggingRef = useRef(false)
  const dragPointerIdRef = useRef<number | null>(null)

  const onTitleChange = useCallback(
    (nextTitle: string) => {
      updateNodeData(id, { kind: 'imageCompare', title: nextTitle } as Partial<StudioNodeData>)
    },
    [id, updateNodeData],
  )

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    /** 与内部 img 布局一致：用 client 尺寸（不含边框），避免与 clip 内 sizer 差 1px */
    const w = Math.max(0, Math.floor(el.clientWidth))
    const h = Math.max(0, Math.floor(el.clientHeight))
    if (w > 0 && h > 0) {
      setFrame((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, d.compareSrcA, d.compareSrcB])

  /** 旧工程里的对比节点没有 dragHandle，补写后中线拖动才会生效 */
  const dragHandlePatchedRef = useRef(false)
  useEffect(() => {
    if (dragHandlePatchedRef.current) return
    dragHandlePatchedRef.current = true
    setNodes((nds) => {
      let changed = false
      const next = nds.map((n) => {
        if (n.id !== id || n.type !== 'imageCompare') return n
        if (n.dragHandle === IMAGE_COMPARE_DRAG_HANDLE) return n
        changed = true
        return { ...n, dragHandle: IMAGE_COMPARE_DRAG_HANDLE }
      })
      return changed ? next : nds
    })
  }, [id, setNodes])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const setSplitFromClientX = useCallback((clientX: number) => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 4) return
    setSplit(clamp01((clientX - rect.left) / rect.width))
  }, [])

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return
      if (dragPointerIdRef.current != null && ev.pointerId !== dragPointerIdRef.current) return
      setSplitFromClientX(ev.clientX)
    }
    const onUp = (ev: PointerEvent) => {
      if (dragPointerIdRef.current != null && ev.pointerId !== dragPointerIdRef.current) return
      draggingRef.current = false
      dragPointerIdRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setSplitFromClientX])

  const beginDrag = useCallback(
    (e: React.PointerEvent, target: HTMLElement) => {
      e.preventDefault()
      e.stopPropagation()
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      draggingRef.current = true
      dragPointerIdRef.current = e.pointerId
      setSplitFromClientX(e.clientX)
    },
    [setSplitFromClientX],
  )

  const endDrag = useCallback((e: React.PointerEvent, target: HTMLElement) => {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    draggingRef.current = false
    dragPointerIdRef.current = null
  }, [])

  const onDragPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      if (dragPointerIdRef.current != null && e.pointerId !== dragPointerIdRef.current) return
      e.preventDefault()
      setSplitFromClientX(e.clientX)
    },
    [setSplitFromClientX],
  )

  const hasA = Boolean(String(d.compareSrcA || '').trim())
  const hasB = Boolean(String(d.compareSrcB || '').trim())
  const clipPx = frame.w > 0 ? Math.max(0, Math.min(frame.w, split * frame.w)) : 0

  return (
    <NodeChrome
      icon={<span className="glyph">比</span>}
      title={d.title}
      accent="#c084fc"
      runStatus={d.runStatus}
      runProgress={d.runProgress}
      editableTitle
      onTitleChange={onTitleChange}
      showStatusBadge={false}
      selected={selected}
    >
      <div className="studio-image-compare">
        <div className="studio-image-compare__labels">
          <span className="studio-image-compare__tag studio-image-compare__tag--a">
            A（左）{d.compareLabelA ? ` · ${d.compareLabelA}` : ''}
          </span>
          <span className="studio-image-compare__tag studio-image-compare__tag--mid" aria-hidden>
            拖竖线对比
          </span>
          <span className="studio-image-compare__tag studio-image-compare__tag--b">
            B（右）{d.compareLabelB ? ` · ${d.compareLabelB}` : ''}
          </span>
        </div>
        <div
          ref={viewportRef}
          className="studio-image-compare__viewport nodrag nopan nowheel"
          onPointerDown={(e) => beginDrag(e, e.currentTarget)}
          onPointerMove={onDragPointerMove}
          onPointerUp={(e) => endDrag(e, e.currentTarget)}
          onLostPointerCapture={() => {
            draggingRef.current = false
            dragPointerIdRef.current = null
          }}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSplit(0.5)
          }}
          role="application"
          aria-label="双图对比：左侧为 A，右侧为 B，拖拽竖线。双击重置到中间。"
        >
          {!hasA && !hasB ? (
            <div className="studio-image-compare__empty">无图像：框选两张图片节点后右键「新增对比节点」</div>
          ) : (
            <>
              {frame.w > 0 && frame.h > 0 ? (
                <>
                  {/* 层 1：B —— 与 A 共用同一 sizer 像素尺寸 + object-fit:contain */}
                  <div className="studio-image-compare__layer studio-image-compare__layer--b">
                    <div
                      className="studio-image-compare__sizer"
                      style={{ width: frame.w, height: frame.h }}
                    >
                      {hasB ? (
                        <img
                          className="studio-image-compare__fit"
                          src={d.compareSrcB}
                          alt=""
                          draggable={false}
                        />
                      ) : (
                        <div className="studio-image-compare__empty studio-image-compare__empty--inline">
                          缺少 B
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 层 2：A —— 左侧 overflow 裁切，几何与 B 完全一致 */}
                  {hasA ? (
                    <div className="studio-image-compare__clip" style={{ width: clipPx }}>
                      <div
                        className="studio-image-compare__sizer"
                        style={{ width: frame.w, height: frame.h }}
                      >
                        <img
                          className="studio-image-compare__fit"
                          src={d.compareSrcA}
                          alt=""
                          draggable={false}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="studio-image-compare__empty studio-image-compare__empty--a">缺少 A</div>
                  )}
                </>
              ) : (
                <div className="studio-image-compare__empty">载入布局…</div>
              )}
              <div
                className="studio-image-compare__dividerHit nodrag nopan nowheel"
                style={{ left: `${split * 100}%` }}
                onPointerDown={(e) => beginDrag(e, e.currentTarget)}
                onPointerMove={onDragPointerMove}
                onPointerUp={(e) => endDrag(e, e.currentTarget)}
                onLostPointerCapture={() => {
                  draggingRef.current = false
                  dragPointerIdRef.current = null
                }}
              >
                <span className="studio-image-compare__dividerLine" />
                <span className="studio-image-compare__knob" />
              </div>
            </>
          )}
        </div>
      </div>
    </NodeChrome>
  )
}
