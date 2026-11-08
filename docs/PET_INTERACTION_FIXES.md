# Pet interaction fixes (2026-11-08)

Four issues reported together: dragging was offset from the cursor, clicking other windows stopped
working after touching the pet, the "full avatar library" entry did nothing, and the pet kept showing
up on the desktop after being closed.

## 1. The avatar library never opened

A call-order bug. `handleContextAction('library')` created the picker and then called
`closeContextMenu()`, which iterates every actor and removes its picker. The library was deleted in the
same frame it was created — a `MutationObserver` shows exactly one `added` followed by one `removed`.

Fix: close the menu first, then build the library.

That immediately exposed three more problems:

- **Clipped by the canvas.** The picker lived inside `.stage-actor`, but `#stage-floor` is
  `overflow: hidden`. It now mounts on `body` with `position: fixed`.
- **Offset left by half its width.** The stylesheet centers it with `left: 50%; transform:
  translateX(-50%)`. With fixed coordinates the transform still applied; it is now cleared explicitly.
- **Height measured as zero on first layout**, so it wrongly decided there was no room below and
  flipped above the actor, covering the page header. It is now re-measured on `requestAnimationFrame`
  and again via a 30ms timer (rAF is throttled in hidden windows).

## 2. Dragging was offset from the cursor

The old implementation used "window start + accumulated cursor delta":

```js
dragOrigin = screen.getCursorScreenPoint();   // sampled when drag-start finally runs
dragWinStart = petWindow.getPosition();
// drag-move: newPos = dragWinStart + (cursor - dragOrigin)
```

`drag-start` is an async IPC. When the user presses and immediately drags, the movement between
`pointerdown` and the main process actually running `drag-start` is **lost forever**, so the window
stays behind by that amount for the whole drag.

Fix: the renderer sends the cursor's position inside the window (`clientX`, `clientY`) with
`drag-start`, and the main process computes absolutely every time:

```js
newPos = cursorScreenPoint - dragOffset
```

No accumulation, no dependency on the starting window position, so the cursor keeps a constant offset
inside the window.

Measured in a real window:

```
cursor  = [1117, 581]
offset  = [40, 30]
pos     = [1077, 551]
expect  = [1077, 551]
drift   = [0, 0]
```

Also found: `pet-window.json` still had `locked: true` from an earlier session. When locked,
`drag-start` returns immediately and the window does not move at all — easily mistaken for a drag bug.

## 3. Other windows stopped responding after touching the pet

A transparent window still receives mouse input across its entire rectangle. The pet window is
250x300 while the character occupies roughly 200x304 of it, so clicking the empty area swallowed the
click and the desktop or another window never saw it.

Fix: dynamic click-through.

- The renderer computes one merged bounding box over the character, toolbar, bubble, emote panel and
  chat box, and reports it with `petControl('hitbox', rect)`; a `MutationObserver` keeps it current as
  panels open and close.
- The main process polls the cursor every 80ms and calls
  `setIgnoreMouseEvents(!inside, { forward: true })`.
- While dragging it forces click-through off so the drag cannot lock itself out.

Polling in the main process rather than listening for `mousemove` in the renderer is deliberate: once
click-through is on, continued movement events depend on `forward`, which is not reliable everywhere.
Polling always recovers.

Measured: reported hitbox `{x:27, y:-2, w:200, h:304}`; cursor outside → `ignoring = true`; cursor
inside → `ignoring = false`.

## 4. The pet stayed on the desktop after closing

Three separate causes stacked up:

| Cause | Fix |
| --- | --- |
| Closing the main window only hides it to the tray, and that path hid the mini window but not the pet | `window.on('close')` now calls `petWindowCtl.hide()`; `showWorkbench()` restores with `show()` |
| `ready-to-show` can fire after `close`, and `showInactive()` brought the window back | the callback checks `isDestroyed()` and `state.hidden` first |
| `moved` still referenced the renamed `dragOrigin` | changed to `dragOffset`; it was throwing a `ReferenceError` on every move and position was never saved |

`hide()` is also guarded: it does nothing if the pet was never opened, so closing the window cannot
create one.

Measured: open → 1 window; close → 0; after another 900ms → still 0; `hide()` → `isVisible() = false`;
`show()` → `true`.

## Verification

- 182/182 unit tests. `pet-drag.test.cjs` was rewritten around "the window must always equal cursor
  minus press offset", covering zero drift, a missing offset falling back to the window centre, the
  locked case and hitbox clamping.
- 44 real-window UI checks, no console errors. New `collab-outfit-library-opens`: the library must
  actually open from the context menu, contain at least six entries, stay fully inside the viewport,
  and stay horizontally centred on the actor (guarding against the `transform` regression).
- Pet-specific real-window checks: drag drift `[0,0]`, no resurrection after close, hide/show follows
  the main window, click-through follows the cursor.

## Still open

- "Lock" disables dragging only; it is not system-level click-through. Click-through is now automatic
  by region.
- The pet window keeps the default `focusable`, so clicking it takes focus once (needed for the chat
  input). Making it never steal focus needs an on-demand `setFocusable`, not done yet.
