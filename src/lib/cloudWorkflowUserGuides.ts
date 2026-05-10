import type { StudioNodeKind } from '../types'

const STUDIO_NODE_KINDS = new Set<StudioNodeKind>([
  'text',
  'script',
  'image',
  'imageCompare',
  'video',
  'audio',
  'music',
  'panorama',
])

function coerceStudioNodeKind(raw: string): StudioNodeKind {
  const s = String(raw || '').trim()
  return STUDIO_NODE_KINDS.has(s as StudioNodeKind) ? (s as StudioNodeKind) : 'text'
}

/** Comfy 工作流 JSON 中与 `llama_cpp_instruct_adv.system_prompt` 等字段对应的占位符 */
export const CLOUD_WORKFLOW_SYSTEM_PROMPT_TOKEN = '__SYSTEM_PROMPT__'

export function workflowJsonUsesSystemPromptPlaceholder(json: string): boolean {
  return String(json || '').includes(CLOUD_WORKFLOW_SYSTEM_PROMPT_TOKEN)
}

/** 画布 / Comfy 侧输入输出的人类可读说明（与授权服 `cloud-workflows.json` 的 `id` 对齐） */
export type CloudWorkflowIoRow = {
  /** 粗分类，便于 UI 着色 */
  media: 'text' | 'image' | 'video' | 'audio' | 'numeric' | 'other'
  /** 简短标题，如「主提示词」 */
  title: string
  /** 数量：如「1」「2～N」「0～1（可选）」 */
  count: string
  /** 补充：占位符、侧栏填法、语言要求等 */
  detail?: string
}

export type CloudWorkflowUserGuide = {
  /** 可选：覆盖弹窗标题（默认用工作流 name） */
  title?: string
  /** 一段话总览 */
  summary?: string
  inputs: CloudWorkflowIoRow[]
  outputs: CloudWorkflowIoRow[]
  /** FLOWID 画布上的操作提示 */
  canvasHints?: string[]
}

