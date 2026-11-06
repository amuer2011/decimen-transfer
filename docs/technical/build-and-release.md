# Build & release

## Scripts

```bash
npm run dev               # https dev server with HMR (self-signed cert)
npm run serve             # build, then serve the production bundle
npm run demo              # dev server with VITE_DEMO=1 — sender locked to bundled payloads
npm test                  # golden wire-format vectors and unit tests (node --test via tsx)
npm run build             # typecheck (app + node configs), hosted site → dist/
npm run build:standalone  # both self-contained pages → dist-standalone/
npm run build:all         # everything
npm run icons             # regenerate all icons and header marks from the SVG
npm run desktop:mac       # macOS x64 + arm64 DMGs and .app directories
npm run desktop:win       # Windows 10+ x64 portable EXE only
npm run desktop:win:installer   # Windows 10+ x64 NSIS installer only
npm run desktop:win:all         # Windows 10+ x64 portable EXE + NSIS installer
npm run desktop:win7      # Win7 SP1 x64 portable EXE only (Electron 22.3.27)
npm run desktop:win7:installer  # Win7 SP1 x64 NSIS installer only
npm run desktop:win7:all        # Win7 SP1 x64 portable EXE + NSIS installer
npm run desktop:kylin     # Kylin Linux arm64 DEB
npm run desktop:package   # configured targets for the current platform
```

Every Windows edition ships both a portable EXE and an NSIS installer. The
`:win` / `:win7` commands still build only the portable EXE; the matching
`:installer` command builds only the installer, and `:all` builds both.
Installer file names add `-Setup.exe` (for example
`Decimen.Optical.Transfer-v<version>-win-x64-Setup.exe`); portable names,
paths, and app identities are unchanged. The installer sets
`oneClick: false`, `perMachine: false`, and
`allowToChangeInstallationDirectory: true`, so it installs for the current
user by default and lets the user choose the installation directory.

Desktop output goes to `artifacts/desktop/`. Packaging downloads the Electron
runtime during the build, but the resulting Windows EXE, macOS app, and Kylin
arm64 DEB contain the application runtime. The packaged app starts a
random-port HTTP server bound to `127.0.0.1`; it does not expose a LAN service
or require a network connection for transfers.

The macOS app is unsigned unless the builder machine has an Apple signing
identity. The first launch may require **Open** from the Finder context menu,
and screen capture may require **System Settings → Privacy & Security → Screen
Recording**. Windows output is x64: the portable EXE runs without installing,
and the NSIS installer installs per user by default into a selectable
directory.

## About and updates

Desktop builds include an **About / Check for updates** dialog, reachable from
the header, the footer version, and **Help → About / Check for updates**. The
app makes no update request at startup: the dialog opens offline and only
contacts GitHub after the user chooses **Check for updates**. It shows the
current edition and version, the published release notes, download progress and
any error. Closing the dialog does not cancel a running download. v1.0.8 is the
first release that includes this flow.

Updates are read from `updates.json` in the latest GitHub Release and selected
by edition, platform, architecture and channel, so a package can never cross
between editions or Windows targets:

| Edition | Windows 10+ | Windows 7 | macOS | Kylin |
| --- | --- | --- | --- | --- |
| Full | `latest` | `win7` | x64 / arm64 | arm64 |
| Text | `text` | `text-win7` | x64 / arm64 | arm64 |

Windows 10+ NSIS installs use `electron-updater`'s NSIS updater: after the
download is verified, the user can restart and install. If a transfer is active
or a received result has not been saved, the app refuses to restart and keeps
the downloaded update for later; the check fails closed if the page does not
answer. Windows portable builds download the matching portable EXE and reveal
it in Explorer so the user can replace the old file manually. Unsigned macOS
builds download the DMG and open it for manual installation; the release also
contains x64 and arm64 ZIPs for each edition, but unsigned macOS has no
automatic self-update path. Kylin downloads the DEB and opens it for the system
to authorize.

The Win7 channel stays pinned to Electron 22.3.27. `electron-updater` 6.8.11
still needs a compatibility check on the actual target host; the test suite and
builds do not certify a real Windows 7 machine. Users on a release older than
v1.0.8 must install v1.0.8 manually once before in-app updates are available.

`npm run icons` uses the cross-platform resvg dependency to render `public/decimen_logo.svg`. It generates the PWA/Apple PNGs, the multi-size Windows ICO and the three inlined header marks from the same artwork; no system rasterizer is needed.

The frontend build targets Chromium 108 for the independent Win7 runtime. See [Windows 7](windows7.md) for the build, output path and target-machine verification.

## Text-only edition

A second, text-only edition is built from the same sources. It accepts only a pasted text snippet (up to 4 MB of UTF-8), keeps QR screen capture and checksum verification, and omits the file picker, drag-and-drop, demo images, media preview, and file saving. It rejects a file sent by the full edition; text transfers interoperate with the full edition's text mode.

