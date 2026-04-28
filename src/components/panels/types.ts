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
