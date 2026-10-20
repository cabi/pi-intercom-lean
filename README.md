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

## Development

```sh
npm install
npm test       # routing, help, fill-in, and static-tool-list tests
npm run measure # regenerate the token table above
```

See [MAINTENANCE.md](MAINTENANCE.md) for the upstream-version contract and upgrade steps.
