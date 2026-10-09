import type { Bar, Pc, Row } from '../types'

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

type CodexWindow = { used_percent?: unknown; resets_at?: unknown }
export type CodexReading = {
  timestamp?: string
  primary?: CodexWindow
  secondary?: CodexWindow
  reachedType?: unknown
}

const clampPct = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0
}

// A window whose reset time has passed has rolled over, so its old reading no longer applies.
const windowBar = (pct: unknown, resetsAt: string | undefined, now: number): Bar => {
  if (resetsAt !== undefined && Date.parse(resetsAt) < now) {
    return { pct: 0 }
  }

  return { pct: clampPct(pct), resetsAt }
}

const epochSecondsToIso = (value: unknown): string | undefined => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined
}

export const claudeRow = (limits: readonly RateLimit[], now: number): Row => {
  const five = limits.find(limit => limit.kind === 'five_hour')
  const week = limits.find(limit => limit.kind === 'seven_day')

  return {
    id: 'claude',
    label: 'Claude',
    fiveHour: five ? windowBar(five.percentUsed, five.resetsAt, now) : null,
    week: week ? windowBar(week.percentUsed, week.resetsAt, now) : null,
    note: five || week ? undefined : 'no reading yet',
  }
}

/**
 * Reads `~/.claude/quota/claude-usage.json`, the fallback while the session has
 * no rate-limit reading of its own yet.
 */
export const claudeFileRow = (json: string, now: number): Row => {
  const data = JSON.parse(json)

  return {
    id: 'claude',
    label: 'Claude',
    fiveHour: windowBar(data.fiveHour, data.resetsAt, now),
    week: windowBar(data.weekly, data.weeklyResetsAt, now),
    updatedAt: data.time,
  }
}

/** Finds the newest `rate_limits` event in a Codex rollout transcript (JSONL). */
export const findCodexReading = (jsonl: string): CodexReading | null => {
  const lines = jsonl.split('\n')

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line === undefined || !line.includes('"rate_limits"')) {
      continue
    }

    try {
      const event = JSON.parse(line)
      const limits = event?.payload?.rate_limits ?? event?.payload?.info?.rate_limits
      if (limits?.primary) {
        return {
          timestamp: event.timestamp,
          primary: limits.primary,
          secondary: limits.secondary,
          reachedType: limits.rate_limit_reached_type,
        }
      }
    } catch {
      // A partially written last line is expected while Codex is running.
    }
  }

  return null
}

export const codexRow = (reading: CodexReading, now: number): Row => ({
  id: 'codex',
  label: 'Codex',
  fiveHour: windowBar(reading.primary?.used_percent, epochSecondsToIso(reading.primary?.resets_at), now),
  week: reading.secondary
    ? windowBar(reading.secondary.used_percent, epochSecondsToIso(reading.secondary.resets_at), now)
    : null,
  note: reading.reachedType ? 'LIMIT REACHED' : undefined,
  updatedAt: reading.timestamp,
})

/** Reads the snapshot written from `GET https://opencode.ai/zen/go/v1/usage`. */
export const opencodeRow = (json: string, now: number): Row => {
  const data = JSON.parse(json)

  return {
    id: 'opencode',
    label: 'OpenCode',
    // rollingDisplay rounds a used-but-under-1 % window up, as the official app does.
    fiveHour: windowBar(data.rollingDisplay ?? data.rolling, data.rollingResetsAt, now),
    week: windowBar(data.weekly, data.weeklyResetsAt, now),
    note: clampPct(data.monthly) >= 85 ? `month ${clampPct(data.monthly)}%` : undefined,
    updatedAt: data.updatedAt,
  }
}

export const emptyRow = (id: Row['id'], label: string, note: string): Row => ({
  id,
  label,
  fiveHour: null,
  week: null,
  note,
})

/** Green below 50 %, yellow from 50 to 70 %, red above 70 %. */
export const tone = (pct: number): 'error' | 'warning' | 'success' =>
  pct > 70 ? 'error' : pct >= 50 ? 'warning' : 'success'

/** At this load a value blinks. */
export const CRITICAL_PCT = 90

/** Prints `cpu|ram|disk` in whole percent; parsed by `parsePc`. */
export const PC_SCRIPT = [
  "$cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime",
  '$os = Get-CimInstance Win32_OperatingSystem',
  '$ram = [math]::Round((1 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize) * 100)',
  '$d = Get-PSDrive C',
  '$disk = [math]::Round($d.Used / ($d.Used + $d.Free) * 100)',
  '"$cpu|$ram|$disk"',
].join('; ')

export const parsePc = (stdout: string): Pc => {
  const [cpu, ram, disk] = stdout.trim().split('|').map(part => {
    const n = Number(part)
    return part.trim() !== '' && Number.isFinite(n) ? clampPct(n) : null
  })

  return { cpu: cpu ?? null, ram: ram ?? null, disk: disk ?? null }
}

const span = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(rest).padStart(2, '0')}m`
  return `${rest}m`
}

export const untilText = (iso: string | undefined, now: number): string =>
  iso === undefined ? '' : `resets ${span(Date.parse(iso) - now)}`

export const ageText = (iso: string | undefined, now: number): string => {
  if (iso === undefined) return ''
  const ms = now - Date.parse(iso)
  return ms > 30 * 60000 ? `${span(ms)} old` : ''
}
