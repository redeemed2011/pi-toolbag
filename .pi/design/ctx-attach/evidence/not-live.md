# Evidence — retired question, copied 2026-10-09

Source: `pi-ctx/src/render/gated-edge.ts`, `claimedBodyOrEmpty`.

If `claimedId` is set and the id is missing, not live, or not a question, the inject text is `claim ${claimedId} not_live` and `claim_not_live` is 1. The question body is not included.

Source: `pi-ctx/src/tools/claim.ts`.

`close` does not consult `live`. A later `claim` of an id that is not live returns `not_found`.

Nothing in these two functions deletes a project log line or a `ctx.bind` entry when a question leaves the live set.