```bash
npm run build:text            # hosted text site → dist-text/
npm run build:text:standalone # both self-contained pages → dist-text-standalone/
npm run build:text:all        # both text builds
npm run desktop:text:mac      # macOS x64 + arm64
npm run desktop:text:win      # Windows 10+ x64 portable EXE only
npm run desktop:text:win:installer  # Windows 10+ x64 NSIS installer only
npm run desktop:text:win:all        # Windows 10+ x64 portable EXE + NSIS installer
npm run desktop:text:win7     # Win7 SP1 x64 portable EXE only (Electron 22.3.27)
npm run desktop:text:win7:installer # Win7 SP1 x64 NSIS installer only
npm run desktop:text:win7:all       # Win7 SP1 x64 portable EXE + NSIS installer
npm run desktop:text:kylin    # Kylin Linux arm64 DEB
npm run desktop:text:package  # configured text targets for the current platform
```

Standalone text pages are `decimen-text-sender.html` and `decimen-text-receiver.html` in `dist-text-standalone/`. Text desktop artifacts go to `artifacts/desktop/text/` (Win7: `artifacts/desktop/text/win7/`), carry `.Text` in their file names, and use their own app id and package name, so they install alongside the full edition instead of replacing it. The Win7 text `:all` build verifies the portable and installer EXEs and writes `SHA256SUMS-text-win7.txt` covering both; `desktop:text:win7:installer` alone writes `SHA256SUMS-text-win7-setup.txt`.

The legacy `text-desktop-release.yml` workflow can still build the text edition
for macOS (x64 + arm64), Windows 10+, Win7, and Kylin when run manually, but it
no longer runs on tags. Official `v*` releases build the text edition through
the unified `release.yml` desktop matrix. Its Windows jobs use
`desktop:text:win:all` and `desktop:text:win7:all`, so both the portable EXE and
the NSIS installer are published. Full-edition commands and output paths are
unchanged.

Both editions start with a larger QR preview; the size slider, fullscreen zoom, and narrow-screen fitting still apply.

Since v1.0.9, both editions automatically remember sender tuning (FPS, frame
bytes, ECC and display size) and receiver tuning (capture width/FPS and decode
workers). Decode workers accept integers from 1 to 32, defaulting to 2, and can
be changed during reception. Desktop builds store only these settings in
`transfer-settings.json` under the application's user-data directory, so a new
local-server port after restart does not lose preferences. Web and standalone
builds use local storage where available. Transfer content is never persisted
by this feature.

## PWA / service worker

`vite-plugin-pwa` (workbox) precaches everything including the 940 KB decoder wasm. Two pieces are custom (`build/root-pwa-head.ts`): manifest/SW references are rewritten to resolve to the site root from any page depth (the build validates this), and the registration script does the skip-waiting handshake — a new deploy takes over open pages with a single reload instead of serving the stale precache forever. A workbox `rangeRequests` route serves received media from the Cache API (see [Platform quirks](platform-quirks.md)).

## CI (`.github/workflows`)

- **`ci.yml`** — tests and builds on every push to `main` / `release/*` and every PR. Asserts the served `receive` chunk stays under 20 KB (catches the inlined worker/wasm leaking into the site build) and that manifest/SW references point at files that exist.
- **`pages.yml`** — deploys to GitHub Pages on every push to `main`.
- **`release.yml`** — the single official release path for a `v*` tag. `validate` requires the tag to equal `v<package version>` and runs the tests. The desktop matrix then builds eight jobs: full and text editions of Windows 10+ (portable EXE plus NSIS installer), Win7 (portable EXE plus NSIS installer), macOS x64 and arm64 (DMG plus ZIP), and Kylin arm64 (DEB). The `web` job builds both hosted sites, the two site ZIPs, and the four standalone HTML pages. Only after every job succeeds does `publish` collect the artifacts, run `build/prepare-release.cjs` to verify all ten client variants, the four Windows `.yml` manifests and blockmaps, and the four macOS update ZIPs, write `updates.json` and `SHA256SUMS.txt`, create a draft release, upload the complete asset set, then publish it and mark it latest. This ordering prevents update clients from seeing a release before its assets exist.
- **`desktop-release.yml`**, **`win7-desktop.yml`**, **`text-desktop-release.yml`** — manual-only legacy entries. They no longer run on tags and are not part of the official release; manual runs can still build artifacts or attach them to an explicitly named release.
- **`kylin-desktop.yml`** — on pushes to `main` / `release/*`: builds and uploads a Kylin Linux arm64 DEB as a workflow artifact.

Before the first Pages deployment, set **Settings -> Pages -> Build and deployment -> Source** to **GitHub Actions**. The default `GITHUB_TOKEN` can deploy an already-enabled Pages site, but cannot enable Pages for a repository where the site does not exist.

The site builds with `base: "./"`, so it works under a project subpath with no configuration.

## Release pattern

1. `git checkout -b release/vX.Y.Z` and bump the version with
   `npm version X.Y.Z --no-git-tag-version` (for example
   `npm version 1.0.9 --no-git-tag-version`), then commit.
2. Feature work + docs on the branch; PR to `main`.
3. After merge, push the matching tag. The `package.json` version and the tag
   must be identical (`1.0.9` ↔ `v1.0.9`); a mismatch fails `validate`.
4. That tag is the only official release trigger. `release.yml` builds every
   variant, verifies them, and performs the draft → upload all assets →
   publish/latest sequence.
5. Never rebuild or replace the assets of an already published version. Ship a
   new version instead. A manual `workflow_dispatch` of `release.yml` is only
   for finishing an incomplete release with the same tag, not for swapping
   packages under existing update clients.

The footer stamps `v<version> · build <short-hash>` (`-dirty` when uncommitted work is in the build), so any artifact names its exact source.
