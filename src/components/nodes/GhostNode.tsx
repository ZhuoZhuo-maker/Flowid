/**
 * 临时幽灵节点：仅用于“拖线未命中”时承载预览连线，不参与真实业务渲染。
 */
export function GhostNode() {
  return <div className="studio-ghost-node" aria-hidden />
}

