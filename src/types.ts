import type { Edge, Node } from '@xyflow/react'

/**
 * 画布节点类型枚举（Flowid 多模态节点划分，便于后续接真实生成管线）。
 */
export type StudioNodeKind =
  | 'text'
  | 'script'
  | 'image'
  | 'imageCompare'
  | 'video'
  | 'audio'
  | 'music'
  | 'panorama'
export type NodeRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error'

/**
 * Comfy 任务轮询阶段映射的近似进度，便于用户感知仍在运行。
 */
export type NodeRunProgress = {
  /** 0–100 */
  percent: number
  /** 阶段说明 */
  label: string
}

export type WorkflowProviderType = 'local' | 'cloud'
export type WorkflowExecutionMode = 'custom' | 'official'

/**
 * 工作流模板：保存一份 ComfyUI workflow JSON 与输入映射规则。
 */
export type WorkflowTemplate = {
  id: string
  name: string
  workflow: Record<string, unknown>
  /**
   * 键为节点输入字段名（如 prompt/body/src），值为 workflow 内目标路径。
   * 例如：{ "prompt": "34.inputs.text" }
   */
  inputMapping: Record<string, string>
  createdAt: number
}

/**
 * ComfyUI 连接配置（本地或云端）。
 */
export type WorkflowProviderConfig = {
  enabled: boolean
  baseUrl: string
  apiKey?: string
  timeoutSec: number
}

/**
 * 节点类型到工作流模板的绑定关系。
 */
export type WorkflowTemplateBindings = Partial<Record<StudioNodeKind, string>>

/** 本地对授权服务「云端工作流」JSON 的覆盖（按云端工作流 id 存储） */
export type CloudWorkflowOverrideEntry = {
  jsonText: string
  resultNodeId?: string
  resultFieldPath?: string
  updatedAt?: number
}

/**
 * 节点级工作流配置：同一类节点可共享一套本地/云端配置。
 */
export type NodeWorkflowConfig = {
  /** ComfyUI workflow JSON 文本 */
  workflowJsonText: string
  /** 当前工作流名称（用于保存到列表） */
  workflowName: string
  /** 工作流列表 */
  workflows: Array<{
    id: string
    name: string
    jsonText: string
    createdAt: number
    /** 该工作流条目的结果节点 id（可选） */
    resultNodeId?: string
    /** 该工作流条目的结果字段路径（可选，如 text.0） */
    resultFieldPath?: string
  }>
  /** 当前选中的工作流 id */
  selectedWorkflowId?: string
  /** 云端模型名称（展示/选择值） */
  cloudModelName: string
  /** 云端模型地址 */
  cloudModelUrl: string
  /** 云端模型 API Key */
  cloudApiKey: string
  /** 官方模板 id（执行模式为 official 时使用） */
  officialTemplateId?: string
  /** 兼容旧版本：节点类型级结果提取（新版本优先读取工作流条目内配置）。 */
  resultNodeId?: string
  /** 兼容旧版本：节点类型级结果字段路径（新版本优先读取工作流条目内配置）。 */
  resultFieldPath?: string
  /**
   * 设置页「文本/图片/视频…」里当前编辑的是本地导入列表还是云端授权工作流。
   * 与全局「执行环境 本地/云端 Comfy」独立：便于在本地执行时仍预调云端 JSON，或反之。
   */
  settingsEditTarget?: 'local' | 'cloud'
  /** 设置页云端分支：当前选中的云端工作流 id（来自授权服务 /cloud-workflows） */
  cloudSettingsSelectedWorkflowId?: string
  /**
   * 云端工作流 id → 用户在本机保存的 JSON 与结果映射；缺省时执行仍从授权服务拉取原版。
   * 值可为纯字符串（旧版仅保存 JSON 文本）或完整条目对象。
   */
  cloudWorkflowOverrides?: Record<string, CloudWorkflowOverrideEntry | string>
  /**
   * 文本类 Comfy 模板中 `__SYSTEM_PROMPT__` 占位替换（按云端条目 id 或本地工作流条目 id 存储）。
   * 执行时自 `nodeConfigs.text` 读取，以便脚本节点与文本节点共用对话类云端工作流。
   */
  cloudWorkflowSystemPrompts?: Record<string, string>
}

