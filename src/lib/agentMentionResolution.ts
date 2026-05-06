import type { Node } from '@xyflow/react'
import type { StudioNodeData } from '../types'
import { parseMentionRefs } from './nodeMentions'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i

export type AgentProjectTabBrief = { id: string; name: string }

/**
 * 解析用户句中的 `@[标题](uuid)`，对照画布节点与顶栏工程标签自动归类，
 * 并附加一段说明给规划/对话模型——新场景只需扩展本模块，不必在 Studio 里散落 if。
 */
export function augmentPromptWithMentionResolution(
  userText: string,
  nodes: Array<Node<StudioNodeData>>,
  projectTabs: AgentProjectTabBrief[],
): string {
  const refs = parseMentionRefs(userText)
  const lines: string[] = []
  const seen = new Set<string>()
  for (const r of refs) {
    const id = r.nodeId?.trim()
    if (!id || !UUID_RE.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodes.find((n) => n.id === id)
    if (node) {
      const title = String(node.data.title || '').trim() || id
      lines.push(
        `- ${id} → 画布节点「${title}」（${node.data.kind}）；仅当用户明确要求执行/运行该节点时，才对其使用 run_node。`,
      )
      continue
    }
    const tab = projectTabs.find((t) => t.id === id)
    if (tab) {
      const nm = String(tab.name || '').trim() || id
      lines.push(`- ${id} → 顶栏工程标签「${nm}」，不是画布节点；禁止对该 id 使用 run_node。`)
      continue
    }
    lines.push(`- ${id} → 未匹配到画布节点或工程标签；禁止对该 id 使用 run_node。`)
  }
  if (!lines.length) return userText
  return `${userText}\n\n---\n[FlowID·@引用解析｜由编辑器根据当前画布自动附加]\n${lines.join('\n')}`
}
