export type LeftPanelType =
  | 'add-node'
  | 'download-node'
  | 'my-assets'
  | 'history'
  | 'ai-assistant'
  | 'local-projects'
  | 'settings'
  | null

export type AssetKind = 'image' | 'video' | 'audio'

export type AssetItem = {
  id: string
  name: string
  kind: AssetKind
  src: string
  createdAt: number
  /** 桌面端素材库：磁盘绝对路径（存在时表示可重命名/删除真实文件） */
  diskPath?: string
  /** 素材库分类（来自子文件夹名） */
  materialCategory?: 'human' | 'scene' | 'prop' | 'audio' | 'other'
}

export type HistoryItem = {
  id: string
  text: string
  createdAt: number
  kind?: AssetKind | 'music' | 'action'
  src?: string
  title?: string
}

export type AddNodeMenuItem = {
  id: string
  title: string
  subtitle?: string
  badge?: string
  icon: string
  action: () => void
}
