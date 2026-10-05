# Korsakov Orchestrator

Herramienta propia para orquestar agentes de IA de distintos proveedores desde un solo lugar, por proyecto, con visibilidad en vivo y control de cuotas.

Nació el 2026-10-05 a partir de la integración de Antigravity al equipo de agentes (Claude Code como orquestador; OpenCode, Codex y Antigravity como trabajadores).

## Visión en una frase

Una app local con **monitor general multi-proyecto** + **chat** que maneja los programas oficiales (Claude Code, Codex, OpenCode, Antigravity) con el login del propio usuario, para trabajar en cualquier proyecto y en cualquier PC de la misma forma.

## Índice

| Documento | Qué tiene |
|---|---|
| [decisiones.md](decisiones.md) | Todo lo decidido, con el porqué y lo descartado |
| [arquitectura-y-plan.md](arquitectura-y-plan.md) | Cómo se construye y en qué etapas |
| [cuotas.md](cuotas.md) | Cómo se lee la cuota de cada herramienta sin gastar tokens |
| [modelos-y-ruteo.md](modelos-y-ruteo.md) | Qué modelo hace qué tarea, pruebas que lo respaldan y cómo darle tareas a cada uno |
| [estado-actual.md](estado-actual.md) | Qué existe hoy: ramas, scripts, monitores, configuración |
| [huecos-y-pendientes.md](huecos-y-pendientes.md) | Preguntas abiertas, riesgos y trabajo pendiente |
| [investigaciones/](investigaciones/) | Los informes completos de cada agente investigador |
| [scripts/](scripts/) | Lanzadores y scripts de cuota usados en las pruebas |

## Investigaciones (resumen)

| # | Tema | Modelo | Calidad |
|---|---|---|---|
| 01 | Herramientas de orquestación (1ra pasada) | Gemini 3.1 Pro | Pobre: no abrió páginas |
| 02–04 | Herramientas, scaffolding, cuotas | Gemini 3.8 Flash / LongCat / DeepSeek Flash | Buenas; LongCat la mejor |
| 05 | Consolidado de 02–04 | Orquestador | — |
| 06 | Cuota de OpenCode Go con hora de reinicio | DeepSeek Flash | Excelente (leyó el código fuente) |
| 07 | Harness y aspecto legal de Claude | DeepSeek Flash | Muy buena |
| 08–11 | Interfaz web sobre los CLIs | LongCat / DeepSeek / Gemini Flash / Gemini Pro | LongCat > DeepSeek > Gemini |
| 12 | Mejores usos de Gemini | LongCat | Buena |