const GUIDES: Record<string, CloudWorkflowUserGuide> = {
  '12c6b358-d5c2-4b9c-9eaf-4c7154f48a2e': {
    summary: '文生图通用模板：以文字描述为主生成单张或多张结果图。',
    inputs: [
      { media: 'text', title: '提示词 / 创意描述', count: '1', detail: '写在节点「提示词」；会参与正向条件编码。' },
      { media: 'text', title: '负向 / 补充说明（若有）', count: '0～1（可选）', detail: '依工作流内节点而定，可在参数设置里查看默认文案。' },
      { media: 'image', title: '参考图', count: '0～多（可选）', detail: '画布引用其它图片节点或上传；用于风格/构图参考时由工作流读入。' },
    ],
    outputs: [{ media: 'image', title: '生成图像', count: '1～多', detail: '结果写入当前图片节点输出。' }],
    canvasHints: ['在「云端 Comfy」执行环境下，从下拉选用与此处相同名称的工作流即可对应本说明。'],
  },
  '4e750db8-5879-4ff6-bebc-4b61931f02e3': {
    summary: '根据商品/场景类文字描述，生成电商模特或展示相关的提示词文案。',
    inputs: [
      { media: 'text', title: '主体描述（商品、场景、风格）', count: '1', detail: '填在文本节点正文或提示词区域。' },
    ],
    outputs: [{ media: 'text', title: '模型提示词 / 结构化文案', count: '1', detail: '生成结果回填到文本节点，可再接到图片节点使用。' }],
    canvasHints: ['适合把草稿需求写成一段话，让工作流扩展成可直接用于生图的提示词。'],
  },
  '6f654e22-44bf-4d07-ad45-3006077a7527': {
    summary:
      '通用对话：多轮或单轮文本生成。主输入为侧栏正文；系统提示词在侧栏「系统提示词」或设置 → 文本 → 云端工作流 →「系统提示词」中编辑保存，执行时写入 __SYSTEM_PROMPT__。',
    inputs: [
      { media: 'text', title: '用户消息 / 任务描述', count: '1', detail: '侧栏主输入区（节点正文）。' },
      {
        media: 'text',
        title: '系统提示词',
        count: '0～1（可选）',
        detail: '侧栏或设置页保存；留空则 Comfy 侧系统提示为空。',
      },
    ],
    outputs: [{ media: 'text', title: '模型回复', count: '1', detail: '纯文本。' }],
    canvasHints: [
      '说明里「系统提示词为空」指未配置时的默认；可在 FLOWID 单独保存系统提示词，无需改 JSON。',
    ],
  },
  'e9fa5040-1e4e-4a67-80d8-9ec2a90a5171': {
    summary: '在保留内容结构的前提下修复瑕疵、提升清晰度或补全局部。',
    inputs: [
      { media: 'image', title: '待修复原图', count: '1', detail: '节点主图 / src；建议高分辨率原图。' },
      { media: 'text', title: '修复说明', count: '0～1（可选）', detail: '说明要修哪里、修成什么样。' },
    ],
    outputs: [{ media: 'image', title: '修复后图像', count: '1' }],
    canvasHints: ['必须提供一张输入图；仅有文字无法执行。'],
  },
  '7b5d69e8-288b-40d9-b875-85deee17ca6f': {
    summary: '向外扩展画布（ outpainting ），根据文字指定延伸内容与风格。',
    inputs: [
      { media: 'image', title: '底图', count: '1' },
      { media: 'text', title: '扩图方向与内容描述', count: '1', detail: '描述四周或单侧要补全的画面。' },
    ],
    outputs: [{ media: 'image', title: '扩展后的整图', count: '1' }],
    canvasHints: ['扩图比例、步数等在工作流节点中；可在「参数设置」微调。'],
  },
  '9a853fc9-76b1-45b2-b081-17ac36007100': {
    summary: '按英文语义分割/抠图；提示词建议使用英文描述要保留或移除的区域。',
    inputs: [
      { media: 'image', title: '输入图', count: '1' },
      { media: 'text', title: '英文语义指令', count: '1', detail: '例如主体、背景、要抠出的对象等。' },
    ],
    outputs: [
      { media: 'image', title: '抠图 / 掩码相关结果', count: '1～多', detail: '以当前工作流输出节点为准（RGBA 或带遮罩）。' },
    ],
    canvasHints: ['工作流名称标注「英文」：中文提示可能效果不稳定。'],
  },
  '56fda30e-47ad-4d84-912c-3afa3daa8d31': {
    summary: '单张图驱动生成短视频（LTX）；可指定输出分辨率占位。',
    inputs: [
      { media: 'image', title: '首帧 / 关键图', count: '1' },
      { media: 'text', title: '运动与镜头描述', count: '0～1（可选）' },
      { media: 'numeric', title: '宽、高', count: '0～1 组（可选）', detail: 'JSON 内 `__WIDTH__` / `__HEIGHT__` 可由侧栏或节点参数注入。' },
    ],
    outputs: [{ media: 'video', title: '生成视频', count: '1' }],
    canvasHints: ['无图仅有文时执行会失败；请先绑定或上传图片。'],
  },
  '51adf032-739c-45c6-8ba0-2ca8a820f5a5': {
    summary: '将多段视频按时间轴拼接为一条成片。',
    inputs: [
      { media: 'video', title: '待合并片段', count: '2～N', detail: '在视频节点中按工作流要求提供多路输入或引用多个上游视频。' },
      { media: 'text', title: '转场 / 顺序说明', count: '0～1（可选）', detail: '若模板支持文案控制顺序或淡入淡出。' },
    ],
    outputs: [{ media: 'video', title: '合并后的视频', count: '1' }],
    canvasHints: ['至少两段有效视频输入；具体槽位见「参数设置」中的加载节点。'],
  },
  'aba0f3e6-246d-44f5-b717-501b64249062': {
    summary: '文案 + 多路参考音色：生成带角色感的语音（有参版可调更多 TTS 参数）。',
    inputs: [
      { media: 'text', title: '台本 / 角色台词（__NOTE__）', count: '1', detail: '配音侧栏「说明」或工作流约定字段会写入 `__NOTE__`。' },
      {
        media: 'audio',
        title: '参考音色',
        count: '1～10',
        detail: '对应 `__REF_AUDIO_1__` … `__REF_AUDIO_10__`；可只录部分槽位，其余在 FLOWID 内会按规则复用已上传文件以满足 Comfy 固定槽位。' },
    ],
    outputs: [{ media: 'audio', title: '合成语音', count: '1' }],
    canvasHints: ['在侧栏为每个角色上传参考音频；台本里用角色标记与工作流内配置一致（见参数 JSON）。'],
  },
  '2196ad66-7596-4eb7-94e2-38b73494cff3': {
    summary: '多角色语音合成：无需在工作流里暴露大量 TTS 细参，主要吃台本与参考声。',
    inputs: [
      { media: 'text', title: '台本（__NOTE__）', count: '1' },
      { media: 'audio', title: '参考音色 / 干声', count: '1～多', detail: '按模板 LoadAudio 数量准备；少则只传前几路。' },
    ],
    outputs: [{ media: 'audio', title: '混合对白音频', count: '1' }],
    canvasHints: ['与「有参」版相比：音色微调主要在服务端默认节点中完成。'],
  },
  'ac275434-b077-4906-befe-149ac77040df': {
    summary: '多人朗读：一段台本拆为多说话人。',
    inputs: [
      { media: 'text', title: '带角色标记的台本（__NOTE__）', count: '1', detail: '格式需与工作流内说话人配置一致。' },
    ],
    outputs: [{ media: 'audio', title: '整段合成音频', count: '1' }],
    canvasHints: ['若执行报「缺少参考音频」，请为各角色上传参考音或在参数设置中核对占位。'],
  },
  '42e833e6-6ac9-4531-bcbf-803ef8684659': {
    summary: '用口述内容（语音）描述想要的音乐风格与结构，再生成音乐。',
    inputs: [
      { media: 'audio', title: '语音输入 / 哼唱', count: '1', detail: '音乐节点录制的参考说明音轨。' },
      { media: 'text', title: '补充文字（歌词、风格）', count: '0～1（可选）', detail: '音乐节点「说明」会参与部分模板；与 `__PROMPT__` 回填策略一致。' },
    ],
    outputs: [{ media: 'audio', title: '生成音乐（或带人声的成品）', count: '1', detail: '以工作流末级输出为准。' }],
    canvasHints: ['若工作流支持 Suno/类似微调参数，可在「参数设置」里查看注入字段。'],
  },
  'e06bc186-c218-4334-becd-4d34860f1add': {
    summary: '电商场景：商品与卖点文字共同驱动主图生成，可指定画幅。',
    inputs: [
      { media: 'text', title: '商品信息与卖点', count: '1' },
      { media: 'image', title: '商品白底图 / 参考图', count: '0～多（可选）', detail: '有图时约束构图与包装外观。' },
      { media: 'numeric', title: '输出宽高', count: '0～1 组（可选）', detail: '`__WIDTH__` / `__HEIGHT__`。' },
    ],
    outputs: [{ media: 'image', title: '电商主图 / 海报', count: '1～多' }],
    canvasHints: [],
  },
  'b72cf513-2fde-4d57-8509-4a205cd29364': {
    summary: '单张图 + 文字指令的编辑（替换、改色、加删物体等）。',
    inputs: [
      { media: 'image', title: '原图', count: '1' },
      { media: 'text', title: '编辑指令', count: '1' },
    ],
    outputs: [{ media: 'image', title: '编辑后图像', count: '1' }],
    canvasHints: [],
  },
  '7f74b07f-4ab1-4689-9b34-c38577cd98c5': {
    summary: '多图输入：融合、换脸、多参考一致性编辑等（具体以 JSON 内节点为准）。',
    inputs: [
      { media: 'image', title: '参考图 / 待编辑图', count: '2～多', detail: '主图 + 若干 ref；画布用 @ 引用或多槽上传。' },
      { media: 'text', title: '编辑说明', count: '1' },
    ],
    outputs: [{ media: 'image', title: '合成或编辑结果', count: '1' }],
    canvasHints: ['执行前请确认已提供足够张数的图片输入。'],
  },
  '5fd83c68-d85b-465e-be78-26756b9f8ed8': {
    summary: '去除画面杂物、水印或干扰对象，尽量保持主体不变。',
    inputs: [
      { media: 'image', title: '原图', count: '1' },
      { media: 'text', title: '要去掉的对象描述', count: '0～1（可选）' },
    ],
    outputs: [{ media: 'image', title: '净化后图像', count: '1' }],
    canvasHints: [],
  },
  '706c7ac8-62a6-43d1-b635-5df850ceac86': {
    summary: '相机角度控制：结合水平/垂直/远近（或等价）参数与提示词生成新视角。',
    inputs: [
      { media: 'image', title: '基准图', count: '1' },
      { media: 'text', title: '视角或内容补充（__PROMPT__）', count: '0～1（可选）' },
      {
        media: 'numeric',
        title: '相机参数',
        count: '1 组',
        detail: '`__CAM_H__` / `__CAM_V__` / `__CAM_Z__` 由 FLOWID 多角控制面板或占位注入。' },
    ],
    outputs: [{ media: 'image', title: '新角度渲染图', count: '1' }],
    canvasHints: ['打开图片节点的多角/3D 控制侧栏可驱动上述占位（若工程已启用该能力）。'],
  },
  'c3f19b3c-5688-4337-b567-6fa676d3ab12': {
    summary: '人像图 + 驱动（常见为音频或文案）生成数字人说话视频。',
    inputs: [
      { media: 'image', title: '人像参考图', count: '1' },
      { media: 'audio', title: '驱动音频', count: '0～1', detail: '口型同步时常需要；若模板仅文驱则可能不用。' },
      { media: 'text', title: '台词 / 说明', count: '0～1（可选）' },
      { media: 'numeric', title: '视频分辨率', count: '0～1 组（可选）', detail: '`__WIDTH__` / `__HEIGHT__`。' },
    ],
    outputs: [{ media: 'video', title: '数字人视频', count: '1' }],
    canvasHints: [],
  },
  '19c28d3f-ff15-4b36-8c9d-31f485deeeca': {
    summary: '首帧图 + 尾帧图 + 音频（或其它约束）生成过渡视频。',
    inputs: [
      { media: 'image', title: '首帧', count: '1' },
      { media: 'image', title: '尾帧', count: '1' },
      { media: 'audio', title: '配乐或口型驱动', count: '0～1', detail: '以模板为准；名称含「音」时常需要音轨。' },
      { media: 'text', title: '过渡描述', count: '0～1（可选）' },
    ],
    outputs: [{ media: 'video', title: '成片视频', count: '1' }],
    canvasHints: ['请在工作流 JSON 中确认各 LoadImage / LoadAudio 与画布字段的对应关系。'],
  },
}

