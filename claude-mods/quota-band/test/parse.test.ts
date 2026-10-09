import { expect, test } from 'claude-code/testing'

import { claudeFileRow, claudeRow, codexRow, findCodexReading, opencodeRow, parsePc, tone } from '../hooks/parse'

const NOW = Date.parse('2026-10-08T18:00:00Z')

test('claude row reads the five-hour and seven-day windows', () => {
  const row = claudeRow(
    [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-08T20:00:00Z' },
      { kind: 'seven_day', percentUsed: 7, resetsAt: '2026-10-14T08:00:00Z' },
    ],
    NOW,
  )

  expect(row.fiveHour).toEqual({ pct: 24, resetsAt: '2026-10-08T20:00:00Z' })
  expect(row.week?.pct).toBe(7)
  expect(row.note).toBeUndefined()
})

test('claude row without a reading says so', () => {
  expect(claudeRow([], NOW).note).toBe('no reading yet')
})

test('codex reading comes from the newest rate_limits line', () => {
  const older = JSON.stringify({
    timestamp: '2026-10-08T10:00:00Z',
    payload: { rate_limits: { primary: { used_percent: 5, resets_at: 1791500000 } } },
  })
  const newer = JSON.stringify({
    timestamp: '2026-10-08T17:00:00Z',
    payload: {
      type: 'token_count',
      rate_limits: {
        primary: { used_percent: 31, resets_at: Date.parse('2026-10-08T19:00:00Z') / 1000 },
        secondary: { used_percent: 5, resets_at: Date.parse('2026-10-14T18:00:00Z') / 1000 },
        rate_limit_reached_type: null,
      },
    },
  })
  const reading = findCodexReading([older, '{"type":"other"}', newer, '{"partial'].join('\n'))

  expect(reading?.timestamp).toBe('2026-10-08T17:00:00Z')
  const row = codexRow(reading!, NOW)
  expect(row.fiveHour?.pct).toBe(31)
  expect(row.week?.pct).toBe(5)
  expect(row.note).toBeUndefined()
})

test('a window whose reset has passed reads as zero', () => {
  const reading = findCodexReading(
    JSON.stringify({
      timestamp: '2026-10-07T21:00:00Z',
      payload: { rate_limits: { primary: { used_percent: 90, resets_at: Date.parse('2026-10-07T23:00:00Z') / 1000 } } },
    }),
  )

  expect(codexRow(reading!, NOW).fiveHour).toEqual({ pct: 0 })
})

test('codex transcript without rate limits gives no reading', () => {
  expect(findCodexReading('{"type":"event_msg"}\n')).toBeNull()
})

test('opencode snapshot maps rolling and weekly', () => {
  const row = opencodeRow(
    JSON.stringify({
      updatedAt: '2026-10-08T17:44:24Z',
      rolling: 12,
      weekly: 41,
      monthly: 70,
      rollingResetsAt: '2026-10-08T23:44:23Z',
      weeklyResetsAt: '2026-10-12T00:00:00Z',
    }),
    NOW,
  )

  expect(row.fiveHour?.pct).toBe(12)
  expect(row.week?.pct).toBe(41)
  expect(row.note).toBeUndefined()
})

test('claude snapshot file is the fallback reading', () => {
  const row = claudeFileRow(
    JSON.stringify({
      time: '2026-10-08T17:00:00Z',
      fiveHour: 10,
      weekly: 25,
      resetsAt: '2026-10-08T23:30:00Z',
      weeklyResetsAt: '2026-10-14T08:00:00Z',
    }),
    NOW,
  )

  expect(row.fiveHour?.pct).toBe(10)
  expect(row.week?.pct).toBe(25)
  expect(row.updatedAt).toBe('2026-10-08T17:00:00Z')
})

test('tone is green below 50, yellow to 70, red above 70', () => {
  expect(tone(49)).toBe('success')
  expect(tone(50)).toBe('warning')
  expect(tone(70)).toBe('warning')
  expect(tone(71)).toBe('error')
})

test('pc probe output parses, and a failed probe part reads as null', () => {
  expect(parsePc('14|68|98' + String.fromCharCode(13, 10))).toEqual({ cpu: 14, ram: 68, disk: 98 })
  expect(parsePc('|68|98')).toEqual({ cpu: null, ram: 68, disk: 98 })
})

test('opencode row shows the rounded-up five-hour value when the window has usage under 1 %', () => {
  const row = opencodeRow(
    JSON.stringify({
      updatedAt: '2026-10-08T17:59:00Z',
      rolling: 0,
      rollingDisplay: 1,
      weekly: 42,
      monthly: 70,
      rollingResetsAt: '2026-10-08T22:00:00Z',
      weeklyResetsAt: '2026-10-12T00:00:00Z',
    }),
    NOW,
  )
  expect(row.fiveHour?.pct).toBe(1)
  expect(row.week?.pct).toBe(42)
})
