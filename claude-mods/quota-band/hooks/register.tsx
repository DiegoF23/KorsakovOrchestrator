import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Bar, Pc, Row } from '../types'
import {
  ageText,
  CRITICAL_PCT,
  claudeFileRow,
  claudeRow,
  codexRow,
  emptyRow,
  findCodexReading,
  opencodeRow,
  parsePc,
  PC_SCRIPT,
  tone,
} from './parse'
import type { CodexReading } from './parse'

const rows = atom({ plugin: 'quota-band', key: 'rows' } as const, [])
const isHidden = atom({ plugin: 'quota-band', key: 'isHidden' } as const, false)
const pc = atom({ plugin: 'quota-band', key: 'pc' } as const, null)
const blinkOn = atom({ plugin: 'quota-band', key: 'blinkOn' } as const, true)

const REFRESH_MS = 60_000
const PC_REFRESH_MS = 15_000
const BLINK_MS = 700
const LABEL_WIDTH = 9
const LINE_UNITS = 12
const MAX_READ_BYTES = 4 * 1024 * 1024
const CODEX_DAYS_BACK = 7

// Codex rollouts are megabytes; parse each one again only when its mtime changes.
const codexCache = new Map<string, { mtimeMs: number; size: number; reading: CodexReading | null }>()

const pad = (n: number) => String(n).padStart(2, '0')

const readClaude = async ($: Engine, home: string, now: number): Promise<Row> => {
  const { rateLimits } = await $.session.usage()
  if (rateLimits.length > 0) {
    return claudeRow(rateLimits, now)
  }

  // Before the session's first response there is no reading; use the last snapshot on disk.
  const json = await $.fs.read(`${home}\.claude\quota\claude-usage.json`).catch(() => undefined)
  return json === undefined ? claudeRow([], now) : claudeFileRow(json, now)
}

const readCodex = async ($: Engine, home: string, now: number): Promise<Row> => {
  // Long Codex runs write rollouts over the 4 MiB a mod can read; codex-quota.mjs reads only
  // their tail and writes the newest reading to codex-usage.json, which wins when present.
  await $.process
    .run(['node', `${home}\\.claude\\quota\\codex-quota.mjs`], { timeoutMs: 20_000 })
    .catch(() => undefined)
  const snapshot = await $.fs.read(`${home}\\.claude\\quota\\codex-usage.json`).catch(() => undefined)
  if (snapshot !== undefined) {
    try {
      const reading = JSON.parse(snapshot) as CodexReading
      if (reading?.primary) {
        return codexRow(reading, now)
      }
    } catch {
      // Fall back to reading the rollouts directly.
    }
  }

  for (let back = 0; back < CODEX_DAYS_BACK; back += 1) {
    const day = new Date(now - back * 86_400_000)
    const dir = `${home}\\.codex\\sessions\\${day.getFullYear()}\\${pad(day.getMonth() + 1)}\\${pad(day.getDate())}`
    const entries = await $.fs.list(dir).catch(() => [])
    const rollouts = entries
      .filter(entry => entry.kind === 'file' && /^rollout-.*\.jsonl$/.test(entry.name))
      .filter(entry => entry.size <= MAX_READ_BYTES)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 6)

    // Windows keeps the listed mtime/size of a file Codex still has open, so the newest
    // rollouts are always re-read and the reading with the latest event timestamp wins.
    let best: CodexReading | null = null
    for (const entry of rollouts) {
      const path = `${dir}\\${entry.name}`
      const cached = codexCache.get(path)
      const reading =
        entry !== rollouts[0] && entry !== rollouts[1] && cached?.mtimeMs === entry.mtimeMs && cached?.size === entry.size
          ? cached.reading
          : findCodexReading(await $.fs.read(path).catch(() => ''))
      codexCache.set(path, { mtimeMs: entry.mtimeMs, size: entry.size, reading })
      if (reading && (best === null || Date.parse(reading.timestamp ?? '') > Date.parse(best.timestamp ?? ''))) {
        best = reading
      }
    }
    if (best) {
      return codexRow(best, now)
    }
  }

  return emptyRow('codex', 'Codex', 'no data in the last 7 days')
}

const readOpencode = async ($: Engine, home: string, now: number): Promise<Row> => {
  // The snapshot script asks the official endpoint at most once a minute; running it here keeps
  // the row live between prompts.
  await $.process
    .run(['node', `${home}\\.claude\\quota\\opencode-quota.mjs`], { timeoutMs: 20_000 })
    .catch(() => undefined)
  const path = `${home}\\.claude\\quota\\opencode-official.json`

  try {
    return opencodeRow(await $.fs.read(path), now)
  } catch {
    return emptyRow('opencode', 'OpenCode', 'no snapshot')
  }
}

const refresh = async ($: Engine) => {
  const now = await $.clock.now()
  const home = (await $.env.get('USERPROFILE')) ?? ''
  const next = await Promise.all([
    readClaude($, home, now).catch(() => emptyRow('claude', 'Claude', 'unavailable')),
    readCodex($, home, now).catch(() => emptyRow('codex', 'Codex', 'unavailable')),
    readOpencode($, home, now),
    Promise.resolve(emptyRow('antigravity', 'Antigravity', 'no local quota source')),
  ])

  await update($, rows, () => next)
}

