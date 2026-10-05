# Reporte consolidado: monitor general, comando de inicio y cuotas

Fecha: 5 de octubre de 2026. Síntesis de tres investigaciones independientes con la misma consigna:

| Investigador | Modelo | Profundidad | Informe |
| --- | --- | --- | --- |
| Antigravity | Gemini 3.8 Flash (High) | 33 búsquedas, 24 páginas leídas, 474k tokens | `Investigacion-Flash.md` |
| OpenCode | LongCat 2.5 preview | ~35 fuentes abiertas | `Investigacion-LongCat.md` |
| OpenCode | DeepSeek v4.1 Flash (max) | ~40 fuentes abiertas | `Investigacion-DeepSeek.md` |

Lo marcado como *sin verificar* todavía no fue comprobado en esta máquina.

## 1. Monitor general (multi-proyecto)

**Conclusión de los tres: construir, no adoptar.** Ninguna herramienta existente combina selector de proyecto, orquestador y trabajadores en vivo, ramas de git, cuotas, limpieza automática y soporte para Windows.

Ideas a tomar:

- **Claude-Code-Agent-Monitor**: tablero por estados (trabajando, esperando, terminado, error) y visor de transcripciones. Flash propone usarlo como base y adaptarlo.
- **agentglass**: lee las transcripciones de Claude en `~/.claude/projects/**/*.jsonl` y tiene selector de proyecto.
- **ctop**: detecta sesiones por procesos y archivos locales, y limpia sesiones "fantasma".
- **agent-dashboard**: máquina de estados por sesión, con subagentes y planes.
- **Limpieza automática**: ocultar o archivar trabajadores terminados después de un tiempo configurable.

## 2. Comando de inicio de proyecto

**Conclusión: construir un comando liviano sobre lo que ya tenemos.**

- **gentle-ai** (ya instalado) cubre memoria, MCP, skills y reglas con `--scope workspace` y `sdd-init`. Es la base más cercana a lo pedido.
- **AGENTS.md** como fuente única de reglas para todos los agentes.
- **agentinit** y **rulesync**: generan la configuración de cada agente (Claude, Codex, OpenCode, Antigravity) a partir de una sola fuente.

Flujo propuesto: detectar el stack → instalar gentle-ai en el proyecto → generar `AGENTS.md`/`CLAUDE.md` sincronizados → conectar Engram y Context7 → carpetas de docs y datos → commit inicial.

## 3. Cuotas sin gastar consultas

| Herramienta | Cómo se lee sin tokens | Estado |
| --- | --- | --- |
| Claude Code | Datos de `rate_limits` que Claude Code pasa a la statusline; historial con `ccusage` | Coinciden los tres |
| Codex | Servicio local `account/rateLimits/read` o los JSONL de sesión | Coinciden |
| OpenCode (plan Go) | Consulta de uso `/zen/go/v1/usage` | DeepSeek y LongCat |
| Antigravity | Servicio local del language server (`GetUserStatus`), **solo con la app o `agy` abiertos**. Muestra la ventana de 5 horas | Coinciden LongCat y DeepSeek; Flash lo describe como "hay que conectarse al proceso en ejecución". *Sin verificar* |
| Antigravity (semanal) | **No encontrado** por ninguno | Pendiente |

Historial de tokens de Antigravity: bases SQLite en `~/.gemini/antigravity-cli/conversations/` (según la documentación de ccusage).

## 4. Lecciones de la prueba

- Antigravity investiga bien **solo si puede abrir páginas**: hace falta `read_url(*)` en sus permisos. La primera investigación con Gemini 3.1 Pro salió pobre por eso.
- Cualquier permiso denegado corta el turno de `agy` y aun así informa `SUCCESS`. El lanzador y el monitor ya lo detectan como error.
- Los tres modelos baratos rindieron bien. LongCat y DeepSeek no tocaron la cuota de Antigravity.

## 5. Próximos pasos propuestos

1. Verificar en esta máquina la lectura de la cuota de Antigravity sin consultas.
2. Diseñar el monitor general en el repositorio `Herramientas-IA`.
3. Pasar `agy-run.ps1` a despachador oficial.
4. Diseñar el comando de inicio sobre gentle-ai.
