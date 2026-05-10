import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { motion } from 'motion/react'
import {
  ChevronDown,
  ChevronRight,
  Command,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  FileText,
  HardDrive,
  Image as ImageIconLucide,
  KeyRound,
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
import { ensureMaterialLibraryCategoryDirs } from '../../lib/materialLibrary'
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
import { USER_AGREEMENT_TEXT, fetchRemoteUserAgreement } from '../../lib/userAgreement'
import { LicenseActivationPanel } from './LicenseActivationPanel'
import { loadCloudCallLogs, type CloudCallLogEntry } from '../../lib/cloudCallLogs'
import {
  CLOUD_ASSIST_KIND_LABELS,
  CLOUD_ASSIST_KIND_LIST,
  readAssistApiKeys,
  testAssistConnectionForKind,
  writeAssistApiKeys,
  type CloudAssistKind,
} from '../../lib/cloudAssistModelCatalog'
import {
  getActiveCloudSelfPreset,
  getOfficialCloudBaseUrl,
  hasOfficialCloudBaseUrl,
  loadActiveCloudSelfPresetId,
  loadCloudSelfPresets,
  removeCloudSelfPreset,
  setActiveCloudSelfPresetId,
  upsertCloudSelfPreset,
  type CloudProviderId,
  type CloudSelfConnectionSource,
  type CloudSelfPreset,
} from '../../lib/cloudSelfPresets'
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
import { effectiveCloudComfyBaseUrl } from '../../lib/comfyClient'
import { fetchCloudWorkflowJson, type CloudWorkflowMeta } from '../../lib/cloudWorkflowsApi'
import {
  getCloudWorkflowUserGuide,
  CLOUD_WORKFLOW_SYSTEM_PROMPT_TOKEN,
  type CloudWorkflowIoRow,
} from '../../lib/cloudWorkflowUserGuides'
import {
  insertTextAtCaret,
  readDraggedPlainText,
  readDraggedPlainTextSync,
} from '../../lib/textareaInsertAtCaret'
import {
  isSensitiveWordFilterEnabled,
  setSensitiveWordFilterEnabled,
  SENSITIVE_FILTER_CHANGED_EVENT,
} from '../../lib/sensitiveWords'

const KIND_LABELS: Record<StudioNodeKind, string> = {
  text: '文本',
  script: '脚本',
  image: '图片',
  imageCompare: '图像对比',
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
  'flowid-dark-select w-full rounded-xl border border-white/10 bg-black/60 py-3 pl-3 pr-10 text-[15px] text-white/70 outline-none focus:border-white/20'
const WF_CARD = 'bg-[#111114] border border-white/5 rounded-2xl'
const WF_SYNC_BTN =
  'w-full rounded-xl border border-white/5 bg-[#1e1e22] py-4 text-[15px] font-black uppercase tracking-[0.3em] text-white/40 transition-all hover:bg-orange-600 hover:text-white'

const CLOUD_PROVIDERS: Array<{ id: CloudProviderId; label: string; models: string[] }> = [
  { id: 'doubao', label: 'doubao', models: ['seedream-5.0', 'seedream-4.5', 'seedream-4.0'] },
  { id: 'gemini', label: 'gemini', models: ['nano-banana-2', 'nano-banana-pro'] },
  { id: 'openai', label: 'openai', models: ['gpt-image-2', 'dall-e-3', 'dall-e-2'] },
]

function asProviderId(x: string): CloudProviderId {
  return (x === 'doubao' || x === 'gemini' || x === 'openai' ? x : 'doubao') as CloudProviderId
}

export type SettingsTab =
  | 'comfy'
  | 'cloud-models'
  | 'ai-assistant'
  | StudioNodeKind
  | 'shortcuts'
  | 'local-storage'
  | 'device-activation'
  | 'user-agreement'

const SETTINGS_SIDEBAR: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'comfy', label: 'COMFYUI', icon: Server },
  { id: 'cloud-models', label: '云端模型', icon: Cloud },
  { id: 'text', label: KIND_LABELS.text, icon: Type },
  { id: 'image', label: KIND_LABELS.image, icon: ImageIconLucide },
  { id: 'video', label: KIND_LABELS.video, icon: Video },
  { id: 'audio', label: KIND_LABELS.audio, icon: Mic },
  { id: 'music', label: KIND_LABELS.music, icon: Music },
  { id: 'ai-assistant', label: 'AI 助手', icon: Terminal },
  { id: 'shortcuts', label: '快捷键', icon: Command },
  { id: 'local-storage', label: '本地存储', icon: HardDrive },
  { id: 'device-activation', label: '授权码', icon: KeyRound },
  { id: 'user-agreement', label: '用户协议', icon: FileText },
]

/** 与 @flowid (2) SettingsPanel 一致：侧栏文案 + 「核心参数」 */
function settingsMainTitle(tab: SettingsTab): string {
  if (tab === 'device-activation') return '授权码 核心参数'
  if (tab === 'user-agreement') return '用户协议'
  if (tab === 'cloud-models') return '云端模型'
  const row = SETTINGS_SIDEBAR.find((i) => i.id === tab)
  return row ? `${row.label} 核心参数` : '设置'
}

type OfficialTemplateMeta = {
  id: string
  name: string
  version: string
  description?: string
}