export type ShortcutCommandId =
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'fitView'
  | 'resetZoom'
  /** 画布矩形框选：按住该键在空白处拖选（与 React Flow `selectionKeyCode` 一致） */
  | 'marqueeSelect'

/** 单次运行可能产生的多条媒体（分镜多图等），用于节点底部缩略图条 */
export type NodeResultThumbnail = {
  id: string
  url: string
  /** 本图在 IndexedDB 中的资产 id（仅部分图片经本地落库后有） */
  assetId?: string
  fileName?: string
  /** 镜像到本地输出目录后的绝对路径 */
  diskPath?: string
  mediaKind: 'image' | 'video' | 'audio'
}

/**
 * 各节点在 React Flow `data` 中承载的业务字段。
 */
export type StudioNodeDataBase = {
  /** 节点标题（可编辑） */
  title: string
  /** 节点执行状态（用于工作流运行可视化） */
  runStatus?: NodeRunStatus
  /** 执行中：队列/历史轮询映射的进度与说明 */
  runProgress?: NodeRunProgress
  /** 最近执行时间戳 */
  lastRunAt?: number
  /** 可选：节点级模板绑定（优先级高于全局类型绑定） */
  workflowTemplateId?: string
  /**
   * 底部面板 / 提示框为当前节点选中的工作流条目 id（与 `nodeConfigs[kind].workflows[].id` 对应）。
   * 未设置时执行与下拉默认使用设置里工作流列表的第一条（置顶项），而非设置面板内的 `selectedWorkflowId`。
   */
  workflowEntryId?: string

  /**
   * 底部提示框切换：显式 `workflow` 时走 Comfy 工作流；未设置或 `model` 时走「模型」线路（新建节点默认模型）。
   * 节点级状态，用于同一画布不同节点不同执行路径。
   */
  promptPickerMode?: 'workflow' | 'model'

  /**
   * 节点级云端模型配置（用于“模型”模式执行）。
   * 不同节点可配置不同模型与 key，不随节点类型同步。
   */
  cloudModelName?: string
  cloudModelUrl?: string
  cloudApiKey?: string

  /** 自助模式：选中的云端模型预设 id（与 `cloudAssistModelPick` 二选一） */
  cloudSelfPresetId?: string
  /** 辅助线路：编码后的「端点 + 模型」选择值（见 `encodeCloudAssistModelPick`） */
  cloudAssistModelPick?: string

  /**
   * 兼容字段：部分 UI 层会在未严格区分 kind 的情况下读取媒体节点字段。
   * 这些字段对非媒体节点应视为不存在（undefined）。
   */
  src?: string
  srcAssetId?: string
  /**
   * 主预览对应生成物在本地 output 目录的绝对路径（桌面端镜像成功后写入）。
   * 重启后优先从此路径恢复，避免仅按节点标题扫目录导致跨工程/重名串文件。
   */
  srcDiskPath?: string
  referenceImageSources?: string[]
  referenceImageAssetIds?: string[]

  /** 运行产生的媒体缩略图队列（最新批次在前）；主预览仍为 `src` */
  resultThumbnails?: NodeResultThumbnail[]
  /** 为 true 时展开底部输出缩略图行（默认折叠） */
  resultThumbnailsExpanded?: boolean
  /** 当前授权下，按本节点工作流/模型预估的单次预扣积分（仅展示，不落盘） */
  pointsReserveHint?: number
}

export type TextNodeData = StudioNodeDataBase & {
  kind: 'text'
  /** 短文本/提示词片段 */
  body: string
  /** 底部面板选择的工作流名称（与设置中列表对应） */
  model?: string
}

export type ScriptNodeData = StudioNodeDataBase & {
  kind: 'script'
  /** 剧本/脚本正文 */
  body: string
}

