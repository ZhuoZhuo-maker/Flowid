import type { Edge, Node } from '@xyflow/react'

/**
 * 画布节点类型枚举（Flowid 多模态节点划分，便于后续接真实生成管线）。
 */
export type StudioNodeKind =
  | 'text'
  | 'script'
  | 'image'
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
   * 底部提示框切换：执行时走工作流（ComfyUI）还是走文本模型。
   * 这是“节点级”状态，用于同一画布不同节点不同执行路径。
   */
  promptPickerMode?: 'workflow' | 'model'

  /**
   * 节点级云端模型配置（用于“模型”模式执行）。
   * 不同节点可配置不同模型与 key，不随节点类型同步。
   */
  cloudModelName?: string
  cloudModelUrl?: string
  cloudApiKey?: string

  /**
   * 兼容字段：部分 UI 层会在未严格区分 kind 的情况下读取媒体节点字段。
   * 这些字段对非媒体节点应视为不存在（undefined）。
   */
  src?: string
  srcAssetId?: string
  referenceImageSources?: string[]
  referenceImageAssetIds?: string[]

  /** 运行产生的媒体缩略图队列（最新批次在前）；主预览仍为 `src` */
  resultThumbnails?: NodeResultThumbnail[]
  /** 为 true 时展开底部输出缩略图行（默认折叠） */
  resultThumbnailsExpanded?: boolean
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
  /** 分组标题字体大小 */
  titleFontSize?: number
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
