# Huecos y pendientes

## Preguntas abiertas

1. **Cuota semanal de Antigravity:** ninguna investigación encontró cómo leerla sin gastar. La de 5 horas saldría del servicio local `GetUserStatus`, pero **no está verificado en esta PC**.
2. **Imágenes por `stream-json` en Claude Code:** las investigaciones dicen que sí; falta probarlo de verdad.
3. **Cuota de Claude dentro de Korsakov:** fuera de Claude Desktop no existe `get_usage`. Opciones: statusline (solo terminal) o el dato que trae cada respuesta en modo máquina (sin verificar).
4. **Agent SDK con plan Pro/Max:** LongCat dice que el SDK es para claves de API, no para la suscripción. Sin verificar; por eso el plan usa el binario `claude`.
5. **`git add` con varios archivos denegado en `agy`** aunque esté `command(git add)` permitido. Sin resolver.

## Trabajo pendiente

- [x] **Tiempo restante real en las tarjetas** (pedido del usuario, 2026-10-06; implementado 2026-10-06 con la lista de tareas del propio agente, sin costo de cuota). Hoy el "~5:17" sale de ``etaEnd``, una hora de fin que el orquestador adivina al lanzar la pista (`resolveRemainingText` en `monitor/lib/format.mjs`), y queda desfasado. Objetivo: que se actualice solo, por programación, sin gastar cuota del orquestador. Ideas a evaluar: (a) el constructor escribe líneas `PROGRESS n/m` (o marca casillas del brief) y el monitor estima `restante = transcurrido × (m − n) / n`; (b) el supervisor cuenta tareas cerradas en el documento de la pista; (c) un histórico de duraciones por tipo de tarea y modelo. El orquestador no interviene. El monitor mide el ritmo y reemplaza el `~5:17` adivinado por el restante medido (`monitor/lib/progress.mjs`, ver `monitor/README.md`).
  - [x] **Barra de avance (idea del usuario, 2026-10-06; implementada 2026-10-06):** una barra que se llena según el % hecho, pero que no salte de 1 a 100 de golpe y que dé tranquilidad de que se está trabajando, además de decir si va bien o demorado. Fuente propuesta, sin costo: la **lista de tareas que el propio agente mantiene** (OpenCode `todowrite`, Claude `TodoWrite`, Codex `update_plan`), que ya llega en los pasos completos. Barra por segmentos (uno por ítem: hecho / en curso / pendiente), el ítem en curso visible, ritmo comparado con lo esperado (adelantado / en hora / demorado) y aviso "sin movimiento hace N min" si no llegan pasos.

- [ ] Etapa 1: llevar el monitor a `Korsakov Orchestrator` como app independiente con selector de proyecto.
- [ ] Integrar en `main` las ramas del monitor (`feat/fleet-monitor-antigravity`, `bench/bench-deepseek`). **Decisión del usuario.**
- [ ] Pasar `agy-run.ps1` / `oc-run.ps1` a `tools/autopilot` como despachadores oficiales (aprobado).
- [ ] Medidor de cuota de Antigravity con dos bolsas (Gemini y Claude/GPT).
- [ ] Medidor de Codex.
- [ ] Bajar el caché de cuotas del monitor (hoy 60 s) para que tome los cambios al instante.
- [ ] Comando de inicio de proyecto sobre gentle-ai.

## Relacionado (proyecto Flota)

- 52 pedidos del dueño extraídos de los PDFs de revisión de pantallas (`FlotaGrupo-worktrees/monitor-antigravity/.oc-logs/demo/pdf-review/`). Verificado que en `main` siguen pendientes, entre otros: el Tab que se para en el ojito de la contraseña, "tanque lleno" por defecto en el servidor, fotos en la lista de usuarios y la confirmación antes de cambiar la clave. El resto del mapa de Gemini Flash hay que verificarlo antes de construir.
