# UI/UX Re-review by Four Sub-agents (2026-11-08, round 2)

Four read-only sub-agents re-reviewed the code **after** the previous round of fixes, each from a
different lens: visual/information architecture, interaction & state machine, usability & copy, and
rendering performance. They did not modify files; the main line consolidated findings and implemented
the fixes. Scope was limited to `desktop/`; upstream workbench files, the local panel service and any
codex directory were not read.

## The most important correction: the flicker was not actually fixed

The previous rewrite split `drawLinks()` into structural rebuild vs geometry update, but only the
**drag** path used it. `applyEcosystem()` still called `drawLinks(true)`, so every state transition
between zones (idle -> generating -> speaking -> done), every auto re-layout, and every round start/end
forced a full `replaceChildren()` of the SVG, restarting SMIL `<animateMotion>` pulses from t=0.
With four models that is 8+ rebuilds per round — the main source of the reported flicker.

Now `applyEcosystem()` calls `drawLinks()` without force; `structSig` decides whether a rebuild is
really needed, position changes only run `updateLinkGeometry()`, and `followLayout()` follows the
0.52s CSS walk transition with rAF. Also: link node references are cached in `linkNodes[i]` (removing
3n attribute-selector queries per frame), `applyFacing()` was moved out of the per-frame path (it
alternated `getBoundingClientRect()` reads with DOM writes, forcing synchronous layout), and
`stopFollow()` cancels the rAF loop on hide / rebuild / pet mode.

Clarified non-issue: rewriting `animateMotion`'s `path` every frame does **not** restart SMIL timing
(`path` is a value attribute, not `begin`); only destroying and recreating the element does.

## Other fixes from the review

| Lens | Fix |
| --- | --- |
| State machine | During a round, model checkboxes and refresh are disabled and `buildStage()` guards with `if (running) return`, so changing participants mid-round can no longer rebuild the stage while the old closure keeps dispatching real tasks to removed models ("ghost dispatches"). |
| State machine | Stop now works even if clicked during the `getState` / `dispatchSend` await window (previously `abortTurn` was not assigned yet and the round waited for the 180s guard). Every await and both polling callbacks re-check `stopRequested`. |
| State machine | Rebuilding the stage keeps history **and** reconstructs `edges` / `round` from the last round of `messages.refs`, so the record, the reference links and the status line no longer contradict each other. Clear-history confirmation now resets its label after the 4s timeout. |
| Copy / risk | The intro now states plainly that starting a round really calls the selected online models and clears the previous round's history; a confirmation checkbox gates the Start button. Stop copy no longer claims the previous round is preserved. "Float to desktop" is labelled as opening a new window. |
| Visual | The dialogue box moved out of the canvas into its own strip below it, so it cannot cover actor names, speech bubbles or the rest-area mat. Pet mode hides the desk grid, mat and zone divider. The duplicate warm circle was removed; dark theme grid/mat/dialogue contrast was raised. The side panel uses `min-height` instead of a fixed `height`, so the confirmation row and input are never clipped. |
| Copy / a11y | The long hint line was cut to four short items. "Rename avatar ID" became "Change display name (synced to chat and dispatch)". Dialogue timing copy is consistent (8s auto-hide, pause on hover, 2.5s after leaving, click to dismiss). The context menu is now `role="menu"`, takes focus when opened via Shift+F10, supports arrow keys, and returns focus to the actor on Escape. |

## Verification

- 178/178 unit tests, 40 real-window UI checks, no console errors.
- New checks: `collab-consent-gate` (no dispatch without confirmation), `collab-menu-keyboard`
  (menu focus + Escape return), `collab-pet-mode-clean` (no leftover zone decorations in the small
  pet window), plus strengthened `collab-no-link-rebuild` and `collab-history-consistency`.
- Real-window dark-theme check: `rgb(23,24,28)` background, 3 sprites, input row inside the panel,
  confirmation visible. Floating pet: sprite, 8 emotes, 4 models, emote panel and lock all work.

## Deliberately left for later

The review also raised lower-severity items that were not changed: the two zones still rely on
grid/mat textures rather than per-state props, narrow-window (<1000px) scaling is still coarse,
`left/top` could be replaced by `transform` for compositor-driven movement, `renderTurns()` still
rebuilds the whole (max 40 item) list, and several menu labels could be polished further. These do
not affect main-flow correctness. Full local write-up (Chinese) is in the project docs; this file is
the public summary.
