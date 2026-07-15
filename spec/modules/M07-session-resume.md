<!-- anchor: uav99wwn -->
# M07 — Session resume & immutability

> Resume a prior session by id, and know — declaratively — which fields must not change across turns, so consumers can lock controls or fork instead of getting a surprise error from the SDK.

<!-- anchor: 1o2jpavp -->
## Purpose

Developers resuming a session can learn, without running anything, which run parameters are frozen for that architecture (always `model`; usually the reasoning/thinking config) and detect violations before dispatch. M07 owns the pure helpers `getSessionResumeConstraints(architecture)`, `isSessionFieldMutable(architecture, path)`, and `findResumeViolations(architecture, original, next)`. Adapters are **stateless** and do not enforce immutability; the library only *declares* it so the consumer (who holds the original config) can lock UI or start a new session.

<!-- anchor: xdlheejy -->
## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L1 | `resumeSessionId` param in; `result.sessionId` out. |
| L3 | Reads the `resumeImmutable` flag on `ArchOption` (owned by M01/L3). |
| L4 | Exports the three pure resume helpers. |
| M02 | `model` immutability interacts with `ADAPTIVE_THINKING_ONLY` and aliases. |
| M15 | Path-scope fields (`allowedPaths`/`disallowedPaths`) are immutable on resume; M07 is extended to cover designated `RuntimeExecuteParams` fields, not just `ArchOption` keys. |

<!-- anchor: 648h3dnk -->
## Unified Contract (L1)

- `RuntimeExecuteParams.resumeSessionId` requests resumption; support varies by adapter (see matrix). `result.sessionId` carries the id to resume next time.

<!-- anchor: sjvy01iz -->
## Configuration & Extensibility (L3)

- Source of truth: the `resumeImmutable` flag per `ArchOption` plus the always-immutable `model`. Generation-only knobs (temperature, top-p) stay mutable.
- **Designated `RuntimeExecuteParams` fields are also immutable.** Some always-immutable fields live on `RuntimeExecuteParams` rather than on `ArchOption` — notably M15's `allowedPaths` / `disallowedPaths` (a sandbox must not change mid-session). The mechanism is extended so `findResumeViolations` checks this designated set in addition to `ArchOption` keys; changing either path-scope field on a resumed run is reported as a violation.
- **Resume support matrix** (canonical home — adapters link here):

| Behavior | claude-code | codex | gemini | opencode |
| --- | :---: | :---: | :---: | :---: |
| `resumeSessionId` | ✅ native `options.resume` | ⚠️ `resumeThread`, no tracking | ✅ reads `~/.gemini/projects/*/chats/` | ⚠️ partial |
| Immutability enforcement origin | API-enforced (hard 400 on changed `thinking`) | thread-bound (model/effort) | history-bound | session-bound |

<!-- anchor: 8fjvcqvu -->
## Public API & Packaging (L4)

Exports `getSessionResumeConstraints`, `isSessionFieldMutable`, `findResumeViolations` from the package root — all pure.

<!-- anchor: t53sdoth -->
## Edge cases

- Consumer changes `model` on a resumed session → `findResumeViolations` reports it; claude-code would otherwise hard-400 from the API.
- Changing a reasoning/thinking option flagged `resumeImmutable` → reported as a violation; a new arch option that affects reasoning must set `resumeImmutable: true`.
- codex resume → thread reference works but the library does not track turn history; constraints are advisory.
- Consumer changes `allowedPaths`/`disallowedPaths` on a resumed session → `findResumeViolations` reports it (M15); the sandbox scope is frozen for the session's lifetime, so the consumer must fork a new session to re-scope.

<!-- anchor: ygoq8m7a -->
## Acceptance criteria

These verify the helpers are pure and that every immutable field is detectable before a resumed run.

<tagged_list type="ac" tags="m07"/>
