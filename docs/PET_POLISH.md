# Pet interaction polish (2026-11-08)

Three experience gaps left after the previous round.

## 1. The pet had no settings entry - right-click menu

Configuration lived only in six toolbar icons, and options such as the opaque window existed in the
main process but had no reachable entry point. **Right-clicking the pet** now opens:

| Item | Notes |
| --- | --- |
| Next avatar | Shows "N/5", cycles through five characters |
| Opaque window: on/off | Transparent windows flicker on some GPUs |
| Lock position: on/off | Locked means it will not drag |
| Always on top: on/off | |
| Chat with a model | Opens the chat box in place, no new window |
| Close the pet | |

The menu is drawn in the renderer (the window is frameless and transparent, so a native menu cannot be
positioned reliably) and is **clamped inside the window** - unlike main-window popovers, anything
outside the window is simply not drawn. Opening the menu also hides the speech bubble, which otherwise
overlaps it. Clicking empty space, pressing Escape, or clicking the character closes it.

The toolbar stays as is: common actions remain one click away, the menu collects the long tail.

## 2. Clicking the pet stole focus

The window used to be focusable, so a single click took focus away from whatever you were typing in.
It now defaults to `focusable: false`: clicking the character or toolbar buttons triggers the click
without stealing focus. Only opening the chat box temporarily calls `setFocusable(true)` and focuses
the input; closing the chat box turns it off again.

Measured: `win.isFocusable()` is `false` by default.

## 3. The avatar library drifted when the window resized

The library moved to `position: fixed` on `body` last round to escape the canvas `overflow: hidden`.
But resizing the window left it at stale coordinates, possibly floating or off-screen.

Resize now re-anchors every open library to its actor.

## Verification

- 183/183 unit tests. A new source-level assertion requires all six menu actions, the `contextmenu`
  listener, position clamping, `petControl('focusable')`, and `focusable: false` on the window.
- 44 real-window UI checks pass, no console errors.
- Pet real-window check: `isFocusable()` false by default; six menu items with rect
  `[38, 111, 212, 189]` fully inside the 250x300 window; clicking "Lock position" toggles it and closes
  the menu; right-click reopens; clicking outside closes.

## Still open

- The pet still cycles five avatars instead of showing the nine-cell library the main window has; the
  250x300 window cannot fit the grid. It needs a collapsible panel first.
- The menu has no keyboard navigation. The pet window is not focusable by design, so a keyboard entry
  point has little value; if that changes, arrow keys and Escape would need adding.
