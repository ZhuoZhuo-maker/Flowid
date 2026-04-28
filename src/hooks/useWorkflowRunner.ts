import { useCallback, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { NodeRunStatus, StudioNodeData } from '../types'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 工作流执行引擎：负责拓扑排序、子图执行与节点状态流转。
 */
export function useWorkflowRunner({
  nodes,
  edges,
  selectedNodeId,
  setNodes,
  appendHistory,
  executeSingleNode,
}: {
  nodes: Node<StudioNodeData>[]
  edges: Edge[]
  selectedNodeId: string | null
  setNodes: React.Dispatch<React.SetStateAction<Node<StudioNodeData>[]>>
  appendHistory: (text: string) => void
  executeSingleNode?: (node: Node<StudioNodeData>) => Promise<void>
}) {
  const [isRunning, setIsRunning] = useState(false)
  const isExecutableNode = useCallback((node: Node<StudioNodeData>) => {
    return node.data.kind !== 'group' && node.data.kind !== 'panorama'
  }, [])
  /**
   * 批量更新节点运行状态。
   */
  const setRunStatus = useCallback(
    (ids: string[], status: NodeRunStatus, stamp = false) => {
      const idSet = new Set(ids)
      const now = Date.now()
      setNodes((prev) =>
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
    [setNodes],
  )

  /**
   * 计算一批节点在当前连线关系下的拓扑顺序。
   */
  const getTopoOrder = useCallback(
    (targetIds: string[]): string[] => {
      const targetSet = new Set(targetIds)
      const indegree = new Map<string, number>()
      const graph = new Map<string, string[]>()
      targetIds.forEach((id) => {
        indegree.set(id, 0)
        graph.set(id, [])
      })

      edges.forEach((edge) => {
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

      // 若有环，兜底按原序追加剩余节点，避免执行中断。
      if (order.length < targetIds.length) {
        targetIds.forEach((id) => {
          if (!order.includes(id)) order.push(id)
        })
      }
      return order
    },
    [edges],
  )

  /**
   * 从指定节点向下游收集可执行子图。
   */
  const collectReachable = useCallback(
    (startId: string): string[] => {
      const visited = new Set<string>([startId])
      const queue = [startId]
      while (queue.length) {
        const curr = queue.shift()!
        edges.forEach((edge) => {
          if (edge.source === curr && !visited.has(edge.target)) {
            visited.add(edge.target)
            queue.push(edge.target)
          }
        })
      }
      return nodes.filter((n) => visited.has(n.id)).map((n) => n.id)
    },
    [edges, nodes],
  )

  /**
   * 按顺序模拟执行工作流节点，体现运行状态流转。
   */
  const executeNodeIds = useCallback(
    async (ids: string[], runName: string) => {
      if (ids.length === 0) {
        window.alert('没有可执行节点')
        return
      }
      const executableIdSet = new Set(
        nodes.filter((node) => isExecutableNode(node)).map((node) => node.id),
      )
      const filteredIds = ids.filter((id) => executableIdSet.has(id))
      const order = getTopoOrder(filteredIds)
      if (order.length === 0) {
        appendHistory(`未找到可执行节点：${runName}`)
        return
      }
      setIsRunning(true)
      setRunStatus(order, 'queued')
      appendHistory(`开始执行：${runName}（${order.length} 节点）`)

      const nodeMap = new Map(nodes.map((node) => [node.id, node]))
      try {
        for (const id of order) {
          setRunStatus([id], 'running')
          try {
            const currNode = nodeMap.get(id)
            if (!currNode) {
              throw new Error('节点不存在')
            }
            if (executeSingleNode) {
              await executeSingleNode(currNode)
            } else {
              await sleep(500 + Math.floor(Math.random() * 700))
            }
            setRunStatus([id], 'success', true)
            appendHistory(`执行成功：${id}`)
          } catch (error) {
            setRunStatus([id], 'error', true)
            appendHistory(`执行失败：${id}（${(error as Error).message}）`)
          }
        }
      } finally {
        setIsRunning(false)
      }
    },
    [appendHistory, executeSingleNode, getTopoOrder, nodes, setRunStatus],
  )

  /**
   * 执行全量节点。
   */
  const runAllWorkflow = useCallback(async () => {
    await executeNodeIds(
      nodes.filter((n) => isExecutableNode(n)).map((n) => n.id),
      '全流程',
    )
  }, [executeNodeIds, isExecutableNode, nodes])

  /**
   * 从当前选中节点开始执行下游链路。
   */
  const runFromSelected = useCallback(async () => {
    if (!selectedNodeId) {
      window.alert('请先选中一个节点')
      return
    }
    const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    if (!selectedNode || !isExecutableNode(selectedNode)) {
      window.alert('分组节点不可执行，请选择具体业务节点')
      return
    }
    const ids = collectReachable(selectedNodeId)
    await executeNodeIds(ids, `从 ${selectedNodeId} 开始`)
  }, [collectReachable, executeNodeIds, isExecutableNode, nodes, selectedNodeId])

  return {
    isRunning,
    runAllWorkflow,
    runFromSelected,
    /** 按拓扑顺序执行指定 id 列表（会过滤不可执行节点，如分组）。 */
    executeNodeIds,
  }
}
