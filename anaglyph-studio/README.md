# Anaglyph Studio

A browser tool for turning a pair of photographs into a red/cyan anaglyph, built
around the problem that actually ruins hand-held 3D shots: **the camera does not
just move sideways between the two exposures.** It also rises, rolls and drifts
closer. Horizontal separation is the 3D signal. Everything else is noise your
eyes cannot fuse — a few pixels of vertical offset or half a degree of roll is
enough to turn a stereo pair into a headache.

Anaglyph Studio measures that unwanted motion and cancels it before compositing.

Open `index.html` in any modern browser. That is the whole install: one file, no
build step, no dependencies, no network access. It works straight off the
filesystem (`file://`) and offline. Your images never leave the machine.

**Getting it open:** download this folder's `index.html` (GitHub's **Download
raw file** button, ⤓ top-right of the file view) and double-click it. Viewing
the file *on* GitHub shows you the source, and `raw.githubusercontent.com`
serves it as `text/plain` — neither renders. To serve it on localhost instead,
run `node serve.mjs` or `python serve.py` from the repository root. Those, plus
GitHub Pages and a troubleshooting table, are covered in the
[repository README](../README.md#running-it).

---

## Using it

1. **Load two images** — click, drop or paste into the left and right eye slots.
   Drop two files anywhere on the window and the first becomes the left eye.
   No photos handy? **Load the demo pair** — a stereo landscape generated
   in-browser, with a realistic vertical + roll + scale error baked into the
   right eye so there is something real to correct.
2. **Press Auto-align.** It measures the vertical shift, roll and scale change
   between the two frames and fills in the sliders. **Hold `\`** at any point
   to flash back to the uncorrected original.
3. **Check it with the Wiggle view.** Flipping between the two aligned frames is
   ruthless: if anything jumps vertically or rocks, the alignment is off.
4. **Place the screen plane.** Drag the Depth slider, **Alt+click** any object
   to put it exactly on the screen, or run **Analyse depth range** and let the
   app report how much parallax the scene actually spans.
5. **Export** a PNG/JPEG/WebP, copy it straight to the clipboard, or render an
   animated wiggle GIF.

Only step 1 is mandatory. Every automatic result is a starting point you can
override by hand, and every change is undoable (Ctrl+Z). Settings persist in
the browser between visits and can be saved/loaded as JSON.

---

## How the alignment works

Between the two shots the camera underwent a small rigid motion. Projected into
the image, the part worth correcting is well modelled by a **similarity
transform**: a translation, a rotation and a uniform scale. The app estimates it
by maximising **zero-mean normalised cross-correlation** between the two frames,
coarse to fine:

- Both images are reduced to **Sobel gradient magnitude**, not raw pixels. Two
  exposures of the same scene routinely differ in brightness and white balance;
  correlating edges barely notices, correlating pixels does.
- A four-level **image pyramid** is searched. The coarsest level sweeps the whole
  permitted range; each finer level re-searches a shrinking window around the
  previous winner.
- A final **sub-pixel coordinate-descent polish** runs on a separate
  high-resolution level, halving its step size each round.
- Regions outside an image's own footprint (the letterbox bars you get when the
  two files have different aspect ratios) carry a validity mask and are excluded
  from the correlation entirely.

Against synthetic pairs with a known misalignment, the recovered transform lands
within **0.04 px of exact, measured as the worst displacement anywhere in the
frame** — including on an 8-megapixel pair, in about 2.5 seconds. See
[Verification](#verification).

### What it will not do

- **Horizontal displacement is not a single number.** In a real stereo pair every
  object is displaced by a different amount — that *is* the depth information.
  The horizontal figure the search returns is the disparity of whatever dominates
  the frame, which makes a sensible default convergence point and nothing more.
  It lands in the Depth slider, and moving it afterwards is expected.
- **Keystone is approximated, not solved.** If the camera yawed or pitched, the
  true correction is projective. The Horizontal/Vertical skew sliders are a shear
  approximation — good for small errors, not a rectification engine.
- **It cannot rescue a pair that does not overlap**, and it will tell you: the
  match percentage turns amber below 55% and red below 30%.

---

## The depth slider

Depth is horizontal separation between the two views, as a percentage of image
width. It does not invent parallax — it slides the whole depth volume relative to
the screen:

| Setting | Effect |
| --- | --- |
| **Negative** | Crossed disparity — the scene pushes out of the screen towards the viewer. |
| **Zero** | Whatever the camera converged on sits exactly on the screen plane. |
| **Positive** | Uncrossed disparity — the scene recedes behind the screen. Safest, most comfortable. |

The reading under the slider converts to pixels for the current image. A useful
guideline: keep the on-screen separation of your *farthest* object under about
2.5% of the image width, or viewers have to diverge their eyes to fuse it.

Beyond the slider there are three measured ways to place the plane:

- **Alt+click** (or the *Set screen by click* button) measures the parallax of
  the clicked object and zeroes it, putting that object exactly on the screen.
- **Analyse depth range** samples local parallax at hundreds of well-textured
  points and reports the nearest, median and farthest disparities — in pixels
  and as a percentage of width — with a comfort verdict.
- **Screen at nearest / Screen at median** then place the whole scene using
  those measurements: *nearest* parks everything at or behind the screen (the
  safe choice), *median* straddles the screen plane for maximum pop.

The measurements use zero-mean patch correlation with a left↔right consistency
check — each match is verified backwards, which rejects the classic stereo
failure modes (periodic texture aliasing and half-occluded depth edges).

Objects that pop out **and** touch the frame edge cause a "window violation" —
the frame occludes something that is supposedly in front of it, and the brain
refuses the illusion. Push depth positive to bring the scene back behind the
screen, or crop in.

---

## Controls

**1 · Source images** — two file slots (click / drop / paste), swap L↔R, clear.
*Swap eyes when rendering* fixes pseudo-stereo, where near objects look far away.

**2 · Alignment correction** — Auto-align with a cancel button, per-parameter
solve toggles (vertical / rotation / scale / horizontal), search range
(fine / normal / wide, centred on the current values) and search quality.
Manual sliders for vertical offset, rotation, scale and both skews.
*Apply correction to* chooses between warping only the right eye or splitting the
correction evenly between both — the split halves the resampling of either view,
so neither eye ends up visibly softer. The relative geometry is identical either
way; the translation is pre-rotated so the split is exact rather than approximate.

**3 · Depth** — the depth slider, zero-parallax reset, a button to restore the
value auto-align measured, click-to-set convergence, and the depth-range
analyser with its two placement buttons.

**4 · Anaglyph rendering** — six encoding methods:

| Method | Character |
| --- | --- |
| **Dubois** | Least-squares fit to real filter spectra; negative cross-terms pre-cancel leakage. Lowest ghosting. Default. |
| **Optimised** | Drops red from the left channel. Bright and comfortable; pure reds go dark. |
| **Half colour** | Luminance into red, real green and blue. Most colour with little rivalry. |
| **Full colour** | Every original colour, and every bit of retinal rivalry. |
| **Greyscale** | No colour, no rivalry. The safe option for difficult images. |
| **True** | Red and blue only. Dark, but works with almost any glasses. |

Plus *blend in linear light* (gamma-correct compositing — the single most common
reason home-made anaglyphs come out muddy), ghost/cross-talk reduction, red
desaturation to tame retinal rivalry, and independent red/cyan channel gains.

**5 · Image adjustments** — right-eye exposure matching in two strengths (mean
gain, or full per-channel histogram matching that also fixes contrast and
colour-cast differences), plus brightness, contrast, saturation, gamma.

**6 · Framing & output** — *crop to the region both eyes cover* (finds the
largest upright rectangle inside the overlap, which removes the wedge-shaped
blank edges rotation leaves behind), extra inset, frame border, and colours for
the border and any uncovered area.

**7 · Preview & guides** — six view modes (Anaglyph, Left, Right, Difference,
Wiggle, Side-by-side), guide overlays (horizontal rules, grid, thirds, centre
cross) with adjustable density and opacity, preview resolution, parallel or
cross-eyed free-view order, wiggle speed, difference gain.

**8 · Export** — anaglyph, either eye, or the side-by-side pair, as PNG, JPEG or
WebP at any output scale — downloaded or copied straight to the clipboard;
plus the wiggle GIF with frame delay, size, palette size, dithering and loop
control.

**9 · Settings & history** — undo/redo over every parameter (Ctrl+Z /
Ctrl+Shift+Z, 100 steps), automatic persistence to the browser's local storage,
and save/load of the complete configuration as a JSON file. Reset restores
factory defaults and clears the stored state.

Every slider has a number box for exact entry, and **double-clicking a slider
resets that one control** to its default. The stage bar adds a hold-to-compare
button (the uncorrected original), and a fullscreen toggle.

### Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` | Right eye up/down 1 px (`Shift` = 0.1 px) |
| `←` `→` | Depth − / + |
| `[` `]` | Rotate right eye ∓0.1° |
| `A` | Auto-align |
| `W` | Toggle wiggle |
| `D` | Toggle difference |
| `\` (hold) | Show the uncorrected original |
| `Alt+click` | Put the clicked point on the screen plane |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `F` / `0` | Fit to window |
| `1` | Zoom 100% |

Mouse wheel zooms about the cursor, drag pans, double-click fits.

---

## The wiggle GIF

Alternating the two aligned views reads as 3D on any screen without glasses, and
it doubles as the most honest alignment check there is — misalignment that is
easy to miss in an anaglyph is glaring when the image rocks.

The GIF encoder is written from the spec and lives in the same file: median-cut
quantisation to a palette shared across both frames (a per-frame palette makes
the animation flicker), optional Floyd–Steinberg dithering, and a variable-width
LSB-first LZW coder.

> A note for anyone reading that code: a GIF decoder learns each dictionary entry
> one code *later* than the encoder emits it, so the code width must grow when
> the entry about to be added no longer fits — not when the entry just added
> filled the table. Getting that backwards desyncs every conforming decoder.
> The test suite covers it directly.

---

## Verification

`test/` holds the harness used to develop this. It needs Node and Playwright
(`npm i -D playwright`, or point `NODE_PATH` at a global install) and drives real
Chromium:

```sh
node test/test.js      # 62 checks — accuracy, encoding, export, UI
node test/robust.js    # 33 checks — edge cases
node test/features.js  # 36 checks — demo scene, depth tools, undo, persistence
```

`test.js` synthesises a stereo pair by applying a transform it chose itself, lets
the app measure it, and compares the app's derived transform against the exact
inverse — reported as the worst displacement error anywhere in the frame. It also
round-trips the LZW coder through `gifcheck.js`, an independent GIF parser and
decoder that shares no code with the app, and checks that Chromium itself renders
the exported GIF.

`robust.js` covers a single loaded image, mismatched framing and aspect ratios,
an 8-megapixel pair, frame borders, all three still formats, and the extremes of
the GIF palette settings.

`features.js` loads the demo pair (whose misalignment is a known constant),
verifies auto-align recovers it, checks the depth analysis against the scene's
built-in layer parallax, drives click-to-set-convergence through the real
canvas, and exercises undo/redo, the settings JSON round-trip, persistence
across a reload, A/B compare, clipboard copy and fullscreen.

All three suites — 131 checks — pass in full. Measured results:

| | |
| --- | --- |
| Alignment accuracy, 800×600 | 0.035 px worst-case displacement, 99.4% correlation |
| Alignment accuracy, 3200×2400 | vertical within 0.7 px, rotation within 0.01° |
| Demo scene (layered parallax) | vertical within 0.06 px, rotation within 0.05° |
| "Screen at nearest" placement | nearest point lands within 0.05 px of zero |
| Auto-align time | ~1.4 s at 800×600, ~2.5 s at 8 MP |
| Preview render | ~30–70 ms (eye rasters cached between rendering-only tweaks) |

---

## Notes

- Everything runs on the main thread with cooperative yielding rather than in a
  Worker, deliberately: Chromium refuses to construct a blob-URL Worker from a
  `file://` page, and opening the file directly had to keep working.
- Previews render at a capped resolution (900 / 1400 / 2400 px) and drop to a
  faster path while a slider is being dragged. Exports always render at full
  size from the source images — the preview cap never touches output quality.
- EXIF orientation is honoured via `createImageBitmap`, with a fallback for
  older browsers.
- Tested in Chromium. The code uses no APIs outside the common set supported by
  current Chrome, Firefox and Safari; WebP export depends on browser support and
  reports honestly if it is missing.
