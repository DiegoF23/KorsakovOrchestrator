# Cuotas sin gastar consultas

Regla de oro del usuario: **nunca** mandar una consulta al modelo solo para saber la cuota, porque gasta y además arranca el reloj de la ventana de 5 horas.

| Herramienta | Cómo se lee | Estado |
|---|---|---|
| **Claude (Desktop)** | El orquestador llama `get_usage` (herramienta de Claude Desktop) en cada respuesta con trabajo, aprovechando un paso que igual iba a dar, y escribe `~/.claude/quota/claude-usage.json` | ✅ Funcionando. Regla escrita en el `CLAUDE.md` global |
| **Claude (terminal)** | `statusLine` recibe `rate_limits.five_hour` / `seven_day` por stdin; `statusline-usage.mjs` escribe el mismo archivo | ✅ Configurado; solo funciona en la terminal (Desktop no ejecuta statusline) |
| **OpenCode Go** | `GET https://opencode.ai/zen/go/v1/usage` con la clave local → porcentaje y `resetsAt` de 5 h, semanal y mensual | ✅ Automático: hook `UserPromptSubmit` → `opencode-quota.mjs` (máximo cada 5 min) → `~/.claude/quota/opencode-official.json` |
| **Codex** | Servicio local `account/rateLimits/read` o los JSONL de sesión | ⏳ Sin implementar (el monitor ya lee sesiones) |
| **Antigravity** | Servicio local del language server (`GetUserStatus`), solo con la app o `agy` abiertos; ventana de 5 h | ⏳ Sin verificar en esta PC. **Semanal: no encontrado** |

## Detalles importantes

- Antigravity tiene **dos bolsas separadas**: Gemini, y Claude/GPT. Cada una con su ventana de 5 horas y su semanal. Hacen falta **dos indicadores**.
- El porcentaje de OpenCode no coincide con el historial en dólares (issue anomalyco/opencode#41391): vale el porcentaje.
- Lo que se descartó para Claude: leer el token OAuth de `~/.claude/.credentials.json` y llamar `api.anthropic.com/api/oauth/usage`. El control de seguridad de Claude Code lo bloquea y no se esquiva.
- `get_usage` no deja nada guardado en disco: Claude Desktop pide el dato a Anthropic y lo muestra sin escribirlo (verificado).
