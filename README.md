# pi-intercom-lean

A token-lean wrapper around [pi-intercom](https://github.com/nicobailon/pi-intercom), the inter-session messaging extension for the [pi coding agent](https://github.com/nicobailon/pi). Based on pi-intercom by **Nico Bailon**; this repo keeps his original MIT license (see [LICENSE](LICENSE)) and contains no copied upstream code — it installs `pi-intercom` as a pinned dependency and wraps it.

**Every upstream feature is preserved.** The only change is what the model reads on each request: upstream's two long tool declarations are merged into one small `intercom` tool whose `op` picks the operation, with short descriptions and trimmed schemas. Op `help` returns the full upstream description and parameters on demand.

## Token savings (o200k_base / gpt-4o)

Measured with `npm run measure` against pi-intercom 0.18.0. "Declaration" = description + parameters JSON, sent with every request that lists tools; snippet + guidelines land in the system prompt.

### Main session

| Tool | Description | Parameters | Snippet+guidelines | Total |
|---|---|---|---|---|
| upstream `intercom` | 413 tok (1,687 ch) | 563 tok (2,410 ch) | 25 tok | 1,001 tok |
| lean `intercom` | 259 tok (1,266 ch) | 196 tok (788 ch) | 18 tok | 473 tok |

**53% saved (528 tokens per request).**

### Subagent session

| Tool | Description | Parameters | Snippet+guidelines | Total |
|---|---|---|---|---|
| upstream `intercom` | 413 tok | 563 tok | 25 tok | 1,001 tok |
| upstream `contact_supervisor` | 95 tok | 231 tok | 130 tok | 456 tok |
| lean `intercom` (includes supervisor ops) | 303 tok (1,515 ch) | 262 tok (1,051 ch) | 27 tok | 592 tok |

**59% saved (865 tokens per request).**

## How it works

- Loads upstream through a `Proxy` that intercepts `registerTool`, collects the definitions, and re-registers one lean tool that routes each `op` to the original upstream `execute`. Commands (`/intercom`, `/alias`, `/handover`, …), the `alt+m` shortcut, and event wiring pass through untouched.
- Common parameters stay in the schema; rare ones (`attachments`, `interview`) pass as JSON strings, validated before forwarding.
- `op: help` prints the full upstream description, snippet, guidelines, and parameters for the matching tool.
- The tool list can't change mid-session: `setActiveTools` (and any dynamic tool activation) is blocked, since upstream registers its tools once at load.
- Safe fill-ins before validation: `action: X` → `op: X`, a supervisor `reason` used as `op` → `op: supervisor`, tool-name aliases (`intercom`, `contact_supervisor`), and structured `attachments`/`interview` values are JSON-encoded. Anything ambiguous returns a clear error instead of a guess.
- Upstream's skills and slash commands keep working because the upstream extension itself runs, unmodified, behind the proxy.

## Usage

Install as a pi package from GitHub (replaces `pi-intercom`):

```sh
pi install git:github.com/cabi/pi-intercom-lean         # ssh
pi install https://github.com/cabi/pi-intercom-lean    # https
```

or in a project, add it to your pi extension list / `package.json` and load it like any other extension.
Replace `pi-intercom` with this package — pi throws on duplicate tool names, so a session must not load both at once.

## Example guidance text for subagents

If a subagent misuses intercom (polling, asking busy peers, routine completion via supervisor), paste this into its AGENTS.md / task prompt:

```markdown
## Intercom usage

Talk to the supervisor and peer pi sessions with the `intercom` tool; `op` picks the
action. `op: help` prints the full upstream schema.

- **Supervisor** (the session that delegated this task): `op: supervisor` with
  `reason: need_decision` or `interview_request` **waits for the reply** — use when
  blocked, uncertain, or facing a scope/product decision. `reason: progress_update`
  is non-blocking, for plan-changing discoveries only; routine completion belongs in
  your final result, not here.
- **Peers:** `op: send` is fire-and-forget; `op: ask` blocks until the reply arrives;
  `op: reply` answers the active or single pending inbound ask (`to` disambiguates).
- **Delivery rule:** messages only reach an idle session — a busy peer drops sends and
  auto-answers asks without ever seeing them. Never poll for a result; keep working and
  report once. `op: pending` lists unanswered inbound asks.
- **Targeting:** name, full session ID, or the short id in parentheses from
  `op: list` (leading ID prefix is enough; with no exact match, a leading name prefix
  works when exactly one connected session shares it). Prefer the short id when names
  clash; re-list before reusing an id; never target self.
- **Scoping:** for send/ask/handover, `cwd` restricts targeting to that directory;
  omit `to` to hit the sole live session there; `openProjectPaneIfMissing` spawns one.
- Rare fields (`attachments`, `interview`) go as JSON strings. `op: handover` sends a
  model-generated session summary the receiver acts on (`message` = next task).
```

## Development

```sh
npm install
npm test       # routing, help, fill-in, and static-tool-list tests
npm run measure # regenerate the token table above
```

See [MAINTENANCE.md](MAINTENANCE.md) for the upstream-version contract and upgrade steps.

## Update prompt

Paste this into a pi session to run the next upstream sync:

```text
Sync pi-intercom-lean to the latest version of upstream pi-intercom.

1. Read MAINTENANCE.md first to understand the current upstream version and adaptation points.
2. Check the latest upstream version. Compare the code and changelog between the two versions, and list: added or removed tools, changes to parameters and defaults, behavior changes, and whether the internals recorded in MAINTENANCE.md still hold.
3. If only the version number changed and the code didn't, just upgrade the dependency.
4. For new parameters or tools, add them to the lean version using the same trimming rules: common ones go in the schema, rare ones go in help. If upstream changed behavior, update the descriptions so they still match what the tool does.
5. Run the tests, re-measure the tokens, and update the README and MAINTENANCE.md.
6. Summarize the changes for me, and only publish after I confirm.
```
