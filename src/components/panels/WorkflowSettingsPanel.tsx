import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { motion } from 'motion/react'
import {
  Command,
  HardDrive,
  Image as ImageIconLucide,
  Mic,
  Music,
  Server,
  Terminal,
  Type,
  Video,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  browserSupportsDirectoryPicker,
  clearBrowserFolderHandle,
  loadBrowserFolderHandle,
  saveBrowserFolderHandle,
  type BrowserFolderSlot,
} from '../../lib/browserFolderHandleStore'
import {
  loadLocalDiskPathsSettings,
  saveLocalDiskPathsSettings,
  type LocalDiskPathsSettings,
} from '../../lib/localDiskPathsSettings'
import {
  unbindFlowidProjectJsonBrowser,
} from '../../lib/projectDiskMirror'
import { WorkflowVisualEditorInline } from './WorkflowVisualEditorInline'
import type {
  NodeWorkflowConfig,
  ShortcutCommandId,
  StudioNodeKind,
  WorkflowExecutionMode,
  WorkflowProviderConfig,
  WorkflowProviderType,
} from '../../types'
import type { AiAssistantConfig } from '../../lib/aiAssistantAgent'
import {
  loadCloudModelPresets,
  removeCloudModelPreset,
  saveCloudModelPresets,
  type CloudModelPreset,
} from '../../lib/cloudModelPresets'
import { normalizeOpenAICompatibleBaseUrl } from '../../lib/openaiCompat'
import { fetchOpenAICompat } from '../../lib/openaiProxy'
import {
  isDashScopeCompatibleModeMisusedForTts,
  isQwenTtsMultimodalEndpoint,
  normalizeQwenTtsMultimodalUrl,
  type QwenTtsMultimodalResponse,
} from '../../lib/qwenTtsMultimodal'
import {
  enrollQwenVoiceCloneWithBailian,
  isQwenVcSynthesisModel,
  QWEN_VC_DEFAULT_TARGET_MODEL,
  sanitizeQwenVoicePreferredName,
} from '../../lib/qwenVoiceClone'
import {
  loadAiAssistantCorePresets,
  removeAiAssistantCorePreset,
  upsertAiAssistantCorePreset,
  type AiAssistantCorePreset,
} from '../../lib/aiAssistantPresets'
import { loadTtsPresets, removeTtsPreset, upsertTtsPreset, type TtsPreset } from '../../lib/ttsPresets'

const KIND_LABELS: Record<StudioNodeKind, string> = {
  text: '文本',
  script: '脚本',
  image: '图片',
  video: '视频',
  audio: '配音',
  music: '音乐',
  panorama: 'VR360',
}

/** @flowid 设置面板：深色胶囊按钮、弱胶囊、表单控件 */
const WF_SECTION_TITLE =
  'text-[14px] font-black text-white/50 uppercase tracking-widest'
/** 弹窗内 action：深色胶囊 */
const WF_BTN_CAPSULE_DARK =
  'rounded-full border border-white/10 bg-[#1e1e22] px-4 py-2 text-[12px] font-black uppercase tracking-widest text-white/55 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'
/** 列表行内深色胶囊（参数设置） */
const WF_BTN_CAPSULE_COMPACT =
  'shrink-0 rounded-full border border-white/10 bg-[#1e1e22] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white/55 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'
/** 列表行内深色胶囊（置顶 / 删除），对齐参考图 */
const WF_BTN_CAPSULE_DARK_COMPACT =
  'shrink-0 rounded-full border border-white/10 bg-[#1e1e22] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white/45 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'
const WF_BTN_CAPSULE_MUTED =
  'rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-black uppercase tracking-widest text-white/50 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'
const WF_INPUT =
  'w-full rounded-xl border border-white/5 bg-black/40 p-3 text-[15px] font-mono text-white/60 outline-none focus:border-white/20'
const WF_SELECT =
  'w-full rounded-xl border border-white/10 bg-black/60 py-3 pl-3 pr-10 text-[15px] text-white/70 outline-none focus:border-white/20'
const WF_CARD = 'bg-[#111114] border border-white/5 rounded-2xl'
const WF_SYNC_BTN =
  'w-full rounded-xl border border-white/5 bg-[#1e1e22] py-4 text-[15px] font-black uppercase tracking-[0.3em] text-white/40 transition-all hover:bg-orange-600 hover:text-white'

type SettingsTab = 'comfy' | 'ai-assistant' | StudioNodeKind | 'shortcuts' | 'local-storage'

const SETTINGS_SIDEBAR: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'comfy', label: 'COMFYUI', icon: Server },
  { id: 'text', label: KIND_LABELS.text, icon: Type },
  { id: 'image', label: KIND_LABELS.image, icon: ImageIconLucide },
  { id: 'video', label: KIND_LABELS.video, icon: Video },
  { id: 'audio', label: KIND_LABELS.audio, icon: Mic },
  { id: 'music', label: KIND_LABELS.music, icon: Music },
  { id: 'ai-assistant', label: 'AI 助手', icon: Terminal },
  { id: 'shortcuts', label: '快捷键', icon: Command },
  { id: 'local-storage', label: '本地存储', icon: HardDrive },
]

/** 与 @flowid (2) SettingsPanel 一致：侧栏文案 + 「核心参数」 */
function settingsMainTitle(tab: SettingsTab): string {
  const row = SETTINGS_SIDEBAR.find((i) => i.id === tab)
  return row ? `${row.label} 核心参数` : '设置'
}

type OfficialTemplateMeta = {
  id: string
  name: string
  version: string
  description?: string
}

const SHORTCUT_LABELS: Array<{ id: ShortcutCommandId; label: string }> = [
  { id: 'selectAll', label: '全选' },
  { id: 'copy', label: '复制' },
  { id: 'cut', label: '剪切' },
  { id: 'paste', label: '粘贴' },
  { id: 'duplicate', label: '复制副本' },
  { id: 'delete', label: '删除' },
  { id: 'undo', label: '撤销' },
  { id: 'redo', label: '重做' },
  { id: 'fitView', label: '适应视图' },
  { id: 'resetZoom', label: '100% 缩放' },
]

const LOCAL_PATH_DIR_NAME_MAP: Record<Exclude<BrowserFolderSlot, 'flowidProjectJsonPath'>, string> = {
  inputPath: 'input',
  outputPath: 'output',
  workflowPath: 'workflow',
}

/**
 * 将路径末段与目标目录名对齐：若用户只选了根目录，则自动拼接并创建 `input/output/workflow` 子目录。
 */
function looksLikeEndsWithDir(pathText: string, dirName: string): boolean {
  const raw = String(pathText || '').trim().replace(/[\\/]+$/, '')
  if (!raw) return false
  const lower = raw.toLowerCase()
  const seg = dirName.toLowerCase()
  return lower === seg || lower.endsWith(`\\${seg}`) || lower.endsWith(`/${seg}`)
}

/**
 * 工作流设置面板：管理本地/云端配置、模板导入、节点类型绑定。
 */
