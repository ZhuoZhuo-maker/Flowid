import type { DramaProductionState } from './types'
import { isDramaAutoPilot } from './dramaUiBridge'

/**
 * 短剧 Agent 一轮结束后若模型未调用 ask_user / set_*，注入续跑提示。
 * @param state 当前制片状态
 * @param awaitingUser 本轮是否已调用 ask_user
 * @param projectTabId 项目 id（用于判断自动制片）
 */
export function buildDramaContinuationNudge(
  state: DramaProductionState | null,
  awaitingUser: boolean,
  projectTabId?: string,
): string | null {
  if (!state || awaitingUser) return null

  const auto = projectTabId ? isDramaAutoPilot(projectTabId) : true

  const { phase, scriptBody, characters, locations, shots } = state

  if (phase === 'intake') {
    return '【系统续跑】请调用 flowid_drama_ask_user 让用户确认或选择参数，不要只输出文字就结束本轮。'
  }

  if (phase === 'script_draft') {
    if (scriptBody.trim().length < 80) {
      return '【系统续跑】请先用 flowid_drama_set_script 写入完整剧本，再 flowid_drama_ask_user 询问用户是否满意；不要只输出大纲就结束。'
    }
    return '【系统续跑】请 flowid_drama_ask_user 询问用户对剧本是否满意；满意后 flowid_drama_advance_phase 并 flowid_drama_invite_expert 邀请角色设计师。'
  }

  if (phase === 'character_location') {
    if (characters.length === 0) {
      return '【系统续跑】请 flowid_drama_set_characters 写入角色列表，并 flowid_drama_ask_user 让用户确认视觉风格。'
    }
    if (locations.length === 0) {
      return '【系统续跑】请 flowid_drama_set_locations 写入场景；写入后客户端将自动出场景图。'
    }
    if (shots.length === 0) {
      return auto
        ? '【系统续跑】请 flowid_drama_set_shots 写入分镜表（含 imagePrompt）；写入后客户端将自动出分镜图与视频。'
        : '【系统续跑】角色与场景已定稿。请 flowid_drama_advance_phase 进入分镜阶段，flowid_drama_invite_expert 邀请分镜师，flowid_drama_set_shots 写入分镜表。'
    }
    if (auto) {
      return '【系统续跑】请 flowid_drama_generate_scene_images phase=main 生成场景主图（若尚未出图）。'
    }
  }

  if (phase === 'storyboard' || phase === 'storyboard_images') {
    if (shots.length === 0) {
      return auto
        ? '【系统续跑】请 flowid_drama_set_shots 写入完整分镜表；客户端将自动 generate_storyboard_images 与 generate_storyboard_videos。'
        : '【系统续跑】请 flowid_drama_ask_user 确认分镜方案，flowid_drama_set_shots 写入分镜表后再 ask_user。'
    }
    const hasImages = shots.some((s) => (s.imageSrcs?.length ?? 0) > 0)
    if (phase === 'storyboard' && !hasImages) {
      return '【系统续跑】请 flowid_drama_generate_storyboard_images 生成分镜图（自动模式也会后台执行，若未出图请显式调用）。'
    }
    if (phase === 'storyboard_images' && !shots.some((s) => s.videoSrc)) {
      return '【系统续跑】请 flowid_drama_ask_user 确认分镜视频方案，并 flowid_drama_generate_storyboard_videos 生成镜头视频。'
    }
  }

  if (phase === 'video_audio' && shots.length > 0 && !shots.some((s) => s.videoSrc)) {
    return '【系统续跑】请确认分镜视频方案并 flowid_drama_generate_storyboard_videos 或 ask_user 让用户选择。'
  }

  return null
}

/**
 * 过滤短剧聊天中展示给用户的工具 trace（【已执行】· flowid_* 行）。
 * @param lines 模型返回行
 */
export function filterDramaChatDisplayLines(lines: string[]): string[] {
  const out: string[] = []
  let inTrace = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === '【已执行】') {
      inTrace = true
      continue
    }
    if (inTrace) {
      if (line.startsWith('· ') || line.startsWith('·flowid_')) continue
      if (!line.trim()) {
        inTrace = false
        continue
      }
      inTrace = false
    }
    if (line.startsWith('【系统续跑】')) continue
    if (line.trim()) out.push(line)
  }
  return out
}
