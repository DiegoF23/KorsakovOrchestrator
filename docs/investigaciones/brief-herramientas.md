# Research brief: tools for orchestrating AI coding agents

READ-ONLY research. Do not edit any file other than none; do not run shell commands. Your output is your final message.

## Context

One developer orchestrates AI coding agents on Windows. Claude Code (desktop app) is the orchestrator. It delegates work to Antigravity CLI (`agy`), OpenAI Codex CLI and OpenCode. Engram (persistent memory) and Context7 (docs) are connected via MCP.

## What we want to build or adopt

- **A. Multi-project local monitor**: a standalone local web app. Select a project (tabs or a select), see its orchestrator session, worker agents and their live activity, git branches, quota meters, and auto-cleanup of finished workers after a while. Works the same on any PC.
- **B. Project init command**: scaffolds an AI-development structure in any repo (rules, skills, agent configs, docs, data, MCP/connectors), portable across PCs, loaded automatically every session like Engram/Context7 rules are.
- **C. Quota tracking WITHOUT sending a model request** for Claude Code, Codex, OpenCode and Antigravity. A probe request is unacceptable: it spends quota and starts the 5-hour window clock.

## How to research (mandatory)

- Search the web broadly: GitHub, official docs, release notes, issues, discussions, Reddit/HN if useful. Read as many repositories and pages as needed.
- **Open and read every source page before citing it.** Never cite a URL you did not open. Never invent repository names, URLs, ports, file paths or endpoints.
- For C, be concrete: which local file, log, header or endpoint each tool reads, and for which CLI. For Antigravity specifically: is there any documented or observable way to read the remaining 5-hour/weekly quota without a model call? If you cannot confirm it from a source, say "not found" explicitly.
- Mark every claim as **verified** (you read it in the source) or **unverified**.

## Deliverable (Spanish, Markdown, under 1800 words)

1. Table of projects/tools: name, URL, what it does, last activity date and stars if visible, license, covers A/B/C, verdict (adopt / borrow ideas / skip) with one-line reason.
2. Section C detail: per CLI (Claude Code, Codex, OpenCode, Antigravity), how to read quota with zero tokens, with sources.
3. Recommendation: build vs adopt for A and B, and the top 5 ideas to copy.
4. List of sources actually opened.
