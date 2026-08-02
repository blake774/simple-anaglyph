# simple-anaglyph

## [anaglyph-studio/](anaglyph-studio/)

A single-file web app that builds red/cyan 3D anaglyphs from a stereo pair, and
corrects the vertical shift, roll and scale change the camera picks up between
the left and right shot — the misalignment that makes hand-held 3D unwatchable.

No build step, no dependencies, no network access. Your images never leave the
machine.

---

## Running it

### Option 1 — no server at all (most reliable)

The app is one self-contained HTML file that runs straight off the filesystem.

1. Download **[`anaglyph-studio/index.html`](anaglyph-studio/index.html)** — on
   the GitHub page for that file, click the **Download raw file** button (the ⤓
   icon at the top-right of the file view).
2. Double-click the downloaded file.

It opens in your browser and everything works, offline, including the built-in
demo scene. **If localhost is giving you trouble, do this instead** — there is
no functional difference.

> **Why clicking the file on GitHub doesn't run it:** GitHub renders HTML files
> as *source code*, and `raw.githubusercontent.com` serves them as `text/plain`,
> so the browser prints the markup instead of running it. Neither URL is a live
> page — you need the file on disk, or a real web server.

### Option 2 — localhost

From a clone of the repo, use whichever runtime you already have. Both scripts
are dependency-free, pick a free port automatically if the default is taken,
and open your browser for you.

```sh
git clone https://github.com/blake774/simple-anaglyph.git
cd simple-anaglyph

node serve.mjs        # Node    (or: npm start)
python serve.py       # Python  (or: python3 serve.py, or: py -3 serve.py)
```

Either prints the exact URL to open, e.g. `http://localhost:8000/anaglyph-studio/`.

Pass a port if you want a specific one, and `--no-open` to skip launching a
browser:

```sh
node serve.mjs 3000
python serve.py 3000 --no-open
```

A plain `python3 -m http.server 8000` from the repo root also works — open
<http://localhost:8000/> and the root page redirects to the app.

#### If localhost still doesn't work

| Symptom | Cause and fix |
| --- | --- |
| `python3: command not found` | On Windows the command is usually `py -3 serve.py` or `python serve.py`. Or use `node serve.mjs`. |
| Windows opens the Microsoft Store when you type `python` | The App Execution Alias is intercepting it. Use `py -3 serve.py`, or use `node serve.mjs`. |
| `node: command not found` | Install Node, or use the Python script, or just use **Option 1**. |
| Page won't load / "can't reach this site" | Confirm the terminal still shows *"Anaglyph Studio is running"* — if the command exited, the server is gone. The terminal must stay open. |
| `Address already in use` / `EADDRINUSE` | Something else holds the port. The scripts here auto-advance to the next free port; with `-m http.server`, pass a different one: `python3 -m http.server 8123`. |
| 404, or a directory listing instead of the app | You are serving the wrong folder. Run the command from the **repository root** (the folder containing `serve.mjs` and `anaglyph-studio/`), and browse to `/anaglyph-studio/`. |
| Blank page | Make sure you are on `/anaglyph-studio/` (with the trailing slash), not `/anaglyph-studio` alone on some servers. |
| Working in WSL, a VM, a container, or over SSH | `localhost` there is not your desktop's localhost. Use the second URL the scripts print (`http://<ip>:<port>/anaglyph-studio/`), forward the port, or use **Option 1**. |

### Option 3 — GitHub Pages (a public URL, nothing to install)

The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
publishes the site on every push to `main`. Two one-time settings, both in the
repository's **Settings** tab:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → General → Default branch → `main`.** The `github-pages`
   deployment environment only permits deploys from the default branch, so this
   step is required or the job will be blocked.

Then push to `main`, or run it by hand from the **Actions** tab → *Deploy to
GitHub Pages* → *Run workflow*. The site lands at:

```
https://blake774.github.io/simple-anaglyph/
```

which redirects to `/anaglyph-studio/`.

---

## Tests

`npm test` runs all three suites (131 checks). They drive real Chromium and
need Playwright installed (`npm i -D playwright`); the app itself needs nothing.

---

See the [full documentation](anaglyph-studio/README.md) for how the alignment
correction works, the depth tools, and the verification suite.
