import type { ProjectSnapshot } from '../types'
import { createDefaultProject } from '../data/defaultProject'
import { LEGACY_LOCAL_STORAGE_KEYS } from './legacyLocalStorageKeys'
import { migrateVideoTargetEdges } from './videoNodeInports'

const STORAGE_KEY = 'flowid.project.v1'
const DEFAULT_NODE_WIDTH = 430
const DEFAULT_NODE_HEIGHT = 340

/** 与 `StudioApp` 中 `nodeTypes` 一致；未知 type 会导致 React Flow 渲染崩溃 */
const KNOWN_FLOW_NODE_TYPES = new Set([
  'text',
  'script',
  'image',
  'imageCompare',
  'video',
  'audio',
  'panorama',
  'ghost',
  'group',
])

/**
 * 丢弃非法节点并剔除悬挂边，避免损坏的 localStorage / 导入 JSON 导致整页白屏。
 */
function sanitizeSnapshotForRuntime(snapshot: ProjectSnapshot): ProjectSnapshot {
  const nodeList = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const nodes = nodeList.filter((node) => {
    const t = typeof node.type === 'string' ? node.type : ''
    if (!KNOWN_FLOW_NODE_TYPES.has(t)) return false
    const d = node.data as { kind?: string } | undefined
    if (!d || typeof d.kind !== 'string') return false
    return true
  })
  const idSet = new Set(nodes.map((n) => n.id))
  const edgeList = Array.isArray(snapshot.edges) ? snapshot.edges : []
  const edges = edgeList.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target) && typeof e.source === 'string' && typeof e.target === 'string',
  )
  return {
    ...snapshot,
    nodes,
    edges,
  }
}

/**
 * 给工程节点补齐默认尺寸，保证首次渲染与新建节点尺寸一致。
 */
function normalizeSnapshotNodeSize(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      const prevStyle = (node.style ?? {}) as {
        width?: number | string
        height?: number | string
        [key: string]: unknown
      }
      const hasWidth = typeof prevStyle.width === 'number' || typeof prevStyle.width === 'string'
      const hasHeight = typeof prevStyle.height === 'number' || typeof prevStyle.height === 'string'
      let next = node
      if (node.type === 'panorama') {
        return {
          ...node,
          style: {
            ...prevStyle,
            width: hasWidth ? prevStyle.width : 440,
            /** 全景卡片内容自适应，旧工程里 560 等固定高会在底部留大块空白 */
            height: 'auto',
          },
        }
      }
      if (!hasWidth || !hasHeight) {
        next = {
          ...node,
          style: {
            ...prevStyle,
            width: hasWidth ? prevStyle.width : DEFAULT_NODE_WIDTH,
            height: hasHeight ? prevStyle.height : DEFAULT_NODE_HEIGHT,
          },
        }
      }
      if (next.type === 'group') {
        return {
          ...next,
          selectable: false,
          dragHandle: '.studio-group__titleRow',
        }
      }
      return next
    }),
  }
}

/**
 * 从 localStorage 读取工程；失败或不存在则返回默认示例。
 */
export function loadStoredProject(): ProjectSnapshot {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacyKey = LEGACY_LOCAL_STORAGE_KEYS.project
      const legacy = localStorage.getItem(legacyKey)
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy)
        localStorage.removeItem(legacyKey)
        raw = legacy
      }
    }
    if (!raw) return createDefaultProject()
    const parsed = JSON.parse(raw) as ProjectSnapshot
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) {
      return createDefaultProject()
    }
    const normalized = normalizeSnapshotNodeSize(parsed)
    const safe = sanitizeSnapshotForRuntime(normalized)
    if (!safe.nodes.length) {
      return createDefaultProject()
    }
    return {
      ...safe,
      edges: migrateVideoTargetEdges(safe.nodes, safe.edges),
    }
  } catch {
    return createDefaultProject()
  }
}

/**
 * 将工程写入 localStorage。
 */
export function saveStoredProject(snapshot: ProjectSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('[Flowid] 保存工程到 localStorage 失败，已跳过本次写入', error)
  }
}

/**
 * 将工程导出为可下载的 JSON 文件内容。
 */
export function serializeProject(snapshot: ProjectSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

/**
 * 从用户选择的文件解析工程。
 */
export function parseProjectFile(text: string): ProjectSnapshot {
  const parsed = JSON.parse(text) as ProjectSnapshot
  if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) {
    throw new Error('工程文件格式不正确')
  }
  const safe = sanitizeSnapshotForRuntime(normalizeSnapshotNodeSize(parsed))
  if (!safe.nodes.length) {
    throw new Error('工程中没有可加载的合法节点（已过滤未知类型）')
  }
  return {
    ...safe,
    edges: migrateVideoTargetEdges(safe.nodes, safe.edges),
  }
}
