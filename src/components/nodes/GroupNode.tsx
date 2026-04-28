import { NodeResizer, useStoreApi, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useCanvasActions } from '../../context/CanvasContext'
import type { GroupNodeData } from '../../types'

/**
 * 分组节点：标题栏在 `pointerdown` **捕获**阶段同步 `addSelectedNodes`，避免早于 XYDrag 的
 * `unselectNodesAndEdges` 竞态；整条标题栏双击重命名（排除折叠按钮）。
 * NodeResizer 置于 `.studio-group__body`，顶边控件不压在标题上。
 */
export function GroupNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<Node<GroupNodeData, 'group'>>) {
  const { updateNodeData, updateNodeMeta, removeNodeById } = useCanvasActions()
  const store = useStoreApi()
  const borderColor = data.borderColor || '#6fd2ff'
  const backgroundColor = data.backgroundColor || 'rgba(50, 90, 120, 0.08)'
  const titleFontSize = Math.min(24, Math.max(10, Number(data.titleFontSize || 12)))
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const colorPresets = [
    { label: '无颜色', border: '#6fd2ff', bg: 'rgba(50, 90, 120, 0.08)' },
    { label: '红色', border: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)' },
    { label: '棕色', border: '#a16207', bg: 'rgba(161, 98, 7, 0.18)' },
    { label: '绿色', border: '#22c55e', bg: 'rgba(34, 197, 94, 0.18)' },
    { label: '蓝色', border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.18)' },
    { label: '浅蓝', border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.18)' },
    { label: '青色', border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.18)' },
    { label: '紫色', border: '#a855f7', bg: 'rgba(168, 85, 247, 0.18)' },
    { label: '黄色', border: '#eab308', bg: 'rgba(234, 179, 8, 0.18)' },
    { label: '黑色', border: '#111827', bg: 'rgba(17, 24, 39, 0.24)' },
  ]

  useEffect(() => {
    if (!menuPos) return
    const close = () => setMenuPos(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuPos])

  /** 折叠态标题上下留白（像素） */
  const COLLAPSED_TITLE_PAD_Y = 8
  const lineBox = Math.ceil(titleFontSize * 1.2)
  /** 展开态标题栏高度（保证整条可拖、可点的最小触控高度） */
  const titleRowHeightExpanded = Math.max(48, lineBox + 20)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const titleRowRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  /** Esc 取消时随后触发的 blur 不应再提交草稿 */
  const skipBlurCommitRef = useRef(false)
  const lastSyncedSizeRef = useRef<{ w: number; h: number } | null>(null)
  /** 是否处于标题原位编辑（由双击进入，失焦或 Enter 提交） */
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  /** 编辑中的标题草稿，与画布数据解耦以便 Esc 取消 */
  const [titleDraft, setTitleDraft] = useState(data.title)

  useEffect(() => {
    if (!isTitleEditing) {
      setTitleDraft(data.title)
    }
  }, [data.title, isTitleEditing])

  useEffect(() => {
    if (!isTitleEditing) return
    const el = titleInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [isTitleEditing])

  /** 失焦或切换选中时退出编辑，避免输入框残留在非选中组上 */
  useEffect(() => {
    if (!selected && isTitleEditing) {
      setIsTitleEditing(false)
    }
  }, [selected, isTitleEditing])

  /** 折叠宽度不得低于建组时的宽度，禁止用测量值把节点压成几条像素 */
  const MIN_COLLAPSED_W = 220
  const MIN_COLLAPSED_H = 40

  /**
   * 折叠后同步节点尺寸：宽度以当前节点宽度为准（不缩小）；高度以标题栏实际高度 + 边框为准。
   * 避免 getBoundingClientRect 在折叠瞬间得到极小值导致标题栏被裁没。
   */
  const syncCollapsedSizeFromDom = useCallback(() => {
    if (!data.collapsed || !rootRef.current) return
    const root = rootRef.current
    const nodeW = Math.max(
      MIN_COLLAPSED_W,
      Number(width) || Number(data.expandedWidth) || MIN_COLLAPSED_W,
    )
    const titleH = titleRowRef.current?.offsetHeight ?? 0
    let rootH = root.offsetHeight
    if (rootH < MIN_COLLAPSED_H) {
      rootH = Math.max(
        MIN_COLLAPSED_H,
        titleH > 12 ? titleH + 2 : lineBox + COLLAPSED_TITLE_PAD_Y * 2 + 2,
      )
    }
    const nextW = Math.round(nodeW)
    const nextH = Math.round(Math.max(MIN_COLLAPSED_H, rootH))
    const prev = lastSyncedSizeRef.current
    if (
      prev &&
      Math.abs(prev.w - nextW) < 1 &&
      Math.abs(prev.h - nextH) < 1
    ) {
      return
    }
    lastSyncedSizeRef.current = { w: nextW, h: nextH }
    updateNodeMeta(id, {
      width: nextW,
      height: nextH,
      style: {
        width: nextW,
        height: nextH,
      },
    })
  }, [
    COLLAPSED_TITLE_PAD_Y,
    data.collapsed,
    data.expandedWidth,
    id,
    lineBox,
    updateNodeMeta,
    width,
  ])

  useLayoutEffect(() => {
    if (!data.collapsed) {
      lastSyncedSizeRef.current = null
      return
    }
    const run = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => syncCollapsedSizeFromDom())
      })
    }
    run()
    const el = rootRef.current
    const titleEl = titleRowRef.current
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => syncCollapsedSizeFromDom())
    if (el) ro.observe(el)
    if (titleEl) ro.observe(titleEl)
    return () => ro.disconnect()
  }, [
    data.collapsed,
    syncCollapsedSizeFromDom,
    titleFontSize,
    data.title,
    borderColor,
    backgroundColor,
  ])

  const setLocked = (locked: boolean) => {
    updateNodeData(id, { kind: 'group', locked })
    updateNodeMeta(id, { draggable: !locked })
  }

  /**
   * 提交标题编辑并关闭输入框。
   */
  const commitTitleEdit = useCallback(() => {
    const next = titleDraft.trim() || data.title
    updateNodeData(id, { kind: 'group', title: next })
    setIsTitleEditing(false)
  }, [data.title, id, titleDraft, updateNodeData])

  /**
   * 取消编辑，丢弃草稿。
   */
  const cancelTitleEdit = useCallback(() => {
    skipBlurCommitRef.current = true
    setTitleDraft(data.title)
    setIsTitleEditing(false)
  }, [data.title])

  /**
   * 整条标题栏统一处理双击重命名（排除折叠按钮），不依赖内部 span 的可点范围。
   */
  const onTitleRowDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('.studio-group__toggleBtn')) return
      if (isTitleEditing) return
      event.stopPropagation()
      setTitleDraft(data.title)
      setIsTitleEditing(true)
    },
    [data.title, isTitleEditing],
  )

  return (
    <div
      ref={rootRef}
      className={`studio-group ${selected ? 'is-selected' : ''} ${
        data.collapsed ? 'studio-group--collapsed' : ''
      }`}
      style={
        {
          '--group-border-color': borderColor,
          '--group-title-bg-color': backgroundColor,
          '--group-title-size': `${titleFontSize}px`,
          ...(!data.collapsed
            ? { '--group-title-row-height': `${titleRowHeightExpanded}px` }
            : {}),
          '--group-title-pad-y': `${COLLAPSED_TITLE_PAD_Y}px`,
        } as CSSProperties
      }
    >
      {/* 分组设置菜单：仅在标题栏区域右键打开，避免在组内空白/成员节点区域误触。 */}
      <div
        ref={titleRowRef}
        className="studio-group__titleRow"
        onDoubleClick={onTitleRowDoubleClick}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return
          if ((event.target as HTMLElement).closest('.studio-group__toggleBtn')) return
          /** 同步写入 RF store，确保拖曳开始时本组已是 selected，避免被 XYDrag 清空选区 */
          store.getState().addSelectedNodes([id])
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenuPos({ x: event.clientX, y: event.clientY })
        }}
      >
        <button
          type="button"
          className="studio-group__toggleBtn nodrag"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            const currWidth = Number(width || data.expandedWidth || 430)
            const currHeight = Number(height || data.expandedHeight || 280)
            if (data.collapsed) {
              const restoreWidth = Math.max(220, Number(data.expandedWidth || currWidth))
              const restoreHeight = Math.max(140, Number(data.expandedHeight || currHeight))
              updateNodeData(id, {
                kind: 'group',
                collapsed: false,
              })
              updateNodeMeta(id, {
                width: restoreWidth,
                height: restoreHeight,
                style: {
                  width: restoreWidth,
                  height: restoreHeight,
                },
              })
            } else {
              updateNodeData(id, {
                kind: 'group',
                collapsed: true,
                expandedWidth: currWidth,
                expandedHeight: currHeight,
              })
              const collapsedWidth = Math.max(220, currWidth)
              /** 高度交给标题栏自然排版 + DOM 测量同步，此处只锁宽度 */
              updateNodeMeta(id, {
                width: collapsedWidth,
                style: {
                  width: collapsedWidth,
                },
              })
            }
          }}
          title={data.collapsed ? '展开分组' : '折叠分组'}
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
        {isTitleEditing ? (
          <input
            ref={titleInputRef}
            className="studio-group__titleInput nodrag"
            value={titleDraft}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false
                return
              }
              commitTitleEdit()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitleEdit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelTitleEdit()
              }
            }}
            placeholder="分组标题"
          />
        ) : (
          <span className="studio-group__titleText">{data.title || '分组标题'}</span>
        )}
      </div>
      {!data.collapsed ? (
        <div className="studio-group__body">
          <NodeResizer
            minWidth={220}
            minHeight={140}
            lineClassName="studio-group__resizeLine"
            handleClassName="studio-group__resizeHandle"
            isVisible={selected && !data.locked}
          />
        </div>
      ) : null}
      {menuPos
        ? createPortal(
            <div
              className="studio-group__menu nodrag"
              style={{ left: menuPos.x + 4, top: menuPos.y + 4 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="studio-group__menuItem"
                onClick={() => {
                  const next = !(data.locked ?? false)
                  setLocked(next)
                  setMenuPos(null)
                }}
              >
                {data.locked ? '取消固定' : '固定'}
              </button>
              <button
                type="button"
                className="studio-group__menuItem"
                onClick={() => {
                  const nextTitle = window.prompt('输入组标题', data.title)?.trim()
                  if (nextTitle) {
                    updateNodeData(id, { kind: 'group', title: nextTitle })
                  }
                  setMenuPos(null)
                }}
              >
                重命名
              </button>
              <div className="studio-group__menuSectionTitle">颜色</div>
              <div className="studio-group__menuColors">
                {colorPresets.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="studio-group__menuColorItem"
                    style={{ background: item.border }}
                    onClick={() => {
                      updateNodeData(id, {
                        kind: 'group',
                        borderColor: item.border,
                        backgroundColor: item.bg,
                      })
                      setMenuPos(null)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="studio-group__menuItem"
                onClick={() => {
                  const raw = window.prompt('输入标题字号（10-120）', String(titleFontSize))
                  if (!raw) return
                  const next = Math.max(10, Math.min(120, Number(raw) || 12))
                  updateNodeData(id, { kind: 'group', titleFontSize: next })
                  setMenuPos(null)
                }}
              >
                字体大小
              </button>
              <button
                type="button"
                className="studio-group__menuItem is-danger"
                onClick={() => {
                  removeNodeById(id)
                  setMenuPos(null)
                }}
              >
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
