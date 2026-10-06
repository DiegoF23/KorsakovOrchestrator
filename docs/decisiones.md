# Decisiones

Todas tomadas el 2026-10-05 salvo indicación. Formato: decisión → por qué → qué se descartó.

## D1. Antigravity se integra por su CLI `agy`, no por el SDK de Python

- **Por qué:** `agy -p` usa la sesión de la cuenta de Google del usuario, que incluye Gemini 3.8 Flash, Gemini 3.1 Pro y Claude Sonnet/Opus 5.5 con cuota propia. El SDK `google-antigravity` se autentica con `GEMINI_API_KEY` (API paga aparte) y solo apunta a modelos Gemini.
- **Descartado:** el script `agy_worker.py` sugerido por Antigravity (sin aislamiento de carpeta, sin worktree, prompt por argv, nombres de modelos desactualizados).

## D2. Ruteo de modelos (ver [modelos-y-ruteo.md](modelos-y-ruteo.md))

- Gemini como caballo de batalla en lo que es bueno; Claude de Antigravity se conserva; DeepSeek 4.1 Flash construye; LongCat investiga; Claude orquesta y revisa.
- **Nunca** `deepseek-v4-pro`: consume mucho.
- **Descartado:** "Sonnet 5.5 Medium por defecto para todo" (primera versión de la regla, corregida por el usuario el mismo día).

## D3. Seguir con el esquema actual; no adoptar un harness

- **Por qué:** los harness (claude-squad, Conductor, vibe-kanban, Crystal/Nimbalyst, etc.) esperan a un humano en su interfaz como centro de mando. Nuestro orquestador es una IA (Claude) que lanza los trabajadores por su cuenta. Adoptar uno invertiría el flujo.
- **Legal:** Anthropic no permite que terceros ofrezcan el login de Claude.ai ni intermedien credenciales Pro/Max; sí permite que el usuario inicie sesión en el binario oficial `claude` sin modificar. OpenCode quitó su login de Claude en marzo de 2026 por un pedido legal. Ver investigación 07.

## D4. Construir nuestro propio monitor general (no adoptar uno)

- **Por qué:** ninguna herramienta existente junta multi-proyecto + orquestador + trabajadores de 4 proveedores + ramas + cuotas + limpieza + Windows. Se toman ideas de agentglass, ctop, agent-dashboard y Claude-Code-Agent-Monitor.
- **Casa:** carpeta propia `Desktop\Korsakov Orchestrator` (decidido por el usuario el 2026-10-05, reemplaza la idea inicial de `Herramientas-IA`).

## D5. Korsakov = monitor + chat sobre los CLIs oficiales, por etapas

- **Por qué:** es viable y legal lanzar el `claude` oficial en modo máquina (`stream-json`), con imágenes, sesiones retomables y sin preguntas (`--permission-mode bypassPermissions`). La interfaz no suma tokens.
- **Base candidata:** `sugyan/claude-code-webui` (MIT). De CloudCLI (`siteboon/claudecodeui`, AGPL) solo ideas.
- **Condición:** no abandonar Claude Desktop hasta que Korsakov sea mejor.
- **Descartado por ahora:** una "IDE propia" completa desde cero.

## D6. Cuotas sin gastar consultas

- Ver [cuotas.md](cuotas.md). Claude se actualiza en cada respuesta con trabajo, usando `get_usage` de Claude Desktop; OpenCode con su consulta oficial y un hook automático.
- **Descartado:** leer el token OAuth de Claude para la consulta interna de uso (lo bloquea el control de seguridad de Claude Code; no se esquiva).
- **Descartado:** statusline en Claude Desktop (Desktop no la ejecuta; sí funciona en la terminal).

## D7. Limpieza automática de tarjetas

- Ocultar tarjetas terminadas o falladas a los **5 minutos** (elección del usuario). El texto "N terminadas ocultas" es un botón que las vuelve a mostrar.

## D9. Solo localhost; escritorio quizás más adelante

- Korsakov corre solo en la PC del usuario (`127.0.0.1`); nunca se expone a la red.
- Por ahora es web. Más adelante quizás se empaquete como app de escritorio con un envoltorio web → escritorio.
- **Consecuencia de diseño:** mantener servidor Node + página web sin acoplarse al navegador, para que el envoltorio sea trivial. Electron puede correr el servidor Node adentro; Tauri necesitaría el servidor como proceso aparte (sidecar). Sin decidir.

## D8. Respuestas cortas

- El usuario pide respuestas resumidas siempre; si quiere detalle, lo pide.