/**
 * 画布「加点抠图」：坐标为相对主图 **像素宽高** 的 0～1 归一化（与 object-fit: contain 无关，Comfy 与主图对齐）。
 * `t=1` 表示保留（绿），`t=0` 表示去掉（红）。
 */
export type MattingPoint = { x: number; y: number; t: 0 | 1 }

/** 图片节点「模型」模式云端生图：宽高比（写入 API `size`，不拼进 prompt） */
export type CloudImageAspectKey =
  | 'auto'
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:5'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '21:9'

/** 云端生图分辨率档位（影响 `size` 像素与 `quality`） */
export type CloudImageResolutionTier = '1k' | '2k'

/**
 * 画布内双图滑动对比（不执行 Comfy，仅本地预览）。
 */
export type ImageCompareNodeData = StudioNodeDataBase & {
  kind: 'imageCompare'
  /** 左半 / 滑块左侧显示的图像 URL（与图片节点主图同源） */
  compareSrcA: string
  /** 右半 / 底层完整显示的图像 URL */
  compareSrcB: string
  compareLabelA?: string
  compareLabelB?: string
}

export type ImageNodeData = StudioNodeDataBase & {
  kind: 'image'
  /** 参考图 URL 或占位说明 */
  src: string
  /** 主图原始文件名（用于排序与展示） */
  srcFileName?: string
  /** 本地上传主图在 IndexedDB 中的资产 id（用于重启后恢复） */
  srcAssetId?: string
  prompt: string
  /** 底部面板选择的工作流名称 */
  model?: string
  /** 底部面板上传的多张参考图（blob URL，供占位符 __REF_IMAGES__ 与工作流使用） */
  referenceImageSources?: string[]
  /** 与 `referenceImageSources` 对齐的本地资产 id 列表（空串表示非本地资产） */
  referenceImageAssetIds?: string[]
  /** 主图上的抠图前后景点；执行时注入占位符 `__MATTING_POINTS_JSON__` 等 */
  mattingPoints?: MattingPoint[]
  /** 主图 naturalWidth，与 mattingPoints 一起用于生成 Comfy 像素坐标 */
  mattingRefWidth?: number
  /** 主图 naturalHeight */
  mattingRefHeight?: number
  /** 云端「模型」模式：输出比例，对应 Image API / image_generation 的 `size` */
  cloudImageAspect?: CloudImageAspectKey
  /** 云端「模型」模式：1K / 2K */
  cloudImageResolutionTier?: CloudImageResolutionTier
  /**
   * Comfy「Qwen Multiangle Camera」类工作流：水平/垂直角与变焦，提交时写入占位符
   * `__CAM_H__` / `__CAM_V__` / `__CAM_Z__`（整数角约 ±60，与常见节点上限一致）。
   */
  comfyMultiangleH?: number
  comfyMultiangleV?: number
  comfyMultiangleZoom?: number
  /**
   * Comfy 工作流占位符 `__WIDTH__` / `__HEIGHT__`（如 TTResolutionSelector、EmptyLatent* 等）。
   * 仅「工作流」模式生效；与云端 Image API 的 `cloudImageAspect` 相互独立。
   */
  comfyWorkflowWidth?: number
  comfyWorkflowHeight?: number
  /** Comfy 工作流：输出比例（与云端模型比例下拉同一套，映射到像素） */
  comfyWorkflowAspect?: CloudImageAspectKey
  /** 为 true 时以 comfyWorkflowWidth/Height 为准，忽略比例映射 */
  comfyWorkflowUseCustomPixels?: boolean
  /** Comfy 占位符 `__STYLE_TONE__`（风格短语，不进入用户主提示词框） */
  comfyWorkflowStyleTone?: string
  /**
   * 无限扩图：四向扩展像素（写入 Comfy ImagePadForOutpaint；未填则用模板默认左右 400、上下 0）。
   */
  comfyOutpaintLeft?: number
  comfyOutpaintTop?: number
  comfyOutpaintRight?: number
  comfyOutpaintBottom?: number
  /** 宫格分割：最多5张图片 URL 列表（对应 __GRID_IMAGE_1__ ~ __GRID_IMAGE_5__，下标与槽位 1~5 对齐） */
  gridImages?: string[]
  /** 宫格图 IndexedDB 资源 id（与 gridImages 下标对齐，避免 blob: 失效后无法上传 Comfy） */
  gridImageAssetIds?: string[]
  /** 宫格分割：水平张数（默认2） */
  gridHorizontal?: number
  /** 宫格分割：垂直张数（默认2） */
  gridVertical?: number
  /** 宫格分割：移除画布边缘 */
  gridRemoveEdge?: boolean
  /** 宫格分割：移除描边宽度 */
  gridRemoveStroke?: number
  /** 宫格分割：文件名前缀 */
  gridFilePrefix?: string
  /** 宫格分割：保存格式 */
  gridFormat?: 'PNG' | 'JPG'
}

