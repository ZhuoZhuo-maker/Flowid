import { memo } from 'react'
import { BaseEdge, getBezierPath, Position, type EdgeProps } from '@xyflow/react'

/**
 * 贝塞尔边 + 两层宽描边形成「丝缕光轨」：仅多 2 个 path，无 SVG filter，边很多时仍轻量。
 * 虚线流动只作用在 BaseEdge 主路径上，外层由 CSS 关闭 animation。
 */
export const SilkBezierEdge = memo(function SilkBezierEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  style,
  markerEnd,
  markerStart,
  pathOptions,
  interactionWidth,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: pathOptions?.curvature,
  })

  return (
    <>
      <path
        d={path}
        fill="none"
        className="studio-edge-silk-layer studio-edge-silk-layer--outer"
        stroke="var(--studio-edge-silk-outer)"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={path}
        fill="none"
        className="studio-edge-silk-layer studio-edge-silk-layer--mid"
        stroke="var(--studio-edge-silk-mid)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <BaseEdge
        id={id}
        path={path}
        labelX={labelX}
        labelY={labelY}
        label={label}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
    </>
  )
})

SilkBezierEdge.displayName = 'SilkBezierEdge'
