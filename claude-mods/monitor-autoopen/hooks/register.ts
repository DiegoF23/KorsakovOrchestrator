import type { Register } from 'claude-code'

const MONITOR = 'http://127.0.0.1:4200'
const MONITOR_ORIGIN = '127.0.0.1:4200'
const BROWSER_SERVER = 'Claude_Browser'
const RETRY_MS = 2000
const MAX_ATTEMPTS = 30
// After the first open, keep checking that the monitor tab is still there:
// the desktop can reset the browser while it finishes setting up the session.
const WATCH_MS = 5000
const WATCH_CHECKS = 24
const LOG_LIMIT = 200

type ProjectList = { projects: { id: string; name: string }[]; defaultId: string }
type McpResult = { content?: { type: string; text?: string }[]; isError?: boolean }

const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
const resultText = (result: McpResult) =>
  (result.content ?? []).map(block => block.text ?? '').join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    let session = 'unknown'
    try {
      session = await $.session.id()
    } catch {}

    // Every step is appended to runs.log next to the plugin, one JSON line each.
    const log = async (event: string, detail: Record<string, unknown> = {}) => {
      const line = JSON.stringify({ at: new Date().toISOString(), session, cwd: e.cwd, event, ...detail })
      try {
        let previous = ''
        try {
          previous = await $.fs.read(`${$.plugin.root}/runs.log`)
        } catch {}
        const lines = previous.split('\n').filter(Boolean).slice(-(LOG_LIMIT - 1))
        await $.fs.write(`${$.plugin.root}/runs.log`, [...lines, line].join('\n') + '\n')
      } catch {}
    }

    let projects: ProjectList
    try {
      const response = await $.http.fetch(`${MONITOR}/api/projects`)
      if (!response.ok) return (await log('monitor answered with an error', { status: response.status }), result)
      projects = JSON.parse(response.text) as ProjectList
    } catch (error) {
      return (await log('monitor not reachable', { error: String(error) }), result)
    }

    // Prototype matching: project name against the session folder name.
    const folder = folderName(e.cwd).toLowerCase()
    const match = projects.projects.find(p => p.name.toLowerCase() === folder)
    const url = match ? `${MONITOR}/?project=${encodeURIComponent(match.id)}` : `${MONITOR}/`

    const open = async () => {
      const opened = (await $.mcp.call(BROWSER_SERVER, 'preview_start', { url })) as McpResult
      return !opened.isError
    }

    const browserState = async () => {
      const state = resultText((await $.mcp.call(BROWSER_SERVER, 'tabs_context', {})) as McpResult)
      const browserOpen = /"browserOpen":\s*true/.test(state)
      return {
        hasMonitor: browserOpen && state.includes(MONITOR_ORIGIN),
        shown: browserOpen && !state.includes('hidden'),
      }
    }

    // The desktop connects its browser server after the session starts, so the
    // first open is retried in the background until the server shows up.
    const run = async () => {
      let opened = false
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !opened; attempt++) {
        try {
          opened = await open()
          await log(opened ? 'opened' : 'browser refused', { url, attempt })
          if (!opened) return
        } catch (error) {
          if (attempt === MAX_ATTEMPTS) return log('browser not reachable', { error: String(error) })
          await $.clock.sleep(RETRY_MS)
        }
      }

      for (let check = 1; check <= WATCH_CHECKS; check++) {
        await $.clock.sleep(WATCH_MS)
        try {
          const state = await browserState()
          if (state.shown) return log('pane shown by the user', { check, hasMonitor: state.hasMonitor })
          if (!state.hasMonitor) {
            const reopened = await open()
            await log(reopened ? 'reopened after reset' : 'reopen refused', { check })
          }
        } catch (error) {
          await log('watch failed', { check, error: String(error) })
        }
      }
      await log('watch finished')
    }

    await log('session started', { url })
    void run()
    return result
  })
}
