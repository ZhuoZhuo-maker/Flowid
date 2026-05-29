/**
 * 短剧 Agent 聊天区「节点」步骤记录（激活工作流、更新参数等）。
 */

export type DramaChatStep = {
  id: string
  label: string
  ts: number
}

const stepsByProject = new Map<string, DramaChatStep[]>()
const listeners = new Set<() => void>()

/**
 * 追加一步状态条
 * @param projectTabId 项目 id
 * @param label 展示文案（如「激活工作流」）
 */
export function pushDramaChatStep(projectTabId: string, label: string): void {
  if (!projectTabId || !label.trim()) return
  const trimmed = label.trim()
  const list = stepsByProject.get(projectTabId) ?? []
  const last = list[list.length - 1]
  /** 连续相同步骤不重复追加（避免续跑时刷屏） */
  if (last?.label === trimmed) return
  list.push({ id: `${Date.now()}-${list.length}`, label: trimmed, ts: Date.now() })
  stepsByProject.set(projectTabId, list)
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

/** 读取当前项目全部步骤 */
export function getDramaChatSteps(projectTabId: string): DramaChatStep[] {
  if (!projectTabId) return []
  return [...(stepsByProject.get(projectTabId) ?? [])]
}

/** 订阅步骤变化 */
export function subscribeDramaChatSteps(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 工具名 → 截图式中文步骤文案 */
export function dramaToolStepLabel(toolName: string): string | null {
  switch (toolName) {
    case 'flowid_drama_set_spec':
      return '更新短片参数'
    case 'flowid_drama_set_script':
      return '更新剧本摘要'
    case 'flowid_drama_set_characters':
      return '更新角色信息'
    case 'flowid_drama_set_locations':
      return '更新场景信息'
    case 'flowid_drama_set_shots':
      return 'Update Storyboard'
    case 'flowid_drama_sync_storyboard_node':
      return '同步分镜表'
    case 'flowid_drama_apply_shot_list':
      return '展开镜头节点'
    case 'flowid_run_nodes':
      return '生成故事视频'
    case 'flowid_drama_generate_character_images':
      return '生成角色图'
    case 'flowid_drama_generate_scene_images':
      return '生成场景图'
    case 'flowid_drama_generate_storyboard_images':
      return '生成分镜图像'
    case 'flowid_drama_generate_storyboard_videos':
      return '生成分镜视频'
    case 'flowid_drama_invite_expert':
      return '邀请专家加入群聊'
    case 'flowid_drama_advance_phase':
      return '推进制片阶段'
    case 'flowid_drama_get_state':
      return '获取工作区详情'
    default:
      return null
  }
}
