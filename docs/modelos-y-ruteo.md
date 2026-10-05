# Modelos y ruteo de tareas

Regla vigente (también en el `CLAUDE.md` global y en Engram). Se aplica sin preguntar en cada tarea.

| Tarea | Modelo |
|---|---|
| Leer PDFs, capturas, maquetas o videos del dueño | Antigravity **Gemini 3.1 Pro (High)** |
| Auditar un repositorio completo / contexto enorme | Antigravity **Gemini 3.1 Pro (High)** |
| Ubicar cosas en el código, ver qué hace hoy, depurar con logs, primera revisión | Antigravity **Gemini 3.8 Flash (High)** |
| Construir código (features, fixes, tests) | OpenCode **deepseek-v4.1-flash** (variante max) |
| Investigar en la web | OpenCode **longcat-2.5-preview-free**; si no alcanza, deepseek-v4.1-flash |
| Planificar, diseñar, revisar, decidir | **Claude** (orquestador) |
| Tareas que necesitan calidad Claude | Antigravity Claude Sonnet/Opus 5.5 (Medium), solo si hace falta o lo pide el usuario; Codex cuando esa cuota se agota |

**Nunca:** `opencode-go/deepseek-v4-pro` (caro). GPT-OSS 120B no aporta (nivel de o4-mini).

## Pruebas que respaldan la tabla (2026-10-05)

| Prueba | Resultado |
|---|---|
| Mapa del código del monitor (solo lectura) | Gemini 3.8 Flash: preciso y rápido |
| Construir el adaptador de Antigravity | Gemini 3.1 Pro: funcionó, pero con un bug, un caso sin terminar y un intento de correr scripts propios |
| **Prueba lado a lado**: ocultar tarjetas terminadas (misma consigna, entornos separados) | **DeepSeek 4.1 Flash ganó**: diseño limpio, commit, $0,04. Gemini 3.8 Flash: correcto pero con mañas (contador colgado de la lista, código muerto); 489k tokens |
| Leer 10 PDFs de revisión de pantallas | Gemini 3.1 Pro: 52 pedidos fieles, con palabras textuales; 5/5 en el control |
| Ubicar esos 52 pedidos en `main` | Gemini 3.8 Flash: buen índice, pero 3 de 10 afirmaciones falsas (inventó un archivo); 1,3 M tokens |
| Investigación web (5 modelos) | LongCat (117 fuentes) > DeepSeek Flash > Gemini Flash (abrió 1 página) > Gemini Pro (1 página) |

## Cómo darle tareas a Gemini con `agy`

- Pasarle **rutas exactas**: si no, adivina nombres de archivos en lugar de listar carpetas.
- `--mode plan` para solo lectura; `--mode accept-edits` para editar (la escritura en el workspace **no** se aprueba sola).
- No existe `--cwd`: lanzar desde la carpeta de trabajo; `--add-dir` para sumar otra.
- Consigna larga en un archivo dentro del workspace y un `-p` corto (en Windows, las comillas rompen el argumento).
- Cualquier permiso denegado **corta el turno** y aun así informa `SUCCESS` con respuesta vacía: tratarlo como falla.
- Permisos en `~/.gemini/antigravity-cli/settings.json`: `read_url(*)` para que pueda abrir páginas (acepta dominio, no regex); `command(...)` por prefijo (el `regex:` se evalúa palabra por palabra); un escape inválido en el JSON anula todo el archivo.
- Cada llamada carga unos 21k tokens de contexto base: no usarlo para tareas mínimas.
- Gemini investiga mal en la web: su buscador ya trae resúmenes y no abre las páginas.
