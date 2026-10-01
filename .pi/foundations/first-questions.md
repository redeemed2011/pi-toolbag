# First Questions

**Session date**: 2026-10-01
**Status**: CONFIRMED

## The one-sentence goal

> "A raw copy of this machine's cplt global config lives in pi-toolbag as an example, secrets are the only thing that may be redacted, and one agent-visible instruction keeps that copy identical to ~/.config/cplt/config.toml."

## Interrogated items

### Example of the global config in pi-toolbag

- **Original request**: "i'd like the cplt global config to be provided in pi-toolbag as an example"
- **Source / who / when**: User, 2026-10-01, after finding ~/.config/cplt/config.toml is not in any repo.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: This is the goal, not an add-on. The smallest version is one example file, not a second config system.
- **Decision rationale**: Without a file in the repo, there is nothing to keep in sync and nothing for another machine to copy.

### Always kept in sync

- **Original request**: "yet it is always kept in sync"
- **Source / who / when**: User, 2026-10-01.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: An instruction does not mechanically prevent drift. It is still the mechanism the user named. A script, symlink, or test was cut.
- **Decision rationale**: The example is useless if it can silently diverge from the live file. Sync means the example stays a raw copy of config.toml.

### Three possible instruction sites

- **Original request**: "because of either instructions in the repo's agents.md or a comment in the global cplt config or in pi's global agents.md"
- **Source / who / when**: User, 2026-10-01. Offered as alternatives, not as a stack.
- **Alignment with the goal**: Strong that some agent-visible instruction exists. Weak that all three exist.
- **Outcome**: MODIFIED to exactly one instruction site, whichever is actually injected when either file would be edited. Do not maintain all three.
- **Challenges**: Three copies of the rule will drift from each other. A comment only in ~/.config/cplt/config.toml is invisible to an agent that edits only the example. Repo AGENTS.md is invisible to a session whose cwd is not pi-toolbag. Pi's global AGENTS.md is the only candidate that can cover both edit paths, and only if Pi actually injects it.
- **Decision rationale**: The user asked for a choice. One site is the smallest version that can still meet "always". Which site is an open question, not a second goal.

### Secrets check, not sanitizing

- **Original request**: "nevermind about sanitizing. there's no secrets in there and the LLM will likely mistakenly generate incorrect configuration. just raw copy the file, making sure there's no secrets in the file."
- **Source / who / when**: User, 2026-10-01. Withdraws the sanitizing preference from the previous turn.
- **Alignment with the goal**: Strong. A rewritten example is what they now want to avoid.
- **Outcome**: KEPT. Copy the file raw. The only sanitization allowed is redacting a secret if one is present. Paths, comments, and settings are not rewritten.
- **Challenges**: Machine paths are not secrets. Rewriting them is the failure mode they named: an agent inventing a config that is not the live one. A scan on 2026-10-01 found no secret values in ~/.config/cplt/config.toml; the only hits were the words "secrets" and "auth token dump" in comments.
- **Decision rationale**: Raw copy is the smallest way to keep the example true. If a secret appears later, redact that value only and leave the rest byte-for-byte.

### Trust store, blocklist cache, and the pi wrapper

- **Original request**: not requested. Nearby files: ~/.config/cplt/trust/, subscriptions/, ~/.local/bin/pi.
- **Source / who / when**: Found while answering the previous question, 2026-10-01.
- **Alignment with the goal**: None. The goal names the global config.
- **Outcome**: DELETED
- **Challenges**: Trust and the blocklist cache are machine state, not the config. The pi wrapper already comments that its flags are mirrored in config.toml. Folding it in would be a second sync problem.
- **Decision rationale**: Copying them does not help the example stay identical to config.toml, and it widens the secret/state surface.

## Deleted / avoided scope

- Maintaining the sync rule in all three of repo AGENTS.md, the live config comment, and Pi's global AGENTS.md — they would drift from each other.
- Syncing ~/.config/cplt/trust/, the blocklist cache, or ~/.local/bin/pi — not the global config.
- Sanitizing or placeholder-rewriting paths — user withdrew that; a rewritten file is the incorrect config they want to avoid.
- A script, symlink, or CI check — not asked for; instructions are the named mechanism.

## Open questions

1. None for the goal. Raw copy plus a secrets check is confirmed.
3. Which single instruction site does Pi actually inject for an edit to either file? Answered in first-principles, not by guessing.
