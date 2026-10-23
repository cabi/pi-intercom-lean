# Maintenance notes

This is a thin adapter around upstream. It contains no upstream logic of its own; everything below is what it *depends on* in upstream, so an upstream change can silently break it.

## Matching upstream version

- **Pinned:** `pi-intercom@0.18.1` (exact version in `package.json` — no `^`, no `~`).
- Verify with `npm ls pi-intercom`.

## What was trimmed per tool

Upstream registers two tools. Both are merged into one lean `intercom` tool with an `op` enum; upstream `execute`/`renderCall`/`renderResult` are called with the original parameter names.

### `intercom` → ops `list`, `list-cwd`, `send`, `ask`, `handover`, `reply`, `pending`, `status`, `cancel`

- **Description** (1,687 → ~1,266 ch): kept every call-shape rule — targeting (name / full ID / short id in parentheses, leading ID-prefix resolution, the 0.18 name-prefix fallback when no exact match resolves and exactly one connected name shares the prefix, prefer short id on name clash, re-list before reuse, skip self-resolution), send/ask/handover `cwd` scoping + sole-live-session targeting, `openProjectPaneIfMissing`/`focus` behavior, reply-to-pending-ask semantics, cancel semantics, handover's "receiver acts on it" behavior. Dropped: examples, duplicates of schema content (type/enums/lengths restated in prose), human-only UI notes.
- **Parameters** (2,410 → ~788 ch): removed all per-property descriptions except `replyTo`, `supersedes`, `retryOf` (short, because the bare names don't disambiguate the threading/supersede/retry semantics); kept every field, type, enum, and constraint. (Upstream grew 2,261 → 2,410 ch in 0.18.0 by expanding the `to` description with the name-prefix fallback.)

### `contact_supervisor` → op `supervisor` (subagent sessions only, merged into the same tool)

- **Description** (522 ch + 705 ch snippet+guidelines → one short paragraph): kept which reasons wait for a reply and which don't, and when to use it (decisions, structured questions, plan changes — not routine completion). Dropped: the long interview-protocol guidelines (still fully available via `op: help` and upstream's runtime errors).
- **Parameters** (1,031 → shared schema + JSON strings): `reason` enum kept verbatim; `message` kept; `interview`'s 11-field nested schema collapsed into a JSON-string shape note (the structure is fully documented in `op: help` and validated by upstream on execute). Unchanged through 0.18.1.

### `help` (new, lean-only)

Returns the upstream `description`, `promptSnippet`, `promptGuidelines`, and `parameters` (pretty-printed JSON) for `topic: "intercom"` or `"contact_supervisor"`; with no topic it prints every upstream tool registered in this session.

## Upstream internals this depends on

| Internal | Where used here | Breakage if upstream changes |
|---|---|---|
| Tool names `"intercom"` and `"contact_supervisor"` | routing, help topics, renderers | lean op routes nowhere / renders nothing |
| `registerTool` registration at extension load (synchronous) | the Proxy collects tools during `upstream(pi)` | empty tool list at lean registration time |
| Upstream never calls `setActiveTools` and registers no loader tools (as of 0.18.1) | lean blocks `setActiveTools` to keep the tool list static | if upstream starts using it, features would silently vanish; revisit then |
| `execute(toolCallId, params, signal, onUpdate, ctx)` signature and `params.action` dispatch | forwarding with `{...params, action: op}` | calls fail or misroute |
| `contact_supervisor` params `reason` / `message` / `interview` | forwarding | supervisor ops break |
| Result shape `{ content, details?: { error } }` and renderer args (`args.action`, `args.reason`, `interview.title`) | render shims | degraded rendering only |
| Upstream errors returned as `details.error` (not throws) | error passthrough to the model | lean error handling looks broken but calls still work |
| Upstream validates `action`/`reason`/`interview` at execute time | lean schema is the only static gate | invalid values surface later; message still clear |
| `PI_SUBAGENT_ORCHESTRATOR_TARGET` env + orchestrator metadata decides whether `contact_supervisor` is registered | lean mirrors the same registration check via collected tools | supervisor op offered in main sessions or missing in subagent sessions |
| `defineTool` is an identity passthrough | lean builds its own definitions the same way | none today |
| pi `registerTool` throws on duplicate tool names | lean replaces upstream entirely; never co-load both in one session | co-loading crashes session startup |

## Fill-in rules (only unambiguous guesses)

Applied in `lean/fill-ins.ts` before schema validation:

- `action: <valid intercom op>` with no `op` → `op = action`.
- `action: <supervisor reason>` or `op: <supervisor reason>` → `op = "supervisor"`, `reason = <value>` (never overwrites an explicit `reason`).
- `op: "contact_supervisor"` / `op: "intercom"` (tool names) → the tool's ops.
- `action === op` → drop `action`.
- `action !== op` (both present) → error (ambiguous, not guessed).
- Unknown `action` value → left in place so schema validation reports the valid enum.
- Array/object `attachments` or `interview` → `JSON.stringify` (schema says string; upstream parses it back).
- `execute` also tolerates raw arrays/objects for `attachments`/`interview` if `prepareArguments` is bypassed (structures forward as-is; other non-strings error).

## How to upgrade

1. `npm install pi-intercom@<new-version>` (update the pin) and `npm install`.
2. `npx tsx analysis/load-upstream.mjs > analysis/upstream-dump.txt` — check tool count, names, action/reason enums, param lists, and whether `setActiveTools` or a loader tool appeared. (Plain `node` fails on Node ≥ 24: it refuses type-stripping inside `node_modules`.)
3. Diff the dump against this file's expectations (names, enums, params above); update `lean/tool.ts` texts/schema and the fill-ins if anything moved.
4. `npm test` — covers every op reaching upstream, help fidelity, fill-ins, static tool list.
5. `npm run measure` — update the README tables.
6. Update the version pin in this file and README.
