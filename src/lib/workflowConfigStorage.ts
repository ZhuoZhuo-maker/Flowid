import type {
  CloudWorkflowOverrideEntry,
  NodeWorkflowConfig,
  ShortcutCommandId,
  WorkflowExecutionMode,
  WorkflowProviderConfig,
  WorkflowProviderType,
  StudioNodeKind,
} from '../types'
import { LEGACY_LOCAL_STORAGE_KEYS } from './legacyLocalStorageKeys'

const STORAGE_KEY = 'flowid.workflow.config.v1'

export type WorkflowConfigSnapshot = {
  executionMode: WorkflowExecutionMode
  executionProvider: WorkflowProviderType
  local: WorkflowProviderConfig
  cloud: WorkflowProviderConfig
  cloudEndpoints: Array<{ id: string; name: string; baseUrl: string; enabled: boolean }>
  nodeConfigs: Record<StudioNodeKind, NodeWorkflowConfig>
  shortcuts: {
    enableGlobalHotkeys: boolean
    moveStep: number
    fastMoveStep: number
    bindings: Record<ShortcutCommandId, string>
  }
  /**
   * 为 true 时，每次提交 Comfy 前将工作流中 KSampler 的 `seed` 随机化（类似桌面端选 randomize）；
   * 为 false 时严格使用 JSON 内保存的 seed，便于完全复现。
   */
  randomizeKsamplerSeedsOnRun: boolean
}

/**
 * 返回默认工作流配置。
 */
export function getDefaultWorkflowConfig(): WorkflowConfigSnapshot {
  const defaultNodeConfig: NodeWorkflowConfig = {
    workflowJsonText: '',
    workflowName: '',
    workflows: [],
    selectedWorkflowId: undefined,
    cloudModelName: '',
    cloudModelUrl: '',
    cloudApiKey: '',
    resultNodeId: '',
    resultFieldPath: '',
  }
  return {
    executionMode: 'custom',
    executionProvider: 'local',
    local: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8188',
      timeoutSec: 120,
    },
    cloud: {
      enabled: false,
      baseUrl: '',
      timeoutSec: 180,
    },
    cloudEndpoints: [{ id: crypto.randomUUID(), name: '云端-1', baseUrl: '', enabled: true }],
    nodeConfigs: {
      text: { ...defaultNodeConfig },
      script: { ...defaultNodeConfig },
      image: { ...defaultNodeConfig },
      video: { ...defaultNodeConfig },
      audio: { ...defaultNodeConfig },
      music: { ...defaultNodeConfig },
      panorama: { ...defaultNodeConfig },
      imageCompare: { ...defaultNodeConfig },
    },
    shortcuts: {
      enableGlobalHotkeys: true,
      moveStep: 1,
      fastMoveStep: 10,
      bindings: {
        selectAll: 'Ctrl+A',
        copy: 'Ctrl+C',
        cut: 'Ctrl+X',
        paste: 'Ctrl+V',
        duplicate: 'Ctrl+D',
        delete: 'Delete',
        undo: 'Ctrl+Z',
        redo: 'Ctrl+Y',
        fitView: 'Ctrl+1',
        resetZoom: 'Ctrl+0',
        /** 仅支持 Shift / Alt：Ctrl、Cmd 保留给「追加多选」 */
        marqueeSelect: 'Shift',
      },
    },
    /** 默认开启：避免工作流 JSON 里长期固定 seed 导致风格锁死（如旧动漫 seed + 新写实图仍偏动漫） */
    randomizeKsamplerSeedsOnRun: true,
  }
}

/**
 * 规范化工作流条目，补齐新字段并兼容旧数据。
 */
function normalizeNodeWorkflows(config: NodeWorkflowConfig): NodeWorkflowConfig['workflows'] {
  return (config.workflows ?? []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    name: item.name || '未命名工作流',
    jsonText: item.jsonText || '',
    createdAt: item.createdAt || Date.now(),
    resultNodeId: item.resultNodeId || '',
    resultFieldPath: item.resultFieldPath || '',
  }))
}

function normalizeCloudWorkflowOverrides(
  raw: unknown,
): Record<string, CloudWorkflowOverrideEntry> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, CloudWorkflowOverrideEntry> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || '').trim()
    if (!id) continue
    if (typeof v === 'string') {
      const jsonText = v.trim()
      if (jsonText) out[id] = { jsonText }
      continue
    }
    if (v && typeof v === 'object') {
      const jsonText = String((v as { jsonText?: unknown }).jsonText || '').trim()
      if (!jsonText) continue
      const rn = String((v as { resultNodeId?: unknown }).resultNodeId || '').trim()
      const rf = String((v as { resultFieldPath?: unknown }).resultFieldPath || '').trim()
      const ua = (v as { updatedAt?: unknown }).updatedAt
      out[id] = {
        jsonText,
        resultNodeId: rn || undefined,
        resultFieldPath: rf || undefined,
        updatedAt: typeof ua === 'number' ? ua : undefined,
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeCloudWorkflowSystemPrompts(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || '').trim()
    if (!id) continue
    if (typeof v !== 'string') continue
    out[id] = v
  }
  return Object.keys(out).length ? out : undefined
}

