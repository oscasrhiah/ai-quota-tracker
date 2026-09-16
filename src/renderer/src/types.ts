export interface AppSettings {
  autoLaunch: boolean
  notifyOnReset: boolean
  /** 用量過低警告（剩餘 %） */
  lowWarnPct: number
  /** 自動重新整理間隔（分鐘） */
  refreshIntervalMin: number
  /** 使用者拖曳調整過的供應商卡片順序（存連線 id） */
  connectionOrder?: string[]
}

export interface PersistedState {
  settings: AppSettings
}
