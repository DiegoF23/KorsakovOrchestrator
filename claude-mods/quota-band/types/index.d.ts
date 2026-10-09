export type Bar = { pct: number; resetsAt?: string }

export type Row = {
  id: 'claude' | 'codex' | 'opencode' | 'antigravity'
  label: string
  fiveHour: Bar | null
  week: Bar | null
  note?: string
  updatedAt?: string
}

/** Host load in whole percent; null when that probe failed. */
export type Pc = { cpu: number | null; ram: number | null; disk: number | null }

declare module 'claude-code' {
  interface PluginState {
    'quota-band': { rows: Row[]; isHidden: boolean; pc: Pc | null; blinkOn: boolean }
  }
}
