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
