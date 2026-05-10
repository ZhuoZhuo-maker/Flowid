import type { AiAssistantConfig } from './aiAssistantAgent'
import { normalizeOpenAICompatibleBaseUrl } from './openaiCompat'
import { fetchOpenAICompat } from './openaiProxy'

export type AgentCanvasBriefNode = { id: string; title: string; kind: string }

/**
 * 执行单条 tool_call；返回给模型看的 JSON 字符串（或对象由上层 stringify）。
 */
export type FlowidAgentToolExecutor = (name: string, argumentsJson: string) => Promise<string>

const STATIC_SYSTEM = `你是 Flowid 画布智能助手，可通过工具操作用户工作流（建节点、改文案、切换执行方式、绑定 Comfy 工作流或云端模型、删除、批量执行等）。

典型流程（剧本→视频）：
1) flowid_create_node 创建 script，flowid_set_script_body 写入正文；
2) flowid_create_node 创建 video，flowid_set_video_prompt 写入镜头描述；
3) flowid_connect_nodes：剧本为 source，视频为 target；
4) flowid_set_prompt_picker_mode / flowid_bind_workflow_by_name / flowid_set_cloud_assist_pick 按需配置节点执行方式；
5) flowid_run_node 执行单个节点；多个节点用 flowid_run_nodes（≥2 个时客户端会弹窗请用户确认）。

图片/文本/配音/音乐：flowid_set_image_prompt、flowid_set_text_body、flowid_set_media_note。

安全规则：
- flowid_delete_nodes：删除前客户端**始终**弹窗确认。
- flowid_run_nodes：一次执行**多于一个**节点时弹窗确认；单节点可用 flowid_run_node 无二次确认。

通用：
- 先看「当前画布节点」列表，能复用则更新，避免重复创建。
- target_query 用标题关键词、完整标题或节点 id。
- 纯问答、无需改画布时不要调用工具。
- 工具返回 JSON；根据结果继续调用或给用户简洁中文总结。`

