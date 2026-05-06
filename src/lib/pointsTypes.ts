/** 与 SQLite `licenses` 行对应（桌面端积分主数据） */
export type LicensePointsRow = {
  code: string
  machine_code: string | null
  points: number
  total_earned: number
  total_spent: number
  bind_time: string | null
  expire_time: string | null
  status: string
  created_at: string | null
}

export type PointsLogRow = {
  id: number
  license_code: string
  amount: number
  type: string
  description: string
  before_points: number
  after_points: number
  created_at: string
  dedupe_key?: string | null
  meta_json?: string | null
}

export type PointsAdjustType = 'recharge' | 'consume' | 'refund' | 'gift'
