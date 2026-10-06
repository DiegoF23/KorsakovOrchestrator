# Vista en vivo de la actividad de los agentes

Requisitos acordados con el usuario el 2026-10-05. Base técnica: [investigaciones/13-vista-en-vivo-de-archivos.md](investigaciones/13-vista-en-vivo-de-archivos.md).

## Qué se quiere ver

1. **Mapa dibujado** de carpetas y archivos que el agente toca, con el estado de cada uno: leído, editado, creado, borrado.
2. **Panel desplegado** al elegir un elemento, que se adapta a lo que el agente produjo.

## Visores por tipo

| Tipo | Cómo se muestra |
|---|---|
| Código y texto | Hoja con resaltado (Prism); el contenido aparece como si se tipeara. Una edición se muestra como cambio (antes → después). |
| Imagen (png, jpg, gif, webp, svg) | Vista previa de la imagen. |
| Video (mp4, webm) | Reproductor. |
| Terminal (comandos) | Panel tipo consola: el comando y su salida, con colores ANSI. |
| PDF | Visor embebido del navegador. |
| Otros binarios o archivos muy grandes | Ficha con nombre, tamaño y tipo; sin contenido. |

- El tipo se decide por extensión y, si hace falta, por el contenido.
- El monitor sirve los archivos solo desde las carpetas de trabajo registradas, solo en `127.0.0.1`, y bloquea las rutas que intenten salirse de esas carpetas.

## Streaming real vs. simulado

- **Simulado (todos los agentes):** al terminar cada herramienta se toma el contenido completo y se anima en pantalla.
- **Real (Claude Code lanzado por Korsakov, etapa 2):** `stream-json` con mensajes parciales.

## Pendiente de verificar antes de construir

- Si la salida de comandos de OpenCode llega por partes mientras corre o solo al final.
- Los hallazgos de la investigación 13 (marcados verificados por LongCat, no comprobados por Claude).
