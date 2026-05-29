import { patchDramaUiState } from '../../../lib/dramaProduction/dramaUiBridge'
import type { DramaImageGenMode } from '../../../lib/dramaProduction/dramaUiBridge'

type Props = {
  projectTabId: string
  mode: DramaImageGenMode
  compact?: boolean
}

/**
 * 节点内生图方式：ComfyUI 文生图工作流 / 云端 image2。
 */
export function DramaImageGenPicker({ projectTabId, mode, compact }: Props) {
  const setMode = (next: DramaImageGenMode) => {
    if (!projectTabId) return
    patchDramaUiState(projectTabId, { imageGenMode: next })
  }

  return (
    <div className={`drama-image-gen-picker${compact ? ' drama-image-gen-picker--compact' : ''}`} role="group" aria-label="生图方式">
      <button
        type="button"
        className={mode === 'workflow' ? 'is-active' : ''}
        onClick={() => setMode('workflow')}
      >
        Comfy 文生图
      </button>
      <button
        type="button"
        className={mode === 'cloud' ? 'is-active' : ''}
        onClick={() => setMode('cloud')}
      >
        云端 image2
      </button>
    </div>
  )
}
