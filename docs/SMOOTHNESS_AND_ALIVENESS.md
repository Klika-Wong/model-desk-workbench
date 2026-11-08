# Smoothness and "aliveness" pass (2026-11-08)

Four user reports: the floating pet "wanders by itself" while dragging, the UI still feels off,
it "still flickers", and the work area feels stiff compared with the base-building screen in
Arknights. Each item below has either a measurement or a code-level cause.

## Pet dragging: synchronous disk writes on every frame

`pet-window.cjs` saved state inside the window `moved` handler, and `save()` is a synchronous
`fs.writeFileSync`. Dragging calls `setPosition` every frame, so every frame wrote to disk and
blocked the main process. Queued `drag-move` IPC then lagged behind the cursor, and the window
jumped to catch up — which reads as "it wanders by itself".

Fixes: debounce the save (600ms) and only write on `drag-end`; skip `setPosition` when the target
equals the current position; clamp a stored off-screen position back to the primary display.
Six unit tests cover the drag path.

## Flicker: measured, not assumed

Consecutive `capturePage` frames were diffed pixel by pixel: 9 frame pairs while idle showed
**zero** differing pixels, and 23 frame pairs during a live round differed only in the single status
text line. The canvas, actors and links were pixel-identical.

So the SVG and sprite layers are not repainting every frame. The perceived jitter came from three
layout-level issues:

1. Actors were positioned with percentage `left/top` plus a 0.45s transition. `left/top` are layout
   properties, so every frame triggered reflow/repaint while the links also rewrote `d` each frame.
   Now positions are pixel CSS variables applied through `translate3d`, so movement is composited.
2. A newly created actor animated from the canvas origin, which looked like a flash.
   Positions are now set before the transition class is added on the next frame.
3. A permanent `will-change: transform` promoted each actor (with its 928x1131 sheet) to a cached
   layer. It is now limited to dragging, and `.pet-sprite` uses `contain: paint`.

The idle sprite cycle was also slowed from 1.44s to 1.9s.

## From "stiff" to "alive"

| Idea | Implementation |
| --- | --- |
| Idle micro-motions | One global beat picks a random idle actor every 4.2-10.4s and plays a wave or a hop for 0.9s. It skips whoever is generating, stops on page hide, and uses a single timer. |
| Walking has weight | Transition duration scales with distance (0.34s near, 0.86s far) and the walk animation uses the same duration. |
| Standing on ground | Each actor gets a ground shadow that turns cool and slightly wider while generating, reddish on failure. |
| Quiet idle state | The literal "idle" label collapses to a 6px dot, expanding on hover; names are transparent until hover/selection instead of a row of grey pills. |
| Zones breathe | The work zone label dims and reads "idle" when nobody is generating, and only switches back to "generating / streaming" when occupied. |
| A real rest corner | The rest zone draws two cushions and a warm mat, with a separate brighter palette in dark theme. |

Canvas height went from 400 to 436 to give actors and shadows room.

## Also in this pass

Conversation turns are appended incrementally (selection only toggles a class) and the in-memory
message list is now capped at 40, matching what is persisted. Dialogue lifetime is centralised in
`resetDialogue()`. Error states now name the next step, and menu labels were rewritten
("Pin this actor", "Turn off auto-arrange", "Float to desktop (new window)"). Thumbnails use
`loading="lazy"` and `decoding="async"`.

## Verification

178/178 unit tests; 41 real-window UI checks with no console errors, including a new
`collab-idle-motion` check that triggers the idle beat and requires the sprite row to become 3 or 4.
Frame diffs as described above; dark theme measured at `rgb(23,24,28)` with a 436px canvas.

## Still open

The idle beat is a fixed random interval with no adaptivity; desks and furniture are CSS hints only,
not real scene art; walking is straight-line interpolation without pathing; and pet dragging on
mixed-DPI multi-monitor setups is still untested.

## Follow-up: "is it the GIFs?" (same day)

First, a correction: the earlier "zero differing pixels" measurement was unreliable. `capturePage`
on a window that is not in the foreground returns the last cached composition, so animation frames
never appear. The conclusion "the render layer is not repainting" was a method error, not a finding.

GIFs are half the story. Characters on the main screen and in the floating pet use WebP spritesheets,
not GIF. But the outfit library and status list thumbnails did load `roster/*.gif`, and dozens decoding
at once does stall the main thread. Those now use the WebP sheet's first frame
(`background-size: 800% 900%`), so the default path loads no GIFs at all. The Dafeiyu pet is still a
GIF and remains an opt-in choice.

Three actual causes, all fixed:

1. Sprite frames advanced via `background-position`, which is a **paint** animation (redraw the frame
   and sample the 960x1170 sheet every step). Now a fixed "viewfinder" clips an inner strip that is
   translated with `transform: translate3d()` at `steps(8)` — compositor only, no repaint. Applied to
   the collaboration view, the floating pet and the chat page.
2. `--pet-h` was `125.67px`. Every row offset was fractional, so the browser sampled at subpixel
   positions: rows bled into each other and edges jittered frame to frame. Now **120x130**, which keeps
   the source 96x104 ratio (0.923) and makes the 960x1170 background an exact integer multiple.
3. A permanent `will-change: transform` plus `contain: paint` promoted every actor to its own layer;
   combined with `transparent: true` on the pet window this forced whole-window recomposition each
   frame. Those hints are gone, and the pet window sets an explicit `#00000000` background.

A new **Reduce motion** setting turns off the looping sprite animation, the link flow and the breathing
animation, and collapses position transitions to 1ms. It is useful on low-end machines and for light
sensitivity, but more importantly it is a one-click test: if the flicker persists with it enabled, the
cause is window composition or the GPU driver, not front-end animation.

Verification: 178/178 unit tests, 42 real-window UI checks, including `collab-reduce-motion` which
requires `animation-name` to become `none` and to come back afterwards.
