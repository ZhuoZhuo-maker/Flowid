import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  clampMultiangleHV,
  clampMultiangleZoom,
  FLOWID_MULTIANGLE_DEFAULT_H,
  FLOWID_MULTIANGLE_DEFAULT_V,
  FLOWID_MULTIANGLE_DEFAULT_ZOOM,
  FLOWID_MULTIANGLE_HV_MAX,
  FLOWID_MULTIANGLE_HV_MIN,
  FLOWID_MULTIANGLE_ZOOM_MAX,
  FLOWID_MULTIANGLE_ZOOM_MIN,
} from '../../lib/comfyMultianglePlaceholders'
import {
  buildMultianglePreviewLine,
  MULTIANGLE_HORIZONTAL,
  MULTIANGLE_VERTICAL,
  MULTIANGLE_ZOOM,
  pickNearestPreset,
} from '../../lib/multianglePresets'
import { MultiangleGizmo3D } from './MultiangleGizmo3D'

export type MultiangleControlPanelProps = {
  nodeId: string
  nodeKind: 'image' | 'video'
  /** 未归一化的原始值（与节点 data 一致） */
  rawH?: number
  rawV?: number
  rawZ?: number
  /** `position:fixed` 锚点（通常取节点旁 20px），与标题栏拖拽偏移叠加 */
  anchorLeft: number
  anchorTop: number
  canvasDayMode: boolean
  onApply: (patch: {
    comfyMultiangleH?: number
    comfyMultiangleV?: number
    comfyMultiangleZoom?: number
  }) => void
  onClose: () => void
}

