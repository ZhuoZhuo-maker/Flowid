import type { Edge, Node } from '@xyflow/react'
import type { ProjectSnapshot, StudioNodeData } from '../types'
import { STUDIO_FLOW_SOURCE_HANDLE_ID, STUDIO_FLOW_TARGET_HANDLE_ID } from '../lib/studioFlowHandles'
import { VIDEO_IN_UNIFIED } from '../lib/videoNodeInports'

/**
 * 首次进入时的示例工程：展示从左到右的「剧本 → 提示 → 分镜图 → 成片 → 音频」链路。
 */
export function createDefaultProject(): ProjectSnapshot {
  const nodes: Node<StudioNodeData>[] = [
    {
      id: 'script-1',
      type: 'script',
      position: { x: 40, y: 80 },
      style: { width: 430, height: 340 },
      data: {
        kind: 'script',
        title: '剧本 · 开场',
        runStatus: 'idle',
        body:
          '【景别】全景\n【场景】雨夜 · 天台\n【对白】主角望向城市灯火，低声自语。',
      },
    },
    {
      id: 'text-1',
      type: 'text',
      position: { x: 420, y: 120 },
      style: { width: 430, height: 340 },
      data: {
        kind: 'text',
        title: '镜头/风格提示',
        runStatus: 'idle',
        body:
          '电影感，青橙色调，慢推镜头，浅景深，雨滴在栏杆上反光。',
      },
    },
    {
      id: 'image-1',
      type: 'image',
      position: { x: 780, y: 60 },
      style: { width: 430, height: 340 },
      data: {
        kind: 'image',
        title: '关键分镜',
        runStatus: 'idle',
        src: '',
        prompt: '同上，构图：人物背影占画面下三分之一，城市天际线延展。',
      },
    },
    {
      id: 'video-1',
      type: 'video',
      position: { x: 1140, y: 100 },
      style: { width: 430, height: 340 },
      data: {
        kind: 'video',
        title: '成片片段',
        runStatus: 'idle',
        src: '',
        prompt: '5s，从全景缓推到中景，保留雨声音效。',
      },
    },
    {
      id: 'audio-1',
      type: 'audio',
      position: { x: 1500, y: 140 },
      style: { width: 430, height: 340 },
      data: {
        kind: 'audio',
        title: '对白/配乐',
        runStatus: 'idle',
        src: '',
        note: '可选：环境雨声 + 低频铺底。',
      },
    },
  ]

  const edges: Edge[] = [
    {
      id: 'e-script-text',
      source: 'script-1',
      target: 'text-1',
      sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID,
      targetHandle: STUDIO_FLOW_TARGET_HANDLE_ID,
      animated: true,
    },
    {
      id: 'e-text-image',
      source: 'text-1',
      target: 'image-1',
      sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID,
      targetHandle: STUDIO_FLOW_TARGET_HANDLE_ID,
      animated: true,
    },
    {
      id: 'e-image-video',
      source: 'image-1',
      target: 'video-1',
      sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID,
      targetHandle: VIDEO_IN_UNIFIED,
      animated: true,
    },
    {
      id: 'e-video-audio',
      source: 'video-1',
      target: 'audio-1',
      sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID,
      targetHandle: STUDIO_FLOW_TARGET_HANDLE_ID,
      animated: true,
    },
  ]

  return {
    version: 1,
    name: '示例工程',
    nodes,
    edges,
    viewport: { x: 40, y: 20, zoom: 0.78 },
  }
}
