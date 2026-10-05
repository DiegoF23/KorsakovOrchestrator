# OpenCode Go: monitorear cuota y reset sin gastar tokens

Investigación completada. Hallazgo principal: **existe un endpoint oficial de uso que devuelve el % y el `resetsAt` exacto, sin invocar ningún modelo**. Todo lo demás son alternativas/fallbacks.

## 1. Endpoint oficial (✅ verificado en código fuente de `anomalyco/opencode`)

- `GET https://opencode.ai/zen/go/v1/usage`
- Auth: header `Authorization: Bearer <API key>` + `Accept: application/json`. Es un GET seco: **no consume cuota**.
- Respuesta (route oficial, `zen/go/v1/usage.ts`):
```json
{"usage":{
  "rolling":{"status":"ok|rate-limited","percent":0-100,"resetsAt":"ISO-8601"},
  "weekly":{...}, "monthly":{...}}}
```
- `percent` = **% usado** (entero, `Math.floor`). `resetsAt` se calcula server-side como `now + resetInSec` (`usage.ts#L155`): **sí expone el reset exacto**; no hace falta computarlo.
- Errores: `401 AuthError` (key inválida), `403 EntitlementError` (sin suscripción).
- Segunda vía, OpenCode 2 / OAuth de consola: `GET {consoleBaseUrl}/api/go/status` → `access.meters.{fiveHour,week,month}` con `limitMicroCents`, `usedMicroCents`, `resetsAt` (slkiser `opencode-go.ts#L253`).

## 2. Dónde vive el token (✅ verificado en fuente y en disco)

- V1: `auth.json` en `Global.Path.data/opencode` (`auth/index.ts`); `xdgData` ⇒ `~/.local/share/opencode/auth.json`. En esta máquina `C:\Users\DiegoFA\.local\share\opencode\auth.json` existe (el path `%LOCALAPPDATA%\opencode` **no**). Formato: `{"<providerID>":{"type":"api","key":"..."}}`; IDs `opencode-go` (alias legacy `opencode`).
- V2: SQLite `~/.local/share/opencode/opencode.db`, tabla `credential` (`integration_id`, `value` JSON con `.key`) (`tui.tsx#L94`).
- Alternativa: env `OPENCODE_API_KEY`. La misma key sirve para `/models` y `/usage` (no es la cookie de la web).

## 3. Definición de ventanas (✅ verificado, `console/core/src/subscription.ts` + `util/date.ts`)

- **5h rolling**: reset = `timeRollingUpdated + 5h`; cada request con uso mueve `timeRollingUpdated`, así que el reset se corre (`subscription.ts#L53`). Si no hubo uso en 5h, % = 0 y reset = ahora+5h.
- **Weekly**: semana UTC fija, lunes 00:00 UTC → lunes 00:00 UTC (`date.ts#L1`).
- **Monthly**: periodo anclado al timestamp UTC de suscripción, **no** mes calendario (`date.ts#L11`).
- Límites: 5h = 20% del mensual, weekly = 50%, monthly = 100% (docs Go).

## 4. Si no hubiera API: cálculo local (⚠️ aproximado, no verificado en vivo)

Con timestamps de `opencode.db` (hoy `~/.local/share/opencode/opencode.db`; existe en esta máquina):
- 5h: último mensaje assistant del provider `opencode-go` + 5h (aproximación: el server también cuenta requests de otros clientes).
- Weekly: próximo lunes 00:00 UTC. Monthly: `resetsAt − 1 mes` o fecha de suscripción (xingkaijun usa `ResetsAt − 30d`).
- Es redundante salvo para mostrar reset con caché offline.

## 5. Cómo lo computan las herramientas de la comunidad (todas usan el mismo endpoint)

- **slkiser/opencode-quota**: URL en `lib/opencode-go.ts#L10`, fetch+validación `#L153`, parseo `#L80`; provider en `providers/opencode-go.ts`. Consola OAuth `#L253`.
- **xingkaijun/opencode-go-quota** (plugin CPA, Go): structs `poller.go#L14-L24`, Bearer en `#L69`, `fetchOnce`; además graba requests por día para forecast.
- **ranjithrajv/opencode-usage-quota-tracker**: `tui.tsx#L33` URL, `#L60` `apiKeys()`, `#L94` keys desde SQLite, `#L261` `fetchUsage()`; muestra 5h/1w/1mo con countdown.
- **ridho9/opencode-go-usage**: legacy, scraping HTML de `https://opencode.ai/workspace/{wrk}/go` buscando `rollingUsage:$R...` → `usagePercent`/`resetInSec` (`index.js`) — frágil.
- **jorgealonsodev/opencode-go-monitor** (VSCode): scraping con cookie de sesión; "API mode" aún reservado (⚠️ solo leí README/marketplace).
- **janekbaraniewski/openusage**: RPC SolidStart `https://opencode.ai/_server` con hashes fijos que rotan por deploy (`console_rpc.go`); expone billing/usage Zen, **no** los medidores 5h/1w/1mo de Go (✅ leído).
- **tongsh6/opencode-token-tracker**: solo tokens/costos locales (JSONL); sin cuota Go (⚠️ solo README).

## 6. Advertencia real

Issue [#41391](https://github.com/anomalyco/opencode/issues/41391) (abierto): los % de Go no cuadran con el "Usage History" en dólares (posible multiplicador ~4x por modelo). El endpoint sigue siendo la fuente autoritativa del %, pero **no asumas que `% × límite = dólares visibles`**.

## Fuentes abiertas y leídas

Oficiales: [route usage.ts](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/usage.ts) · [subscription.ts](https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/subscription.ts) · [util/date.ts](https://github.com/anomalyco/opencode/blob/dev/packages/console/core/src/util/date.ts) · [auth/index.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/auth/index.ts) · [core/global.ts](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/global.ts) · [docs/go](https://opencode.ai/docs/go) · [issue #41391](https://github.com/anomalyco/opencode/issues/41391).

Comunidad (raw leídos): [slkiser lib/opencode-go.ts](https://github.com/slkiser/opencode-quota/blob/main/src/lib/opencode-go.ts) · [slkiser providers/opencode-go.ts](https://github.com/slkiser/opencode-quota/blob/main/src/providers/opencode-go.ts) · [slkiser opencode-go-auth.ts](https://github.com/slkiser/opencode-quota/blob/main/src/lib/opencode-go-auth.ts) · [xingkaijun poller.go](https://github.com/xingkaijun/opencode-go-quota/blob/main/poller.go) · [xingkaijun usage.go](https://github.com/xingkaijun/opencode-go-quota/blob/main/usage.go) · [ridho9 index.js](https://github.com/ridho9/opencode-go-usage/blob/main/index.js) · [ranjithrajv tui.tsx](https://github.com/ranjithrajv/opencode-usage-quota-tracker/blob/main/tui.tsx) · [openusage console_rpc.go](https://github.com/janekbaraniewski/openusage/blob/main/internal/providers/opencode/console_rpc.go) · [openusage local_paths.go](https://github.com/janekbaraniewski/openusage/blob/main/internal/providers/opencode/local_paths.go) · READMEs de ridho9, xingkaijun, slkiser, ranjithrajv, tongsh6 y jorgealonsodev.

**Recomendación**: el monitor local debe leer la key de `auth.json` (o `credential` en SQLite v2), llamar `GET /zen/go/v1/usage` con Bearer al abrir/refrescar (p. ej. cada 5–15 min, o una vez y calcular countdown con `resetsAt`), y mostrar `percent` + cuenta regresiva. Cero tokens de modelo.