export const FLOWID_AGENT_TOOL_DEFINITIONS: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'flowid_create_node',
      description: '在画布新建一个业务节点。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['text', 'script', 'image', 'video', 'audio', 'music', 'panorama'],
            description: '节点类型',
          },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_connect_nodes',
      description: '连接两个已有节点（有向边：source → target）。剧本连视频时剧本为 source。',
      parameters: {
        type: 'object',
        properties: {
          source_query: { type: 'string', description: '源节点标题关键词或 id' },
          target_query: { type: 'string', description: '目标节点标题关键词或 id' },
        },
        required: ['source_query', 'target_query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_script_body',
      description: '写入「剧本」节点正文（多行剧本）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '剧本节点标题关键词或 id' },
          body: { type: 'string', description: '剧本全文' },
        },
        required: ['target_query', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_video_prompt',
      description: '写入「视频」节点主提示词（第一路 prompt）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '视频节点标题关键词或 id' },
          prompt: { type: 'string', description: '视频生成提示词/镜头描述' },
        },
        required: ['target_query', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_image_prompt',
      description: '写入「图片」节点主提示词（与底部提示词框一致）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '图片节点标题关键词或 id' },
          prompt: { type: 'string', description: '生图/修图提示词' },
        },
        required: ['target_query', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_text_body',
      description: '写入「文本」节点正文。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '文本节点标题关键词或 id' },
          body: { type: 'string', description: '文本内容' },
        },
        required: ['target_query', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_media_note',
      description: '写入「配音」或「音乐」节点的备注/说明文案（与底部面板一致）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '配音或音乐节点标题关键词或 id' },
          note: { type: 'string', description: '备注或口播说明' },
        },
        required: ['target_query', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_prompt_picker_mode',
      description: '切换节点底部「工作流 / 云端模型」执行模式（ComfyUI vs 云）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '目标节点' },
          mode: {
            type: 'string',
            enum: ['workflow', 'model'],
            description: 'workflow=走 Comfy 工作流；model=走云端模型线路',
          },
        },
        required: ['target_query', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_bind_workflow_by_name',
      description:
        '为节点绑定 Comfy 工作流条目（按名称子串或完整 id 匹配当前节点类型下的工作流列表）。会先切换到 workflow 模式。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '目标节点' },
          name_substring: {
            type: 'string',
            description: '工作流显示名包含该子串即可；或填完整 workflowEntryId（uuid）',
          },
        },
        required: ['target_query', 'name_substring'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_set_cloud_assist_pick',
      description:
        '为节点设置云端模型线路（与画布下拉「辅助线路」编码一致，通常以 flowid-assist: 开头）。会切换到 model 模式。',
      parameters: {
        type: 'object',
        properties: {
          target_query: { type: 'string', description: '目标节点' },
          pick: { type: 'string', description: 'encodeCloudAssistModelPick 生成的字符串' },
        },
        required: ['target_query', 'pick'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_delete_nodes',
      description:
        '删除一个或多个节点（含关联连线）。客户端会弹窗列出标题请用户确认；未确认则不会删除。',
      parameters: {
        type: 'object',
        properties: {
          target_queries: {
            type: 'array',
            items: { type: 'string' },
            description: '每个元素为标题关键词或节点 id',
          },
        },
        required: ['target_queries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_run_nodes',
      description:
        '批量触发执行多个节点（与画布批量执行类似）。当解析到多于一个节点时客户端会弹窗确认；单个节点请优先用 flowid_run_node。target_queries 可与 use_selected_all 合用；至少提供其一。',
      parameters: {
        type: 'object',
        properties: {
          target_queries: {
            type: 'array',
            items: { type: 'string' },
            description: '要执行的节点：标题关键词或 id；可为空若 use_selected_all 为 true',
          },
          use_selected_all: {
            type: 'boolean',
            description: '为 true 时将当前画布多选中的业务节点一并加入执行列表',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_run_node',
      description: '触发执行指定节点（跑 Comfy 工作流或云端模型，取决于节点底部配置）。',
      parameters: {
        type: 'object',
        properties: {
          target_query: {
            type: 'string',
            description: '节点标题关键词或 id；可与 use_current 二选一',
          },
          use_current: {
            type: 'boolean',
            description: '为 true 时执行当前选中的节点',
          },
        },
      },
    },
  },
]

function briefLine(nodes: AgentCanvasBriefNode[]): string {
  if (!nodes.length) return '（画布为空）'
  return nodes.map((n) => `- [${n.kind}] ${n.title} (${n.id})`).join('\n')
}

function humanToolSummary(name: string, resultJson: string): string {
  try {
    const o = JSON.parse(resultJson) as { ok?: boolean; error?: string; title?: string; node_id?: string }
    if (o.ok === false) return `· ${name} → 失败：${o.error || '未知错误'}`
    if (name === 'flowid_create_node') return `· ${name} → 已创建「${o.title || o.node_id || '?'}」`
    if (name === 'flowid_connect_nodes') return `· ${name} → 已连线`
    if (name === 'flowid_set_script_body') return `· ${name} → 已写入剧本`
    if (name === 'flowid_set_video_prompt') return `· ${name} → 已写入视频提示词`
    if (name === 'flowid_run_node') return `· ${name} → ${o.error ? `失败：${o.error}` : '已触发执行（请到画布查看进度）'}`
    if (name === 'flowid_set_image_prompt') return `· ${name} → 已写入图片提示词`
    if (name === 'flowid_set_text_body') return `· ${name} → 已写入文本`
    if (name === 'flowid_set_media_note') return `· ${name} → 已写入配音/音乐备注`
    if (name === 'flowid_set_prompt_picker_mode') return `· ${name} → 已切换执行模式`
    if (name === 'flowid_bind_workflow_by_name') return `· ${name} → 已绑定工作流`
    if (name === 'flowid_set_cloud_assist_pick') return `· ${name} → 已设置云端线路`
    if (name === 'flowid_delete_nodes') return `· ${name} → ${o.error ? `失败：${o.error}` : '已删除（或用户取消）'}`
    if (name === 'flowid_run_nodes') return `· ${name} → ${o.error ? `失败：${o.error}` : '已触发批量执行（请到画布查看进度）'}`
    return `· ${name} → 完成`
  } catch {
    return `· ${name} → 已执行`
  }
}

type ChatMessage = {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id: string
    type?: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

/**
 * 多轮 chat.completions + tools，直到模型不再请求工具或达到轮次上限。
 */
export async function runFlowidAgentToolLoop(options: {
  config: AiAssistantConfig
  userText: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  getCanvasBrief: () => AgentCanvasBriefNode[]
  executeTool: FlowidAgentToolExecutor
  maxRounds?: number
}): Promise<{ lines: string[]; error?: string }> {
  const {
    config,
    userText,
    history,
    getCanvasBrief,
    executeTool,
    maxRounds = 10,
  } = options

  const rawEndpoint =
    config.provider === 'ollama'
      ? (config.endpoint.trim() || 'http://127.0.0.1:11434/v1/chat/completions')
      : config.endpoint.trim()
  const endpoint = rawEndpoint
    ? `${normalizeOpenAICompatibleBaseUrl(rawEndpoint)}/v1/chat/completions`
    : ''
  const apiKey = config.apiKey.trim()
  const model = config.model.trim()
  if (!endpoint || !model) {
    return { lines: [], error: '未配置 AI 接口或模型' }
  }
  if (config.provider === 'cloud' && !apiKey) {
    return { lines: [], error: '云端模式需填写 API Key' }
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${STATIC_SYSTEM}\n\n当前画布节点：\n${briefLine(getCanvasBrief())}`,
    },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: userText },
  ]

  const traceLines: string[] = []
  const assistantLines: string[] = []

  for (let round = 0; round < maxRounds; round += 1) {
    messages[0] = {
      role: 'system',
      content: `${STATIC_SYSTEM}\n\n当前画布节点：\n${briefLine(getCanvasBrief())}`,
    }

    const res = await fetchOpenAICompat(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      json: {
        model,
        temperature: 0.25,
        messages,
        tools: FLOWID_AGENT_TOOL_DEFINITIONS,
        tool_choice: 'auto',
      },
    })

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      const msg = String(errBody?.error?.message || `HTTP ${res.status}`)
      return {
        lines: [...traceLines, ...assistantLines, `请求模型失败：${msg}`],
        error: msg,
      }
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string
        message?: ChatMessage
      }>
    }
    const choice = data.choices?.[0]
    const msg = choice?.message
    if (!msg) {
      return { lines: [...traceLines, ...assistantLines, '模型未返回消息'], error: 'empty message' }
    }

    const text = String(msg.content || '').trim()
    if (text) assistantLines.push(text)

    const toolCalls = msg.tool_calls?.length
      ? msg.tool_calls.filter((t) => t.type === 'function' || !t.type)
      : []

    if (!toolCalls.length) {
      break
    }

    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    })

    for (const tc of toolCalls) {
      const fn = tc.function
      const resultStr = await executeTool(fn.name, fn.arguments || '{}')
      traceLines.push(humanToolSummary(fn.name, resultStr))
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultStr,
      })
    }
  }

  const merged: string[] = []
  if (traceLines.length) merged.push('【已执行】', ...traceLines, '')
  merged.push(...assistantLines)
  if (!merged.filter(Boolean).length) {
    merged.push('已完成工具调用；模型未输出额外说明，请到画布查看节点与执行状态。')
  }
  return { lines: merged }
}
