# Vista en vivo de la actividad de los agentes

Requisitos acordados con el usuario el 2026-10-05. Base técnica: [investigaciones/13-vista-en-vivo-de-archivos.md](investigaciones/13-vista-en-vivo-de-archivos.md).

## Qué se quiere ver

1. **Mapa dibujado** de carpetas y archivos que el agente toca, con el estado de cada uno: leído, editado, creado, borrado.
2. **Panel desplegado** al elegir un elemento, que se adapta a lo que el agente produjo.

## Principio

Lo más informativo posible del paso a paso de la IA. Cada herramienta que usa el agente se reproduce en pantalla en orden, animada (simulada, como Roo Code) o en vivo cuando el agente lo permita.

## Ventanas y pestañas

- Cada elemento abierto es una ventana desplegable que se puede **plegar** para esconderla.
- Las pestañas llevan el nombre (archivo, comando, memoria) y **cambian de color según el estado**, igual que las tarjetas del monitor actual (trabajando, terminado, detenido).

## Visores por tipo

| Tipo | Cómo se muestra |
|---|---|
| Código y texto | Hoja con resaltado (Prism); el contenido aparece como si se tipeara. Una edición se muestra como cambio (antes → después). |
| Imagen (png, jpg, gif, webp, svg) | Mientras el agente la genera: ícono animado "en construcción" con el estilo del tema. Al terminar: la imagen que devolvió el agente. |
| Video (mp4, webm) | Mismo ícono animado mientras se genera; al terminar, reproductor en la pestaña. |
| Terminal (comandos) | Mini terminal: el comando se tipea y la salida se va escribiendo, con colores ANSI. |
| Memoria (Engram: `mem_save`, `mem_search`, etc.) | Ficha de memoria: título, tipo y contenido guardado, escribiéndose; en búsquedas, la consulta y los resultados. |
| Otras herramientas (MCP, web, subagentes) | Nombre de la herramienta, sus parámetros y la respuesta resumida. |
| PDF | Visor del navegador dentro de la misma pestaña (como Claude Desktop). |
| Otros binarios o archivos muy grandes | Ficha con nombre, tamaño y tipo; sin contenido. Botones para copiar la ruta y para abrir el Explorador de Windows con el archivo seleccionado. |

- El tipo se decide por extensión y, si hace falta, por el contenido.
- El monitor sirve los archivos solo desde las carpetas de trabajo registradas, solo en `127.0.0.1`, y bloquea las rutas que intenten salirse de esas carpetas.
- Todo pedido a la API se acepta solo si viene de la propia página: encabezado `Host` igual a `127.0.0.1:<puerto>` o `localhost:<puerto>` (defensa contra *DNS rebinding*) y, si hay `Origin`, el mismo origen. Lo demás recibe 403.
- "Abrir en el Explorador" es una acción (POST) que solo acepta rutas dentro de las carpetas registradas y ejecuta `explorer.exe /select,<ruta>` sin pasar por una consola.

## Streaming real vs. simulado

- **Simulado (todos los agentes):** al terminar cada herramienta se toma el contenido completo y se anima en pantalla.
- **Real (Claude Code lanzado por Korsakov, etapa 2):** `stream-json` con mensajes parciales.

## Pendiente de verificar antes de construir

- Si la salida de comandos de OpenCode llega por partes mientras corre o solo al final.
- Los hallazgos de la investigación 13 (marcados verificados por LongCat, no comprobados por Claude).