export function WorkflowSettingsPanel({
  executionMode,
  executionProvider,
  randomizeKsamplerSeedsOnRun,
  localConfig,
  cloudConfig,
  cloudEndpoints,
  nodeConfigs,
  shortcuts,
  lastExecutionMessage,
  onExecutionProviderChange,
  onRandomizeKsamplerSeedsOnRunChange,
  onProviderConfigChange,
  onNodeConfigChange,
  onSaveNodeWorkflow,
  onSelectNodeWorkflow,
  onRemoveNodeWorkflow,
  onUpdateNodeWorkflowEntry,
  onClearNodeWorkflows,
  onPinNodeWorkflowToTop,
  onAddCloudEndpoint,
  onUpdateCloudEndpoint,
  onRemoveCloudEndpoint,
  onShortcutConfigChange,
  onShortcutBindingChange,
  onTestProviderConnection,
  connectionTestMessage,
  officialTemplates,
  onExecutionModeChange,
  onRefreshOfficialTemplates,
  aiAssistantConfig,
  onAiAssistantConfigChange,
  onSaveAiAssistantConfig,
  onClose,
}: {
  executionMode: WorkflowExecutionMode
  executionProvider: WorkflowProviderType
  /** 每次执行是否随机化 KSampler 的 seed */
  randomizeKsamplerSeedsOnRun: boolean
  localConfig: WorkflowProviderConfig
  cloudConfig: WorkflowProviderConfig
  cloudEndpoints: Array<{ id: string; name: string; baseUrl: string; enabled: boolean }>
  nodeConfigs: Record<StudioNodeKind, NodeWorkflowConfig>
  shortcuts: {
    enableGlobalHotkeys: boolean
    moveStep: number
    fastMoveStep: number
    bindings: Record<ShortcutCommandId, string>
  }
  lastExecutionMessage: string
  onExecutionProviderChange: (provider: WorkflowProviderType) => void
  onRandomizeKsamplerSeedsOnRunChange: (value: boolean) => void
  onProviderConfigChange: (
    provider: WorkflowProviderType,
    patch: Partial<WorkflowProviderConfig>,
  ) => void
  onNodeConfigChange: (kind: StudioNodeKind, patch: Partial<NodeWorkflowConfig>) => void
  onSaveNodeWorkflow: (kind: StudioNodeKind, name: string) => void
  onSelectNodeWorkflow: (kind: StudioNodeKind, workflowId: string) => void
  onRemoveNodeWorkflow: (kind: StudioNodeKind, workflowId: string) => void
  onUpdateNodeWorkflowEntry: (
    kind: StudioNodeKind,
    workflowId: string,
    patch: Partial<{ name: string; jsonText: string; resultNodeId: string; resultFieldPath: string }>,
  ) => void
  onClearNodeWorkflows: (kind: StudioNodeKind) => void
  onPinNodeWorkflowToTop: (kind: StudioNodeKind, workflowId: string) => void
  onAddCloudEndpoint: () => void
  onUpdateCloudEndpoint: (
    endpointId: string,
    patch: Partial<{ name: string; baseUrl: string; enabled: boolean }>,
  ) => void
  onRemoveCloudEndpoint: (endpointId: string) => void
  onShortcutConfigChange: (patch: {
    enableGlobalHotkeys?: boolean
    moveStep?: number
    fastMoveStep?: number
  }) => void
  onShortcutBindingChange: (command: ShortcutCommandId, binding: string) => void
  onTestProviderConnection: (
    provider: WorkflowProviderType,
  ) => Promise<{ ok: boolean; message: string }>
  connectionTestMessage: string
  officialTemplates: OfficialTemplateMeta[]
  onExecutionModeChange: (mode: WorkflowExecutionMode) => void
  onRefreshOfficialTemplates: () => Promise<OfficialTemplateMeta[]>
  aiAssistantConfig: AiAssistantConfig
  onAiAssistantConfigChange: (patch: Partial<AiAssistantConfig>) => void
  onSaveAiAssistantConfig: () => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('comfy')
  const [nodeSubTab, setNodeSubTab] = useState<'workflow' | 'cloud-model'>('workflow')
  const [bindingCommand, setBindingCommand] = useState<ShortcutCommandId | null>(null)
  const aiCloneAudioInputRef = useRef<HTMLInputElement | null>(null)
  const [diskPaths, setDiskPaths] = useState<LocalDiskPathsSettings>(() => loadLocalDiskPathsSettings())
  const [browserProjectBound, setBrowserProjectBound] = useState(false)
  const [cloudModelPresets, setCloudModelPresets] = useState<CloudModelPreset[]>([])
  const [editingCloudModelId, setEditingCloudModelId] = useState<string | null>(null)
  const [cloudModelDraft, setCloudModelDraft] = useState<{ name: string; baseUrl: string; apiKey: string }>({
    name: '',
    baseUrl: '',
    apiKey: '',
  })
  const [cloudModelTestMsg, setCloudModelTestMsg] = useState<string>('')
  const [aiCorePresets, setAiCorePresets] = useState<AiAssistantCorePreset[]>(() => loadAiAssistantCorePresets())
  const [ttsPresets, setTtsPresets] = useState<TtsPreset[]>(() => loadTtsPresets())
  const [editingAiCoreId, setEditingAiCoreId] = useState<string | null>(null)
  const [aiCoreDraft, setAiCoreDraft] = useState<AiAssistantCorePreset>({
    id: '',
    name: '',
    provider: 'ollama',
    endpoint: '',
    apiKey: '',
    model: '',
  })
  const [aiCoreTestMsg, setAiCoreTestMsg] = useState<string>('')
  const [editingTtsId, setEditingTtsId] = useState<string | null>(null)
  const [ttsDraft, setTtsDraft] = useState<TtsPreset>({
    id: '',
    name: '',
    endpoint: '',
    apiKey: '',
    model: '',
    voice: '',
  })
  const [ttsTestMsg, setTtsTestMsg] = useState<string>('')
  const [bailianCloneBusy, setBailianCloneBusy] = useState(false)
  /** 是否 Flowid 桌面壳（可弹出系统文件/文件夹对话框并读写真实路径） */
  const isElectronDesktop = useMemo(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.flowidDesktop?.pickDirectory && window.flowidDesktop?.pickJsonFile),
    [],
  )
  const [editingWorkflow, setEditingWorkflow] = useState<{
    kind: StudioNodeKind
    workflowId: string
    workflowName: string
    workflowJsonText: string
    resultNodeId: string
    resultFieldPath: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeKind = useMemo(() => {
    const kinds: StudioNodeKind[] = ['text', 'script', 'image', 'video', 'audio', 'music', 'panorama']
    return kinds.includes(activeTab as StudioNodeKind) ? (activeTab as StudioNodeKind) : null
  }, [activeTab])

  const activeNodeConfig = activeKind ? nodeConfigs[activeKind] : null
  const activeComfyBaseUrl = useMemo(() => {
    if (executionProvider === 'local') return localConfig.baseUrl
    return cloudEndpoints.find((item) => item.enabled && item.baseUrl.trim())?.baseUrl || ''
  }, [cloudEndpoints, executionProvider, localConfig.baseUrl])
  const activeComfyApiKey = executionProvider === 'local' ? '' : cloudConfig.apiKey || ''

  useEffect(() => {
    if (!activeKind) {
      setCloudModelPresets([])
      return
    }
    setCloudModelPresets(loadCloudModelPresets(activeKind))
  }, [activeKind])

  useEffect(() => {
    const onChanged = () => {
      if (!activeKind) return
      setCloudModelPresets(loadCloudModelPresets(activeKind))
    }
    window.addEventListener('flowid:cloud-model-presets-changed', onChanged as EventListener)
    return () => {
      window.removeEventListener('flowid:cloud-model-presets-changed', onChanged as EventListener)
    }
  }, [activeKind])

  useEffect(() => {
    const onAi = () => setAiCorePresets(loadAiAssistantCorePresets())
    const onTts = () => setTtsPresets(loadTtsPresets())
    window.addEventListener('flowid:ai-assistant-core-presets-changed', onAi as EventListener)
    window.addEventListener('flowid:tts-presets-changed', onTts as EventListener)
    return () => {
      window.removeEventListener('flowid:ai-assistant-core-presets-changed', onAi as EventListener)
      window.removeEventListener('flowid:tts-presets-changed', onTts as EventListener)
    }
  }, [])

  // If user already has an active config but presets were cleared (e.g. new profile / storage reset),
  // seed a "当前配置" preset so the UI always shows where the assistant is pointing to.
  useEffect(() => {
    if (!aiCorePresets.length && (aiAssistantConfig.endpoint.trim() || aiAssistantConfig.model.trim())) {
      const seeded: AiAssistantCorePreset = {
        id: crypto.randomUUID(),
        name: aiAssistantConfig.provider === 'cloud' ? '当前云端聊天模型' : '当前本地聊天模型',
        provider: aiAssistantConfig.provider === 'cloud' ? 'cloud' : 'ollama',
        endpoint: aiAssistantConfig.endpoint.trim(),
        apiKey: String(aiAssistantConfig.apiKey || ''),
        model: aiAssistantConfig.model.trim(),
      }
      const merged = upsertAiAssistantCorePreset(seeded)
      setAiCorePresets(merged)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAssistantConfig.endpoint, aiAssistantConfig.model, aiAssistantConfig.provider])

  useEffect(() => {
    const hasAny = ttsPresets.length > 0
    const hasConfig = Boolean(aiAssistantConfig.ttsEndpoint.trim() || aiAssistantConfig.ttsModel.trim() || aiAssistantConfig.ttsVoice.trim())
    if (!hasAny && hasConfig) {
      const seeded: TtsPreset = {
        id: crypto.randomUUID(),
        name: '当前 TTS 配置',
        endpoint: aiAssistantConfig.ttsEndpoint.trim(),
        apiKey: String(aiAssistantConfig.ttsApiKey || ''),
        model: aiAssistantConfig.ttsModel.trim(),
        voice: aiAssistantConfig.ttsVoice.trim(),
      }
      const merged = upsertTtsPreset(seeded)
      setTtsPresets(merged)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAssistantConfig.ttsEndpoint, aiAssistantConfig.ttsModel, aiAssistantConfig.ttsVoice])

  const startNewAiCorePreset = () => {
    const id = crypto.randomUUID()
    setEditingAiCoreId(id)
    setAiCoreDraft({
      id,
      name: '新助手模型',
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      apiKey: '',
      model: 'qwen3:14b',
    })
    setAiCoreTestMsg('')
  }

  const startEditAiCorePreset = (p: AiAssistantCorePreset) => {
    setEditingAiCoreId(p.id)
    setAiCoreDraft({
      id: p.id,
      name: p.name,
      provider: p.provider,
      endpoint: p.endpoint,
      apiKey: String(p.apiKey || ''),
      model: p.model,
    })
    setAiCoreTestMsg('')
  }

  const saveAiCoreDraft = () => {
    if (!editingAiCoreId) return
    if (!aiCoreDraft.name.trim()) {
      setAiCoreTestMsg('请填写名称。')
      return
    }
    const next: AiAssistantCorePreset = {
      id: editingAiCoreId,
      name: aiCoreDraft.name.trim(),
      provider: aiCoreDraft.provider === 'cloud' ? 'cloud' : 'ollama',
      endpoint: aiCoreDraft.endpoint.trim(),
      apiKey: String(aiCoreDraft.apiKey || ''),
      model: aiCoreDraft.model.trim(),
    }
    const merged = upsertAiAssistantCorePreset(next)
    setAiCorePresets(merged)
    setAiCoreTestMsg('已保存。')
  }

  const testAiCorePreset = async (p: AiAssistantCorePreset) => {
    const endpoint = String(p.endpoint || '').trim()
    if (!endpoint) {
      setAiCoreTestMsg('请先填写 endpoint。')
      return
    }
    setAiCoreTestMsg('测试中…')
    try {
      const base = normalizeOpenAICompatibleBaseUrl(endpoint)
      const url = `${base}/v1/models`
      const res = await fetch(url, {
        headers: p.provider === 'cloud' && p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
      })
      if (!res.ok) {
        setAiCoreTestMsg(`测试失败：HTTP ${res.status}`)
        return
      }
      setAiCoreTestMsg('测试成功：可访问 /v1/models')
    } catch (e) {
      setAiCoreTestMsg(`测试失败：${String((e as any)?.message || e)}`)
    }
  }

  const applyAiCorePreset = (p: AiAssistantCorePreset) => {
    onAiAssistantConfigChange({
      provider: p.provider,
      endpoint: p.endpoint,
      apiKey: String(p.apiKey || ''),
      model: p.model,
    })
  }

  const startNewTtsPreset = () => {
    const id = crypto.randomUUID()
    setEditingTtsId(id)
    setTtsDraft({
      id,
      name: '新 TTS',
      endpoint: 'http://127.0.0.1:7860/',
      apiKey: '',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
    })
    setTtsTestMsg('')
  }

  const startEditTtsPreset = (p: TtsPreset) => {
    setEditingTtsId(p.id)
    setTtsDraft({
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      apiKey: String(p.apiKey || ''),
      model: p.model,
      voice: p.voice,
    })
    setTtsTestMsg('')
  }

  const saveTtsDraft = () => {
    if (!editingTtsId) return
    if (!ttsDraft.name.trim()) {
      setTtsTestMsg('请填写名称。')
      return
    }
    const next: TtsPreset = {
      id: editingTtsId,
      name: ttsDraft.name.trim(),
      endpoint: ttsDraft.endpoint.trim(),
      apiKey: String(ttsDraft.apiKey || ''),
      model: ttsDraft.model.trim(),
      voice: ttsDraft.voice.trim(),
    }
    const merged = upsertTtsPreset(next)
    setTtsPresets(merged)
    setTtsTestMsg('已保存。')
  }

  const isLikelyGradio = (raw: string): boolean => {
    const lower = String(raw || '').trim().toLowerCase()
    return lower.includes('/gradio_api') || lower.endsWith(':7860') || lower.endsWith(':7860/')
  }

  const normalizeBaseUrl = (raw: string): string => String(raw || '').trim().replace(/\/+$/, '')

  const testTtsPreset = async (p: TtsPreset) => {
    const endpoint = String(p.endpoint || '').trim()
    if (!endpoint) {
      setTtsTestMsg('请先填写 TTS endpoint。')
      return
    }
    setTtsTestMsg('测试中…')
    try {
      if (isLikelyGradio(endpoint)) {
        const base = normalizeBaseUrl(endpoint)
        const res = await fetch(`${base}/gradio_api/info`)
        if (!res.ok) {
          setTtsTestMsg(`测试失败：HTTP ${res.status}`)
          return
        }
        setTtsTestMsg('测试成功：Gradio 接口可访问')
        return
      }
      if (isDashScopeCompatibleModeMisusedForTts(endpoint)) {
        setTtsTestMsg(
          '不能将百炼「compatible-mode」用作 TTS：它只对接聊天等接口，没有 /v1/audio/speech。请把 endpoint 改成 qwen-tts-multimodal（或完整 multimodal 地址），模型如 qwen3-tts-flash，音色如 Cherry。',
        )
        return
      }
      if (isQwenTtsMultimodalEndpoint(endpoint)) {
        const genUrl = normalizeQwenTtsMultimodalUrl(endpoint)
        if (!String(p.model || '').trim()) {
          setTtsTestMsg('千问 TTS：请填写模型名（如 qwen3-tts-vd-2026-01-26）。')
          return
        }
        if (!String(p.voice || '').trim()) {
          setTtsTestMsg('千问 TTS：请填写 voice（声音设计生成的音色名）。')
          return
        }
        if (!String(p.apiKey || '').trim()) {
          setTtsTestMsg('千问 TTS：请填写 API Key。')
          return
        }
        const res = await fetchOpenAICompat(genUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${String(p.apiKey).trim()}`,
          },
          json: {
            model: String(p.model).trim(),
            input: {
              text: '连通性测试。',
              voice: String(p.voice).trim(),
              language_type: 'Chinese',
            },
          },
        })
        if (!res.ok) {
          setTtsTestMsg(`千问 TTS 测试失败：HTTP ${res.status}`)
          return
        }
        const data = (await res.json()) as QwenTtsMultimodalResponse
        if (data.code) {
          setTtsTestMsg(`千问 TTS 测试失败：${data.code} ${data.message || ''}`)
          return
        }
        if (data.status_code != null && data.status_code !== 200) {
          setTtsTestMsg(`千问 TTS 测试失败：${data.status_code} ${data.message || ''}`)
          return
        }
        if (!data.output?.audio?.url && !data.output?.audio?.data) {
          setTtsTestMsg('千问 TTS 测试失败：响应中无音频')
          return
        }
        setTtsTestMsg('千问 TTS 测试成功：已合成短句（可再试助手「测试 TTS 播报」）')
        return
      }
      // 与真实播报一致：经 fetchOpenAICompat（浏览器跨域时走认证服务的 /proxy/openai），避免「直连 /v1/models 成功但 /v1/audio/speech 走代理失败」的假阳性。
      const base = normalizeOpenAICompatibleBaseUrl(endpoint)
      const url = `${base}/v1/models`
      const res = await fetchOpenAICompat(url, {
        method: 'GET',
        headers: {
          ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
        },
      })
      if (!res.ok) {
        setTtsTestMsg(`测试失败：HTTP ${res.status}`)
        return
      }
      setTtsTestMsg('测试成功：连接正常（已通过 /v1/models 鉴权检查）')
    } catch (e) {
      setTtsTestMsg(`测试失败：${String((e as any)?.message || e)}`)
    }
  }

  const runBailianVoiceCloneFromUpload = useCallback(async () => {
    const dataUrl = aiAssistantConfig.ttsCloneAudioDataUrl.trim()
    const apiKey = aiAssistantConfig.ttsApiKey.trim()
    if (!dataUrl) {
      window.alert('请先上传参考音频。')
      return
    }
    if (!apiKey) {
      window.alert('请填写 TTS API Key（与千问合成共用百炼 Key）。可在上方 TTS 预设中填写并点「使用」同步到助手。')
      return
    }
    let target = aiAssistantConfig.ttsModel.trim()
    if (!isQwenVcSynthesisModel(target)) {
      const ok = window.confirm(
        `当前 TTS 模型不是 VC 系列（复刻要求 target_model 为 qwen3-tts-vc*）。将使用 ${QWEN_VC_DEFAULT_TARGET_MODEL} 进行复刻，并写入该模型以便后续合成一致。继续？`,
      )
      if (!ok) return
      target = QWEN_VC_DEFAULT_TARGET_MODEL
    }
    const preferred = sanitizeQwenVoicePreferredName(
      aiAssistantConfig.ttsCloneAudioName || `v_${Date.now().toString(36)}`,
    )
    setBailianCloneBusy(true)
    try {
      const { voice, targetModel } = await enrollQwenVoiceCloneWithBailian({
        apiKey,
        targetModel: target,
        preferredName: preferred,
        audioDataUrl: dataUrl,
      })
      const ep = aiAssistantConfig.ttsEndpoint.trim()
      onAiAssistantConfigChange({
        ttsVoice: voice,
        ttsModel: targetModel,
        ttsEndpoint: ep && isQwenTtsMultimodalEndpoint(ep) ? ep : 'qwen-tts-multimodal',
      })
      window.alert(`复刻成功。\n\n已写入音色（voice）：\n${voice}\n\n可按需保存助手配置。`)
    } catch (e) {
      window.alert(String((e as Error)?.message || e || '复刻失败'))
    } finally {
      setBailianCloneBusy(false)
    }
  }, [aiAssistantConfig, onAiAssistantConfigChange])

  const applyTtsPreset = (p: TtsPreset) => {
    onAiAssistantConfigChange({
      ttsEndpoint: p.endpoint,
      ttsApiKey: String(p.apiKey || ''),
      ttsModel: p.model,
      ttsVoice: p.voice,
    })
  }

  const startEditCloudModel = (preset: CloudModelPreset) => {
    setEditingCloudModelId(preset.id)
    setCloudModelDraft({
      name: String(preset.name || ''),
      baseUrl: String(preset.baseUrl || ''),
      apiKey: String(preset.apiKey || ''),
    })
    setCloudModelTestMsg('')
  }

  const startNewCloudModel = () => {
    const id = crypto.randomUUID()
    setEditingCloudModelId(id)
    setCloudModelDraft({ name: '新模型', baseUrl: '', apiKey: '' })
    setCloudModelTestMsg('')
  }

  const saveCloudModelDraft = () => {
    if (!editingCloudModelId) return
    if (!activeKind) return
    if (!cloudModelDraft.apiKey.trim()) {
      setCloudModelTestMsg('请填写 API Key（必填）。')
      return
    }
    const next: CloudModelPreset = {
      id: editingCloudModelId,
      name: cloudModelDraft.name.trim() || '未命名模型',
      baseUrl: cloudModelDraft.baseUrl.trim(),
      apiKey: cloudModelDraft.apiKey,
    }
    const merged = cloudModelPresets.some((p) => p.id === next.id)
      ? cloudModelPresets.map((p) => (p.id === next.id ? next : p))
      : [...cloudModelPresets, next]
    saveCloudModelPresets(merged, activeKind)
    setCloudModelPresets(merged)
    setCloudModelTestMsg('已保存。')
  }

  const applyCloudModelToActiveKind = (preset: CloudModelPreset) => {
    if (!activeKind) return
    onNodeConfigChange(activeKind, {
      cloudModelName: preset.name,
      cloudModelUrl: preset.baseUrl,
      cloudApiKey: String(preset.apiKey || ''),
    })
  }

  const testCloudModelPreset = async (preset: CloudModelPreset) => {
    const baseUrl = normalizeOpenAICompatibleBaseUrl(preset.baseUrl || '')
    if (!baseUrl) {
      setCloudModelTestMsg('请先填写模型地址。')
      return
    }
    if (!String(preset.apiKey || '').trim()) {
      setCloudModelTestMsg('请先填写 API Key（必填）。')
      return
    }
    setCloudModelTestMsg('测试中…')
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${String(preset.apiKey || '').trim()}`,
        },
      })
      if (!res.ok) {
        setCloudModelTestMsg(`测试失败：HTTP ${res.status}`)
        return
      }
      setCloudModelTestMsg('测试成功：可访问 /v1/models')
    } catch (err) {
      const msg = String((err as any)?.message || err)
      if (/Failed to fetch/i.test(msg)) {
        setCloudModelTestMsg(
          '测试失败：Failed to fetch（常见原因：地址填的是控制台网页而不是 API endpoint；或网络/DNS/证书问题；或服务不支持 OpenAI 兼容的 /v1/models）。',
        )
        return
      }
      setCloudModelTestMsg(`测试失败：${msg}`)
    }
  }

  /**
   * 判断是否为可导入的 JSON 工作流文件。
   */
  const isWorkflowJsonFile = (file: File) => {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.json')) return true
    if (file.type === 'application/json' || file.type === 'text/json') return true
    return false
  }

  /**
   * 将单条工作流写入配置并立即落盘到列表（需同步刷状态，避免连续导入时互相覆盖）。
   */
  const commitWorkflowJson = (kind: StudioNodeKind, workflowName: string, workflowJsonText: string) => {
    flushSync(() => {
      onNodeConfigChange(kind, { workflowJsonText, workflowName })
    })
    flushSync(() => {
      onSaveNodeWorkflow(kind, workflowName)
    })
  }

  /**
   * 一次导入多个工作流 JSON（拖拽多文件或多选文件）。
   */
  const importWorkflowFromFiles = async (list: FileList | File[], kind: StudioNodeKind) => {
    const files = Array.from(list).filter(isWorkflowJsonFile)
    if (!files.length) {
      window.alert('未找到可用的 JSON 文件（需 .json 后缀或 JSON MIME）')
      return
    }
    for (const file of files) {
      const text = await file.text()
      const fileName = file.name.replace(/\.json$/i, '')
      commitWorkflowJson(kind, fileName, text)
    }
  }

  /**
   * 打开弹窗内参数子页面。
   */
  const openInlineEditor = (
    kind: StudioNodeKind,
    workflowId: string,
    workflowName: string,
    workflowJsonText: string,
    resultNodeId: string,
    resultFieldPath: string,
  ) => {
    setEditingWorkflow({
      kind,
      workflowId,
      workflowName,
      workflowJsonText,
      resultNodeId,
      resultFieldPath,
    })
  }

  const toCombo = (event: KeyboardEvent): string | null => {
    const rawKey = event.key
    const modOnly = ['Control', 'Shift', 'Alt', 'Meta'].includes(rawKey)
    if (modOnly) {
      return null
    }
    const key =
      rawKey === ' '
        ? 'Space'
        : rawKey.length === 1
          ? rawKey.toUpperCase()
          : rawKey
    const combo = [
      event.ctrlKey || event.metaKey ? 'Ctrl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      key,
    ]
      .filter(Boolean)
      .join('+')
    return combo || null
  }

  useEffect(() => {
    if (!bindingCommand) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const combo = toCombo(event)
      if (!combo) return
      onShortcutBindingChange(bindingCommand, combo)
      setBindingCommand(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindingCommand, onShortcutBindingChange])

  useEffect(() => {
    if (nodeSubTab !== 'workflow') {
      setEditingWorkflow(null)
    }
  }, [nodeSubTab, activeTab])

  useEffect(() => {
    if (executionMode !== 'official') return
    void onRefreshOfficialTemplates()
  }, [executionMode, onRefreshOfficialTemplates])

  useEffect(() => {
    if (activeTab !== 'local-storage') return
    void (async () => {
      const base = loadLocalDiskPathsSettings()
      setDiskPaths(base)
      const flowidDir = await loadBrowserFolderHandle('flowidProjectJsonPath')
      setBrowserProjectBound(Boolean(flowidDir))
      if (isElectronDesktop) return
      const next: LocalDiskPathsSettings = { ...base }
      let changed = false
      for (const slot of ['inputPath', 'outputPath', 'workflowPath'] as Array<
        Exclude<BrowserFolderSlot, 'flowidProjectJsonPath'>
      >) {
        const dh = await loadBrowserFolderHandle(slot)
        const leafDir = LOCAL_PATH_DIR_NAME_MAP[slot]
        if (dh) {
          const normalized = String(next[slot] || '')
          const expectedTail = `/${dh.name}/${leafDir}`
          if (!normalized || !normalized.endsWith(expectedTail)) {
            next[slot] = expectedTail
            changed = true
          }
        }
      }
      if (flowidDir) {
        const expected = `/${flowidDir.name}`
        if (next.flowidProjectJsonPath !== expected) {
          next.flowidProjectJsonPath = expected
          changed = true
        }
      }
      if (changed) {
        setDiskPaths(next)
        saveLocalDiskPathsSettings(next)
      }
    })()
  }, [activeTab, isElectronDesktop])

  /**
   * 选择「输入 / 输出 / 工作流」目录。
   * - 桌面版：支持只选根目录，自动创建并使用 `input/output/workflow` 子目录；
   * - 网页版：在目录句柄中自动创建对应子目录并保存句柄，界面显示为“路径样式”。
   */
  const pickPathDirectory = async (field: 'inputPath' | 'outputPath' | 'workflowPath') => {
    const leafDir = LOCAL_PATH_DIR_NAME_MAP[field]
    if (isElectronDesktop) {
      const desk = window.flowidDesktop
      if (!desk?.pickDirectory) return
      const res = await desk.pickDirectory({
        defaultPath: diskPaths[field] || diskPaths.workflowPath || diskPaths.inputPath,
      })
      if (!res.ok) {
        window.alert(res.error || '选择失败')
        return
      }
      if (res.canceled || !res.path) return
      const selectedPath = res.path
      let finalPath = selectedPath
      if (looksLikeEndsWithDir(selectedPath, leafDir)) {
        if (desk.ensureDirectory) {
          const ensured = await desk.ensureDirectory(selectedPath)
          if (!ensured.ok) {
            window.alert(ensured.error || '创建目录失败')
            return
          }
          finalPath = ensured.path || selectedPath
        }
      } else if (desk.ensureSubdirectory) {
        const ensured = await desk.ensureSubdirectory(selectedPath, leafDir)
        if (!ensured.ok || !ensured.path) {
          window.alert(ensured.error || `创建 ${leafDir} 目录失败`)
          return
        }
        finalPath = ensured.path
      } else {
        finalPath = `${selectedPath.replace(/[\\/]+$/, '')}\\${leafDir}`
      }
      await clearBrowserFolderHandle(field)
      setDiskPaths((prev) => ({ ...prev, [field]: finalPath }))
      // 与网页端「选文件夹即落库」一致：立刻写入 localStorage，避免镜像仍读到旧的空 inputPath。
      saveLocalDiskPathsSettings({ [field]: finalPath })
      return
    }
    if (!browserSupportsDirectoryPicker()) {
      window.alert('当前浏览器不支持选择文件夹，请使用 Chrome / Edge 新版，或仅在下方输入框填写备忘路径。')
      return
    }
    try {
      const picker = window.showDirectoryPicker
      if (!picker) {
        window.alert('当前浏览器不支持选择文件夹。')
        return
      }
      const pickedRoot = await picker.call(window, { mode: 'readwrite' })
      const targetDir = await pickedRoot.getDirectoryHandle(leafDir, { create: true })
      await saveBrowserFolderHandle(field, targetDir)
      const label = `/${pickedRoot.name}/${leafDir}`
      setDiskPaths((prev) => ({ ...prev, [field]: label }))
      saveLocalDiskPathsSettings({ [field]: label })
    } catch (e) {
      const err = e as { name?: string }
      if (err?.name === 'AbortError') return
      window.alert(`选择文件夹失败：${String((e as Error)?.message || e)}`)
    }
  }

  /**
   * 选择 Flowid 工程目录（桌面端真实路径 / 网页端目录句柄）。
   */
  const pickPathFlowidProjectJson = async () => {
    if (isElectronDesktop) {
      const desk = window.flowidDesktop
      if (!desk?.pickDirectory) {
        window.alert('当前桌面端能力异常，请重启 Flowid 桌面进程后再试。')
        return
      }
      const res = await desk.pickDirectory({
        defaultPath: String(diskPaths.flowidProjectJsonPath || '').trim() || diskPaths.workflowPath,
      })
      if (!res.ok) {
        window.alert(res.error || '选择失败')
        return
      }
      if (res.canceled || !res.path) return
      if (desk.ensureDirectory) {
        const ensured = await desk.ensureDirectory(res.path)
        if (!ensured.ok || !ensured.path) {
          window.alert(ensured.error || '创建工程目录失败')
          return
        }
        await unbindFlowidProjectJsonBrowser()
        setBrowserProjectBound(false)
        setDiskPaths((prev) => ({ ...prev, flowidProjectJsonPath: ensured.path! }))
        saveLocalDiskPathsSettings({ flowidProjectJsonPath: ensured.path! })
        return
      }
      await unbindFlowidProjectJsonBrowser()
      setBrowserProjectBound(false)
      setDiskPaths((prev) => ({ ...prev, flowidProjectJsonPath: res.path! }))
      saveLocalDiskPathsSettings({ flowidProjectJsonPath: res.path! })
      return
    }
    if (!browserSupportsDirectoryPicker()) {
      window.alert('当前浏览器不支持选择工程目录，请使用 Chrome / Edge。')
      return
    }
    try {
      const picker = window.showDirectoryPicker
      if (!picker) {
        window.alert('当前浏览器不支持选择工程目录。')
        return
      }
      const dir = await picker.call(window, { mode: 'readwrite' })
      await saveBrowserFolderHandle('flowidProjectJsonPath', dir)
      const display = `/${dir.name}`
      setBrowserProjectBound(true)
      setDiskPaths((prev) => ({ ...prev, flowidProjectJsonPath: display }))
      saveLocalDiskPathsSettings({ flowidProjectJsonPath: display })
      window.alert('已绑定工程目录。保存时会写入当前文件与项目文件。')
    } catch (e) {
      const err = e as { name?: string }
      if (err?.name === 'AbortError') return
      window.alert(`选择工程目录失败：${String((e as Error)?.message || e)}`)
    }
  }

  /**
   * 清除单行路径（网页目录会同步删除 IndexedDB 句柄；工程目录会解除浏览器绑定）。
   */
  const clearPathField = async (field: 'inputPath' | 'outputPath' | 'workflowPath' | 'flowidProjectJsonPath') => {
    if (field === 'flowidProjectJsonPath') {
      await unbindFlowidProjectJsonBrowser()
      setBrowserProjectBound(false)
      setDiskPaths((p) => ({ ...p, flowidProjectJsonPath: '' }))
      saveLocalDiskPathsSettings({ flowidProjectJsonPath: '' })
      return
    }
    if (!isElectronDesktop) {
      await clearBrowserFolderHandle(field)
    }
    setDiskPaths((p) => ({ ...p, [field]: '' }))
    saveLocalDiskPathsSettings({ [field]: '' })
  }

  /**
   * 将路径配置写入 localStorage。
   */
  const commitDiskPaths = () => {
    saveLocalDiskPathsSettings(diskPaths)
    window.alert('本地路径已保存。工程将在自动保存时同步写入「Flowid 工程目录」（若已填写）。')
  }

  /**
   * 读取上传的克隆参考音频并存为 Data URL，供 TTS 直接使用。
   */
  const onAiCloneAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!String(file.type || '').startsWith('audio/')) {
      window.alert('请选择音频文件（audio/*）')
      event.currentTarget.value = ''
      return
    }
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    onAiAssistantConfigChange({
      ttsCloneAudioDataUrl: dataUrl,
      ttsCloneAudioName: file.name,
    })
    event.currentTarget.value = ''
  }

  return (
    <motion.section
      data-studio-settings-modal="1"
      role="dialog"
      aria-modal="true"
      aria-label="工作流设置"
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex w-full max-w-5xl h-[min(80vh,calc(100vh-48px))] bg-[#0c0c0e] border border-white/10 rounded-3xl overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.6)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="w-64 border-r border-white/5 flex flex-col pt-8 bg-[#080809] shrink-0 min-h-0">
        <div className="text-[13px] font-black uppercase tracking-[0.4em] text-white/50 mb-6 px-8">系统配置</div>
        <nav className="flex-1 space-y-1.5 px-3 overflow-y-auto custom-scrollbar min-h-0 pb-6">
          {SETTINGS_SIDEBAR.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-[14px] font-black uppercase tracking-widest transition-all text-left group ${
                  isActive
                    ? 'bg-orange-600/10 text-orange-500 border border-orange-600/20'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon
                  size={18}
                  strokeWidth={2}
                  className={
                    isActive ? 'text-orange-500' : 'text-white/40 group-hover:text-white/60'
                  }
                />
                {item.label}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0c0c0e]">
        <header className="px-8 py-5 border-b border-white/5 flex items-center justify-between bg-[#0c0c0e]/50 backdrop-blur-xl shrink-0">
          <h2 className="m-0 text-[15px] font-black uppercase tracking-[0.3em] text-white/90">
            {settingsMainTitle(activeTab)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0 p-8 custom-scrollbar">
          <div className="workflow-settings-panel workflow-settings-panel--flowid space-y-6">
          {activeTab === 'comfy' ? (
            <>
              <div className="bg-[#111114] border border-white/5 rounded-2xl p-6 space-y-5">
                <div className="text-[14px] font-black text-white/50 uppercase tracking-widest">执行模式</div>
                <div className="flex flex-wrap gap-8">
                  <label className="flex cursor-pointer items-center gap-3 group">
                    <input
                      type="radio"
                      name="workflow-execution-mode"
                      className="sr-only"
                      checked={executionMode === 'custom'}
                      onChange={() => onExecutionModeChange('custom')}
                    />
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        executionMode === 'custom'
                          ? 'border-orange-600'
                          : 'border-white/20 group-hover:border-white/40'
                      }`}
                    >
                      {executionMode === 'custom' ? (
                        <div className="aspect-square h-2.5 w-2.5 rounded-full bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
                      ) : null}
                    </div>
                    <span className="text-[14px] font-black uppercase tracking-wide text-white/70 transition-colors group-hover:text-white">
                      自定义工作流 (现有模式)
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 group">
                    <input
                      type="radio"
                      name="workflow-execution-mode"
                      className="sr-only"
                      checked={executionMode === 'official'}
                      onChange={() => onExecutionModeChange('official')}
                    />
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        executionMode === 'official'
                          ? 'border-orange-600'
                          : 'border-white/20 group-hover:border-white/40'
                      }`}
                    >
                      {executionMode === 'official' ? (
                        <div className="aspect-square h-2.5 w-2.5 rounded-full bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
                      ) : null}
                    </div>
                    <span className="text-[14px] font-black uppercase tracking-wide text-white/70 transition-colors group-hover:text-white">
                      官方模板 (后端托管)
                    </span>
                  </label>
                </div>
              </div>

              <div className="bg-[#111114] border border-white/5 rounded-2xl p-6 space-y-5">
                <div className="text-[14px] font-black text-white/50 uppercase tracking-widest">执行环境</div>
                <div className="flex flex-wrap gap-8">
                  <label className="flex cursor-pointer items-center gap-3 group">
                    <input
                      type="radio"
                      name="workflow-provider"
                      className="sr-only"
                      checked={executionProvider === 'local'}
                      onChange={() => onExecutionProviderChange('local')}
                    />
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        executionProvider === 'local'
                          ? 'border-orange-600'
                          : 'border-white/20 group-hover:border-white/40'
                      }`}
                    >
                      {executionProvider === 'local' ? (
                        <div className="aspect-square h-2.5 w-2.5 rounded-full bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
                      ) : null}
                    </div>
                    <span className="text-[14px] font-black uppercase tracking-wide text-white/70 transition-colors group-hover:text-white">
                      本地 ComfyUI
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 group">
                    <input
                      type="radio"
                      name="workflow-provider"
                      className="sr-only"
                      checked={executionProvider === 'cloud'}
                      onChange={() => onExecutionProviderChange('cloud')}
                    />
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        executionProvider === 'cloud'
                          ? 'border-orange-600'
                          : 'border-white/20 group-hover:border-white/40'
                      }`}
                    >
                      {executionProvider === 'cloud' ? (
                        <div className="aspect-square h-2.5 w-2.5 rounded-full bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.6)]" />
                      ) : null}
                    </div>
                    <span className="text-[14px] font-black uppercase tracking-wide text-white/70 transition-colors group-hover:text-white">
                      云端 ComfyUI
                    </span>
                  </label>
                </div>
              </div>

              <div className="bg-[#111114] border border-white/5 rounded-2xl p-6 space-y-4">
                <div className="text-[14px] font-black text-white/50 uppercase tracking-widest">采样随机性</div>
                <label className="flex cursor-pointer items-start gap-4 group">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-orange-600 rounded"
                    checked={randomizeKsamplerSeedsOnRun}
                    onChange={(e) => onRandomizeKsamplerSeedsOnRunChange(e.target.checked)}
                  />
                  <div className="min-w-0 space-y-1.5">
                    <span className="text-[16px] font-black tracking-wide text-white/80 transition-colors group-hover:text-white">
                      每次执行前随机化 KSampler 的 seed（类似 Comfy 选 randomize；避免 JSON 里旧 seed 把画风锁死）
                    </span>
                    <p className="m-0 max-w-2xl text-[14px] leading-relaxed text-white/40">
                      关闭后：严格使用工作流 JSON 里保存的 seed，便于同一参数复现。ComfyUI
                      无法自动判断参考图是「动漫」还是「写实」，随机 seed 只增加多样性，不替代提示词与模型。
                    </p>
                  </div>
                </label>
              </div>

              {executionProvider === 'local' ? (
                <div className="bg-[#111114] border border-white/5 rounded-2xl p-6 space-y-5">
                  <div className="text-[14px] font-black text-white/50 uppercase tracking-widest">本地节点</div>
                  <label className="mb-1 flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={localConfig.enabled}
                      onChange={(e) => onProviderConfigChange('local', { enabled: e.target.checked })}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/70">
                      启用本地执行
                    </span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-white/5 bg-black/40 p-3.5 font-mono text-[15px] text-white/60 outline-none focus:border-white/20"
                    value={localConfig.baseUrl}
                    placeholder="http://127.0.0.1:8188"
                    onChange={(e) => onProviderConfigChange('local', { baseUrl: e.target.value })}
                  />
                  <input
                    className="w-full rounded-xl border border-white/5 bg-black/40 p-3.5 font-mono text-[15px] text-white/60 outline-none focus:border-white/20"
                    type="number"
                    min={10}
                    value={localConfig.timeoutSec}
                    placeholder="超时时间（秒）"
                    onChange={(e) =>
                      onProviderConfigChange('local', {
                        timeoutSec: Number(e.target.value) || 120,
                      })
                    }
                  />
                  <button
                    type="button"
                    className="w-full rounded-xl border border-white/5 bg-[#1e1e22] py-4 text-[15px] font-black uppercase tracking-[0.3em] text-white/40 transition-all hover:bg-orange-600 hover:text-white"
                    onClick={() => void onTestProviderConnection('local')}
                  >
                    测试连接
                  </button>
                </div>
              ) : (
                <div className="bg-[#111114] border border-white/5 rounded-2xl p-6 space-y-5">
                  <div className="text-[14px] font-black text-white/50 uppercase tracking-widest">云端节点</div>
                  <div className="mb-2 flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={cloudConfig.enabled}
                      onChange={(e) => onProviderConfigChange('cloud', { enabled: e.target.checked })}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/70">
                      启用云端执行
                    </span>
                  </div>
                  {cloudEndpoints.map((endpoint) => (
                    <div className="flex flex-wrap gap-3" key={endpoint.id}>
                      <input
                        className="w-36 shrink-0 rounded-xl border border-white/5 bg-black/40 p-3 font-mono text-[15px] text-white/60 outline-none focus:border-white/20"
                        value={endpoint.name}
                        placeholder="云端-1"
                        onChange={(e) =>
                          onUpdateCloudEndpoint(endpoint.id, { name: e.target.value })
                        }
                      />
                      <div className="relative flex min-w-[200px] flex-1 items-center">
                        <input
                          className="w-full rounded-xl border border-white/5 bg-black/40 p-3 pr-32 font-mono text-[15px] text-white/60 outline-none focus:border-white/20"
                          value={endpoint.baseUrl}
                          placeholder="https://your-comfy.example.com"
                          onChange={(e) =>
                            onUpdateCloudEndpoint(endpoint.id, { baseUrl: e.target.value })
                          }
                        />
                        <div className="absolute right-3 flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 accent-orange-600 rounded"
                              checked={endpoint.enabled}
                              onChange={(e) =>
                                onUpdateCloudEndpoint(endpoint.id, { enabled: e.target.checked })
                              }
                            />
                            <span className="text-[12px] font-black uppercase text-white/30">开启</span>
                          </label>
                          <button
                            type="button"
                            className="rounded border border-white/5 bg-white/5 px-2 py-1 text-[12px] font-black uppercase text-white/30 transition-all hover:bg-white/10"
                            onClick={() => onRemoveCloudEndpoint(endpoint.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      className="rounded-xl border border-white/5 bg-white/5 py-3 text-[13px] font-black uppercase tracking-[0.2em] text-white/50 transition-all hover:bg-white/10"
                      onClick={onAddCloudEndpoint}
                    >
                      新增云端
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-white/5 bg-[#1e1e22] py-3 text-[13px] font-black uppercase tracking-[0.2em] text-white/50 transition-all hover:bg-white/5"
                      onClick={() => void onTestProviderConnection('cloud')}
                    >
                      测试连接
                    </button>
                  </div>
                </div>
              )}
              {connectionTestMessage && connectionTestMessage.startsWith(executionProvider === 'local' ? '本地' : '云端') ? (
                <p className="m-0 text-[14px] leading-relaxed text-white/40">{connectionTestMessage}</p>
              ) : null}
            </>
          ) : null}

          {activeKind && activeNodeConfig ? (
            <div className="space-y-5">
              <div className="flex items-center gap-1 rounded-full border border-white/5 bg-[#111114] p-1">
                <button
                  type="button"
                  onClick={() => setNodeSubTab('workflow')}
                  className={`flex-1 rounded-full py-3 text-[13px] font-black uppercase tracking-widest transition-all ${
                    nodeSubTab === 'workflow'
                      ? 'border border-white/5 bg-white/5 text-white/90 shadow-xl'
                      : 'border border-transparent text-white/20 hover:text-white/40'
                  }`}
                >
                  {KIND_LABELS[activeKind]} 工作流
                </button>
                <button
                  type="button"
                  onClick={() => setNodeSubTab('cloud-model')}
                  className={`flex-1 rounded-full py-3 text-[13px] font-black uppercase tracking-widest transition-all ${
                    nodeSubTab === 'cloud-model'
                      ? 'border border-white/5 bg-white/5 text-white/90 shadow-xl'
                      : 'border border-transparent text-white/20 hover:text-white/40'
                  }`}
                >
                  云端配置
                </button>
              </div>

              {nodeSubTab === 'workflow' ? (
                <div
                  className={`${WF_CARD} space-y-6 ${editingWorkflow && executionMode === 'custom' ? 'overflow-hidden p-0' : 'p-8'}`}
                >
                  {executionMode === 'official' ? (
                    <div className="space-y-4">
                      <div className={WF_SECTION_TITLE}>官方模板绑定</div>
                      <select
                        className={WF_SELECT}
                        value={activeNodeConfig.officialTemplateId || ''}
                        onChange={(e) =>
                          onNodeConfigChange(activeKind, {
                            officialTemplateId: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">请选择官方模板</option>
                        {officialTemplates.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} v{item.version}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="wf-json-import-pill"
                        onClick={() => void onRefreshOfficialTemplates()}
                      >
                        刷新模板列表
                      </button>
                    </div>
                  ) : null}
                  {executionMode === 'custom' ? (
                    <>
                      {editingWorkflow ? (
                        <div className="min-h-[280px] p-4 sm:p-6">
                          <WorkflowVisualEditorInline
                            workflowName={editingWorkflow.workflowName}
                            workflowJsonText={editingWorkflow.workflowJsonText}
                            resultNodeId={editingWorkflow.resultNodeId}
                            resultFieldPath={editingWorkflow.resultFieldPath}
                            comfyBaseUrl={activeComfyBaseUrl}
                            comfyApiKey={activeComfyApiKey}
                            onBack={() => setEditingWorkflow(null)}
                            onSave={({
                              workflowJsonText: nextWorkflowJsonText,
                              resultNodeId,
                              resultFieldPath,
                            }) => {
                              onUpdateNodeWorkflowEntry(
                                editingWorkflow.kind,
                                editingWorkflow.workflowId,
                                {
                                  jsonText: nextWorkflowJsonText,
                                  resultNodeId,
                                  resultFieldPath,
                                },
                              )
                              onNodeConfigChange(editingWorkflow.kind, {
                                workflowName: editingWorkflow.workflowName,
                                workflowJsonText: nextWorkflowJsonText,
                                selectedWorkflowId: editingWorkflow.workflowId,
                              })
                            }}
                          />
                        </div>
                      ) : null}
                      {!editingWorkflow ? (
                        <>
                          <div className={`${WF_SECTION_TITLE} mb-2`}>
                            {KIND_LABELS[activeKind]} JSON 导入
                          </div>
                          <div className="flex flex-col gap-1">
                            <div
                              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/5 bg-black/20 p-10 text-center transition-all hover:border-white/10"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={async (event) => {
                                event.preventDefault()
                                if (!event.dataTransfer.files?.length) return
                                await importWorkflowFromFiles(event.dataTransfer.files, activeKind)
                              }}
                            >
                              <div className="mb-4 text-[16px] font-black uppercase tracking-widest text-white/50">
                                拖拽 JSON 文件到此处
                              </div>
                              <button
                                type="button"
                                className="wf-json-import-pill"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  fileInputRef.current?.click()
                                }}
                              >
                                选择文件
                              </button>
                              <input
                                ref={fileInputRef}
                                className="visually-hidden"
                                type="file"
                                accept=".json,application/json"
                                multiple
                                onChange={async (event) => {
                                  const list = event.target.files
                                  if (!list?.length) return
                                  await importWorkflowFromFiles(list, activeKind)
                                  event.currentTarget.value = ''
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              className="wf-json-import-pill wf-json-import-pill--wide"
                              disabled={!activeNodeConfig.workflows.length}
                              onClick={() => {
                                if (!activeNodeConfig.workflows.length) return
                                const ok = window.confirm(
                                  `确认清空「${KIND_LABELS[activeKind]}」下全部工作流吗？此操作不可撤销。`,
                                )
                                if (!ok) return
                                onClearNodeWorkflows(activeKind)
                              }}
                            >
                              清空列表
                            </button>
                          </div>
                          <div className="flex flex-col gap-2">
                            {activeNodeConfig.workflows.map((item) => (
                              <div
                                key={item.id}
                                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5"
                              >
                                <button
                                  type="button"
                                  className={`min-w-0 flex-1 basis-[160px] rounded-xl border px-3 py-2 text-left text-[14px] font-black uppercase tracking-wide transition-all ${
                                    activeNodeConfig.selectedWorkflowId === item.id
                                      ? 'border-orange-600/20 bg-orange-600/10 text-orange-500 shadow-none'
                                      : 'border-transparent text-white/50 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/85'
                                  }`}
                                  onClick={() => onSelectNodeWorkflow(activeKind, item.id)}
                                  onDoubleClick={() =>
                                    openInlineEditor(
                                      activeKind,
                                      item.id,
                                      item.name,
                                      item.jsonText,
                                      item.resultNodeId || activeNodeConfig.resultNodeId || '',
                                      item.resultFieldPath || activeNodeConfig.resultFieldPath || '',
                                    )
                                  }
                                  title="双击在当前设置页编辑参数"
                                >
                                  {item.name}
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_COMPACT}
                                  onClick={() =>
                                    openInlineEditor(
                                      activeKind,
                                      item.id,
                                      item.name,
                                      item.jsonText,
                                      item.resultNodeId || activeNodeConfig.resultNodeId || '',
                                      item.resultFieldPath || activeNodeConfig.resultFieldPath || '',
                                    )
                                  }
                                >
                                  参数设置
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_DARK_COMPACT}
                                  onClick={() => onPinNodeWorkflowToTop(activeKind, item.id)}
                                  disabled={activeNodeConfig.workflows[0]?.id === item.id}
                                >
                                  置顶
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_DARK_COMPACT}
                                  onClick={() => onRemoveNodeWorkflow(activeKind, item.id)}
                                >
                                  删除
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {nodeSubTab === 'cloud-model' ? (
                <div className={`${WF_CARD} space-y-6 p-6`}>
                  <div className="border-b border-white/5 pb-4 text-[16px] font-black uppercase tracking-widest text-white/50">
                    云端模型配置
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={startNewCloudModel}>
                      新增模型
                    </button>
                    {cloudModelTestMsg ? (
                      <div className="text-[12px] font-mono text-white/35">{cloudModelTestMsg}</div>
                    ) : null}
                  </div>

                  {editingCloudModelId ? (
                    <div className="relative z-10 pointer-events-auto rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-black uppercase tracking-widest text-white/60">
                          模型设置
                        </div>
                        <button
                          type="button"
                          className={WF_BTN_CAPSULE_MUTED}
                          onClick={() => setEditingCloudModelId(null)}
                        >
                          关闭
                        </button>
                      </div>
                      <input
                        className={WF_INPUT}
                        autoFocus
                        value={cloudModelDraft.name}
                        placeholder="模型名称"
                        onChange={(e) => setCloudModelDraft((p) => ({ ...p, name: e.target.value }))}
                      />
                      <input
                        className={WF_INPUT}
                        value={cloudModelDraft.baseUrl}
                        placeholder="模型 API 地址（OpenAI 兼容，如 https://xxx ）"
                        onChange={(e) => setCloudModelDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                      />
                      <input
                        className={WF_INPUT}
                        type="password"
                        autoComplete="off"
                        value={cloudModelDraft.apiKey}
                        placeholder="API KEY（必填）"
                        onChange={(e) => setCloudModelDraft((p) => ({ ...p, apiKey: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={saveCloudModelDraft}>
                          保存
                        </button>
                        <button
                          type="button"
                          className={WF_BTN_CAPSULE_MUTED}
                          onClick={() =>
                            void testCloudModelPreset({
                              id: editingCloudModelId,
                              name: cloudModelDraft.name,
                              baseUrl: cloudModelDraft.baseUrl,
                              apiKey: cloudModelDraft.apiKey,
                            })
                          }
                        >
                          测试
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {cloudModelPresets.map((m) => {
                      const isActive = String(activeNodeConfig.cloudModelName || '').trim() === m.name.trim()
                      return (
                        <div
                          key={m.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => startEditCloudModel(m)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') startEditCloudModel(m)
                          }}
                          className={`cursor-pointer select-none flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                            isActive ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/5 bg-black/30'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-black uppercase tracking-widest text-white/70">
                              {m.name}
                            </div>
                            <div className="truncate font-mono text-[11px] text-white/30">{m.baseUrl || '-'}</div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              className={WF_BTN_CAPSULE_COMPACT}
                              onClick={(e) => {
                                e.stopPropagation()
                                applyCloudModelToActiveKind(m)
                              }}
                            >
                              使用
                            </button>
                            <button
                              type="button"
                              className={WF_BTN_CAPSULE_COMPACT}
                              onClick={(e) => {
                                e.stopPropagation()
                                startEditCloudModel(m)
                              }}
                            >
                              设置
                            </button>
                            <button
                              type="button"
                              className={WF_BTN_CAPSULE_DARK_COMPACT}
                              onClick={(e) => {
                                e.stopPropagation()
                                void testCloudModelPreset(m)
                              }}
                            >
                              测试
                            </button>
                            <button
                              type="button"
                              className={WF_BTN_CAPSULE_DARK_COMPACT}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (!window.confirm(`确定删除云端模型「${m.name}」吗？`)) return
                                  if (!activeKind) return
                                  const next = removeCloudModelPreset(m.id, activeKind)
                                setCloudModelPresets(next)
                                if (editingCloudModelId === m.id) setEditingCloudModelId(null)
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'local-storage' ? (
            <div className="space-y-5">
              <div className={`${WF_CARD} space-y-4 p-6`}>
                <div className={`${WF_SECTION_TITLE} border-b border-white/5 pb-4`}>说明</div>
                <p className="m-0 text-[14px] leading-relaxed tracking-wide text-white/20">
                  工程默认在浏览器 localStorage，易被清理且有容量上限。请为「工程目录（flowid）」配置固定存档：桌面版为真实磁盘路径；网页版为
                  Chrome / Edge 绑定的目录，保存时写回、启动时优先加载。
                  <span className="text-white/35"> 桌面版：</span>
                  可直接填磁盘路径（如 <code className="text-white/45">F:\flowid\input</code>）并由壳写入。
                  <span className="text-white/35"> 网页版（Chrome / Edge）：</span>
                  浏览器不能仅凭手填路径写盘；必须在各行点
                  <span className="text-white/35"> 选择文件夹 </span>
                  完成授权。
                  「工作流」在保存/导入时写入 <code className="text-white/45">.json</code>；「输入」会镜像上传图并在{' '}
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-white/50">
                    Ctrl
                  </kbd>
                  +
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-white/50">
                    S
                  </kbd>{' '}
                  保存工程时同步；「输出」镜像生成物（需能拉取 URL）。
                </p>
              </div>

              <div className={`${WF_CARD} overflow-hidden p-2`}>
                <div className="border-b border-white/5 p-6">
                  <div className="text-[15px] font-black uppercase tracking-[0.2em] text-white/70">
                    路径锚点
                  </div>
                </div>
                <div className="space-y-5 p-6" role="group" aria-label="本地存储路径">
                  <p className="m-0 text-[13px] leading-relaxed text-white/25">
                    每行：路径或绑定说明 · 选择 弹出选取器 · 清除 清空本行。
                    {isElectronDesktop
                      ? ' 桌面版：点「选择文件夹」后会立刻保存；手改路径后仍需点「保存路径配置」。'
                      : ' 修改后请点「保存路径配置」。当前为网页版，目录依赖浏览器授权。'}
                  </p>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">输入</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">input</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.inputPath}
                      placeholder={isElectronDesktop ? '例如 D:\\ComfyUI\\input' : '可填写备忘，或点「选择文件夹」'}
                      onChange={(e) => setDiskPaths((p) => ({ ...p, inputPath: e.target.value }))}
                      aria-label="输入目录路径"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          title="选择文件夹"
                          className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                          onClick={() => void pickPathDirectory('inputPath')}
                        >
                          选择
                        </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('inputPath')}
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">输出</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">output</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.outputPath}
                      placeholder={isElectronDesktop ? '例如 D:\\ComfyUI\\output' : '可填写备忘，或点「选择文件夹」'}
                      onChange={(e) => setDiskPaths((p) => ({ ...p, outputPath: e.target.value }))}
                      aria-label="输出目录路径"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          title="选择文件夹"
                          className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                          onClick={() => void pickPathDirectory('outputPath')}
                        >
                          选择
                        </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('outputPath')}
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">工作流</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">workflow</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.workflowPath}
                      placeholder={
                        isElectronDesktop ? '存放 Comfy 工作流 JSON 的文件夹' : '可填写备忘，或点「选择文件夹」'
                      }
                      onChange={(e) => setDiskPaths((p) => ({ ...p, workflowPath: e.target.value }))}
                      aria-label="工作流目录路径"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          title="选择文件夹"
                          className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                          onClick={() => void pickPathDirectory('workflowPath')}
                        >
                          选择
                        </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('workflowPath')}
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">工程目录</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">flowid</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.flowidProjectJsonPath}
                      placeholder={
                        isElectronDesktop ? '例如 D:\\FlowidData\\flowid' : '点右侧选择工程目录（Chrome / Edge）'
                      }
                      onChange={(e) => setDiskPaths((p) => ({ ...p, flowidProjectJsonPath: e.target.value }))}
                      aria-label="Flowid 工程目录路径"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          title="选择文件夹"
                          className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                          onClick={() => void pickPathFlowidProjectJson()}
                        >
                          选择
                        </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('flowidProjectJsonPath')}
                        disabled={!diskPaths.flowidProjectJsonPath.trim() && !browserProjectBound}
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <button type="button" className={WF_SYNC_BTN} onClick={commitDiskPaths}>
                    保存路径配置
                  </button>
                  {!isElectronDesktop ? (
                    <p className="m-0 text-center text-[13px] text-white/30">
                      工程文件状态：{browserProjectBound ? '已绑定' : '未绑定'}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'ai-assistant' ? (
            <div className={`${WF_CARD} space-y-8 p-8`}>
              <div className="text-[16px] font-black uppercase tracking-widest text-white/80">
                AI Core
              </div>
              <p className="m-0 text-[14px] tracking-wide text-white/20">
                自动保存：修改任一字段后立即生效并写入本地配置。云端推荐使用 GPT-4o-mini。
              </p>
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={startNewAiCorePreset}>
                      新增助手模型
                    </button>
                    {aiCoreTestMsg ? (
                      <div className="text-[12px] font-mono text-white/35">{aiCoreTestMsg}</div>
                    ) : null}
                  </div>
                  {editingAiCoreId ? (
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-black uppercase tracking-widest text-white/60">助手模型设置</div>
                        <button type="button" className={WF_BTN_CAPSULE_MUTED} onClick={() => setEditingAiCoreId(null)}>
                          关闭
                        </button>
                      </div>
                      <input
                        className={WF_INPUT}
                        value={aiCoreDraft.name}
                        placeholder="名称"
                        onChange={(e) => setAiCoreDraft((p) => ({ ...p, name: e.target.value }))}
                      />
                      <select
                        className="w-full rounded-xl border border-white/10 bg-black/60 py-3 pl-3.5 pr-10 text-[15px] text-white/90 outline-none"
                        value={aiCoreDraft.provider}
                        onChange={(e) =>
                          setAiCoreDraft((p) => ({
                            ...p,
                            provider: e.target.value === 'cloud' ? 'cloud' : 'ollama',
                          }))
                        }
                      >
                        <option value="ollama">Ollama 本地</option>
                        <option value="cloud">云端模型</option>
                      </select>
                      <input
                        className={WF_INPUT}
                        value={aiCoreDraft.endpoint}
                        placeholder="endpoint（OpenAI 兼容，例如 http://127.0.0.1:11434/v1/chat/completions）"
                        onChange={(e) => setAiCoreDraft((p) => ({ ...p, endpoint: e.target.value }))}
                      />
                      {aiCoreDraft.provider === 'cloud' ? (
                        <input
                          className={WF_INPUT}
                          autoComplete="off"
                          value={String(aiCoreDraft.apiKey || '')}
                          type="password"
                          placeholder="API Key（云端必填）"
                          onChange={(e) => setAiCoreDraft((p) => ({ ...p, apiKey: e.target.value }))}
                        />
                      ) : null}
                      <input
                        className={WF_INPUT}
                        value={aiCoreDraft.model}
                        placeholder="模型名（如 qwen3:14b / gpt-4o-mini）"
                        onChange={(e) => setAiCoreDraft((p) => ({ ...p, model: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={saveAiCoreDraft}>
                          保存
                        </button>
                        <button
                          type="button"
                          className={WF_BTN_CAPSULE_MUTED}
                          onClick={() => void testAiCorePreset(aiCoreDraft)}
                        >
                          测试
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {aiCorePresets.map((p) => {
                      const isActive =
                        aiAssistantConfig.provider === p.provider &&
                        aiAssistantConfig.endpoint.trim() === p.endpoint.trim() &&
                        aiAssistantConfig.model.trim() === p.model.trim()
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                            isActive ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/5 bg-black/30'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-black uppercase tracking-widest text-white/70">
                              {p.name}
                            </div>
                            <div className="truncate font-mono text-[11px] text-white/30">{p.endpoint || '-'}</div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button type="button" className={WF_BTN_CAPSULE_COMPACT} onClick={() => applyAiCorePreset(p)}>
                              使用
                            </button>
                            <button type="button" className={WF_BTN_CAPSULE_COMPACT} onClick={() => startEditAiCorePreset(p)}>
                              设置
                            </button>
                            <button type="button" className={WF_BTN_CAPSULE_DARK_COMPACT} onClick={() => void testAiCorePreset(p)}>
                              测试
                            </button>
                            <button
                              type="button"
                              className={WF_BTN_CAPSULE_DARK_COMPACT}
                              onClick={() => {
                                if (!window.confirm(`确定删除「${p.name}」吗？`)) return
                                setAiCorePresets(removeAiAssistantCorePreset(p.id))
                                if (editingAiCoreId === p.id) setEditingAiCoreId(null)
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-3 border-t border-white/5 pt-6">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={aiAssistantConfig.ttsEnabled}
                      onChange={(e) => onAiAssistantConfigChange({ ttsEnabled: e.target.checked })}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                      自动语音播报 (TTS)
                    </span>
                  </label>
                  {aiAssistantConfig.ttsEnabled ? (
                    <div className="space-y-6">
                      <p className="text-[11px] leading-relaxed text-white/35">
                        若 TTS endpoint 使用阿里云 DashScope 的{' '}
                        <span className="font-mono text-white/45">compatible-mode</span>：该基址通常只支持聊天等接口，不提供
                        OpenAI 的 <span className="font-mono text-white/45">/v1/audio/speech</span>，播报会得到 HTTP 404（与桌面/代理无关）。请换支持
                        Speech API 的服务、本地 Gradio，或百炼语音合成等专用接口。
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={startNewTtsPreset}>
                          新增 TTS
                        </button>
                        {ttsTestMsg ? (
                          <div className="text-[12px] font-mono text-white/35">{ttsTestMsg}</div>
                        ) : null}
                      </div>
                      {editingTtsId ? (
                        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-black uppercase tracking-widest text-white/60">TTS 设置</div>
                            <button type="button" className={WF_BTN_CAPSULE_MUTED} onClick={() => setEditingTtsId(null)}>
                              关闭
                            </button>
                          </div>
                          <input
                            className={WF_INPUT}
                            value={ttsDraft.name}
                            placeholder="名称"
                            onChange={(e) => setTtsDraft((p) => ({ ...p, name: e.target.value }))}
                          />
                          <input
                            className={WF_INPUT}
                            value={ttsDraft.endpoint}
                            placeholder="TTS：Gradio / OpenAI Speech 基址 / 或填 qwen-tts-multimodal（百炼千问多模态）"
                            onChange={(e) => setTtsDraft((p) => ({ ...p, endpoint: e.target.value }))}
                          />
                          <input
                            className={WF_INPUT}
                            value={String(ttsDraft.apiKey || '')}
                            type="password"
                            placeholder="TTS API Key（可选）"
                            onChange={(e) => setTtsDraft((p) => ({ ...p, apiKey: e.target.value }))}
                          />
                          <input
                            className={WF_INPUT}
                            value={ttsDraft.model}
                            placeholder="TTS 模型名"
                            onChange={(e) => setTtsDraft((p) => ({ ...p, model: e.target.value }))}
                          />
                          <input
                            className={WF_INPUT}
                            value={ttsDraft.voice}
                            placeholder="TTS 音色"
                            onChange={(e) => setTtsDraft((p) => ({ ...p, voice: e.target.value }))}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={saveTtsDraft}>
                              保存
                            </button>
                            <button type="button" className={WF_BTN_CAPSULE_MUTED} onClick={() => void testTtsPreset(ttsDraft)}>
                              测试
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        {ttsPresets.map((p) => {
                          const isActive =
                            aiAssistantConfig.ttsEndpoint.trim() === p.endpoint.trim() &&
                            aiAssistantConfig.ttsModel.trim() === p.model.trim() &&
                            aiAssistantConfig.ttsVoice.trim() === p.voice.trim()
                          return (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                                isActive ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/5 bg-black/30'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-black uppercase tracking-widest text-white/70">{p.name}</div>
                                <div className="truncate font-mono text-[11px] text-white/30">{p.endpoint || '-'}</div>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <button type="button" className={WF_BTN_CAPSULE_COMPACT} onClick={() => applyTtsPreset(p)}>
                                  使用
                                </button>
                                <button type="button" className={WF_BTN_CAPSULE_COMPACT} onClick={() => startEditTtsPreset(p)}>
                                  设置
                                </button>
                                <button type="button" className={WF_BTN_CAPSULE_DARK_COMPACT} onClick={() => void testTtsPreset(p)}>
                                  测试
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_DARK_COMPACT}
                                  onClick={() => {
                                    if (!window.confirm(`确定删除「${p.name}」吗？`)) return
                                    setTtsPresets(removeTtsPreset(p.id))
                                    if (editingTtsId === p.id) setEditingTtsId(null)
                                  }}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="space-y-5 rounded-2xl border border-white/5 bg-black/25 p-5 sm:p-6">
                        <div className="text-[12px] font-black uppercase tracking-widest text-white/40">克隆参考音频</div>
                        <div className="flex flex-wrap items-center gap-4">
                          <button
                            type="button"
                            className="wf-json-import-pill"
                            onClick={() => aiCloneAudioInputRef.current?.click()}
                          >
                            上传参考音频
                          </button>
                          <button
                            type="button"
                            className={WF_BTN_CAPSULE_DARK}
                            disabled={bailianCloneBusy || !aiAssistantConfig.ttsCloneAudioDataUrl}
                            onClick={() => void runBailianVoiceCloneFromUpload()}
                          >
                            {bailianCloneBusy ? '百炼复刻中…' : '百炼复刻并填入音色'}
                          </button>
                          <button
                            type="button"
                            className={`${WF_BTN_CAPSULE_MUTED} px-5 py-2.5 text-[13px]`}
                            onClick={() =>
                              onAiAssistantConfigChange({
                                ttsCloneAudioDataUrl: '',
                                ttsCloneAudioName: '',
                              })
                            }
                            disabled={!aiAssistantConfig.ttsCloneAudioDataUrl}
                          >
                            清除参考音频
                          </button>
                          <input
                            ref={aiCloneAudioInputRef}
                            type="file"
                            accept="audio/*"
                            className="visually-hidden"
                            onChange={(e) => {
                              void onAiCloneAudioChange(e)
                            }}
                          />
                        </div>
                        <p className="m-0 text-[11px] leading-relaxed text-white/35">
                          调用百炼「声音复刻」接口（qwen-voice-enrollment），将上传文件作为
                          <span className="font-mono text-white/45"> audio.data</span>（Data URL）。成功后写入
                          <span className="font-mono text-white/45"> TTS 音色</span>，并把合成 endpoint 设为{' '}
                          <span className="font-mono text-white/45">qwen-tts-multimodal</span>、模型与复刻{' '}
                          <span className="font-mono text-white/45">target_model</span>（须为 qwen3-tts-vc*，默认
                          {QWEN_VC_DEFAULT_TARGET_MODEL}）一致。单文件建议小于 10MB。
                        </p>
                        <div className="space-y-1">
                          <p className="m-0 text-[13px] leading-relaxed tracking-wide text-white/45">
                            当前参考音频：{aiAssistantConfig.ttsCloneAudioName || '未上传'}
                          </p>
                          {aiAssistantConfig.ttsCloneAudioDataUrl ? (
                            <audio
                              controls
                              preload="metadata"
                              src={aiAssistantConfig.ttsCloneAudioDataUrl}
                              className="workflow-settings-panel__audioPreview workflow-settings-panel__audioPreview--flowid w-full max-w-full"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 border-t border-white/5 pt-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={aiAssistantConfig.pauseLocalModelWhenWorkflowRunning}
                      onChange={(e) =>
                        onAiAssistantConfigChange({
                          pauseLocalModelWhenWorkflowRunning: e.target.checked,
                        })
                      }
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                      工作流运行时暂停本地模型
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={aiAssistantConfig.confirmBeforeRun}
                      onChange={(e) => onAiAssistantConfigChange({ confirmBeforeRun: e.target.checked })}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                      任务执行前确认
                    </span>
                  </label>
                </div>
              </div>
              <button type="button" className={WF_SYNC_BTN} onClick={onSaveAiAssistantConfig}>
                同步配置
              </button>
            </div>
          ) : null}

          {activeTab === 'shortcuts' ? (
            <div className={`${WF_CARD} p-2 pb-6`}>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 p-6">
                <div className="text-[15px] font-black uppercase tracking-widest text-white/70">热键表</div>
                <label className="flex cursor-pointer items-center gap-4">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                    checked={shortcuts.enableGlobalHotkeys}
                    onChange={(e) =>
                      onShortcutConfigChange({
                        enableGlobalHotkeys: e.target.checked,
                      })
                    }
                  />
                  <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                    全局启用
                  </span>
                </label>
              </div>
              <div className="space-y-6 p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2.5">
                    <label className="ml-1 text-[13px] font-black uppercase tracking-widest text-white/20">
                      微调步长
                    </label>
                    <input
                      className={WF_INPUT}
                      type="number"
                      min={1}
                      value={shortcuts.moveStep}
                      onChange={(e) =>
                        onShortcutConfigChange({ moveStep: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div className="space-y-2.5">
                    <label className="ml-1 text-[13px] font-black uppercase tracking-widest text-white/20">
                      快速步长
                    </label>
                    <input
                      className={WF_INPUT}
                      type="number"
                      min={2}
                      value={shortcuts.fastMoveStep}
                      onChange={(e) =>
                        onShortcutConfigChange({ fastMoveStep: Number(e.target.value) || 10 })
                      }
                    />
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-white/5 bg-black/40 px-4 py-3 text-[13px] font-black uppercase tracking-[0.2em] text-white/20 sm:px-6">
                    <span>指令</span>
                    <span className="text-center">绑定</span>
                    <span className="text-right sm:pr-2">状态</span>
                  </div>
                  {SHORTCUT_LABELS.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-t border-white/5 px-4 py-3 transition-colors hover:bg-white/5 sm:px-6"
                    >
                      <span className="text-[15px] font-black tracking-wider text-white/60">{item.label}</span>
                      <span className="text-center font-mono text-[14px] text-white/25">
                        {shortcuts.bindings[item.id]}
                      </span>
                      <div className="text-right">
                        <button
                          type="button"
                          className="rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-[12px] font-black uppercase text-white/30 transition-all hover:text-white sm:px-4 sm:text-[13px]"
                          onClick={() => setBindingCommand(item.id)}
                        >
                          {bindingCommand === item.id ? '请按键…' : '配置'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {lastExecutionMessage ? (
            <div className={`${WF_CARD} space-y-3 p-6`}>
              <div className={WF_SECTION_TITLE}>最近执行</div>
              <p className="m-0 text-[14px] leading-relaxed text-white/40">{lastExecutionMessage}</p>
            </div>
          ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  )
}
