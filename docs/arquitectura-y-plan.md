# Arquitectura y plan

## Idea

Una app web local. Arriba se elige el **proyecto** y el **orquestador** (por defecto Claude Code). Se escribe en un chat (con imágenes pegadas) y el backend reenvía todo al programa oficial correspondiente, que corre en segundo plano con el login del usuario. Todo lo que el orquestador hace, incluido lanzar agentes de otros modelos, se ve en vivo junto con el monitor de trabajadores, ramas y cuotas.

## Componentes

```
Navegador (chat + monitor por proyecto)
   │ WebSocket / SSE
Servidor local Node (sin dependencias pesadas)
   ├─ Adaptadores de orquestador (un proceso por sesión)
   │    ├─ Claude Code: claude -p --input-format stream-json --output-format stream-json
   │    │               --verbose --include-partial-messages --permission-mode bypassPermissions
   │    │               (primera vez --session-id <uuid>, luego --resume)
   │    ├─ OpenCode:    opencode serve (REST + SSE)
   │    ├─ Codex:       codex app-server (JSON-RPC) o codex exec --json
   │    └─ Antigravity: agy -p --output-format stream-json (sin imágenes; --conversation para retomar)
   ├─ Monitor (lo que ya existe en tools/fleet-monitor): tarjetas, actividad, ramas, cuotas, limpieza
   ├─ Registro de proyectos (qué carpeta, qué sesiones, qué trabajadores)
   └─ Supervisor de procesos (matar el árbol completo, timeouts, limpiar huérfanos al arrancar)
```

- **Detección del orquestador por proyecto:** las transcripciones de Claude Code quedan en `~/.claude/projects/<carpeta-del-proyecto>/<sesión>.jsonl`. El monitor toma la más reciente del proyecto elegido.
- **Imágenes:** bloques `image` en base64 dentro del JSON de entrada de `claude` (verificado por las investigaciones; probar en la práctica).

## Etapas

| Etapa | Qué | Base |
|---|---|---|
| 1 | Monitor general como app independiente en esta carpeta (`Korsakov Orchestrator`): selector de proyecto, Antigravity, cuotas, limpieza | `tools/fleet-monitor` actual + ramas de hoy |
| 2 | Panel de chat con Claude Code: streaming, imágenes, sesiones por proyecto, modo sin preguntas | ideas/código de `sugyan/claude-code-webui` (MIT) |
| 3 | Selector de orquestador: OpenCode (el más fácil), luego Codex y Antigravity | protocolos oficiales de cada CLI |
| 4 | Comando de inicio de proyecto: estructura para desarrollo con IA (reglas, skills, agentes, docs, datos, MCP) | gentle-ai `--scope workspace` + `AGENTS.md` como fuente única |

**Referencia de diseño para la etapa 2 (idea del usuario, 2026-10-06, solo a tener en cuenta):** así trabaja hoy el usuario y así debería sentirse Korsakov. Monitor ocupando unos dos tercios de la pantalla a la izquierda (agentes con su visor en vivo arriba, árbol de git abajo) y el chat del orquestador en una columna a la derecha. Del chat de Claude Desktop le sirven: el cuadro de escritura abajo, el proyecto activo, el contador de cambios (`+82 -0`) con el botón "Crear PR", y los selectores de permisos, modelo y esfuerzo.

**Esfuerzo estimado (investigaciones):** primera versión de 2 a 5 semanas (15–25 días según LongCat; 2–4 semanas para Claude más 1–2 por cada adaptador según DeepSeek).

**Quién trabaja:** DeepSeek 4.1 Flash construye, Gemini 3.8 Flash mapea código, LongCat investiga, Claude diseña y revisa.

## Riesgos técnicos

1. El formato `stream-json` de Claude no es una API estable: puede cambiar con cada actualización semanal. Mitigación: lector tolerante, tests con ejemplos reales, opción de fijar versión.
2. Windows: procesos colgados o huérfanos (issues #50616, #89859 de Claude Code). Mitigación: matar el árbol (`taskkill /T`), tiempos máximos, limpieza al arrancar.
3. En modo máquina Claude omite el razonamiento visible (#82896) y `canUseTool` no se llama para subagentes en segundo plano (#27203).
4. Se pierden herramientas propias de Claude Desktop (`get_usage`, panel de navegador): hay que reemplazarlas.
