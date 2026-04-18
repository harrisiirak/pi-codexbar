# pi-codexbar

A [pi](https://github.com/badlogic/pi-mono) coding-agent extension that surfaces [CodexBar](https://github.com/steipete/CodexBar) provider usage — session, weekly and monthly quota windows, remaining credits, and plan/login info — directly inside the pi TUI. It renders a live footer widget below the input editor, exposes a `/codexbar-status` slash command, and refreshes automatically when the active provider/model changes.

It is intentionally a thin wrapper: all provider knowledge lives in the CodexBar CLI. This extension only maps pi's provider identifiers to CodexBar's, runs `codexbar usage …`, caches the JSON, and paints it.

## Background

pi-coding-agent talks to many AI providers (Anthropic, OpenAI, Copilot, OpenRouter, Gemini, …). Each one has its own billing / quota model, and none of them is visible from inside the agent. [CodexBar](https://github.com/steipete/CodexBar) is a local menubar app + CLI that already aggregates this state for you from its bundled provider adapters, without requiring explicit logins.

This extension stitches the two together:

- pi emits `session_start`, `agent_end`, `model_select` events → the extension asks CodexBar for the current provider's usage and rewrites the footer.
- The user runs `/codexbar-status [provider]` → the extension fetches fresh state and renders it as both a widget and a notification.
- Results are cached on disk with a short TTL so footer redraws don't hammer the CLI.

## Installation

```bash
pi install npm:pi-codexbar
```

Or, for local development, symlink the checkout into pi's extension directory and run `/reload`:

```bash
git clone <repo-url> ~/src/pi-codexbar
ln -s ~/src/pi-codexbar ~/.pi/agent/extensions/pi-codexbar
```

The extension ships TypeScript sources directly (no build step) and is loaded by pi through `tsx`.

## Requirements

| Requirement | Purpose |
|-------------|---------|
| **Node.js ≥ 24** | pi-coding-agent runtime; native TS via `tsx`. |
| **[pi-coding-agent](https://github.com/mariozechner/pi-coding-agent)** | Peer dependency. The extension attaches to `session_start`, `agent_end`, and `model_select` events and registers a slash command. |
| **[CodexBar](https://github.com/steipete/CodexBar) CLI** | Required on `$PATH` (or at one of the known locations below). pi-codexbar never talks to provider APIs directly — it spawns `codexbar usage …` and parses the JSON. |

**CodexBar binary discovery order:**

1. `/usr/local/bin/codexbar` (macOS default)
2. `/usr/bin/codexbar`
3. `/opt/homebrew/bin/codexbar`
4. Whatever `which codexbar` resolves to in the current shell

If nothing is found the footer falls back to `codexbar: unavailable` and `/codexbar-status` reports the error — the extension never crashes pi.

> **Note:** Authentication is handled entirely by CodexBar and its provider adapters. pi-codexbar never stores tokens, never prompts for credentials, and has no opinion about how you logged in (cookies, OAuth, `sessionKey`, …).

## Quick Commands

| Command | Description |
|---------|-------------|
| `/codexbar-status` | Fetch and render usage for the current session's provider. |
| `/codexbar-status <provider>` | Force a specific provider — accepts either a CodexBar id (`claude`, `codex`, `copilot`, `gemini`, `openrouter`) or a pi-native id (it's mapped automatically). |
| `/codexbar-toggle` | Turn the footer widget on/off in real time. When off, the widget is cleared and `session_start` / `agent_end` / `model_select` no longer refresh it. State is persisted to user-scope `settings.json` under the root `enabled` flag (project-scope override still applies as usual). |

The status command prints a notification with the formatted usage line **and** refreshes the footer widget.

## Footer Widget

On every `session_start`, `agent_end`, and `model_select`, the extension resolves the active model's provider, maps it to a CodexBar id, and repaints a widget called `codexbar-usage` above or below the input editor.

A typical line looks like:

```
claude (max) │ S(5h): 42% │ W(7d): 18%M(1mo): 6% │ $23.45 │ ⏱ Apr 20, 3:00 PM
```

**Tokens available in the format string:**

| Token              | Meaning                                                |
|--------------------|--------------------------------------------------------|
| `{provider}`       | CodexBar provider id (e.g., `claude`, `codex`).        |
| `{plan}`           | Login method / plan label (`max`, `api`, …).           |
| `{session}`        | Primary window usage — e.g., `S(5h): 42%`.             |
| `{weekly}`         | Secondary window usage.                                 |
| `{monthly}`        | Tertiary window usage (if the provider reports one).   |
| `{credits}`        | Remaining credit balance, formatted as `$X.XX`.        |
| `{session_reset}`  | Human-readable reset time for the primary window.      |
| `{weekly_reset}`   | Reset time for the secondary window.                   |
| `{monthly_reset}`  | Reset time for the tertiary window.                    |

Empty tokens and the `⏱` marker are stripped from the rendered line, so you can leave tokens you don't care about in the format string without collecting stray `│` separators.

Windows exceeding `colors.highThreshold` percent (default 80) switch from their normal color to the matching `*High` color (e.g., `session` → `sessionHigh`). Override the threshold or individual colors in settings.

## Configuration

pi-codexbar merges configuration from **three layers**, in increasing precedence (last wins):

| Scope | Path | Priority |
|-------|------|----------|
| Builtin | `<package root>/settings.json` & `<package root>/provider-mappings.json` | Lowest |
| User | `~/.pi/agent/extensions/pi-codexbar/{settings,provider-mappings}.json` | Medium |
| Project | `<cwd>/.pi/extensions/pi-codexbar/{settings,provider-mappings}.json` | Highest |

Each layer is optional. Missing keys fall back to the previous layer and, ultimately, to in-code defaults. Merging is shallow per top-level key (`footer`, `colors`, provider mapping entries) — provide only what you want to override.

### User-level overrides

Drop a file at `~/.pi/agent/extensions/pi-codexbar/settings.json`:

```json
{
  "footer": {
    "format": "{provider} │ {session} │ {credits}",
    "placement": "aboveEditor"
  },
  "colors": {
    "provider": "#ffffff",
    "session": "#00ff88",
    "sessionHigh": "#ff0055",
    "highThreshold": 75
  }
}
```

### Project-level overrides

Place a file at `<repo>/.pi/extensions/pi-codexbar/settings.json`. Use this when a given repo should always show a specific layout — e.g., a team monorepo where everyone is on a flat-rate plan and the `{credits}` token should be hidden.

### Settings schema

| Key                          | Type   | Default                                                              |
|------------------------------|--------|----------------------------------------------------------------------|
| `enabled`                    | bool   | `true` — toggled by `/codexbar-toggle`; persisted at user scope.     |
| `footer.format`              | string | `{provider} {plan} │ {session} │ {weekly}{monthly} │ {credits} │ ⏱ {session_reset}` |
| `footer.placement`           | enum   | `belowEditor` (also accepts `aboveEditor`)                           |
| `colors.provider`            | hex    | `#d787af`                                                            |
| `colors.plan`                | hex    | `#808080`                                                            |
| `colors.session` / `…High`   | hex    | `#5faf5f` / `#ff5f5f`                                                |
| `colors.weekly` / `…High`    | hex    | `#00afaf` / `#ff8700`                                                |
| `colors.monthly` / `…High`   | hex    | `#af87d7` / `#ff5f5f`                                                |
| `colors.reset`               | hex    | `#808080`                                                            |
| `colors.separator`           | hex    | `#4e4e4e`                                                            |
| `colors.credits`             | hex    | `#febc38`                                                            |
| `colors.error`               | hex    | `#ff5f5f`                                                            |
| `colors.highThreshold`       | number | `80` (percent; switches `session`/`weekly`/`monthly` to `*High` colors above this value) |

See the bundled [`settings.json`](./settings.json) for the complete default payload.

### Provider mappings

pi and CodexBar use different provider identifiers. The bundled [`provider-mappings.json`](./provider-mappings.json) translates pi ids (and provider family names) into the canonical CodexBar id:

```json
{
  "anthropic":      "claude",
  "openai-codex":   "codex",
  "github-copilot": "copilot",
  "google":         "gemini",
  "openrouter":     "openrouter"
}
```

**Lookup rules:**

1. Exact match on the lower-cased pi provider id.
2. Prefix match — `openai-codex-preview` → `codex`.
3. Otherwise the id is passed through untouched.

Override or extend on either scope:

```jsonc
// ~/.pi/agent/extensions/pi-codexbar/provider-mappings.json
{
  "my-internal-proxy": "openrouter",
  "anthropic":         "claude-experimental"
}
```

Only the entries you list are merged in; everything else still comes from the bundled mapping (or the user layer if you're overriding at the project scope).

**Resolution priority:** project mapping > user mapping > bundled mapping > identity passthrough.

### Common Recipes

| Goal | Config change |
|------|---------------|
| Minimal footer — provider + credits only | `footer.format = "{provider} │ {credits}"` |
| Warn earlier when approaching quota | `colors.highThreshold = 50` |
| Show the widget above the editor | `footer.placement = "aboveEditor"` |
| Route a custom proxy provider to CodexBar | Add a row to `provider-mappings.json` (user or project scope) |
| Disable the widget in a flat-rate repo | Project-scope settings with `footer.format = "{provider}"` |

## Caching

Provider usage is cached under `~/.pi/agent/extensions/pi-codexbar/.cache/usage-<provider>.json` with a **60-second TTL**. This keeps footer refreshes on every `agent_end` from spawning one CodexBar process per turn.

- Stale files are overwritten on the next successful fetch.
- Errors are not cached — a failing run always re-hits the CLI.
- To force a refresh, either wait out the TTL or delete the cache file.

## Events & Runtime Behavior

| Pi event | Behavior |
|----------|----------|
| `session_start` | Detect provider from `ctx.model.provider`, fetch usage, render widget. |
| `agent_end` | Refresh the widget after every agent turn. |
| `model_select` | Re-fetch when the user switches provider/model. |

All three handlers swallow errors internally — a failed CodexBar call never blocks the event loop or interrupts pi.

## Development

```bash
npm install
npm test          # node --test, via tsx loader
npm run run       # smoke-run the extension entry point
```

- No bundler / transpile step — the extension ships `src/*.ts` and pi loads it through `tsx`.
- CI runs `npm ci && npm test` on push and pull requests (see `.github/workflows/`).

## License

MIT.