function mergeLoadedNodeConfig(
  fallback: NodeWorkflowConfig,
  partial: Partial<NodeWorkflowConfig> | undefined,
): NodeWorkflowConfig {
  const merged = { ...fallback, ...(partial ?? {}) }
  const st = merged.settingsEditTarget
  const settingsEditTarget: 'local' | 'cloud' | undefined =
    st === 'cloud' || st === 'local' ? st : undefined
  return {
    ...merged,
    settingsEditTarget,
    cloudSettingsSelectedWorkflowId:
      typeof merged.cloudSettingsSelectedWorkflowId === 'string'
        ? merged.cloudSettingsSelectedWorkflowId
        : undefined,
    workflows: normalizeNodeWorkflows(merged),
    cloudWorkflowOverrides: normalizeCloudWorkflowOverrides(merged.cloudWorkflowOverrides),
    cloudWorkflowSystemPrompts: normalizeCloudWorkflowSystemPrompts(merged.cloudWorkflowSystemPrompts),
  }
}

/**
 * 从 localStorage 读取工作流配置。
 */
export function loadWorkflowConfig(): WorkflowConfigSnapshot {
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacyKey = LEGACY_LOCAL_STORAGE_KEYS.workflowConfig
      const legacy = window.localStorage.getItem(legacyKey)
      if (legacy) {
        window.localStorage.setItem(STORAGE_KEY, legacy)
        window.localStorage.removeItem(legacyKey)
        raw = legacy
      }
    }
    if (!raw) return getDefaultWorkflowConfig()
    const parsed = JSON.parse(raw) as Partial<WorkflowConfigSnapshot>
    const fallback = getDefaultWorkflowConfig()
    return {
      executionMode: parsed.executionMode === 'official' ? 'official' : 'custom',
      executionProvider:
        parsed.executionProvider === 'cloud' ? 'cloud' : 'local',
      local: { ...fallback.local, ...(parsed.local ?? {}) },
      cloud: { ...fallback.cloud, ...(parsed.cloud ?? {}) },
      cloudEndpoints:
        parsed.cloudEndpoints?.map((item) => ({
          id: item.id || crypto.randomUUID(),
          name: item.name || '未命名云端',
          baseUrl: item.baseUrl || '',
          enabled: item.enabled !== false,
        })) ?? fallback.cloudEndpoints,
      nodeConfigs: {
        text: mergeLoadedNodeConfig(fallback.nodeConfigs.text, parsed.nodeConfigs?.text),
        script: mergeLoadedNodeConfig(fallback.nodeConfigs.script, parsed.nodeConfigs?.script),
        image: mergeLoadedNodeConfig(fallback.nodeConfigs.image, parsed.nodeConfigs?.image),
        video: mergeLoadedNodeConfig(fallback.nodeConfigs.video, parsed.nodeConfigs?.video),
        audio: mergeLoadedNodeConfig(fallback.nodeConfigs.audio, parsed.nodeConfigs?.audio),
        music: mergeLoadedNodeConfig(fallback.nodeConfigs.music, parsed.nodeConfigs?.music),
        panorama: mergeLoadedNodeConfig(fallback.nodeConfigs.panorama, parsed.nodeConfigs?.panorama),
        imageCompare: mergeLoadedNodeConfig(
          fallback.nodeConfigs.imageCompare,
          parsed.nodeConfigs?.imageCompare,
        ),
      },
      shortcuts: {
        ...fallback.shortcuts,
        ...(parsed.shortcuts ?? {}),
        bindings: {
          ...fallback.shortcuts.bindings,
          ...(parsed.shortcuts?.bindings ?? {}),
        },
      },
      randomizeKsamplerSeedsOnRun:
        typeof parsed.randomizeKsamplerSeedsOnRun === 'boolean'
          ? parsed.randomizeKsamplerSeedsOnRun
          : fallback.randomizeKsamplerSeedsOnRun,
    }
  } catch {
    return getDefaultWorkflowConfig()
  }
}

/**
 * 将工作流配置持久化到 localStorage。
 */
export function saveWorkflowConfig(snapshot: WorkflowConfigSnapshot) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('[Flowid] 保存工作流配置失败（localStorage 配额不足）', error)
  }
}