export type VideoNodeData = StudioNodeDataBase & {
  kind: 'video'
  /** 视频资源 URL 或占位 */
  src: string
  /** 主视频原始文件名（用于排序与展示） */
  srcFileName?: string
  /** 本地上传主图在 IndexedDB 中的资产 id（用于重启后恢复） */
  srcAssetId?: string
  /** 第一路提示词（左侧统一入边桩 `video-in`；多路文本按画布位置排序分配） */
  prompt: string
  /**
   * 第二路提示词，与 `prompt` 独立；工作流占位符 `__PROMPT2__`（`__PROMPT__` 为口 1）。
   */
  prompt2?: string
  /** 第三、四路提示词（多文本节点连入统一口时按画布位置分配）；占位符 `__PROMPT3__`、`__PROMPT4__` */
  prompt3?: string
  prompt4?: string
  /**
   * 第五路及以后（与 `prompt`～`prompt4` 顺序一致）；工作流里写 `__PROMPT5__`、`__PROMPT6__`… 时自动注入。
   */
  extraPrompts?: string[]
  /** 底部面板选择的工作流名称 */
  model?: string
  /** 底部面板上传的多张参考图（blob URL） */
  referenceImageSources?: string[]
  /** 与 `referenceImageSources` 对齐的本地资产 id 列表（空串表示非本地资产） */
  referenceImageAssetIds?: string[]
  /** 与 Image 节点相同：Comfy Multiangle 占位符 `__CAM_H__` 等（视频 Comfy 工作流可用） */
  comfyMultiangleH?: number
  comfyMultiangleV?: number
  comfyMultiangleZoom?: number
  /** Comfy 工作流占位符 `__WIDTH__` / `__HEIGHT__` */
  comfyWorkflowWidth?: number
  comfyWorkflowHeight?: number
  comfyWorkflowAspect?: CloudImageAspectKey
  comfyWorkflowUseCustomPixels?: boolean
  comfyWorkflowStyleTone?: string
  /** 无限扩图四向边距（像素），含义同 Image 节点 */
  comfyOutpaintLeft?: number
  comfyOutpaintTop?: number
  comfyOutpaintRight?: number
  comfyOutpaintBottom?: number
}

/** 8 路 FB 多人配音侧栏：一行对应 RoleBank 一路（与 Comfy 图槽位顺序一致）。 */
export type ComfyVoiceTableRow = {
  roleName: string
  /** 写入 VoiceDesign `text` 与 VoiceClone `ref_text` 的一句台词 */
  sampleLine: string
  /** 写入 VoiceDesign `instruct` */
  voiceInstruct: string
  /** 界面选项见 `COMFY_VOICE_TABLE_LANGUAGE_OPTIONS`，提交时映射为 Comfy 语言枚举 */
  language: string
}

/** TD 有参：@/底部上传参考音 → DefineSpeaker 角色名（不含主预览 __REF_AUDIO_1__；与 `skipLeadingSlots: 1` 写入顺序一致） */
export type ComfyTdRefAudioRoleRow = {
  roleName: string
}

