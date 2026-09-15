# LKC Diagnostics Plan

This is the next backend step after the existing Firebase log dashboard.

## Minimum Health Action

Each GAS project should expose a read-only diagnostic action:

```text
health_check
```

Return:

```json
{
  "status": "success",
  "system": "LKC_Group",
  "time": "2026-06-14T00:00:00.000Z",
  "checks": {
    "sheetOpen": true,
    "cacheService": true,
    "firebaseAuth": true,
    "scriptProperties": true
  },
  "durationMs": 123
}
```

## Suggested Checks

- `sheetOpen`: can open the configured spreadsheet and read one cell.
- `cacheService`: can write/read/remove a short diagnostic key.
- `firebaseAuth`: can get a token or read/write a diagnostic cache path when the project owns Firebase sync.
- `scriptProperties`: required secrets/config keys exist, without returning their values.
- `actionRouter`: required actions are registered.

## Stability Bot Integration

1. `logs.html` remains the human dashboard and export surface.
2. Export filtered log JSON from `logs.html`.
3. `church_logs_summary.py --input exported.json` produces the log evidence summary.
4. `health_check` results become `metrics` and `chaos_tests` evidence for `arch_stability_bot.py`.
5. The stability bot produces the current score and next actions.

## Phase 1 Shared Event Contract

`firebase/observability-registry.js` is the source of truth shared by the
browser logger and `logs.html`. The dashboard groups events by `system` and
sorts each system by severity before time.

Required contract fields:

- `schemaVersion`: current event shape version (`1`).
- `system`: canonical system ID shown to operators.
- `systemStorageKey`: Firebase-safe path key when the display ID contains
  characters that cannot be used in a Realtime Database key.
- `environment`: `production`, `test`, `staging`, `development`, or `unknown`.
- `source`: `api`, `ui`, `unhandled`, `supabase`, `firebase`, `gas`, `audio`,
  `workflow`, or `unknown`.
- `level`: `critical`, `error`, `warn`, or `info`.
- `fingerprint`: deterministic grouping key for repeated equivalent failures.

Severity policy:

- `critical`: system outage, data or security risk, or retry/deferred-cycle
  exhaustion.
- `error`: failed operation, uncaught exception, timeout, or external API
  failure.
- `warn`: fallback, retry, stale data, or degraded-but-successful operation.
- `info`: successful or recovered state transition.

`logs.html` supports filtering by date, system group, system, severity, source,
and keyword. The default view is grouped by system; each event expands to show
request ID, error type, endpoint placeholder, fingerprint, and sanitized meta.

## Phase 2 Browser Collection

`firebase/observability-browser.js` is the shared browser collector.

- Pages using the central `config.js` capture `window` errors, unhandled promise
  rejections, resource/media errors, and `console.error` without wrapping the
  existing `churchAPI` fetch path.
- Direct pages load the collector as a module and additionally capture failed
  direct `fetch` responses or network exceptions. The original response/error
  behavior is preserved for the application.
- Browser events use `source` values such as `unhandled`, `ui`, `audio`, and
  `api`; the collector rate-limits repeated fingerprints and redacts tokens,
  passwords, authorization values, data URLs, and sensitive metadata keys.
- The collector exposes `window.LKCObservability.reportError` for future
  explicit Supabase or domain-specific adapters.

## Phase 3 Endpoint and Supabase Collection

Endpoint failures now enter the same normalized event contract as browser,
GAS, Firebase, and workflow events.

- firebase/observability-endpoints.js provides the shared endpoint wrapper.
  It records the source, system, HTTP status, action, error type, and
  sanitized endpoint while returning the original response or rethrowing the
  original network error.
- supabase/supabase-config.js installs a synchronous bootstrap because some
  pages create the first Supabase client before the browser module finishes
  loading. The bootstrap queues events when no logger is ready and flushes
  them when firebase/observability-browser.js is installed.
- All eight Supabase adapters request the shared client options:
  LKC_worship, LKC_MasterSchedule, LKC_SundayserviceAttendance,
  LKC_Group, LKC_MinistrySchedule, LKC_NewFamily, LKC_SundayBulletin,
  and LKC_WorshipPPT.
- Central config.js events are tagged with source gas and include the GAS
  endpoint path. This keeps GAS failures separate from generic UI/API errors.
- Endpoint severity is error for network failures and normal server/client
  failures; 404, 408, and 429 are warn because they are commonly retryable
  or expected fallback conditions.
- Endpoint records keep only origin and pathname. Query strings, tokens,
  authorization values, request bodies, and member data are not logged.

## Observability Log Retention

Error logs are retained for three calendar months. The cutoff date is
inclusive: on 2026-09-14, the cleanup keeps logs from 2026-06-14 onward and
deletes only older logs/{system}/{YYYY-MM-DD} date buckets.

- scripts/cleanup-observability-logs.mjs performs the authenticated RTDB
  cleanup.
- .github/workflows/cleanup-observability-logs.yml runs it once per day.
- The workflow requires the GitHub Actions secret
  FIREBASE_SERVICE_ACCOUNT_JSON; if it is absent, the scheduled run skips
  cleanup with a warning rather than attempting an unauthenticated delete.
- Cleanup is date-bucket based and preserves malformed/non-date keys.
- The browser logger does not delete logs and no Firebase service credential is
  shipped to the frontend.

## Log Fields Used By The Bot

The frontend logger should keep these fields structured:

- `requestId`: groups one user/API flow across cache, fallback, and direct GAS events.
- `environment`: `prod` or `test`.
- `appVersion`: frontend logging/config version.
- `sessionId`: anonymous device/session id, not a real user identity.
- `errorType`: normalized failure class such as `GAS_NON_SUCCESS`, `FIREBASE_CACHE_ERROR`, or `INVALID_CACHE_RESPONSE`.
- `cache`: `{ enabled, topic, subkey, ttl, source, hit, miss, fallback }`.
- `payload`: `{ requestBytes, responseBytes, itemCount }`.
- `invalidation`: `{ writeAction, topics, count, failedTopics, durationMs }`.

These fields let the Python bot detect cache hit-rate drops, large payloads, repeated error classes, stale cache, and expensive invalidation.

## Do Not Log

- Tokens.
- Service account JSON.
- Phone numbers.
- Full member data.
- Full request payloads.

Keep log metadata short and structural.
