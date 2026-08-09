# Install & offline

Four shapes, all built from the same source. Built artifacts are attached to every [release](../../../../releases).

| | what it is | needs a server? | offline |
|---|---|---|---|
| **Hosted site** | three pages plus a service worker — live at [decimen.app](https://decimen.app/) | yes, any static host | after the first visit |
| **`decimen-sender.html`** | one file, ~55 KB | no | always |
| **`decimen-receiver.html`** | one file, ~1.3 MB | see the caveat | always |
| **Desktop app** | portable Windows EXE or macOS `.app` in a ZIP | no | always |

## Hosted site: install and offline

The site precaches everything, decoder wasm included — load it once and it works with the network off. Any page does it; landing straight on `/receive/` from a shared link caches the whole app.

Install it for the full-screen app experience:

- **Android** — Chrome offers *Install app* from the menu (real manifest, proper icons).
- **iOS** — Share → **Add to Home Screen**.

This is the shape to use on a phone: it keeps a real `https://` origin, which is what the camera wants.

## Portable desktop apps

The desktop build includes its own Electron runtime and all Decimen assets. On
Windows, double-click `Decimen Optical Transfer-0.3.0-win-x64.exe`; it is a
portable x64 executable and needs no installer, Node.js, Python, or npm. On
macOS, open the ZIP for your CPU (`mac-x64` for Intel or `mac-arm64` for Apple
Silicon), then double-click the `.app` inside.

The app's page is served only from `127.0.0.1`. It does not need the cloud
desktop to have network access. To read a live QR stream from a remote desktop,
open **Receive** on the host, choose **Screen/window**, select the visible RDP
or VM window, and use **Save** when the checksum-verified transfer completes.

macOS packages are unsigned when built without an Apple developer identity, so
the first launch may require Finder's **Open** action. Screen/window capture
also needs **System Settings → Privacy & Security → Screen Recording**. If the
old Decimen entry was removed, launch the current `.app`, click **Capture
screen**, then use **Open Settings**. Click **+**, add the currently opened
`Decimen Optical Transfer.app`, enable it, quit Decimen with **Cmd-Q**, and
reopen it before trying again.

## Standalone files

`npm run build:standalone` produces two pages with nothing external in them — no script src, no stylesheet, no fetch. The receiver carries the 940 KB decoder wasm as a `data:` URI, which is why it is 1.3 MB. Mail one to someone, drop it on a USB stick.

**The receiver's one caveat:** opened from `file://`, the page gets an opaque origin. Desktop Chrome and Firefox will generally prompt for the camera and work; **iOS Safari and Android Chrome will not give a local file a camera.** Since the receiver is usually the phone, serve the file over http(s) from anything — or use the hosted site's offline mode instead. The sender has no such problem; it works from `file://` everywhere.

## Demo mode

```bash
npm run demo    # sender locked to the two bundled images
```

No file picker, no text box — for a sending machine sitting unattended in front of people. This is the dev server with `VITE_DEMO=1`, not a hardened kiosk: anyone with the keyboard has devtools.

## Why the dev server is https-only

The receiver uses `getUserMedia`, and browsers remove that API entirely on insecure origins — a phone reaching your dev server over plain http has no camera, full stop (`localhost` is exempt; your phone isn't localhost). The dev server ships a self-signed certificate: tap through the warning once ("Show Details → visit this website" on iOS, "Advanced → Proceed" elsewhere) and the page is a secure context, so the camera works.
