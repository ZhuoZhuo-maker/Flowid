import { useCallback, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { NodeRunStatus, StudioNodeData } from '../types'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function topoOrderForEdges(targetIds: string[], edgeList: Edge[]): string[] {
  const targetSet = new Set(targetIds)
  const indegree = new Map<string, number>()
  const graph = new Map<string, string[]>()
  targetIds.forEach((id) => {
    indegree.set(id, 0)
    graph.set(id, [])
  })

  edgeList.forEach((edge) => {
    if (!targetSet.has(edge.source) || !targetSet.has(edge.target)) return
    graph.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  })

  const queue: string[] = targetIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const curr = queue.shift()!
    order.push(curr)
    for (const next of graph.get(curr) ?? []) {
      const val = (indegree.get(next) ?? 0) - 1
      indegree.set(next, val)
      if (val === 0) queue.push(next)
    }
  }

  if (order.length < targetIds.length) {
    targetIds.forEach((id) => {
      if (!order.includes(id)) order.push(id)
    })
  }
  return order
}

/**
 * 工作流执行引擎：负责拓扑排序、子图执行与节点状态流转。
 * 支持多项目标签：执行时绑定 `projectTabId`，进度与回填通过 `patchNodesForTab` 写入对应标签快照。
 */
export function useWorkflowRunner({
  selectedNodeId,
  patchNodesForTab,
  getRunGraphForTab,
  getActiveProjectTabId,
  appendHistory,
  executeSingleNode,
}: {
  selectedNodeId: string | null
  patchNodesForTab: (tabId: string, update: (prev: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void
  getRunGraphForTab: (tabId: string) => { nodes: Node<StudioNodeData>[]; edges: Edge[] }
  getActiveProjectTabId: () => string
  appendHistory: (text: string) => void
  /** 返回 `false` 表示本节点被跳过（如敏感词拦截），不记为执行失败 */
  executeSingleNode?: (
    node: Node<StudioNodeData>,
    ctx: { projectTabId: string; getRunGraphForTab: (tabId: string) => { nodes: Node<StudioNodeData>[]; edges: Edge[] } },
  ) => Promise<boolean | void>
}) {
  const runningDepthRef = useRef(0)
  const [isRunning, setIsRunning] = useState(false)

  const isExecutableNode = useCallback((node: Node<StudioNodeData>) => {
    return (
      node.data.kind !== 'group' &&
      node.data.kind !== 'panorama' &&
      node.data.kind !== 'imageCompare'
    )
  }, [])

  const setRunStatusForTab = useCallback(
    (tabId: string, ids: string[], status: NodeRunStatus, stamp = false) => {
      const idSet = new Set(ids)
      const now = Date.now()
      patchNodesForTab(tabId, (prev) =>
        prev.map((node) =>
          idSet.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  runStatus: status,
                  ...(status === 'queued' || status === 'success' || status === 'error'
                    ? { runProgress: undefined }
                    : {}),
                  ...(stamp ? { lastRunAt: now } : {}),
                },
              }
            : node,
        ),
      )
    },
    [patchNodesForTab],
  )

  const executeNodeIds = useCallback(
    async (ids: string[], runName: string, runOpts: { projectTabId: string }) => {
      const { projectTabId } = runOpts
      const { nodes: runNodes, edges: runEdges } = getRunGraphForTab(projectTabId)

      if (ids.length === 0) {
        window.alert('没有可执行节点')
        return
      }
      const executableIdSet = new Set(
        runNodes.filter((node) => isExecutableNode(node)).map((node) => node.id),
      )
      const filteredIds = ids.filter((id) => executableIdSet.has(id))
      const order = topoOrderForEdges(filteredIds, runEdges)
      if (order.length === 0) {
        appendHistory(`未找到可执行节点：${runName}`)
        return
      }
      runningDepthRef.current += 1
      if (runningDepthRef.current === 1) setIsRunning(true)

      setRunStatusForTab(projectTabId, order, 'queued')
      appendHistory(`开始执行：${runName}（${order.length} 节点）`)

      const nodeMap = new Map(runNodes.map((node) => [node.id, node]))
      const runCtx = { projectTabId, getRunGraphForTab }
      try {
        for (const id of order) {
          setRunStatusForTab(projectTabId, [id], 'running')
          try {
            const currNode = nodeMap.get(id)
            if (!currNode) {
              throw new Error('节点不存在')
            }
            if (executeSingleNode) {
              const skip = await executeSingleNode(currNode, runCtx)
              if (skip === false) {
                setRunStatusForTab(projectTabId, [id], 'idle', true)
                appendHistory(`已跳过：${id}（敏感词校验）`)
                continue
              }
            } else {
              await sleep(500 + Math.floor(Math.random() * 700))
            }
            setRunStatusForTab(projectTabId, [id], 'success', true)
            if (!executeSingleNode) {
              appendHistory(`执行成功：${id}`)
            }
          } catch (error) {
            setRunStatusForTab(projectTabId, [id], 'error', true)
            appendHistory(`执行失败：${id}（${(error as Error).message}）`)
          }
        }
      } finally {
        runningDepthRef.current -= 1
        if (runningDepthRef.current <= 0) {
          runningDepthRef.current = 0
          setIsRunning(false)
        }
      }
    },
    [appendHistory, executeSingleNode, getRunGraphForTab, isExecutableNode, setRunStatusForTab],
  )

  const runAllWorkflow = useCallback(async () => {
    const pid = getActiveProjectTabId()
    const { nodes: runNodes } = getRunGraphForTab(pid)
    await executeNodeIds(
      runNodes.filter((n) => isExecutableNode(n)).map((n) => n.id),
      '全流程',
      { projectTabId: pid },
    )
  }, [executeNodeIds, getActiveProjectTabId, getRunGraphForTab, isExecutableNode])

  const runFromSelected = useCallback(async () => {
    if (!selectedNodeId) {
      window.alert('请先选中一个节点')
      return
    }
    const pid = getActiveProjectTabId()
    const { nodes: runNodes } = getRunGraphForTab(pid)
    const selectedNode = runNodes.find((node) => node.id === selectedNodeId)
    if (!selectedNode || !isExecutableNode(selectedNode)) {
      window.alert('分组节点不可执行，请选择具体业务节点')
      return
    }
    const visited = new Set<string>([selectedNodeId])
    const queue = [selectedNodeId]
    const { edges: runEdges } = getRunGraphForTab(pid)
    while (queue.length) {
      const curr = queue.shift()!
      runEdges.forEach((edge) => {
        if (edge.source === curr && !visited.has(edge.target)) {
          visited.add(edge.target)
          queue.push(edge.target)
        }
      })
    }
    const ids = runNodes.filter((n) => visited.has(n.id)).map((n) => n.id)
    await executeNodeIds(ids, `从 ${selectedNodeId} 开始`, { projectTabId: pid })
  }, [executeNodeIds, getActiveProjectTabId, getRunGraphForTab, isExecutableNode, selectedNodeId])

  return {
    isRunning,
    runAllWorkflow,
    runFromSelected,
    executeNodeIds,
  }
}