export function MultiangleControlPanel({
  nodeKind,
  rawH,
  rawV,
  rawZ,
  anchorLeft,
  anchorTop,
  canvasDayMode,
  onApply,
  onClose,
  nodeId,
}: MultiangleControlPanelProps) {
  const h = clampMultiangleHV(rawH, FLOWID_MULTIANGLE_DEFAULT_H)
  const v = clampMultiangleHV(rawV, FLOWID_MULTIANGLE_DEFAULT_V)
  const z = clampMultiangleZoom(rawZ, FLOWID_MULTIANGLE_DEFAULT_ZOOM)

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    setDragOffset({ x: 0, y: 0 })
  }, [nodeId])

  const dragRef = useRef<'panel' | null>(null)
  const panelDragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  const preview = useMemo(() => buildMultianglePreviewLine(h, v, z), [h, v, z])
  const hp = pickNearestPreset(MULTIANGLE_HORIZONTAL, h)
  const vp = pickNearestPreset(MULTIANGLE_VERTICAL, v)
  const zp = pickNearestPreset(MULTIANGLE_ZOOM, z)

  const onH = useCallback((nh: number) => onApply({ comfyMultiangleH: nh }), [onApply])
  const onV = useCallback((nv: number) => onApply({ comfyMultiangleV: nv }), [onApply])
  const onZ = useCallback((nz: number) => onApply({ comfyMultiangleZoom: nz }), [onApply])

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (dragRef.current !== 'panel') return
      setDragOffset({
        x: panelDragStart.current.ox + (ev.clientX - panelDragStart.current.x),
        y: panelDragStart.current.oy + (ev.clientY - panelDragStart.current.y),
      })
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onHeaderMouseDown = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = 'panel'
    panelDragStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: dragOffset.x,
      oy: dragOffset.y,
    }
  }

  const kindLabel = nodeKind === 'image' ? '图片' : '视频'

  return (
    <div
      className={`studio-multiangle-popover nodrag nopan${canvasDayMode ? ' studio-multiangle-popover--day' : ''}`}
      style={{ left: anchorLeft + dragOffset.x, top: anchorTop + dragOffset.y }}
      role="dialog"
      aria-label="Multiangle 角度控制"
    >
      <div className="studio-multiangle-popover__header" onMouseDown={onHeaderMouseDown}>
        <div className="studio-multiangle-popover__titleRow">
          <span className="studio-multiangle-popover__title">角度控制</span>
          <span className="studio-multiangle-popover__sub">{kindLabel}节点 · 拖拽标题栏移动</span>
        </div>
        <button
          type="button"
          className="studio-multiangle-popover__close"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="studio-multiangle-popover__preview" title="与 Comfy Multiangle 风格接近的预览（实际以节点输出为准）">
        {preview}
      </div>

      <div className="studio-multiangle-popover__gizmoWrap">
        <MultiangleGizmo3D h={h} v={v} z={z} canvasDayMode={canvasDayMode} onH={onH} onV={onV} onZ={onZ} />
        <p className="studio-multiangle-popover__gizmoHint">
          三维视图：紫格地面 · 粉球水平 · 青球垂直 · 黄球/粉方块沿视线调距离（均可拖）
        </p>
      </div>

      <div className="studio-multiangle-popover__controls">
        <div className="studio-multiangle-popover__tripple">
          <label className="studio-multiangle-popover__field studio-multiangle-popover__field--pink">
            <span className="studio-multiangle-popover__fieldLabel">水平</span>
            <select
              className="studio-multiangle-popover__select"
              value={hp.id}
              onChange={(e) => {
                const p = MULTIANGLE_HORIZONTAL.find((x) => x.id === e.target.value)
                if (p) onApply({ comfyMultiangleH: clampMultiangleHV(p.value, FLOWID_MULTIANGLE_DEFAULT_H) })
              }}
            >
              {MULTIANGLE_HORIZONTAL.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="studio-multiangle-popover__readout studio-multiangle-popover__readout--pink">{h}°</span>
          </label>
          <label className="studio-multiangle-popover__field studio-multiangle-popover__field--teal">
            <span className="studio-multiangle-popover__fieldLabel">垂直</span>
            <select
              className="studio-multiangle-popover__select"
              value={vp.id}
              onChange={(e) => {
                const p = MULTIANGLE_VERTICAL.find((x) => x.id === e.target.value)
                if (p) onApply({ comfyMultiangleV: clampMultiangleHV(p.value, FLOWID_MULTIANGLE_DEFAULT_V) })
              }}
            >
              {MULTIANGLE_VERTICAL.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="studio-multiangle-popover__readout studio-multiangle-popover__readout--teal">{v}°</span>
          </label>
          <label className="studio-multiangle-popover__field studio-multiangle-popover__field--amber">
            <span className="studio-multiangle-popover__fieldLabel">距离</span>
            <select
              className="studio-multiangle-popover__select"
              value={zp.id}
              onChange={(e) => {
                const p = MULTIANGLE_ZOOM.find((x) => x.id === e.target.value)
                if (p) onApply({ comfyMultiangleZoom: clampMultiangleZoom(p.value, FLOWID_MULTIANGLE_DEFAULT_ZOOM) })
              }}
            >
              {MULTIANGLE_ZOOM.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="studio-multiangle-popover__readout studio-multiangle-popover__readout--amber">{z}</span>
          </label>
        </div>

        <label className="studio-multiangle-popover__sliderRow">
          <span>水平滑杆 {h}°</span>
          <input
            type="range"
            min={FLOWID_MULTIANGLE_HV_MIN}
            max={FLOWID_MULTIANGLE_HV_MAX}
            value={h}
            onChange={(e) => onApply({ comfyMultiangleH: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="studio-multiangle-popover__sliderRow">
          <span>垂直滑杆 {v}°</span>
          <input
            type="range"
            min={FLOWID_MULTIANGLE_HV_MIN}
            max={FLOWID_MULTIANGLE_HV_MAX}
            value={v}
            onChange={(e) => onApply({ comfyMultiangleV: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="studio-multiangle-popover__sliderRow">
          <span>变焦 {z}</span>
          <input
            type="range"
            min={FLOWID_MULTIANGLE_ZOOM_MIN * 10}
            max={FLOWID_MULTIANGLE_ZOOM_MAX * 10}
            value={Math.round(z * 10)}
            onChange={(e) => onApply({ comfyMultiangleZoom: Number(e.target.value) / 10 })}
          />
        </label>

        <div className="studio-multiangle-popover__footer">
          <button
            type="button"
            className="studio-multiangle-popover__reset"
            title="恢复默认 20° / 34° / 5"
            onClick={() =>
              onApply({
                comfyMultiangleH: FLOWID_MULTIANGLE_DEFAULT_H,
                comfyMultiangleV: FLOWID_MULTIANGLE_DEFAULT_V,
                comfyMultiangleZoom: FLOWID_MULTIANGLE_DEFAULT_ZOOM,
              })
            }
          >
            ↺ 重置
          </button>
          <span className="studio-multiangle-popover__hint">
            工作流占位 __CAM_H__ / __CAM_V__ / __CAM_Z__
          </span>
        </div>
      </div>
    </div>
  )
}