function fallbackGuide(meta: {
  id: string
  name: string
  description?: string
  nodeKind: string
}): CloudWorkflowUserGuide {
  const kind = coerceStudioNodeKind(meta.nodeKind)
  const base: CloudWorkflowUserGuide = {
    summary: meta.description?.trim() || `授权服务下发的云端工作流「${meta.name}」。暂无独立说明书条目，以下为按节点类型的通用说明。`,
    inputs: [],
    outputs: [],
    canvasHints: ['若服务端更新了同名工作流 UUID，请以列表中的「当前云端工作流」为准；说明以本机内置表为主键匹配。'],
  }
  if (kind === 'text' || kind === 'script') {
    base.inputs = [{ media: 'text', title: '文本输入', count: '1', detail: '节点正文或提示词。' }]
    base.outputs = [{ media: 'text', title: '文本输出', count: '1' }]
  } else if (kind === 'image' || kind === 'imageCompare') {
    base.inputs = [
      { media: 'text', title: '提示词', count: '0～1' },
      { media: 'image', title: '输入图像', count: '0～多', detail: '图生类工作流通常至少 1 张。' },
    ]
    base.outputs = [{ media: 'image', title: '图像输出', count: '1' }]
  } else if (kind === 'video') {
    base.inputs = [
      { media: 'text', title: '描述', count: '0～1' },
      { media: 'image', title: '关键帧 / 参考图', count: '0～多' },
      { media: 'video', title: '视频片段', count: '0～多' },
    ]
    base.outputs = [{ media: 'video', title: '视频输出', count: '1' }]
  } else if (kind === 'audio') {
    base.inputs = [
      { media: 'text', title: '台本 / 说明', count: '0～1' },
      { media: 'audio', title: '参考音频', count: '0～多' },
    ]
    base.outputs = [{ media: 'audio', title: '音频输出', count: '1' }]
  } else if (kind === 'music') {
    base.inputs = [
      { media: 'audio', title: '语音描述', count: '0～1' },
      { media: 'text', title: '歌词或风格说明', count: '0～1' },
    ]
    base.outputs = [{ media: 'audio', title: '音乐输出', count: '1' }]
  } else {
    base.inputs = [{ media: 'other', title: '见工作流 JSON', count: '—', detail: meta.name }]
    base.outputs = [{ media: 'other', title: '见工作流 JSON', count: '—' }]
  }
  return base
}

export function getCloudWorkflowUserGuide(meta: {
  id: string
  name: string
  description?: string
  nodeKind: string
}): CloudWorkflowUserGuide & { fromBuiltinTable: boolean } {
  const row = GUIDES[meta.id]
  if (row) return { ...row, fromBuiltinTable: true }
  return { ...fallbackGuide(meta), fromBuiltinTable: false }
}
