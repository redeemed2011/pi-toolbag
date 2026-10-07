# Pi sandbox and how ctx is tested

Default `pi` on this machine is **not** the npm CLI. It is a bash wrapper that launches Pi inside **cplt** (Landlock LSM + seccomp-BPF, optional Bubblewrap). The unsandboxed CLI is `pi-unsafe`.

ctx is a Pi extension. Session inject (observers + compact inject) must work inside that sandbox. Project law (shared records under `~/.pi/ctx/`) needs one extra write grant the stock Pi profile does not include.

## What the sandbox actually is

| Layer | What it does |
|---|---|
| Wrapper | `~/.local/bin/pi` → `cplt --agent pi --yes … -- <pi args>` |
| Already inside cplt | Wrapper sees `__CPLT_WRAPPED=1` and execs the Bun Pi launcher (no nested jail) |
| Filesystem | Landlock deny-by-default. Project dir is read+write+exec. Home is not. |
| Network | Outbound TCP 443 allowed. Localhost blocked unless you pass `--allow-localhost`. Secrets stripped from env unless `--pass-env`. |
| Bubblewrap | If `bwrap` is installed, extra namespaces + private `/tmp`. Live probes can return `EROFS` (errno 30) where Landlock-only returns `EACCES` (errno 13). |

cplt version on the design machine: `cplt 2026.08.03-140322-4c056bc`. Newer cplt ([#384](https://github.com/navikt/cplt/pull/384)) narrows `~/.pi/agent` to read-only at the root and writes per subdirectory so `bin/` cannot be both writable and executable. Do not assume the whole of `~/.pi/agent` is writable on a newer cplt.

## Do not use `cplt exec` as a Pi-agent probe

`cplt exec` uses the **shell** sandbox profile, even if you pass `--agent pi`. It is the wrong policy for “what will `pi` see?”

Authoritative checks for the agent the user actually runs:

```bash
# Resolved Landlock grant list (this is what `pi` gets)
cplt --agent pi --print-profile

# Path probe under the *agent* policy (not exec)
cplt --agent pi check path ~/.pi/ctx --write
cplt --agent pi check path ~/.pi/agent/sessions --write

# Wrapper-equivalent flags (keep in sync with ~/.local/bin/pi)
cplt --agent pi --yes \
  --allow-write "$HOME/.pi/grok-cli" \
  --allow-write "$HOME/.config/pi-hashline-edit-pro" \
  --allow-write "$HOME/.pi/ctx" \
  --print-profile
```

`cplt check path` and `--print-profile` have disagreed on this host (`~/.pi/agent` listed RW in the profile, `check path` reported BLOCKED). **Live probes and `--print-profile` win.** `scripts/check-sandbox.sh` uses `--print-profile`.

`--allow-write PATH` fails if `PATH` does not exist. Create `~/.pi/ctx` on the host before granting it.

## Grants ctx needs

### Session inject (default on, unbound)

No `~/.pi/ctx` write. Observers and compact inject only touch:

- the **project directory** (extension checkout, test fixtures)
- **cplt scratch** (`$TMPDIR` → `~/.cache/cplt/tmp/<id>/`) for worker cwd + `--session-dir`
- Pi’s own agent dirs that cplt already carves for `--agent pi` (sessions, tmp, …)

Worker argv adds `--session-dir <worker-cwd>/session` so the worker JSONL never needs `~/.pi/agent/sessions` and never lands in the project `/resume` picker. That flag is a sandbox adaptation on top of the spec’s OM argv contract.

### Project law (explicit bind)

Store path (settled): `~/.pi/ctx/projects/<id>/` with per-writer `logs/<sessionId>.jsonl`.

Stock `--agent pi` does **not** grant `~/.pi/ctx`. Without a write grant, bind cannot create a project. Required:

1. Host: `mkdir -p ~/.pi/ctx`
2. Wrapper `~/.local/bin/pi`: `--allow-write "$HOME/.pi/ctx"`
3. Global config `~/.config/cplt/config.toml` `[allow] write` should include `"~/.pi/ctx"` so `--print-profile` matches the wrapper

Tests never write the real home store. They set `CTX_HOME` to a temp dir under the project or `$TMPDIR`.

## Test pyramid (safe by default)

| Layer | What it is | Needs Pi process? | Needs LLM / network? | Sandbox |
|---|---|---|---|---|
| **Unit** (`vitest`) | fold, snapCutoff, packInject, occupancy, applies_to refuse, F-once A, JSONL, argv | No | No | Run anywhere, including inside cplt. Writes only `CTX_HOME` / `mkdtemp` / project `.tmp/` |
| **Sandbox probe** (`scripts/check-sandbox.sh`, `tests/sandbox-probe.test.ts`) | Asserts `--print-profile` contains the `~/.pi/ctx` grant; documents exec≠agent | No Pi session | No | Invokes `cplt --print-profile` / `cplt check` only |
| **Extension load (optional)** | `pi-unsafe --offline --no-session -e ./index.ts -p …` in an isolated `PI_CODING_AGENT_DIR` | Yes, real CLI | Yes, unless the prompt never starts a model (prefer `--help` / fail-closed load tests) | **Do not** use default `pi` (wrapper). Use `pi-unsafe` with isolated dirs |
| **Live compact (later, gated)** | Bound/unbound compact inject against a cheap model | Yes | Yes | Opt-in: `PI_CTX_LIVE=1`. Isolated `CTX_HOME` + `PI_CODING_AGENT_DIR` + `--session-dir` |

Default `npm test` is **unit + sandbox probe**. It must not:

- invoke the `pi` wrapper (would nest cplt or fail auth)
- write `~/.pi/ctx` or `~/.pi/agent`
- call a provider
- use `cplt exec` as a stand-in for the Pi agent

### Isolated live Pi (when you opt in)

```bash
REAL_PI="$HOME/.pi/agent/bin/pi"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-ctx-live.XXXX")"
export PI_CODING_AGENT_DIR="$WORKDIR/agent"
export CTX_HOME="$WORKDIR/ctx"
mkdir -p "$PI_CODING_AGENT_DIR" "$CTX_HOME"
# Copy or stub auth into $PI_CODING_AGENT_DIR if the run needs a model.
"$REAL_PI" --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
  --session-dir "$WORKDIR/sessions" \
  -e pi-ctx/index.ts \
  -p "ping"
```

`pi-unsafe` is the same binary. Default `pi` is not.

### Running tests from a sandboxed agent

This repo’s project dir is writable inside cplt. `$TMPDIR` is the scratch dir (writable). `/tmp` is generally writable; some pre-existing `/tmp/<name>` trees probe as blocked — prefer `$TMPDIR` or a directory you create under the project.

```bash
cd pi-ctx
npm test                 # vitest; no nested pi
bash scripts/check-sandbox.sh
```

Do not `pi -e ./index.ts` from inside an already-sandboxed agent unless you mean to start a nested Pi. Observer workers spawned **by** the extension use `process.argv[1]` (the real CLI JS) when possible, so they do not re-enter the wrapper.

## Observer workers inside the jail

Workers inherit the parent Landlock. They therefore cannot reach anything the parent cannot. That is why:

- worker cwd is under `$TMPDIR/pi-ctx-workers/…` (scratch)
- `--session-dir` is under that cwd
- `--no-extensions` plus `-e worker.ts` so the worker does not reload the orchestrator
- `--no-builtin-tools` so the worker cannot `bash`/`edit`/`write`
- result IPC is a file in that cwd (`CTX_RESULT_PATH`), not `~/.pi/ctx`

If `CTX_HOME` is unset, project-law paths resolve to `~/.pi/ctx`. Session inject still works.

## Network

Unit tests: none.

Live Pi: provider 443 (e.g. `api.x.ai` is allowed by the current proxy policy). Localhost only if you passed `--allow-localhost`. Do not assume the worker can hit an unlisted local mock server.

## Checklist when the sandbox “broke ctx”

1. Are you on the wrapper (`command -v pi` → `~/.local/bin/pi`) or `pi-unsafe`?
2. Does `~/.pi/ctx` exist on the host?
3. Does `cplt --agent pi --print-profile` list `~/.pi/ctx` under Read+write?
4. Did you probe with `cplt exec` by mistake?
5. Did tests leak into real `~/.pi/ctx` because `CTX_HOME` was unset?
6. Did a worker spawn `pi` from PATH and re-enter the wrapper outside `__CPLT_WRAPPED`?