const refreshPc = async ($: Engine) => {
  const { exitCode, stdout } = await $.process.run(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', PC_SCRIPT],
    { timeoutMs: 10_000 },
  )
  if (exitCode === 0) {
    await update($, pc, () => parsePc(stdout))
  }
}

const isCritical = (value: number | null | undefined) => (value ?? 0) >= CRITICAL_PCT

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'quota-band',
      description: 'Show or hide the quota line above the prompt',
    })
    void refresh($)
    void refreshPc($).catch(() => undefined)
    $.clock.every(REFRESH_MS, () => refresh($))
    $.clock.every(PC_REFRESH_MS, () => refreshPc($).catch(() => undefined))
    // Toggles only while something is critical, so a calm line never redraws on its own.
    $.clock.every(BLINK_MS, async () => {
      const load = await read($, pc)
      const quotas = await read($, rows)
      const anyCritical =
        [load?.cpu, load?.ram, load?.disk].some(isCritical) ||
        quotas.some(row => isCritical(row.fiveHour?.pct) || isCritical(row.week?.pct))
      const shown = await read($, blinkOn)
      if (anyCritical || !shown) {
        await update($, blinkOn, value => (anyCritical ? !value : true))
      }
    })

    return next(e)
  })

  on('command.run', { command: 'quota-band' }, async $ => {
    const hidden = await update($, isHidden, value => !value)
    if (!hidden) {
      await refresh($)
    }

    return { text: hidden ? 'Quota band hidden.' : 'Quota band shown.' }
  })

  // Claude's own windows arrive with every response, so that row stays live between refreshes.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const now = await $.clock.now()
      const claude = claudeRow(e.rateLimits, now)
      await update($, rows, list => list.map(row => (row.id === 'claude' ? claude : row)))
    }

    return next(e)
  })

  // The desktop surface does not draw a custom PromptHint, so the panel sits just above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = (await read($, rows)).filter(row => row.fiveHour !== null || row.week !== null)
    const load = await read($, pc)
    if (e.props.hasSurvey || (list.length === 0 && load === null) || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const isLit = await read($, blinkOn)

    // Text cannot be sized, so the PC row stays quiet: dim labels, no padding, color only on the value.
    const metric = (name: string, value: number | null) => {
      if (value === null) return <Text dimColor>{name} --</Text>
      if (value < 50) {
        return (
          <Text>
            <Text dimColor>{name} </Text>
            <Text color={tone(value)}>{value}%</Text>
          </Text>
        )
      }
      // From 50 % the whole label and value share one highlight; a critical one blinks.
      const isDim = isCritical(value) && !isLit
      return isDim ? (
        <Text color={tone(value)}>{`${name} ${value}%`}</Text>
      ) : (
        <Text color="#000000" backgroundColor={tone(value)}>{`${name} ${value}%`}</Text>
      )
    }

    // A thick colored run for what is used, a thin dim run for what is left.
    const meter = (bar: Bar) => {
      // Measured in the desktop font: three bar glyphs span about four line glyphs. The
      // meter is LINE_UNITS line glyphs wide; each bar glyph takes 4/3 of one away.
      const maxBars = Math.floor((LINE_UNITS * 3) / 4)
      const bars = bar.pct > 0 ? Math.max(1, Math.round((bar.pct / 100) * maxBars)) : 0
      const isDim = isCritical(bar.pct) && !isLit
      return (
        <Text>
          <Text color={tone(bar.pct)} dimColor={isDim}>{'▬'.repeat(bars)}</Text>
          <Text dimColor>{'─'.repeat(Math.max(0, LINE_UNITS - Math.round((bars * 4) / 3)))}</Text>
        </Text>
      )
    }

    return (
      <Box flexDirection="column" width="100%">
        {load !== null && (
          <Box flexDirection="row" columnGap={2} marginBottom={1}>
            {metric('CPU', load.cpu)}
            {metric('RAM', load.ram)}
            {metric('Disk C:', load.disk)}
          </Box>
        )}
        {list.map(row => {
          const isOld = ageText(row.updatedAt, now) !== ''
          return (
            <Box key={row.id} flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
              <Box flexDirection="row" flexShrink={1} columnGap={1}>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                  <Text bold wrap="truncate-end">{row.label}</Text>
                </Box>
                {row.fiveHour !== null && meter(row.fiveHour)}
              </Box>
              <Box flexShrink={0} marginLeft={1}>
                <Text wrap="truncate-end" dimColor={isOld}>
                  {row.fiveHour !== null && <Text color={tone(row.fiveHour.pct)}>{row.fiveHour.pct}%</Text>}
                  {row.week !== null && <Text dimColor> · </Text>}
                  {row.week !== null && <Text color={tone(row.week.pct)}>{row.week.pct}%</Text>}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
