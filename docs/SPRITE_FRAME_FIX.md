# The real cause of the flicker: empty sprite frames (2026-11-08)

## Correction first

Two earlier conclusions were wrong:

1. "Frame-diff shows 0 differing pixels, so nothing is repainting" — `capturePage` returns the last
   cached composition for a window that is not in the foreground. The measurement was invalid.
2. "Switching to transform compositing plus integer frame sizes plus removing GIF thumbnails will fix
   it" — those were real problems, but none of them was the main cause.

## How it was actually found

| What was measured | Method | Result |
| --- | --- | --- |
| GPU path | `app.getGPUFeatureStatus()`, 4 runs | Always `disabled_software` |
| Force-enabling GPU | `ignore-gpu-blocklist`, `enable-gpu-rasterization`, `use-angle=d3d11\|gl`, `disable-gpu-sandbox`, `in-process-gpu` | No effect |
| GPU process crashes | `child-process-gone` + `getAppMetrics()`, 20s | `gpuGone = 0`, no crash loop |
| Dropped frames | 180 rAF samples | avg 6.1ms, p95 6.6ms, **0 frames over 33ms** |
| GPU cache corruption | moved `GPUCache` / `ShaderCache` / `GrShaderCache` … | No effect |
| **The sprite sheets themselves** | `alphaextract` + `scale=8:9:flags=area`, so every output pixel is the mean alpha of one grid cell | **Found it** |

## Root cause: each action row has a different number of real frames

The sheets are 768x936 with an 8x9 grid (96x104 per cell). Mean alpha per cell:

```
row0 (idle)      88  89  89  89  90  90   6   6     <- only 6 frames
row3 (wave)     103 106 106 103   6   6   6   6     <- only 4 frames
row4 (jump)      68  75  82  75  71   6   6   6     <- only 5 frames
row1/2/5                          8 frames each
row6/7/8                          6 frames each
```

Alpha values of 6 and 0 are empty cells. Five different characters were checked and all share the
same layout.

The CSS had always used `steps(8)` with a shift of -8 frame widths, so:

- **idle** (6 frames): 2 of every 8 steps showed nothing → the character disappeared twice per cycle
- **wave** (4 frames): **half the cycle was blank**
- **jump** (5 frames): 3 blank steps

A character that keeps vanishing and reappearing *is* the flicker. It has nothing to do with the GPU,
display scaling or the transparent window. The main screen, the floating pet and the chat page all use
the same `.pet-strip`, which is why "the desktop and the outside both flicker".

## The fix

1. `avatars.js` gained `ACTION_FRAMES`, holding the real frame count per action.
2. On mount and on every state change, `--pet-frames` and `--pet-dur` (frames × 220ms) are written to
   the node.
3. The CSS now derives everything from those variables: `steps(var(--pet-frames, 8))` and a shift of
   `calc(var(--pet-w) * var(--pet-frames) * -1)`, so the animation never walks into an empty cell.

Verified in a real window by sampling the transform matrix: `frames=6`, `duration=1.32s`, `steps(6)`,
translation range `[-600, 0]`, only **6 distinct positions**, no overshoot.

## Window-layer issues fixed alongside

Not the main cause, but all real:

| Where | Problem | Fix |
| --- | --- | --- |
| Main window | Shown immediately, so the unpainted background flashed white | `show:false` + `ready-to-show`; `backgroundColor: '#17181c'` |
| Pet window | `backgroundThrottling: false` — full speed even when occluded | Hand back to the system default |
| Pet window | Always `transparent: true`, forcing DWM to recompose constantly | Added an opaque mode (`pet:control('opaque')`) |
| Settings | Users could not tell which render path they were on | New render diagnostic: hardware acceleration on/off, scale factor, resolution |
| Reduce motion | Only stopped animations; the idle beat kept changing the sprite row | Now also stops `idlePoke` and `followLayout`, so the page is genuinely static and can be used as a yes/no test |

Disabling `CalculateNativeWinOcclusion` became opt-in (`WORKBENCH_DISABLE_OCCLUSION=1`) so software
rendering machines do not pay extra background cost by default.

## Zone semantics

The canvas used to say "Work area · idle" while three idle characters stood inside it and the rest
corner was empty. Now, when nobody is generating, the whole canvas *is* the rest area: the divider,
the rest label, the mat and the desk grid are hidden and the label reads "Resting · idle". The two
zones only appear once someone actually starts generating.

A dark-theme specificity bug was also fixed: `html[data-theme="dark"] .stage-floor::before` was
overriding the idle state, so the desk grid stayed visible.

## Verification

- 180/180 unit tests, 43 real-window UI checks, no console errors.
- New unit tests: the frame-count table, and source-level assertions that `steps`, the shift
  distance and the duration all use the frame-count variable.
- New UI check `collab-sprite-frame-count`: the `steps(N)` denominator, the duration and
  `--pet-frames` must agree with each other, and the frame count must be one of 4/5/6/8.
- Dark real-window measurement: 3 sprites, `--pet-frames=6`, `1.32s`, `data-busy=0`, label
  "Resting", background `rgb(23,24,28)`, both pseudo-elements at opacity 0.

## Two facts that remain

1. This machine cannot get hardware acceleration in Electron: `gpu_compositing = disabled_software`,
   and every ANGLE, sandbox, in-process-GPU and cache workaround failed. Correctness is unaffected
   (the page holds 164fps), but all rasterisation runs on the CPU, so "Reduce motion" really does
   save work here. The settings page now shows this directly.
2. If flicker is still visible after this change it is a different path — for example the moment a
   page is switched, or the transparent pet window being recomposed by DWM. Ticking "Reduce motion"
   tells them apart: still flickering with it on means it is not the animation.
