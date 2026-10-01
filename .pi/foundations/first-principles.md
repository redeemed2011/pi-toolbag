# First Principles

**Session date**: 2026-10-01
**Scope**: A raw copy of this machine's cplt global config lives in pi-toolbag as an example, secrets are the only thing that may be redacted, and one agent-visible instruction keeps that copy identical to ~/.config/cplt/config.toml.

## Bedrock facts

### Fact 1 — Live file is what cplt reads

**Statement**: cplt reads `~/.config/cplt/config.toml` unless `CPLT_CONFIG` is set. On this machine that file exists and `CPLT_CONFIG` is unset in `~/.bashrc`, `~/.bash_profile`, `~/.zshrc`, and `~/.profile`.
**Why it is load-bearing**: The example has to be a copy of the file cplt actually uses, not of a second invented config.
**Source / evidence**: `cplt config --help` (2026-10-01): "cplt reads config from `~/.config/cplt/config.toml` by default (override with `CPLT_CONFIG`)." Shell rc search the same day found no `CPLT_CONFIG`.
**Status**: Verified

### Fact 2 — The live file has no secret values

**Statement**: `~/.config/cplt/config.toml` contains settings and `/home/bo` paths. It does not contain a password, token, API key, or private key. The only matches for those words are comments ("project secrets", "auth token dump").
**Why it is load-bearing**: The copy may be raw. Secrets are the only allowed redaction, and there is nothing to redact today.
**Source / evidence**: Full read of the file and a case-insensitive scan on 2026-10-01. User, same day: paths are not secrets; the only sanitization is secrets.
**Status**: Verified

### Fact 3 — Pi injects one global context file, then cwd ancestors

**Statement**: Pi 0.99.1 loads a context file from the agent directory first, then walks from the working directory to the filesystem root. The agent directory defaults to `~/.pi/agent`. Candidates, in order, are `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`. A file applies across working directories only if it is the agent-directory file. A project `AGENTS.md` applies only when the working directory is that directory or below it.
**Why it is load-bearing**: The sync rule has to be visible when either file is edited. Those edits do not share a working directory.
**Source / evidence**: `docs/configuration.md` ("User instructions applied across working directories"; "Pi loads them from the agent directory, the working directory, and its parent directories"). `dist/core/resource-loader.js` `loadProjectContextFiles` and `loadContextFileFromDir` in package 0.99.1. This session's cwd is `/home/bo/src/projects` and its injected project instructions are `projects/AGENTS.md`, not `pi-toolbag/AGENTS.md`.
**Status**: Verified

### Fact 4 — The global context file does not exist

**Statement**: `~/.pi/agent/AGENTS.md` and `~/.pi/agent/AGENTS.override.md` are absent. `pi-toolbag/AGENTS.md` exists.
**Why it is load-bearing**: A rule that is not in a file Pi loads is not injected. The global file has to be created; the repo file already is, and it is the wrong scope.
**Source / evidence**: `ls` of those paths on 2026-10-01. `loadContextFileFromDir` returns null when no candidate exists.
**Status**: Verified

### Fact 5 — A comment in config.toml is not injected

**Statement**: Pi does not load `config.toml` as a context file. A comment there is seen only if an agent reads that file.
**Why it is load-bearing**: A comment cannot be the instruction that keeps the two files in sync, because editing one file does not read the other.
**Source / evidence**: `loadContextFileFromDir` candidate list in Fact 3. No other loader in that function reads toml.
**Status**: Verified

### Fact 6 — One instruction site, raw copy, no extra machinery

**Statement**: The confirmed contract keeps one instruction site, a raw copy, and secret-only redaction. It cuts path rewriting, trust/blocklist/wrapper sync, and a script, symlink, or CI check.
**Why it is load-bearing**: Extra sites and extra mechanisms are out of scope even if they would catch drift better.
**Source / evidence**: `.pi/foundations/first-questions.md`, confirmed 2026-10-01. User: "the only sanitization is secrets."
**Status**: Verified

## Hypotheses requiring fresh verification

- None that block the solution. `--no-context-files` disables Fact 3; that is an explicit opt-out, not the default.

## Reconstructed minimal solution

### Core approach

Create `~/.pi/agent/AGENTS.md` with the sync rule, and put a raw copy of `~/.config/cplt/config.toml` at `pi-toolbag/cplt-config.example.toml`. Nothing else.

### Justified components

1. **`~/src/pi-toolbag/cplt-config.example.toml`** — required by the goal (a raw copy lives in pi-toolbag as an example) and Fact 2 (today that copy is byte-identical). One file at the repo root. The name says it is an example, so it is not a second live config. No fact requires a new directory.
2. **`~/.pi/agent/AGENTS.md`** — required by Facts 3, 4, and 6. It is the only one of the three named sites that Pi injects for an edit in pi-toolbag and for an edit of `~/.config/cplt/config.toml` from another cwd. It does not exist, so it has to be created.
3. **Rule text in that file** — required by Facts 1, 2, and 6. It must name both paths, say the live file is what cplt reads, say the example stays a raw copy, and say the only allowed difference is a redacted secret in the example. A redacted value must not be copied back over the live file. Paths and other settings are not rewritten. Trust, the blocklist cache, and `~/.local/bin/pi` are not part of the copy.

### Explicitly rejected approaches

- Comment only in `~/.config/cplt/config.toml` — Fact 5: not injected.
- Rule only in `pi-toolbag/AGENTS.md` — Fact 3: not loaded when cwd is outside that repo. This session is the measurement.
- Rule in all three sites — Fact 6. Three copies of the rule drift.
- `APPEND_SYSTEM.md` — also global, but it is not one of the three sites the user named, and Fact 3 already names `AGENTS.md`.
- Path placeholders or a markdown rendering of the config — contradicts the raw-copy goal and Fact 2.
- `examples/` directory or a home under `pi-ctx/docs/` — no fact requires a new tree. `pi-ctx/docs/sandbox.md` is about ctx tests, not this file.
- Script, symlink, or CI check — Fact 6.

## Open questions on foundations

1. None. The example filename is a choice justified above, not a spec. Challenge it before the copy if the path is wrong.
