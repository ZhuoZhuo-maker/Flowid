/** 短剧制片专用 Agent 工具（在通用 flowid_* 工具之外追加） */

export const FLOWID_DRAMA_AGENT_TOOL_DEFINITIONS: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'flowid_drama_ask_user',
      description: '向用户提问并提供 2～5 个选项，聊天窗展示参数卡；等待用户确认后继续。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户展示的问题' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2～5 个可选项',
          },
          expert_role: {
            type: 'string',
            description: '当前专家 id 或中文名：art_director/艺术总监、screenwriter/编剧 等',
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_get_state',
      description: '读取当前短剧制片结构化状态（阶段、参数、角色、场景、分镜 JSON）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_spec',
      description: '写入项目制作参数（概念、平台、风格、画幅、镜头数）。',
      parameters: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          target_platform: { type: 'string' },
          visual_style: { type: 'string' },
          aspect: {
            type: 'string',
            enum: ['auto', '1:1', '16:9', '9:16', '4:5', '3:2', '2:3', '4:3', '3:4', '21:9', 'custom'],
          },
          custom_width: { type: 'number' },
          custom_height: { type: 'number' },
          shot_count: { type: 'number' },
          tone_notes: { type: 'string' },
          storyboard_plan: { type: 'string', enum: ['multi-ref', 'grid'], description: '分镜方案' },
          video_model: { type: 'string', description: '分镜视频模型名' },
          video_tier: { type: 'string', enum: ['pro', 'fast'], description: 'Pro 满血 / Fast 更快' },
          video_resolution: { type: 'string', enum: ['720p', '480p'], description: '视频分辨率' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_script',
      description: '写入完整剧本到制片状态，并同步到画布「剧本」节点。',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string', description: '剧本全文' },
        },
        required: ['body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_characters',
      description: '写入角色列表 JSON（数组：name, personality, appearance, background）。',
      parameters: {
        type: 'object',
        properties: {
          characters_json: { type: 'string', description: 'JSON 数组字符串' },
        },
        required: ['characters_json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_locations',
      description: '写入场景列表 JSON（数组：name, description, visualStyle, props）。',
      parameters: {
        type: 'object',
        properties: {
          locations_json: { type: 'string', description: 'JSON 数组字符串' },
        },
        required: ['locations_json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_review',
      description: '写入合规与节奏审核结果。',
      parameters: {
        type: 'object',
        properties: {
          compliance: { type: 'string' },
          plot_rhythm: { type: 'string' },
          passed: { type: 'boolean' },
        },
        required: ['compliance', 'plot_rhythm', 'passed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_shots',
      description:
        '写入分镜镜头表 JSON（数组：index, title, scene, shotType, action, dialogue, imagePrompt, videoPrompt）。',
      parameters: {
        type: 'object',
        properties: {
          shots_json: { type: 'string', description: 'JSON 数组字符串' },
        },
        required: ['shots_json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_sync_storyboard_node',
      description: '将当前 shots 格式化为文本写入画布「分镜表」节点。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_apply_shot_list',
      description:
        '按制片状态中的 shots 批量创建「镜头N·分镜图」图片节点与「镜头N·成片」视频节点、连线并写入提示词；使用 spec 中的画幅。',
      parameters: {
        type: 'object',
        properties: {
          replace_existing: {
            type: 'boolean',
            description: '为 true 时删除标题以「镜头」开头的旧图片/视频节点后再创建',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_advance_phase',
      description: '当前阶段完成后推进到下一制片阶段。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_set_phase',
      description: '手动设置制片阶段（用户要求回退修改时用）。',
      parameters: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
            enum: [
              'intake',
              'script_draft',
              'character_location',
              'compliance_review',
              'storyboard',
              'storyboard_images',
              'video_audio',
              'export',
              'done',
            ],
          },
          active_expert: { type: 'string' },
        },
        required: ['phase'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_generate_character_images',
      description:
        '为当前制片状态中的全部角色创建 image 节点并执行出图（Comfy/云端）；完成后 ask_user 确认满意度。',
      parameters: {
        type: 'object',
        properties: {
          visual_style: { type: 'string', description: '可选，覆盖 spec.visualStyle 的风格词' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_generate_scene_images',
      description:
        '为指定场景生成主图（phase=main）或多视图（phase=multiview）；创建 image 节点并真实执行出图。',
      parameters: {
        type: 'object',
        properties: {
          phase: { type: 'string', enum: ['main', 'multiview'], description: '主图或多视图' },
          location_id: { type: 'string', description: '场景 id，默认第一个' },
        },
        required: ['phase'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_generate_storyboard_images',
      description:
        '为当前分镜表全部镜头创建 image 节点并真实出图（多图参考 3 张/镜，宫格 6 张/镜）；完成后 ask_user 确认。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_generate_storyboard_videos',
      description:
        '为分镜镜头创建 video 节点并真实生成视频；limit=1 仅生成第一镜，不传则全部生成。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '仅生成前 N 镜，默认全部' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_invite_expert',
      description:
        '邀请另一位专家加入群聊并切换当前活跃专家（如艺术总监邀请编剧、场景设计师邀请分镜师）。',
      parameters: {
        type: 'object',
        properties: {
          expert_id: {
            type: 'string',
            enum: [
              'art_director',
              'screenwriter',
              'character_designer',
              'scene_designer',
              'storyboard_designer',
            ],
            description: '被邀请专家 id',
          },
          expert_role: {
            type: 'string',
            description: '专家中文名或 id（与 expert_id 二选一）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flowid_drama_sync_concept_node',
      description: '将 spec 摘要写入画布「项目设定」节点。',
      parameters: { type: 'object', properties: {} },
    },
  },
]

/** 通用 + 短剧专用工具合并列表 */
export function mergeAgentToolDefinitions(base: unknown[], drama: unknown[]): unknown[] {
  return [...base, ...drama]
}

/** 是否为短剧专用工具名 */
export function isDramaAgentToolName(name: string): boolean {
  return name.startsWith('flowid_drama_')
}
