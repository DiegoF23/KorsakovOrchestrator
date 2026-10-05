# Research brief: a web chat UI that drives Claude Code (and other agent CLIs) as the backend

READ-ONLY research. Do not edit files and do not run commands that change anything. Your output is your final message.

## Idea to validate
A local web app (like `opencode web`): the user picks an orchestrator (Claude Code, or later Codex / OpenCode / Antigravity `agy`), types in a chat UI (with images pasted), and the backend runs the OFFICIAL CLI process with the user's own login, forwarding messages and streaming back text, tool calls, diffs and token usage. Sessions are grouped by project and can be resumed. The orchestrator itself keeps launching worker agents of other models as it does today. Windows 11 is the main platform. The user normally runs agents with no permission prompts (bypass / auto mode).

## Questions (answer each, with evidence)
1. Claude Code headless: exact flags for bidirectional streaming (`-p`, `--output-format stream-json`, `--input-format stream-json`, `--verbose`, `--resume`, `--session-id`, `--permission-mode`, `--dangerously-skip-permissions`, `--permission-prompt-tool`). Can images be sent through stream-json input? Message/event schema. Known bugs or limits (Windows, long sessions, MCP servers, hooks, CLAUDE.md, skills loading in -p mode).
2. Claude Agent SDK (TypeScript/Python) vs spawning the `claude` binary: which works with a Claude Pro/Max subscription login, and what Anthropic's docs/terms say about building a personal UI on top. Cite the legal/compliance page text.
3. Permissions: how existing UIs handle approval prompts in headless mode (bypass mode, canUseTool callback, permission prompt MCP tool), and how to carry the user's "never ask" setup.
4. Same questions, shorter, for Codex CLI (`codex exec --json`, app-server), OpenCode (`opencode serve` / `opencode web` HTTP API + SSE) and Antigravity `agy` (stream-json in/out, `--conversation`).
5. Existing open-source projects that already do this (for example siteboon/claudecodeui (CloudCLI), opcode/claudia, Crystal/Nimbalyst, vibe-kanban, opencode web, others you find): what they cover, stars/activity, license, Windows support, adopt vs fork vs borrow ideas.
6. Community experience: Reddit (r/ClaudeAI, r/ClaudeCode, r/LocalLLaMA), Hacker News, GitHub issues, forums, blogs. What breaks, what people recommend, real token-cost observations (does a UI wrapper change token usage vs the plain CLI?).
7. A recommended architecture and an effort estimate for an MVP (chat + images + per-project sessions + orchestrator selector + streaming tool calls).

## Rules
- Search the whole web, not only official sites: forums, Reddit, HN, GitHub issues/discussions, blogs.
- Open and read every source before citing it. Never invent URLs, flags or fields. Mark each claim verified or unverified.
- Spanish, Markdown, under 1800 words, ending with the list of sources actually opened.