const SHORTCUT_LABELS: Array<{ id: ShortcutCommandId; label: string; hint?: string }> = [
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
  {
    id: 'marqueeSelect',
    label: '框选',
    hint: '仅可选 Shift 或 Alt；Ctrl / Cmd 用于追加多选',
  },
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

function cloudGuideMediaLabel(media: CloudWorkflowIoRow['media']): string {
  switch (media) {
    case 'text':
      return '文字'
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    case 'numeric':
      return '数值'
    default:
      return '其它'
  }
}

function cloudGuideMediaClass(media: CloudWorkflowIoRow['media']): string {
  const base =
    'inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider'
  switch (media) {
    case 'text':
      return `${base} border-sky-500/35 bg-sky-500/10 text-sky-200/90`
    case 'image':
      return `${base} border-emerald-500/35 bg-emerald-500/10 text-emerald-200/90`
    case 'video':
      return `${base} border-violet-500/35 bg-violet-500/10 text-violet-200/90`
    case 'audio':
      return `${base} border-amber-500/35 bg-amber-500/10 text-amber-200/90`
    case 'numeric':
      return `${base} border-cyan-500/35 bg-cyan-500/10 text-cyan-200/90`
    default:
      return `${base} border-white/12 bg-white/[0.06] text-white/45`
  }
}

/**
 * 工作流设置面板：管理本地/云端配置、模板导入、节点类型绑定。
 */
export function WorkflowSettingsPanel({
  canvasDayMode = false,
  executionMode,
  executionProvider,
  randomizeKsamplerSeedsOnRun,
  localConfig,
  cloudConfig,
  cloudEndpoints,
  cloudWorkflowMetaList = [],
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
  onRefreshOfficialTemplates,
  aiAssistantConfig,
  onAiAssistantConfigChange,
  onSaveAiAssistantConfig,
  onClose,
  settingsFocusTab = null,
  onSettingsFocusTabConsumed,
}: {
  executionMode: WorkflowExecutionMode
  executionProvider: WorkflowProviderType
  /** 每次执行是否随机化 KSampler 的 seed */
  randomizeKsamplerSeedsOnRun: boolean
  localConfig: WorkflowProviderConfig
  cloudConfig: WorkflowProviderConfig
  cloudEndpoints: Array<{ id: string; name: string; baseUrl: string; enabled: boolean }>
  /** 授权服务云端工作流目录（设置页「云端工作流」分支用；与全局执行环境是否选云端无关） */
  cloudWorkflowMetaList?: CloudWorkflowMeta[]
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
  onRefreshOfficialTemplates: () => Promise<OfficialTemplateMeta[]>
  aiAssistantConfig: AiAssistantConfig
  onAiAssistantConfigChange: (patch: Partial<AiAssistantConfig>) => void
  onSaveAiAssistantConfig: () => void
  onClose: () => void
  /** 与画布日间模式一致：弹窗白底 #262626 文案 */
  canvasDayMode?: boolean
  /** 外部请求打开指定侧栏（如首页「授权码」）；应用后由 onSettingsFocusTabConsumed 清掉 */
  settingsFocusTab?: SettingsTab | null
  onSettingsFocusTabConsumed?: () => void
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('comfy')
  useEffect(() => {
    if (!settingsFocusTab) return
    setActiveTab(settingsFocusTab)
    onSettingsFocusTabConsumed?.()
  }, [settingsFocusTab, onSettingsFocusTabConsumed])
  const [bindingCommand, setBindingCommand] = useState<ShortcutCommandId | null>(null)
  const aiCloneAudioInputRef = useRef<HTMLInputElement | null>(null)
  const [diskPaths, setDiskPaths] = useState<LocalDiskPathsSettings>(() => loadLocalDiskPathsSettings())
  const [browserProjectBound, setBrowserProjectBound] = useState(false)
  const [cloudKeyVisible, setCloudKeyVisible] = useState(false)
  const [cloudModelsSubTab, setCloudModelsSubTab] = useState<'self' | 'logs'>('self')
  const [cloudSelfPresets, setCloudSelfPresets] = useState<CloudSelfPreset[]>(() => loadCloudSelfPresets())
  const [activeCloudSelfPresetId, setActiveCloudSelfPresetIdState] = useState<string>(() =>
    loadActiveCloudSelfPresetId(),
  )
  const [editingCloudSelfId, setEditingCloudSelfId] = useState<string | null>(null)
  const [cloudSelfDraft, setCloudSelfDraft] = useState<{
    nodeKind: StudioNodeKind | ''
    providerId: CloudProviderId
    connectionSource: CloudSelfConnectionSource
    baseUrl: string
    apiKey: string
    model: string
  }>(() => {
    const active = getActiveCloudSelfPreset()
    const src: CloudSelfConnectionSource = active?.connectionSource === 'official' ? 'official' : 'custom'
    return {
      nodeKind: (String((active as any)?.nodeKind || '') as any) || '',
      providerId: asProviderId(active?.providerId || 'doubao'),
      connectionSource: src,
      baseUrl: src === 'official' ? '' : String(active?.baseUrl || ''),
      apiKey: String(active?.apiKey || ''),
      model: String(active?.model || (CLOUD_PROVIDERS.find((p) => p.id === 'doubao')?.models?.[0] || '')),
    }
  })
  const [cloudSelfMsg, setCloudSelfMsg] = useState<string>('')
  const [assistSectionOpen, setAssistSectionOpen] = useState(false)
  const [assistKeyDraft, setAssistKeyDraft] = useState<Record<CloudAssistKind, string>>(() => readAssistApiKeys())
  const [assistLineTestMsg, setAssistLineTestMsg] = useState<Partial<Record<CloudAssistKind, string>>>({})
  const [cloudLogsPage, setCloudLogsPage] = useState(1)
  const [userAgreementRemote, setUserAgreementRemote] = useState<{
    version: string
    text: string
    updatedAtMs: number
  } | null>(null)
  const [cloudCallLogs, setCloudCallLogs] = useState<CloudCallLogEntry[]>(() => {
    try {
      return loadCloudCallLogs()
    } catch {
      return []
    }
  })
  const [aiCorePresets, setAiCorePresets] = useState<AiAssistantCorePreset[]>(() => loadAiAssistantCorePresets())
  const [sensitiveFilterEnabled, setSensitiveFilterEnabledUi] = useState(() => isSensitiveWordFilterEnabled())
  useEffect(() => {
    const onChanged = (ev: Event) => {
      const ce = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof ce.detail?.enabled === 'boolean') {
        setSensitiveFilterEnabledUi(ce.detail.enabled)
        return
      }
      setSensitiveFilterEnabledUi(isSensitiveWordFilterEnabled())
    }
    window.addEventListener(SENSITIVE_FILTER_CHANGED_EVENT, onChanged as EventListener)
    return () => window.removeEventListener(SENSITIVE_FILTER_CHANGED_EVENT, onChanged as EventListener)
  }, [])
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

  /** 发行版是否在构建时注入了任一厂商的官方兼容根 URL（用于「仅填 Key」模式） */
  const officialLineConfigured = useMemo(
    () => hasOfficialCloudBaseUrl('doubao') || hasOfficialCloudBaseUrl('gemini') || hasOfficialCloudBaseUrl('openai'),
    [],
  )

  useEffect(() => {
    let alive = true
    void fetchRemoteUserAgreement().then((r) => {
      if (!alive) return
      setUserAgreementRemote(r)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onLicenseChanged = () => {
      void fetchRemoteUserAgreement().then((r) => setUserAgreementRemote(r))
    }
    window.addEventListener('flowid:license-changed', onLicenseChanged as EventListener)
    return () => window.removeEventListener('flowid:license-changed', onLicenseChanged as EventListener)
  }, [])

  const sidebarItems = useMemo(() => SETTINGS_SIDEBAR, [])
  const [editingWorkflow, setEditingWorkflow] = useState<{
    kind: StudioNodeKind
    workflowId: string
    workflowName: string
    workflowJsonText: string
    resultNodeId: string
    resultFieldPath: string
  } | null>(null)
  const [editingCloudWorkflow, setEditingCloudWorkflow] = useState<{
    kind: StudioNodeKind
    workflowId: string
    workflowName: string
    workflowJsonText: string
    resultNodeId: string
    resultFieldPath: string
  } | null>(null)
  const [cloudWorkflowOpenMsg, setCloudWorkflowOpenMsg] = useState('')
  /** 非空时显示「云端工作流使用说明」浮层（值为 workflow id） */
  const [cloudWorkflowGuideOpenId, setCloudWorkflowGuideOpenId] = useState<string | null>(null)
  /** 文本节点：编辑当前云端工作流的 Comfy 系统提示词（__SYSTEM_PROMPT__） */
  const [cloudSystemPromptModalWorkflowId, setCloudSystemPromptModalWorkflowId] = useState<string | null>(null)
  const [cloudSystemPromptModalDraft, setCloudSystemPromptModalDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeKind = useMemo(() => {
    const kinds: StudioNodeKind[] = ['text', 'script', 'image', 'video', 'audio', 'music', 'panorama']
    return kinds.includes(activeTab as StudioNodeKind) ? (activeTab as StudioNodeKind) : null
  }, [activeTab])

  const activeNodeConfig = activeKind ? nodeConfigs[activeKind] : null
  const cloudWfsForActiveKind = useMemo((): CloudWorkflowMeta[] => {
    if (!activeKind) return []
    return cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === activeKind)
  }, [activeKind, cloudWorkflowMetaList])

  useEffect(() => {
    if (!activeKind || executionMode !== 'custom') return
    const cfg = nodeConfigs[activeKind]
    if (!cfg) return
    if ((cfg.settingsEditTarget ?? 'local') !== 'cloud') return
    const list = cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === activeKind)
    if (!list.length) return
    const saved = String(cfg.cloudSettingsSelectedWorkflowId || '').trim()
    const hit = saved && list.some((w) => w.id === saved)
    if (!hit) {
      onNodeConfigChange(activeKind, { cloudSettingsSelectedWorkflowId: list[0].id })
    }
  }, [activeKind, cloudWorkflowMetaList, executionMode, nodeConfigs, onNodeConfigChange])

  const settingsWorkflowSource = (activeNodeConfig?.settingsEditTarget ?? 'local') as 'local' | 'cloud'
  const cloudSettingsPickId = String(activeNodeConfig?.cloudSettingsSelectedWorkflowId || '').trim()
  const effectiveCloudSettingsWorkflowId =
    cloudSettingsPickId && cloudWfsForActiveKind.some((w) => w.id === cloudSettingsPickId)
      ? cloudSettingsPickId
      : cloudWfsForActiveKind[0]?.id ?? ''
  const cloudOverrideForPick = effectiveCloudSettingsWorkflowId
    ? activeNodeConfig?.cloudWorkflowOverrides?.[effectiveCloudSettingsWorkflowId]
    : undefined
  const hasCloudOverrideForPick = Boolean(
    cloudOverrideForPick &&
      (typeof cloudOverrideForPick === 'string'
        ? cloudOverrideForPick.trim()
        : String(cloudOverrideForPick.jsonText || '').trim()),
  )
  const activeComfyBaseUrl = useMemo(() => {
    if (executionProvider === 'local') return localConfig.baseUrl
    const raw = cloudEndpoints.find((item) => item.enabled && item.baseUrl.trim())?.baseUrl || ''
    return effectiveCloudComfyBaseUrl(raw)
  }, [cloudEndpoints, executionProvider, localConfig.baseUrl])
  const activeComfyApiKey = executionProvider === 'local' ? '' : cloudConfig.apiKey || ''

  useEffect(() => {
    const onChanged = () => {
      setCloudSelfPresets(loadCloudSelfPresets())
      setActiveCloudSelfPresetIdState(loadActiveCloudSelfPresetId())
    }
    window.addEventListener('flowid:cloud-self-presets-changed', onChanged as EventListener)
    return () => window.removeEventListener('flowid:cloud-self-presets-changed', onChanged as EventListener)
  }, [])

  useEffect(() => {
    const onKeys = () => setAssistKeyDraft(readAssistApiKeys())
    window.addEventListener('flowid:cloud-assist-keys-changed', onKeys as EventListener)
    return () => window.removeEventListener('flowid:cloud-assist-keys-changed', onKeys as EventListener)
  }, [])

  const pagedCloudLogs = useMemo(() => {
    const pageSize = 20
    const total = cloudCallLogs.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(Math.max(1, cloudLogsPage), totalPages)
    const start = (page - 1) * pageSize
    const items = cloudCallLogs.slice(start, start + pageSize)
    return { items, page, totalPages, total }
  }, [cloudCallLogs, cloudLogsPage])

  useEffect(() => {
    const onChanged = () => {
      try {
        setCloudCallLogs(loadCloudCallLogs())
      } catch {
        setCloudCallLogs([])
      }
    }
    window.addEventListener('flowid:cloud-call-logs-changed', onChanged as EventListener)
    return () => window.removeEventListener('flowid:cloud-call-logs-changed', onChanged as EventListener)
  }, [])

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
    // 与下方预设卡「使用」一致：保存即写入当前助手，Agent 浮窗等处的模型名才会同步
    applyAiCorePreset(next)
    setAiCoreTestMsg('已保存并已应用到当前助手。')
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

  const startNewCloudSelf = useCallback(() => {
    setEditingCloudSelfId('new')
    const models = CLOUD_PROVIDERS.find((p) => p.id === cloudSelfDraft.providerId)?.models || []
    setCloudSelfDraft({
      nodeKind: '',
      providerId: cloudSelfDraft.providerId,
      connectionSource: 'custom',
      baseUrl: '',
      apiKey: '',
      model: models[0] || '',
    })
    setCloudSelfMsg('')
  }, [cloudSelfDraft.providerId])

  const startEditCloudSelf = useCallback((p: CloudSelfPreset) => {
    setEditingCloudSelfId(p.id)
    const src: CloudSelfConnectionSource = p.connectionSource === 'official' ? 'official' : 'custom'
    setCloudSelfDraft({
      nodeKind: (String((p as any)?.nodeKind || '') as any) || '',
      providerId: asProviderId(p.providerId),
      connectionSource: src,
      baseUrl: src === 'official' ? '' : String(p.baseUrl || ''),
      apiKey: String(p.apiKey || ''),
      model: String(p.model || ''),
    })
    setCloudSelfMsg('')
  }, [])

  const saveCloudSelfDraft = useCallback(() => {
    const providerId = asProviderId(cloudSelfDraft.providerId)
    const nodeKind = String(cloudSelfDraft.nodeKind || '').trim()
    const src: CloudSelfConnectionSource = cloudSelfDraft.connectionSource === 'official' ? 'official' : 'custom'
    const baseUrlCustom = String(cloudSelfDraft.baseUrl || '').trim()
    const apiKey = String(cloudSelfDraft.apiKey || '').trim()
    const model = String(cloudSelfDraft.model || '').trim()
    if (src === 'official') {
      if (!hasOfficialCloudBaseUrl(providerId)) {
        setCloudSelfMsg('当前分类未配置平台 API 根地址，请换分类或改用自助模式。')
        return
      }
      if (!model || !apiKey) {
        setCloudSelfMsg('平台模式下请填写默认模型与 API Key。')
        return
      }
    } else if (!baseUrlCustom || !model || !apiKey) {
      setCloudSelfMsg('请填写 API 地址 / 默认模型 / API Key。')
      return
    }
    const id = editingCloudSelfId && editingCloudSelfId !== 'new' ? editingCloudSelfId : crypto.randomUUID()
    const saved = upsertCloudSelfPreset({
      id,
      nodeKind,
      providerId,
      connectionSource: src,
      baseUrl: src === 'official' ? '' : baseUrlCustom,
      apiKey,
      model,
    })
    setActiveCloudSelfPresetId(saved.id)
    setCloudSelfMsg('已保存。')
    setEditingCloudSelfId(null)
  }, [cloudSelfDraft, editingCloudSelfId])

  const testCloudSelfDraft = useCallback(async () => {
    const providerId = asProviderId(cloudSelfDraft.providerId)
    const src: CloudSelfConnectionSource = cloudSelfDraft.connectionSource === 'official' ? 'official' : 'custom'
    const rawBase =
      src === 'official' ? getOfficialCloudBaseUrl(providerId) : String(cloudSelfDraft.baseUrl || '').trim()
    const baseUrl = normalizeOpenAICompatibleBaseUrl(rawBase)
    const key = String(cloudSelfDraft.apiKey || '').trim()
    if (!baseUrl) {
      setCloudSelfMsg(src === 'official' ? '本构建未注入该平台分类的官方地址。' : '请先填写 API 地址。')
      return
    }
    if (!key) {
      setCloudSelfMsg('请先填写 API Key。')
      return
    }
    setCloudSelfMsg('测试中…')
    try {
      const auth = `Bearer ${key}`
      const res = await fetchOpenAICompat(`${baseUrl}/v1/models`, { method: 'GET', headers: { Authorization: auth } })
      if (!res.ok) {
        setCloudSelfMsg(`测试失败：HTTP ${res.status}`)
        return
      }
      setCloudSelfMsg('测试成功：可访问 /v1/models')
    } catch (e) {
      setCloudSelfMsg(`测试失败：${String((e as any)?.message || e)}`)
    }
  }, [cloudSelfDraft])

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
    setEditingCloudWorkflow(null)
    setEditingWorkflow({
      kind,
      workflowId,
      workflowName,
      workflowJsonText,
      resultNodeId,
      resultFieldPath,
    })
  }

  /** 设置页：打开授权云端工作流的参数编辑（优先本机覆盖，否则 GET 授权服务 JSON） */
  const openCloudWorkflowInlineEditor = async (
    kind: StudioNodeKind,
    workflowId: string,
    workflowName: string,
  ) => {
    if (!workflowId) return
    setCloudWorkflowOpenMsg('')
    const cfg = nodeConfigs[kind]
    const rawOv = cfg.cloudWorkflowOverrides?.[workflowId]
    let jsonText = ''
    let resultNodeId = ''
    let resultFieldPath = ''
    if (rawOv && typeof rawOv === 'object' && String(rawOv.jsonText || '').trim()) {
      jsonText = String(rawOv.jsonText)
      resultNodeId = String(rawOv.resultNodeId || '').trim()
      resultFieldPath = String(rawOv.resultFieldPath || '').trim()
    } else if (rawOv && typeof rawOv === 'string' && rawOv.trim()) {
      jsonText = rawOv.trim()
    } else {
      setCloudWorkflowOpenMsg('正在从授权服务拉取工作流…')
      const r = await fetchCloudWorkflowJson(workflowId)
      if (!r.ok || !r.workflowJson.trim()) {
        setCloudWorkflowOpenMsg(r.message || `拉取失败（HTTP ${r.status ?? '?' }）`)
        return
      }
      jsonText = r.workflowJson
      setCloudWorkflowOpenMsg('')
    }
    setEditingWorkflow(null)
    setEditingCloudWorkflow({
      kind,
      workflowId,
      workflowName,
      workflowJsonText: jsonText,
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
      if (bindingCommand === 'marqueeSelect') {
        const k = event.key
        if (k === 'Shift' || k === 'Alt') {
          onShortcutBindingChange('marqueeSelect', k)
          setBindingCommand(null)
          return
        }
        window.alert('框选键仅支持 Shift 或 Alt：Ctrl / Cmd 在画布上用于「追加多选」节点，不能与框选键相同。')
        setBindingCommand(null)
        return
      }
      const combo = toCombo(event)
      if (!combo) return
      onShortcutBindingChange(bindingCommand, combo)
      setBindingCommand(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindingCommand, onShortcutBindingChange])

  // 保持：切换主 Tab 时退出内联编辑
  useEffect(() => {
    setEditingWorkflow(null)
  }, [activeTab])

  useEffect(() => {
    if (executionMode !== 'official') return
    void onRefreshOfficialTemplates()
  }, [executionMode, onRefreshOfficialTemplates])

  useEffect(() => {
    const syncPathsFromStorage = () => {
      setDiskPaths(loadLocalDiskPathsSettings())
    }
    window.addEventListener('flowid:local-disk-paths-changed', syncPathsFromStorage as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', syncPathsFromStorage as EventListener)
    }
  }, [])

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
  const clearPathField = async (
    field:
      | 'inputPath'
      | 'outputPath'
      | 'workflowPath'
      | 'flowidProjectJsonPath'
      | 'materialLibraryPath'
      | 'systemPromptCoverPath',
  ) => {
    if (field === 'flowidProjectJsonPath') {
      await unbindFlowidProjectJsonBrowser()
      setBrowserProjectBound(false)
      setDiskPaths((p) => ({ ...p, flowidProjectJsonPath: '' }))
      saveLocalDiskPathsSettings({ flowidProjectJsonPath: '' })
      return
    }
    if (field === 'materialLibraryPath') {
      setDiskPaths((p) => ({ ...p, materialLibraryPath: '' }))
      saveLocalDiskPathsSettings({ materialLibraryPath: '' })
      return
    }
    if (field === 'systemPromptCoverPath') {
      setDiskPaths((p) => ({ ...p, systemPromptCoverPath: '' }))
      saveLocalDiskPathsSettings({ systemPromptCoverPath: '' })
      return
    }
    if (!isElectronDesktop) {
      await clearBrowserFolderHandle(field)
    }
    setDiskPaths((p) => ({ ...p, [field]: '' }))
    saveLocalDiskPathsSettings({ [field]: '' })
  }

  /**
   * 选择素材库根目录（桌面端）：自动创建「人物 / 场景 / 道具 / 音效 / 其他」子文件夹。
   */
  const pickMaterialLibraryPath = async () => {
    if (!isElectronDesktop) {
      window.alert('素材库与本地文件夹实时同步仅在桌面版可用；网页版可在此填写备忘路径。')
      return
    }
    const desk = window.flowidDesktop
    if (!desk?.pickDirectory) {
      window.alert('当前桌面端能力异常，请重启 Flowid 桌面进程后再试。')
      return
    }
    const res = await desk.pickDirectory({
      defaultPath:
        String(diskPaths.materialLibraryPath || '').trim() ||
        String(diskPaths.flowidProjectJsonPath || '').trim() ||
        diskPaths.workflowPath,
    })
    if (!res.ok) {
      window.alert(res.error || '选择失败')
      return
    }
    if (res.canceled || !res.path) return
    const ensured = await ensureMaterialLibraryCategoryDirs(res.path)
    if (!ensured.ok) {
      window.alert(ensured.error || '创建分类子文件夹失败')
      return
    }
    setDiskPaths((p) => ({ ...p, materialLibraryPath: res.path! }))
    saveLocalDiskPathsSettings({ materialLibraryPath: res.path! })
  }

  /**
   * 选择「系统提示词封面」存储根目录（桌面端）：仅确保所选目录存在。
   */
  const pickSystemPromptCoverPath = async () => {
    if (!isElectronDesktop) {
      window.alert('系统提示词封面落盘仅在桌面版可用；网页版可在此填写备忘路径。')
      return
    }
    const desk = window.flowidDesktop
    if (!desk?.pickDirectory || !desk.ensureDirectory) {
      window.alert('当前桌面端能力异常，请重启 Flowid 桌面进程后再试。')
      return
    }
    const res = await desk.pickDirectory({
      defaultPath:
        String(diskPaths.systemPromptCoverPath || '').trim() ||
        String(diskPaths.materialLibraryPath || '').trim() ||
        String(diskPaths.flowidProjectJsonPath || '').trim() ||
        diskPaths.workflowPath,
    })
    if (!res.ok) {
      window.alert(res.error || '选择失败')
      return
    }
    if (res.canceled || !res.path) return
    const ensured = await desk.ensureDirectory(res.path)
    if (!ensured.ok) {
      window.alert(ensured.error || '创建目录失败')
      return
    }
    setDiskPaths((p) => ({ ...p, systemPromptCoverPath: ensured.path || res.path! }))
    saveLocalDiskPathsSettings({ systemPromptCoverPath: ensured.path || res.path! })
  }

  /**
   * 将路径配置写入 localStorage。
   */
  const commitDiskPaths = () => {
    saveLocalDiskPathsSettings(diskPaths)
    window.alert(
      '本地路径已保存。工程将在自动保存时同步写入「Flowid 工程目录」（若已填写）。\n提示：若在输入框里手改路径，必须点本按钮保存后才会写入「项目档案」扫描目录。',
    )
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
      data-canvas-day={canvasDayMode ? '1' : undefined}
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
          {sidebarItems.map((item) => {
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
                <p className="m-0 text-[13px] leading-relaxed text-white/45 border-t border-white/5 pt-4">
                  <span className="font-bold text-white/55">说明：</span>
                  「本地 / 云端」只决定<strong className="text-white/65">执行</strong>时连哪一台 Comfy（地址与鉴权），
                  <strong className="text-white/65">不会</strong>自动把你在各节点里维护的「自定义工作流」列表换成远端 Comfy 上的文件名——该列表保存在本应用本地配置中。
                  Auth 上的<strong className="text-white/65">官方模板</strong>来自授权服务的模板目录，与这里的云端 Comfy 地址是两套数据；仅在「官方模板」执行模式下才会出现对应下拉框（默认多为自定义工作流模式）。
                </p>
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
              <div
                className={`${WF_CARD} space-y-6 ${
                  (editingWorkflow || editingCloudWorkflow) && executionMode === 'custom'
                    ? 'overflow-hidden p-0'
                    : 'p-8'
                }`}
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
                      {editingCloudWorkflow ? (
                        <div className="min-h-[280px] p-4 sm:p-6">
                          <WorkflowVisualEditorInline
                            workflowName={editingCloudWorkflow.workflowName}
                            workflowJsonText={editingCloudWorkflow.workflowJsonText}
                            resultNodeId={editingCloudWorkflow.resultNodeId}
                            resultFieldPath={editingCloudWorkflow.resultFieldPath}
                            comfyBaseUrl={activeComfyBaseUrl}
                            comfyApiKey={activeComfyApiKey}
                            onBack={() => setEditingCloudWorkflow(null)}
                            onSave={({
                              workflowJsonText: nextWorkflowJsonText,
                              resultNodeId,
                              resultFieldPath,
                            }) => {
                              const k = editingCloudWorkflow.kind
                              const wid = editingCloudWorkflow.workflowId
                              const prev = nodeConfigs[k].cloudWorkflowOverrides ?? {}
                              onNodeConfigChange(k, {
                                cloudWorkflowOverrides: {
                                  ...prev,
                                  [wid]: {
                                    jsonText: nextWorkflowJsonText,
                                    resultNodeId,
                                    resultFieldPath,
                                    updatedAt: Date.now(),
                                  },
                                },
                              })
                            }}
                          />
                        </div>
                      ) : null}
                      {!editingWorkflow && !editingCloudWorkflow ? (
                        <>
                          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className={WF_SECTION_TITLE}>工作流配置来源</div>
                            <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
                              <button
                                type="button"
                                className={`rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-wide transition-all ${
                                  settingsWorkflowSource === 'local'
                                    ? 'border border-orange-600/35 bg-orange-600/15 text-orange-400'
                                    : 'border border-transparent text-white/45 hover:text-white/70'
                                }`}
                                onClick={() => {
                                  setCloudWorkflowOpenMsg('')
                                  onNodeConfigChange(activeKind, { settingsEditTarget: 'local' })
                                }}
                              >
                                本地工作流
                              </button>
                              <button
                                type="button"
                                className={`rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-wide transition-all ${
                                  settingsWorkflowSource === 'cloud'
                                    ? 'border border-orange-600/35 bg-orange-600/15 text-orange-400'
                                    : 'border border-transparent text-white/45 hover:text-white/70'
                                }`}
                                onClick={() => {
                                  setCloudWorkflowOpenMsg('')
                                  onNodeConfigChange(activeKind, { settingsEditTarget: 'cloud' })
                                }}
                              >
                                云端工作流
                              </button>
                            </div>
                          </div>
                          <p className="m-0 mb-6 text-[12px] leading-relaxed text-white/35">
                            「本地」管理本机导入的 Comfy JSON 列表；「云端」调整授权服务下发的官方工作流（可本机覆盖保存）。
                            与顶部「执行环境 · 本地/云端 Comfy」相互独立：此处只决定你在设置里编辑哪一套。
                          </p>
                          {settingsWorkflowSource === 'local' ? (
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
                          ) : (
                            <div className="space-y-4 rounded-2xl border border-white/5 bg-black/15 p-5">
                              <p className="m-0 text-[13px] leading-relaxed text-white/40">
                                选择授权服务目录中的云端工作流，与画布在「云端 Comfy」模式下的工作流下拉一致。保存参数后即写入本机；执行该云端工作流时会优先使用本机版本。「恢复默认」会删除本机覆盖并回到授权服务原版。
                              </p>
                              {cloudWfsForActiveKind.length === 0 ? (
                                <p className="m-0 text-[13px] leading-relaxed text-amber-500/90">
                                  未获取到云端工作流：请在侧栏「授权码」配置授权服务地址，并确认服务端已配置{' '}
                                  <code className="rounded bg-white/5 px-1 font-mono text-[12px]">/cloud-workflows</code>。
                                </p>
                              ) : (
                                <>
                                  <div className="text-[11px] font-black uppercase tracking-widest text-white/35">
                                    当前云端工作流
                                  </div>
                                  <select
                                    className={WF_SELECT}
                                    value={effectiveCloudSettingsWorkflowId}
                                    onChange={(e) =>
                                      onNodeConfigChange(activeKind, {
                                        cloudSettingsSelectedWorkflowId: e.target.value || undefined,
                                      })
                                    }
                                  >
                                    {cloudWfsForActiveKind.map((w) => (
                                      <option key={w.id} value={w.id}>
                                        {w.name}
                                      </option>
                                    ))}
                                  </select>
                                  {cloudWorkflowOpenMsg ? (
                                    <p className="m-0 text-[12px] text-white/45">{cloudWorkflowOpenMsg}</p>
                                  ) : null}
                                  {hasCloudOverrideForPick ? (
                                    <p className="m-0 text-[11px] text-orange-400/85">
                                      已启用本机参数覆盖（执行时将优先使用此处保存的 JSON）。
                                    </p>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                      type="button"
                                      className={WF_BTN_CAPSULE_COMPACT}
                                      disabled={!effectiveCloudSettingsWorkflowId}
                                      onClick={() => {
                                        if (!effectiveCloudSettingsWorkflowId) return
                                        const w = cloudWfsForActiveKind.find(
                                          (i) => i.id === effectiveCloudSettingsWorkflowId,
                                        )
                                        void openCloudWorkflowInlineEditor(
                                          activeKind,
                                          effectiveCloudSettingsWorkflowId,
                                          w?.name || '云端工作流',
                                        )
                                      }}
                                    >
                                      参数设置
                                    </button>
                                    <button
                                      type="button"
                                      className={WF_BTN_CAPSULE_DARK_COMPACT}
                                      disabled={!effectiveCloudSettingsWorkflowId || !hasCloudOverrideForPick}
                                      onClick={() => {
                                        if (!effectiveCloudSettingsWorkflowId) return
                                        const ok = window.confirm(
                                          '确定恢复为授权服务上的默认工作流？本机对该云端工作流的参数修改将被丢弃。',
                                        )
                                        if (!ok) return
                                        const prev = activeNodeConfig.cloudWorkflowOverrides ?? {}
                                        const next = { ...prev }
                                        delete next[effectiveCloudSettingsWorkflowId]
                                        onNodeConfigChange(activeKind, {
                                          cloudWorkflowOverrides: Object.keys(next).length ? next : undefined,
                                        })
                                      }}
                                    >
                                      恢复默认
                                    </button>
                                    <button
                                      type="button"
                                      className={WF_BTN_CAPSULE_DARK_COMPACT}
                                      disabled={!effectiveCloudSettingsWorkflowId}
                                      onClick={() => {
                                        if (!effectiveCloudSettingsWorkflowId) return
                                        setCloudWorkflowGuideOpenId(effectiveCloudSettingsWorkflowId)
                                      }}
                                    >
                                      使用说明
                                    </button>
                                    {activeKind === 'text' ? (
                                      <button
                                        type="button"
                                        className={WF_BTN_CAPSULE_DARK_COMPACT}
                                        disabled={!effectiveCloudSettingsWorkflowId}
                                        onClick={() => {
                                          if (!effectiveCloudSettingsWorkflowId) return
                                          setCloudSystemPromptModalWorkflowId(effectiveCloudSettingsWorkflowId)
                                          setCloudSystemPromptModalDraft(
                                            nodeConfigs.text.cloudWorkflowSystemPrompts?.[
                                              effectiveCloudSettingsWorkflowId
                                            ] ?? '',
                                          )
                                        }}
                                      >
                                        系统提示词
                                      </button>
                                    ) : null}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              

              
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
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">素材库</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">assets</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.materialLibraryPath}
                      placeholder={
                        isElectronDesktop
                          ? '右侧面板「我的素材库」同步根目录，将自动创建 人物/场景/道具/音效/其他'
                          : '桌面版可同步本地素材库；网页版可填写备忘路径'
                      }
                      onChange={(e) => setDiskPaths((p) => ({ ...p, materialLibraryPath: e.target.value }))}
                      aria-label="素材库根目录路径"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        title="选择文件夹"
                        className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                        onClick={() => void pickMaterialLibraryPath()}
                      >
                        选择
                      </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('materialLibraryPath')}
                      >
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-24 shrink-0 px-1">
                      <div className="text-[14px] font-black uppercase text-white/80">封面存储</div>
                      <div className="font-mono text-[11px] uppercase text-white/25">covers</div>
                    </div>
                    <input
                      className={`${WF_INPUT} min-w-0 flex-1`}
                      value={diskPaths.systemPromptCoverPath}
                      placeholder={
                        isElectronDesktop
                          ? '例如 D:\\FlowidData\\system-prompt-covers（右栏系统提示词封面上传到此目录）'
                          : '桌面版可落盘封面；网页版可填写备忘路径'
                      }
                      onChange={(e) => setDiskPaths((p) => ({ ...p, systemPromptCoverPath: e.target.value }))}
                      aria-label="系统提示词封面存储目录"
                    />
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        title="选择文件夹"
                        className={`${WF_BTN_CAPSULE_DARK} text-[11px]`}
                        onClick={() => void pickSystemPromptCoverPath()}
                      >
                        选择
                      </button>
                      <button
                        type="button"
                        className={`${WF_BTN_CAPSULE_MUTED} text-[11px]`}
                        onClick={() => void clearPathField('systemPromptCoverPath')}
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
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={sensitiveFilterEnabled}
                      onChange={(e) => {
                        const v = e.target.checked
                        setSensitiveWordFilterEnabled(v)
                        setSensitiveFilterEnabledUi(v)
                      }}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                      启用敏感词检测（拦截与替换）
                    </span>
                  </label>
                  <p className="m-0 pl-8 text-[11px] leading-relaxed text-white/35">
                    开发构建默认关闭；关闭后助手聊天与节点文案不再被敏感词拦截或打星号。正式构建默认开启，可在此强制打开或关闭。
                  </p>
                </div>
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-orange-600 rounded"
                      checked={aiAssistantConfig.virtualAvatarVisible}
                      onChange={(e) => onAiAssistantConfigChange({ virtualAvatarVisible: e.target.checked })}
                    />
                    <span className="text-[14px] font-black uppercase tracking-widest text-white/50">
                      显示画布 AI 虚拟助手
                    </span>
                  </label>
                  <p className="m-0 pl-8 text-[11px] leading-relaxed text-white/35">
                    关闭后隐藏右下角虚拟人；需要对话时请重新开启。
                  </p>
                </div>
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
                      <span className="min-w-0">
                        <span className="block text-[15px] font-black tracking-wider text-white/60">
                          {item.label}
                        </span>
                        {item.hint ? (
                          <span className="mt-0.5 block text-[11px] font-medium leading-snug text-white/25">
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
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

          {activeTab === 'cloud-models' ? (
            <div className="space-y-5">
              <div className={`${WF_CARD} space-y-6 p-6`}>
                <div className={`${WF_SECTION_TITLE} border-b border-white/5 pb-4`}>云端模型</div>

                <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/30 p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-full py-3 text-[13px] font-black uppercase tracking-widest transition-all ${
                      cloudModelsSubTab === 'self'
                        ? 'border border-white/5 bg-white/5 text-white/90 shadow-xl'
                        : 'border border-transparent text-white/20 hover:text-white/40'
                    }`}
                    onClick={() => setCloudModelsSubTab('self')}
                  >
                    自助模式
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-full py-3 text-[13px] font-black uppercase tracking-widest transition-all ${
                      cloudModelsSubTab === 'logs'
                        ? 'border border-white/5 bg-white/5 text-white/90 shadow-xl'
                        : 'border border-transparent text-white/20 hover:text-white/40'
                    }`}
                    onClick={() => setCloudModelsSubTab('logs')}
                  >
                    调用记录
                  </button>
                </div>

                {cloudModelsSubTab === 'self' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className={WF_SECTION_TITLE}>配置列表</div>
                      <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={startNewCloudSelf}>
                        新增
                      </button>
                    </div>

                    {editingCloudSelfId ? (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
                        {officialLineConfigured ? (
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>接入方式</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={`rounded-full border px-4 py-2 text-[12px] font-black uppercase tracking-widest transition-colors ${
                                  cloudSelfDraft.connectionSource === 'custom'
                                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                                    : 'border-white/10 bg-black/30 text-white/40 hover:border-white/20 hover:text-white/60'
                                }`}
                                onClick={() =>
                                  setCloudSelfDraft((d) => ({ ...d, connectionSource: 'custom', baseUrl: d.baseUrl }))
                                }
                              >
                                自助：自填 API 地址
                              </button>
                              <button
                                type="button"
                                className={`rounded-full border px-4 py-2 text-[12px] font-black uppercase tracking-widest transition-colors ${
                                  cloudSelfDraft.connectionSource === 'official'
                                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                                    : 'border-white/10 bg-black/30 text-white/40 hover:border-white/20 hover:text-white/60'
                                }`}
                                onClick={() =>
                                  setCloudSelfDraft((d) => ({ ...d, connectionSource: 'official', baseUrl: '' }))
                                }
                              >
                                平台：仅填 Key
                              </button>
                            </div>
                            <p className="text-[11px] leading-relaxed text-white/30">
                              平台模式下不在此页展示厂商根地址；地址由发行版构建变量注入（仍可能被逆向/抓包，仅防普通用户误改）。
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] leading-relaxed text-white/30">
                            若需「仅填 Key、隐藏厂商地址」：在打包环境设置{' '}
                            <span className="font-mono text-white/45">VITE_CLOUD_OFFICIAL_DOUBAO_URL</span> 等变量后重新构建。
                          </p>
                        )}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>匹配节点</div>
                            <select
                              className={WF_SELECT}
                              value={cloudSelfDraft.nodeKind || ''}
                              onChange={(e) =>
                                setCloudSelfDraft((p) => ({ ...p, nodeKind: (e.target.value as any) || '' }))
                              }
                            >
                              <option value="">通用（不限定节点）</option>
                              {(Object.keys(KIND_LABELS) as StudioNodeKind[]).map((k) => (
                                <option key={k} value={k}>
                                  {KIND_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>分类</div>
                            <select
                              className={WF_SELECT}
                              value={cloudSelfDraft.providerId}
                              onChange={(e) =>
                                setCloudSelfDraft((p) => ({
                                  ...p,
                                  providerId: e.target.value as CloudProviderId,
                                  model:
                                    CLOUD_PROVIDERS.find((x) => x.id === (e.target.value as CloudProviderId))
                                      ?.models?.[0] || p.model,
                                }))
                              }
                            >
                              {CLOUD_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>默认模型</div>
                            <select
                              className={WF_SELECT}
                              value={cloudSelfDraft.model}
                              onChange={(e) => setCloudSelfDraft((p) => ({ ...p, model: e.target.value }))}
                            >
                              {(CLOUD_PROVIDERS.find((p) => p.id === cloudSelfDraft.providerId)?.models || []).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                        </div>

                        {cloudSelfDraft.connectionSource === 'official' ? (
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>API 地址</div>
                            <div className="rounded-xl border border-white/5 bg-black/40 p-3 text-[13px] text-white/40">
                              已隐藏（当前分类：
                              <span className="font-mono text-white/55">{cloudSelfDraft.providerId}</span>
                              {hasOfficialCloudBaseUrl(cloudSelfDraft.providerId) ? '，已配置根 URL）' : '，本构建未配置根 URL）'}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className={WF_SECTION_TITLE}>API 地址</div>
                            <input
                              className={WF_INPUT}
                              value={cloudSelfDraft.baseUrl}
                              placeholder="OpenAI 兼容 API 地址"
                              onChange={(e) => setCloudSelfDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className={WF_SECTION_TITLE}>API Key</div>
                          <div className="relative">
                            <input
                              className={`${WF_INPUT} pr-[4.75rem]`}
                              type={cloudKeyVisible ? 'text' : 'password'}
                              autoComplete="off"
                              value={cloudSelfDraft.apiKey}
                              placeholder="输入 API Key"
                              onChange={(e) => setCloudSelfDraft((p) => ({ ...p, apiKey: e.target.value }))}
                            />
                            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 hover:bg-white/10 hover:text-white/70"
                                title="复制 API Key（不依赖框内选中文本）"
                                aria-label="复制 API Key"
                                onClick={() => {
                                  const t = String(cloudSelfDraft.apiKey || '').trim()
                                  if (!t) {
                                    setCloudSelfMsg('当前没有可复制的 Key')
                                    return
                                  }
                                  void navigator.clipboard.writeText(t).then(
                                    () => setCloudSelfMsg('已复制到剪贴板'),
                                    () => setCloudSelfMsg('复制失败：请允许剪贴板权限，或先点「眼睛」显示明文后用 Ctrl+C'),
                                  )
                                }}
                              >
                                <Copy size={16} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 hover:bg-white/10 hover:text-white/70"
                                title={cloudKeyVisible ? '隐藏' : '显示'}
                                aria-label={cloudKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                                onClick={() => setCloudKeyVisible((v) => !v)}
                              >
                                {cloudKeyVisible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={WF_BTN_CAPSULE_DARK} onClick={saveCloudSelfDraft}>
                            保存
                          </button>
                          <button type="button" className={WF_BTN_CAPSULE_MUTED} onClick={() => void testCloudSelfDraft()}>
                            测试
                          </button>
                          <button
                            type="button"
                            className={WF_BTN_CAPSULE_MUTED}
                            onClick={() => {
                              setEditingCloudSelfId(null)
                              setCloudSelfMsg('')
                            }}
                          >
                            关闭
                          </button>
                          {cloudSelfMsg ? <div className="self-center text-[12px] font-mono text-white/35">{cloudSelfMsg}</div> : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {cloudSelfPresets.length ? (
                        cloudSelfPresets.map((p) => {
                          const isActive = (activeCloudSelfPresetId || '') === p.id
                          return (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                                isActive ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/5 bg-black/20'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-black uppercase tracking-widest text-white/55">
                                    {p.providerId}
                                  </span>
                                  {String((p as any)?.nodeKind || '').trim() ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-white/35">
                                      {KIND_LABELS[(String((p as any).nodeKind) as StudioNodeKind) || 'text'] ||
                                        String((p as any).nodeKind)}
                                    </span>
                                  ) : null}
                                  <span className="truncate font-mono text-[12px] text-white/35">
                                    {p.connectionSource === 'official' ? '平台固定线路' : p.baseUrl}
                                  </span>
                                </div>
                                <div className="mt-1 truncate font-mono text-[12px] text-white/45">{p.model}</div>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_COMPACT}
                                  onClick={() => {
                                    setActiveCloudSelfPresetId(p.id)
                                    setActiveCloudSelfPresetIdState(p.id)
                                  }}
                                >
                                  使用
                                </button>
                                <button type="button" className={WF_BTN_CAPSULE_COMPACT} onClick={() => startEditCloudSelf(p)}>
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_DARK_COMPACT}
                                  onClick={async () => {
                                    setEditingCloudSelfId(p.id)
                                    setCloudSelfDraft({
                                      nodeKind: (String((p as any)?.nodeKind || '') as any) || '',
                                      providerId: p.providerId as CloudProviderId,
                                      connectionSource: p.connectionSource === 'official' ? 'official' : 'custom',
                                      baseUrl: p.connectionSource === 'official' ? '' : p.baseUrl,
                                      apiKey: p.apiKey,
                                      model: p.model,
                                    })
                                    await testCloudSelfDraft()
                                  }}
                                >
                                  测试
                                </button>
                                <button
                                  type="button"
                                  className={WF_BTN_CAPSULE_DARK_COMPACT}
                                  onClick={() => {
                                    if (!window.confirm('确定删除该配置？')) return
                                    setCloudSelfPresets(removeCloudSelfPreset(p.id))
                                  }}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div className="rounded-2xl border border-white/5 bg-black/20 p-4 text-[13px] text-white/35">
                          暂无配置。点击「新增」添加一条。
                        </div>
                      )}
                    </div>

                    <div className="mt-6 overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                        onClick={() => setAssistSectionOpen((v) => !v)}
                      >
                        <span className={WF_SECTION_TITLE}>辅助线路（平台配置 · 仅填 Key）</span>
                        {assistSectionOpen ? (
                          <ChevronDown size={18} className="shrink-0 text-white/35" aria-hidden />
                        ) : (
                          <ChevronRight size={18} className="shrink-0 text-white/35" aria-hidden />
                        )}
                      </button>
                      {assistSectionOpen ? (
                        <div className="space-y-4 border-t border-white/5 px-4 py-4">
                          <p className="text-[11px] leading-relaxed text-white/30">
                            各类型 API Key 仅保存在本机。管理员在 Auth 控制台「云端模型配置」维护根地址与模型；画布「云端模型」下拉里以「辅助 · …」展示，可与自助预设同时使用。授权码与积分仅用于云端
                            ComfyUI 工作流；本页云端模型不依赖授权激活。以下输入框均支持
                            <span className="text-white/45"> Ctrl+V / 右键粘贴</span>
                            ；从邮件或文档粘贴时会自动去掉首尾空白与换行。
                          </p>
                          {CLOUD_ASSIST_KIND_LIST.map((k) => (
                            <div key={k} className="flex flex-wrap items-center gap-2">
                              <span className="w-14 shrink-0 text-[12px] font-black uppercase tracking-widest text-white/40">
                                {CLOUD_ASSIST_KIND_LABELS[k]}
                              </span>
                              <input
                                className={`${WF_INPUT} min-w-[200px] flex-1`}
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                autoCapitalize="off"
                                autoCorrect="off"
                                placeholder="API Key"
                                value={assistKeyDraft[k]}
                                onPaste={(e) => {
                                  const raw = e.clipboardData?.getData('text/plain')
                                  if (raw == null) return
                                  const normalized = String(raw)
                                    .replace(/\u200b/g, '')
                                    .trim()
                                    .replace(/[\r\n\t]+/g, '')
                                  const dirty =
                                    /[\r\n\u200b]/.test(String(raw)) || String(raw) !== String(raw).trim()
                                  if (!dirty) return
                                  e.preventDefault()
                                  setAssistKeyDraft((d) => ({ ...d, [k]: normalized }))
                                  writeAssistApiKeys({ [k]: normalized })
                                }}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setAssistKeyDraft((d) => ({ ...d, [k]: v }))
                                  writeAssistApiKeys({ [k]: v })
                                }}
                              />
                              <button
                                type="button"
                                className={WF_BTN_CAPSULE_MUTED}
                                onClick={() => {
                                  void (async () => {
                                    setAssistLineTestMsg((m) => ({ ...m, [k]: '测试中…' }))
                                    const r = await testAssistConnectionForKind(k)
                                    setAssistLineTestMsg((m) => ({ ...m, [k]: r.message }))
                                  })()
                                }}
                              >
                                测试连接
                              </button>
                              {assistLineTestMsg[k] ? (
                                <span className="w-full font-mono text-[11px] text-white/35 sm:w-auto sm:flex-1">
                                  {assistLineTestMsg[k]}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className={WF_SECTION_TITLE}>调用记录</div>
                      <div className="text-[12px] text-white/30">只保留近 3 天，超过自动删除</div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                      <div className="grid grid-cols-[160px_120px_1fr_80px] gap-2 border-b border-white/5 bg-black/40 px-4 py-3 text-[12px] font-black uppercase tracking-[0.2em] text-white/20">
                        <span>时间</span>
                        <span>节点</span>
                        <span>模型</span>
                        <span className="text-right">次数</span>
                      </div>
                      <div className="max-h-[360px] overflow-auto custom-scrollbar">
                        {pagedCloudLogs.items.length ? (
                          pagedCloudLogs.items.map((r) => (
                            <div
                              key={`${r.ts}-${r.nodeKind}-${r.model}`}
                              className="grid grid-cols-[160px_120px_1fr_80px] items-center gap-2 border-t border-white/5 px-4 py-3 text-[13px] text-white/55"
                            >
                              <span className="font-mono text-[12px] text-white/35">
                                {new Date(r.ts).toLocaleString('zh-CN')}
                              </span>
                              <span className="text-white/55">
                                {KIND_LABELS[(r.nodeKind as StudioNodeKind) || 'text'] ||
                                  String(r.nodeKind || '-')}
                              </span>
                              <span className="min-w-0 truncate font-mono text-[12px] text-white/45">{r.model}</span>
                              <span className="text-right font-mono text-[12px] text-white/45">{r.count}</span>
                            </div>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-[13px] leading-relaxed text-white/35">
                            暂无记录。
                          </div>
                        )}
                      </div>
                    </div>

                    {pagedCloudLogs.totalPages > 1 ? (
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          type="button"
                          className={WF_BTN_CAPSULE_DARK}
                          disabled={pagedCloudLogs.page <= 1}
                          onClick={() => setCloudLogsPage((p) => Math.max(1, p - 1))}
                        >
                          ←
                        </button>
                        <div className="font-mono text-[12px] text-white/35">
                          {String(pagedCloudLogs.page).padStart(2, '0')} /{' '}
                          {String(pagedCloudLogs.totalPages).padStart(2, '0')}
                        </div>
                        <button
                          type="button"
                          className={WF_BTN_CAPSULE_DARK}
                          disabled={pagedCloudLogs.page >= pagedCloudLogs.totalPages}
                          onClick={() => setCloudLogsPage((p) => Math.min(pagedCloudLogs.totalPages, p + 1))}
                        >
                          →
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === 'device-activation' ? (
            <LicenseActivationPanel active layout="embedded" />
          ) : null}

          {activeTab === 'user-agreement' ? (
            <div className={`${WF_CARD} p-6`}>
              <div className="space-y-4">
                <div className={WF_SECTION_TITLE}>只读协议文本（可滚动）</div>
                <div className="text-[12px] text-white/35">
                  {userAgreementRemote
                    ? `来源：授权服务 · version=${userAgreementRemote.version} · 更新 ${new Date(
                        userAgreementRemote.updatedAtMs,
                      ).toLocaleString('zh-CN')}`
                    : '来源：内置默认（未配置授权服务或拉取失败）'}
                </div>
                <textarea
                  readOnly
                  value={userAgreementRemote?.text ?? USER_AGREEMENT_TEXT}
                  className={`${WF_INPUT} min-h-[520px] max-h-[60vh] resize-y whitespace-pre-wrap leading-relaxed`}
                  aria-label="用户协议（只读）"
                />
              </div>
            </div>
          ) : null}

          {lastExecutionMessage ? (
            <div className={`${WF_CARD} space-y-3 p-6`}>
              <div className={WF_SECTION_TITLE}>最近执行</div>
              <p
                className={`m-0 text-[14px] leading-relaxed ${
                  lastExecutionMessage.includes('积分已自动退还')
                    ? 'text-red-300/95'
                    : 'text-white/40'
                }`}
              >
                {lastExecutionMessage}
              </p>
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {cloudWorkflowGuideOpenId ? (
        <div
          className="fixed inset-0 z-[12250] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md"
          role="presentation"
          onMouseDown={() => setCloudWorkflowGuideOpenId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="云端工作流使用说明"
            className={`max-h-[min(78vh,720px)] w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl ${
              canvasDayMode
                ? 'border-black/10 bg-[#fafafa] text-[#1a1a1a]'
                : 'border-white/10 bg-[#121214] text-white/90'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(() => {
              const meta = cloudWorkflowMetaList.find((w) => w.id === cloudWorkflowGuideOpenId)
              const guide = getCloudWorkflowUserGuide({
                id: cloudWorkflowGuideOpenId,
                name: meta?.name || cloudWorkflowGuideOpenId,
                description: meta?.description,
                nodeKind: meta?.nodeKind || activeKind || 'text',
              })
              const title = guide.title || meta?.name || '云端工作流'
              const renderRows = (section: string, rows: CloudWorkflowIoRow[]) => (
                <div className="space-y-2">
                  <div
                    className={`text-[11px] font-black uppercase tracking-widest ${
                      canvasDayMode ? 'text-black/40' : 'text-white/35'
                    }`}
                  >
                    {section}
                  </div>
                  <ul className="m-0 list-none space-y-2 p-0">
                    {rows.map((row, idx) => (
                      <li
                        key={`${section}-${idx}`}
                        className={`rounded-xl border px-3 py-2.5 ${
                          canvasDayMode ? 'border-black/8 bg-black/[0.03]' : 'border-white/8 bg-black/30'
                        }`}
                      >
                        <div className="flex flex-wrap items-start gap-2">
                          <span className={cloudGuideMediaClass(row.media)}>{cloudGuideMediaLabel(row.media)}</span>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-[13px] font-black leading-snug ${
                                canvasDayMode ? 'text-[#111]' : 'text-white/88'
                              }`}
                            >
                              {row.title}
                              <span
                                className={`ml-2 font-mono text-[11px] font-bold ${
                                  canvasDayMode ? 'text-black/45' : 'text-white/40'
                                }`}
                              >
                                × {row.count}
                              </span>
                            </div>
                            {row.detail ? (
                              <p
                                className={`m-0 mt-1.5 text-[12px] leading-relaxed ${
                                  canvasDayMode ? 'text-black/55' : 'text-white/45'
                                }`}
                              >
                                {row.detail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
              return (
                <>
                  <div
                    className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${
                      canvasDayMode ? 'border-black/8 bg-black/[0.02]' : 'border-white/8 bg-black/20'
                    }`}
                  >
                    <div className="min-w-0">
                      <div
                        className={`text-[10px] font-black uppercase tracking-[0.25em] ${
                          canvasDayMode ? 'text-black/35' : 'text-white/35'
                        }`}
                      >
                        工作流使用指南
                      </div>
                      <div
                        className={`mt-1 truncate text-[15px] font-black tracking-wide ${
                          canvasDayMode ? 'text-[#111]' : 'text-white/90'
                        }`}
                        title={title}
                      >
                        {title}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭"
                      className={`shrink-0 rounded-xl border p-2 transition-colors ${
                        canvasDayMode
                          ? 'border-black/10 bg-white text-black/50 hover:bg-black/5 hover:text-black/80'
                          : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/80'
                      }`}
                      onClick={() => setCloudWorkflowGuideOpenId(null)}
                    >
                      <X size={18} strokeWidth={2} />
                    </button>
                  </div>
                  <div
                    className={`max-h-[min(58vh,560px)] space-y-5 overflow-y-auto px-5 py-4 custom-scrollbar ${
                      canvasDayMode ? 'text-black/70' : 'text-white/55'
                    }`}
                  >
                    {!guide.fromBuiltinTable ? (
                      <p
                        className={`m-0 rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${
                          canvasDayMode
                            ? 'border-amber-500/25 bg-amber-500/10 text-amber-900/90'
                            : 'border-amber-500/25 bg-amber-500/10 text-amber-100/90'
                        }`}
                      >
                        当前工作流 id 未收入本机内置说明表，以下为按节点类型自动生成的兜底说明；复杂槽位请以「参数设置」中的
                        JSON 为准。
                      </p>
                    ) : null}
                    {guide.summary ? (
                      <p className={`m-0 text-[13px] leading-relaxed ${canvasDayMode ? 'text-black/65' : 'text-white/50'}`}>
                        {guide.summary}
                      </p>
                    ) : null}
                    {renderRows('需要输入', guide.inputs)}
                    {renderRows('输出', guide.outputs)}
                    {guide.canvasHints?.length ? (
                      <div className="space-y-2">
                        <div
                          className={`text-[11px] font-black uppercase tracking-widest ${
                            canvasDayMode ? 'text-black/40' : 'text-white/35'
                          }`}
                        >
                          画布提示
                        </div>
                        <ul
                          className={`m-0 list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed ${
                            canvasDayMode ? 'text-black/60' : 'text-white/45'
                          }`}
                        >
                          {guide.canvasHints.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={`flex justify-end border-t px-5 py-3 ${
                      canvasDayMode ? 'border-black/8 bg-black/[0.02]' : 'border-white/8 bg-black/25'
                    }`}
                  >
                    <button
                      type="button"
                      className={WF_BTN_CAPSULE_DARK}
                      onClick={() => setCloudWorkflowGuideOpenId(null)}
                    >
                      关闭
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      ) : null}

      {cloudSystemPromptModalWorkflowId ? (
        <div
          className="fixed inset-0 z-[12260] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md"
          role="presentation"
          onMouseDown={() => setCloudSystemPromptModalWorkflowId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="云端工作流系统提示词"
            className={`w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl ${
              canvasDayMode
                ? 'border-black/10 bg-[#fafafa] text-[#1a1a1a]'
                : 'border-white/10 bg-[#121214] text-white/90'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${
                canvasDayMode ? 'border-black/8 bg-black/[0.02]' : 'border-white/8 bg-black/20'
              }`}
            >
              <div className="min-w-0">
                <div
                  className={`text-[10px] font-black uppercase tracking-[0.25em] ${
                    canvasDayMode ? 'text-black/35' : 'text-white/35'
                  }`}
                >
                  系统提示词
                </div>
                <div
                  className={`mt-1 text-[13px] font-bold leading-snug ${
                    canvasDayMode ? 'text-black/70' : 'text-white/55'
                  }`}
                >
                  {cloudWfsForActiveKind.find((w) => w.id === cloudSystemPromptModalWorkflowId)?.name ||
                    '当前云端工作流'}
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className={`shrink-0 rounded-xl border p-2 transition-colors ${
                  canvasDayMode
                    ? 'border-black/10 bg-white text-black/50 hover:bg-black/5 hover:text-black/80'
                    : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/80'
                }`}
                onClick={() => setCloudSystemPromptModalWorkflowId(null)}
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p
                className={`m-0 text-[12px] leading-relaxed ${
                  canvasDayMode ? 'text-black/55' : 'text-white/45'
                }`}
              >
                保存后写入本机配置；执行 Comfy 时将替换模板中的{' '}
                <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
                  {CLOUD_WORKFLOW_SYSTEM_PROMPT_TOKEN}
                </code>
                。与侧栏「系统提示词」区块共用同一存储。
              </p>
              <textarea
                className={`${WF_INPUT} min-h-[140px] resize-y whitespace-pre-wrap leading-relaxed`}
                value={cloudSystemPromptModalDraft}
                onChange={(e) => setCloudSystemPromptModalDraft(e.target.value)}
                placeholder="留空表示不注入系统提示（Comfy 侧为空字符串）。可粘贴，或拖入文本、.txt。"
                aria-label="系统提示词内容"
                onPaste={(e) => {
                  e.stopPropagation()
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const dt = e.dataTransfer
                  if (dt.types.includes('text/plain') || dt.types.includes('Files')) {
                    dt.dropEffect = 'copy'
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const el = e.currentTarget
                  const applyChunk = (chunk: string) => {
                    const t = chunk.trim()
                    if (!t) return
                    const { nextValue, nextCaret } = insertTextAtCaret(el, t)
                    setCloudSystemPromptModalDraft(nextValue)
                    queueMicrotask(() => {
                      try {
                        el.focus()
                        el.setSelectionRange(nextCaret, nextCaret)
                      } catch {
                        // ignore
                      }
                    })
                  }
                  const syncChunk = readDraggedPlainTextSync(e.dataTransfer)
                  if (syncChunk.trim()) {
                    applyChunk(syncChunk)
                    return
                  }
                  void (async () => {
                    applyChunk(await readDraggedPlainText(e.dataTransfer))
                  })()
                }}
              />
            </div>
            <div
              className={`flex flex-wrap justify-end gap-2 border-t px-5 py-3 ${
                canvasDayMode ? 'border-black/8 bg-black/[0.02]' : 'border-white/8 bg-black/25'
              }`}
            >
              <button
                type="button"
                className={WF_BTN_CAPSULE_DARK}
                onClick={() => setCloudSystemPromptModalWorkflowId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={WF_BTN_CAPSULE_COMPACT}
                onClick={() => {
                  const id = cloudSystemPromptModalWorkflowId
                  if (!id) return
                  const raw = cloudSystemPromptModalDraft
                  const prev = nodeConfigs.text.cloudWorkflowSystemPrompts ?? {}
                  const next = { ...prev }
                  if (raw.trim()) next[id] = raw
                  else delete next[id]
                  onNodeConfigChange('text', {
                    cloudWorkflowSystemPrompts: Object.keys(next).length ? next : undefined,
                  })
                  setCloudSystemPromptModalWorkflowId(null)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </motion.section>
  )
}
