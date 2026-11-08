# UI/UX Review: Four Perspectives (2026-11-08)

Scope: `desktop/stage-ui.js`, `avatars.js`, `stage.css`, `index.html`, `theme.css`, `mini.css`,
`pet-ui.js`, `pet-window.cjs`, `task-dispatch.cjs`, `ui-verify.cjs`, plus real-window screenshots.

Four review lenses: visual/information architecture, interaction & state machine, usability & copy,
and rendering performance. The main complaint was "flickering and laggy" plus "the dialog box just
sits there".

## Root cause of the flicker

`drawLinks()` rebuilt the entire SVG (`replaceChildren()`) on every position change. During a drag
this happened every frame, restarting the SMIL `<animateMotion>` pulse each time. Combined with a
0.45s CSS transition on actor `left/top`, the links were also drawn once at the old positions while
the actors visibly walked to new ones.

Fix: split link rendering into **structural rebuild** (only when edge count / active turn / selection /
visibility / canvas size changes) and **geometry update** (only rewrite `d`, text coordinates and the
motion path on existing nodes). `followLayout()` uses rAF for 520ms after a re-layout so links track
the actors during the transition. A real-window check asserts the `<path>` node identity stays the
same across a drag (`collab-no-link-rebuild`).

## Other fixes

| Area | Fix |
| --- | --- |
| Dialog box | Auto-hides after 8s, pauses on hover, click to dismiss, right-click to pin. Restoring history no longer pops the last dialog on startup. |
| History consistency | Rebuilding the stage no longer clears in-memory messages while leaving localStorage intact (which made old records resurrect after reload). Starting a new round clears both. |
| Run control | `runTurn()` has a 180s guard so a missing terminal status cannot disable the button forever; a "stop round" button aborts cleanly and keeps produced messages. |
| Destructive action | "Clear conversation history" now needs a second click within 4 seconds with an explicit non-recoverable warning. |
| Keyboard | Actors are focusable (`tabindex`/`role`/`aria-label`); Enter/Space selects, Shift+F10 or the ContextMenu key opens settings. Fixed Enter from the rename field bubbling into the actor handler. |
| Right panel | Only the conversation log scrolls; section titles wrap instead of being clipped. Status list DOM is cleared on rebuild (no duplicate rows); redundant "idle" line removed. |
| Ecosystem | Work area uses a desk grid, rest corner a soft mat; actors sit in the middle band so the bottom dialog cannot cover their names. |
| Copy / terms | Sidebar "collaboration view" vs panel "participating models" no longer share a name. Offline models are labelled "not connected" and the UI states honestly that there is no one-click wake-up: enable the connection in Models & Quota, then press Refresh. Empty-state and counter strings unified between HTML and JS. |
| Dark theme | `mini.css` dark palette moved from the old green-tinted `#171d20` to the neutral `#17181c` / low-saturation indigo used by the main window. |

## Verification

- 178/178 unit tests, 37 real-window UI checks, no console errors.
- New regression checks: `collab-no-link-rebuild`, `collab-dialogue-dismiss`,
  `collab-history-consistency`, `collab-clear-confirm`, plus assertions that status-row count equals
  actor count, actors are keyboard reachable, the side panel has a single scrolling region, and a
  stop control exists.
- Dark-theme real-window check: `rgb(23,24,28)` background, 3 sprites, conversation log visible.
- Floating pet real-window check: sprite, 8 emotes, 4 models, emote panel, lock toggle all work.

## Known limits

History is a single 40-message tail without round boundaries; "lock" on the pet means no dragging,
not system-level click-through; drag-direction fix relies on `screen.getCursorScreenPoint()` and is
untested on mixed-DPI multi-monitor setups; online filtering trusts `enabled` / `ready` fields and
treats missing fields as online. The 30 chibi characters remain non-commercial fan art (see
`desktop/assets/characters/roster/NOTICE.md`).
