/**
 * 底部提示框「COMFYUI / 模型」：仅显式 `workflow` 走工作流；缺省与历史未写字段均视为「模型」。
 */
export function resolvedPromptPickerMode(data: { promptPickerMode?: 'workflow' | 'model' }): 'workflow' | 'model' {
  return data.promptPickerMode === 'workflow' ? 'workflow' : 'model'
}