export type AudioNodeData = StudioNodeDataBase & {
  kind: 'audio' | 'music'
  /** 音频资源 URL 或占位 */
  src: string
  /** 主音频原始文件名（用于排序与展示） */
  srcFileName?: string
  /** 本地上传主图在 IndexedDB 中的资产 id（用于重启后恢复） */
  srcAssetId?: string
  /** 节点内结果列表（最新在前） */
  resultSources?: string[]
  note: string
  /** 生成模型标识（主要用于音乐节点） */
  model?: string
  /** 配音节点：底部面板上传的多张参考图（blob URL）；音乐节点可不填 */
  referenceImageSources?: string[]
  /** 与 `referenceImageSources` 对齐的本地资产 id 列表（空串表示非本地资产） */
  referenceImageAssetIds?: string[]
  /** 多人 FB 工作流：最多 8 行角色/音色表（无参多人 TTS） */
  comfyVoiceTableRows?: ComfyVoiceTableRow[]
  /** TD 有参多人：仅「@ / 底部上传」参考路（不含节点主预览）；与 `__REF_AUDIO_2__` 起 DefineSpeaker 对齐 */
  comfyTdRefAudioRoleRows?: ComfyTdRefAudioRoleRow[]
  /**
   * 音乐节点：侧栏「微调」写入 Comfy（Ace Step `TextEncodeAceStepAudio1.5` / `EmptyAceStep1.5LatentAudio` 等）。
   * 缺省与云端「(语音转音乐)-音乐创作」模板一致。
   */
  comfyMusicDurationMinutes?: 1 | 2 | 3 | 4
  comfyMusicBpm?: number
  comfyMusicTimesignature?: '2' | '3' | '4' | '6' | string
  comfyMusicLanguage?: string
  comfyMusicKeyscale?: string
}

/**
 * VR360 全景：面向 VR 球面环视的等距柱状（Equirectangular）贴图；另含当前视角平面导出供 @ 引用。
 */
export type PanoramaNodeData = StudioNodeDataBase & {
  kind: 'panorama'
  /** VR 用等距柱状全景图（http(s)/blob/data URL），宽高比常用约 2:1 */
  src: string
  /** 全景原始文件名（用于排序与展示） */
  srcFileName?: string
  /** 全景原图在 IndexedDB 中的资产 id（用于重启后恢复） */
  srcAssetId?: string
  /** 「当前视角」导出的平面图 Object URL */
  rectilinearSrc?: string
  /** 导出宽度，默认 1024 */
  exportWidth?: number
  /** 导出高度，默认 1024 */
  exportHeight?: number
}

export type GroupNodeData = StudioNodeDataBase & {
  kind: 'group'
  /** 分组内节点 id 列表（创建分组时写入） */
  memberIds: string[]
  /** 是否折叠分组（折叠时隐藏组内节点） */
  collapsed?: boolean
  /** 分组框描边颜色 */
  borderColor?: string
  /** 分组框背景色 */
  backgroundColor?: string
  /** 分组标题字体大小（px，约 10–200） */
  titleFontSize?: number
  /** 分组标题文字颜色（CSS 颜色串，如 #cde7ff）；未设时使用界面默认冰蓝 */
  titleColor?: string
  /** 是否固定（固定后不可拖拽） */
  locked?: boolean
  /** 展开态宽度（用于折叠后恢复） */
  expandedWidth?: number
  /** 展开态高度（用于折叠后恢复） */
  expandedHeight?: number
}

export type StudioNodeData =
  | TextNodeData
  | ScriptNodeData
  | ImageNodeData
  | ImageCompareNodeData
  | VideoNodeData
  | AudioNodeData
  | PanoramaNodeData
  | GroupNodeData

/**
 * 可序列化的工程快照（与 React Flow 状态对应，便于导入导出）。
 */
export type ProjectSnapshot = {
  version: 1
  name: string
  nodes: Node<StudioNodeData>[]
  edges: Edge[]
  viewport: { x: number; y: number; zoom: number }
}
