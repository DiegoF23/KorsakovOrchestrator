# Research brief: live view of the files an AI agent is touching

READ-ONLY research. Do not edit files and do not run commands that change anything. Your output is your final message.

## Context
Korsakov Orchestrator is a local web app (Node server without heavy dependencies, vanilla-JS `index.html`, Windows 11) that monitors AI coding agents working in git worktrees: Claude Code, OpenCode, Codex CLI and Antigravity `agy`. Today each agent card shows a text log of events (READ file, EDIT file, CMD, MSG, DONE with cost/tokens).

## What the user wants
1. A **drawn map of the paths and files** the agent is touching: a tree or graph of folders/files that lights up as the agent reads, edits, creates or deletes them, so you can see "where" it is working.
2. Clicking a file opens an **expanded panel with the file as a code sheet**, and the code **appears as the agent writes it**, token by token, like a chat answer streaming in. The same for every file it touches (tabs or a list of files).

## Questions (answer each, with evidence)
1. **Getting the content while it is written.** For each agent, can we receive the file content or edit arguments as they stream, before the tool call finishes?
   - Claude Code headless: `--output-format stream-json --include-partial-messages` (does `input_json_delta` stream the `Write`/`Edit` tool input incrementally? event shape?), and the transcript `.jsonl` in `~/.claude/projects/`.
   - OpenCode: `opencode serve` HTTP API + SSE events (for example `message.part.updated`, tool part `state.input`): is the tool input streamed partially or only complete?
   - Codex CLI: `codex exec --json` and `codex app-server` events for file changes / patches.
   - Antigravity `agy -p --output-format stream-json`.
   - Fallback when streaming is not available: watching the worktree on disk (`fs.watch` on Windows, chokidar) plus `git diff`, and showing a simulated "typing" animation of the diff. Pros and cons.
2. **Existing products that already do this** and how: Cursor, Windsurf, Zed agent panel, Cline / Roo Code (streaming diff view), GitHub Copilot agent mode, Claude Code web UIs (siteboon/claudecodeui, sugyan/claude-code-webui, opcode), Crystal/Nimbalyst, vibe-kanban, agentglass, OpenCode web/TUI, others you find. What they show, open-source code we could study (file paths in their repos), licenses.
3. **UI building blocks** that fit a no-build vanilla page loaded from a CDN: code view with syntax highlighting and incremental append (CodeMirror 6, Monaco, Shiki, highlight.js, Prism), diff views, and the file map (D3 tree/treemap, collapsible tree, force graph, plain CSS tree). Bundle size, CDN availability, performance with frequent updates.
4. **Recommended design** for our monitor: data flow (adapter → server → browser via SSE or polling), how to throttle many small updates, how to keep memory bounded, how to handle several agents at once, and a minimal first version vs a fuller one, with an effort estimate.
5. **Community experience**: Reddit, Hacker News, GitHub issues, blogs about live agent file views, what breaks (huge files, binary files, partial JSON parsing, Windows file watching).

## Rules
- Search the whole web, not only official sites: forums, Reddit, HN, GitHub issues/discussions, blogs, source code.
- Open and read every source before citing it. Never invent URLs, flags, event names or fields. Mark each claim verified or unverified.
- Spanish (neutral), Markdown, under 1800 words, ending with the list of sources actually opened.
