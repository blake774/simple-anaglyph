# simple-anaglyph

## [anaglyph-studio/](anaglyph-studio/)

A single-file web app that builds red/cyan 3D anaglyphs from a stereo pair, and
corrects the vertical shift, roll and scale change the camera picks up between
the left and right shot — the misalignment that makes hand-held 3D unwatchable.

No build step, no dependencies, no network access. Your images never leave the
machine.

---

## Running it

### The quickest way — no server at all

The app is one self-contained HTML file and runs straight off the filesystem.

1. Download **[`anaglyph-studio/index.html`](anaglyph-studio/index.html)** —
   on the GitHub page for that file, use the **Download raw file** button
   (the ⤓ icon, top-right of the file view).
2. Double-click the downloaded file.

That's it. It opens in your default browser and everything works offline,
including the built-in demo scene.

> **Why clicking the file on GitHub doesn't run it:** GitHub shows HTML files as
> *source code*, and `raw.githubusercontent.com` serves them as `text/plain` so
> the browser displays the markup instead of rendering it. Neither is a working
> page — you need the file on disk, or a real web host (below).

### On localhost

From a clone of the repo:

```sh
git clone https://github.com/blake774/simple-anaglyph.git
cd simple-anaglyph

# any one of these:
python3 -m http.server 8000     # then open http://localhost:8000/
npx serve .                     # prints the URL it picked
php -S localhost:8000           # if you have PHP
```

Then browse to **<http://localhost:8000/>** — the root redirects to the app.
The app itself lives at `/anaglyph-studio/`.

If you are on the feature branch rather than `main`:

```sh
git fetch origin
git checkout claude/anaglyph-image-creator-w96lx4
```

### GitHub Pages

A workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
publishes the site on every push to `main`. To turn it on once:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the workflow manually from the **Actions** tab →
   *Deploy to GitHub Pages* → *Run workflow*).

The site then lives at:

```
https://blake774.github.io/simple-anaglyph/
```

which redirects to `https://blake774.github.io/simple-anaglyph/anaglyph-studio/`.

Pages only serves the repository's **default branch** by default — if the work
is still on a feature branch, merge the pull request first, or temporarily add
that branch to the workflow's `on.push.branches` list.

---

See the [full documentation](anaglyph-studio/README.md) for how the alignment
correction works, the depth tools, and the verification suite.
