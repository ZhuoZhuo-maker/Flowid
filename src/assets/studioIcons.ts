/**
 * 画布 UI 图标路径：资源放在 `public/studio-icons/`，构建后通过站点根路径访问。
 * 替换图标时保持文件名不变，直接覆盖同名 SVG 即可。
 */

function studioIcon(file: string): string {
  return `${import.meta.env.BASE_URL}studio-icons/${file}`.replace(
    /([^:]\/)\/+/g,
    '$1',
  )
}

/** 顶部品牌 Logo */
export const ICON_BRAND = studioIcon('brand-flowid.svg')

/** 左侧：添加节点（默认态） */
export const ICON_LEFT_ADD = studioIcon('left-add.svg')

/** 左侧：添加节点（面板已打开） */
export const ICON_LEFT_ADD_ACTIVE = studioIcon('left-add-active.svg')

/** 左侧：素材库（默认态） */
export const ICON_LEFT_DOWNLOAD = studioIcon('left-download.svg')

/** 左侧：素材库（面板打开） */
export const ICON_LEFT_DOWNLOAD_ACTIVE = studioIcon('left-download-active.svg')

/** 左侧：生成记录 */
export const ICON_LEFT_ASSET = studioIcon('left-asset.svg')
export const ICON_LEFT_ASSET_ACTIVE = studioIcon('left-asset-active.svg')

/** 左侧：预设模板 */
export const ICON_LEFT_HISTORY = studioIcon('left-history.svg')
export const ICON_LEFT_HISTORY_ACTIVE = studioIcon('left-history-active.svg')

/** 左侧：系统设置 */
export const ICON_LEFT_HELP = studioIcon('left-help.svg')
export const ICON_LEFT_HELP_ACTIVE = studioIcon('left-help-active.svg')

/** 顶部：本地项目（沿用 top-home 资源名） */
export const ICON_TOP_HOME = studioIcon('top-home.svg')

/** 顶部：充值区星标 */
export const ICON_TOP_STAR = studioIcon('top-star.svg')

/** 顶部：保存进度 */
export const ICON_TOP_MSG = studioIcon('top-save.svg')

/** 顶部：打开生成记录 */
export const ICON_TOP_HELP = studioIcon('top-notify.svg')

/** 右下：选择 / 箭头 */
export const ICON_RT_PLAY = studioIcon('rt-select.svg')

/** 右下：小地图开关 */
export const ICON_RT_MUTE = studioIcon('rt-minimap.svg')
export const ICON_RT_MUTE_ACTIVE = studioIcon('rt-minimap-active.svg')

/** 右下：抓手 */
export const ICON_RT_HAND = studioIcon('rt-pan.svg')

/** 素材面板：上传 */
export const ICON_UPLOAD = studioIcon('panel-upload.svg')
export const ICON_UPLOAD_ACTIVE = studioIcon('panel-upload-active.svg')

/** 添加节点面板：节点类型图标 */
export const ICON_NODE_TEXT = studioIcon('node-text.svg')
export const ICON_NODE_IMAGE = studioIcon('node-image.svg')
export const ICON_NODE_VIDEO = studioIcon('node-video.svg')
export const ICON_NODE_AUDIO = studioIcon('node-audio.svg')
export const ICON_NODE_MUSIC = studioIcon('node-music.svg')
export const ICON_NODE_PANORAMA = studioIcon('node-panorama.svg')

/** 节点状态与连线增强图标 */
export const ICON_SCALE_UP = studioIcon('Scale-up.svg')
export const ICON_SCALE_UP_ACTIVE = studioIcon('Scale-up-active.svg')
export const ICON_ADD_BRANCH = studioIcon('Add-Branch.svg')

/** 面板通用：筛选 */
export const ICON_PANEL_FILTER = studioIcon('panel-filter.svg')
export const ICON_PANEL_FILTER_ACTIVE = studioIcon('panel-filter-active.svg')
