# Decimen Optical Transfer: fountain-coded QR file transfer

Send a file between two devices using nothing but a **screen and a camera**.
One page displays the file as an endless stream of animated QR codes; another
device points its camera at it and reconstructs the file. **No network path
between the devices, no app, no pairing, no permissions beyond the camera.**
The payload travels as light.

## Try it

### **→ [decimen.app](https://decimen.app/)**

Open it on both devices and go — nothing to install. Works offline after the
first visit, and installs as an app on both iOS and Android if you want it on
a home screen.

Files up to 64 MB (or a pasted text snippet), filename and media type preserved,
gzip only when it helps, SHA-256 verified before anything is offered — and
received video plays right in the page. Extracted from a larger experiment that
reached **128 KB/s phone-to-phone**.

The receiver can also capture a display, window, or browser tab directly. This
lets a host read an animated QR stream shown inside a virtual machine or remote
desktop without using a camera, creating a PNG, or recording a video.

<p align="center">
  <img src="docs/receiving.jpg" width="420"
       alt="Phone receiving a file over light: 130.5 KB/s goodput, halfway through decoding the sender's animated QR stream" />
</p>
<p align="center"><em>Mid-transfer: a phone pulling a file out of the air at 130 KB/s.</em></p>

Neither mode is encrypted: whatever is on the sending screen is readable by
any camera pointed at it. The property this gives you is no network, not
confidentiality — see [privacy](docs/user/privacy.md).

## Desktop packages

Portable desktop builds are produced in `artifacts/desktop/`:

- Windows x64: `Decimen Optical Transfer-0.3.0-win-x64.exe`
- macOS Intel: `Decimen Optical Transfer-0.3.0-mac-x64.dmg`
- macOS Apple Silicon: `Decimen Optical Transfer-0.3.0-mac-arm64.dmg`

The Windows build is a portable EXE. The macOS DMG contains a double-clickable
`.app`; open the DMG and drag the app to Applications. Unpacked `.app`
directories are also left beside the DMG after a local build. End users do not
need Node.js, npm, Python, Electron, or any third-party package. The app serves
its bundled pages from `127.0.0.1` and does not need network access during a
transfer.

For live remote-desktop or VM QR capture, run the sender in the cloud desktop,
open **Receive** in the host desktop app, choose **Screen/window**, and select
the RDP/VM window that shows the changing QR codes. The recovered file is then
saved through the host app's **Save** action.

The desktop receiver protects its own window from whole-display capture and
filters it out of the window list, preventing a capture feedback loop.

### Build desktop packages

Run these commands from the repository root. The build machine needs Node.js
and npm. The first `npm ci` installs the development dependencies, and the
first desktop build may download the Electron runtime. The packaged apps do
not need Node.js, npm, or an Internet connection on the end user's machine.

```bash
cd /path/to/decimen-transfer
npm ci
npm test
npm run build
```

Quick platform builds:

```bash
npm run desktop:mac      # macOS Intel + Apple Silicon DMGs and .app folders
npm run desktop:win      # Windows x64 portable EXE
npm run desktop:package  # configured targets for the current platform
```

The same builds can be run manually after the web bundle has been built:

```bash
npm run build
npx electron-builder --config desktop/electron-builder.yml --mac
npx electron-builder --config desktop/electron-builder.yml --win portable
```

Use the macOS command on a Mac and the Windows command on Windows for the
most reliable native builds. All desktop output is written to
`artifacts/desktop/`, including DMG files, the portable Windows EXE, and
temporary unpacked application directories. These generated files are ignored
by Git and must not be committed. DMGs are intended for GitHub Release assets;
do not commit them to the source repository.

## Documentation

**Using it** — [quick start](docs/user/quick-start.md) ·
[sending](docs/user/sending.md) · [receiving](docs/user/receiving.md) ·
[troubleshooting](docs/user/troubleshooting.md) ·
[install & offline](docs/user/install-and-offline.md) ·
[privacy](docs/user/privacy.md)

**How it's built** — [architecture](docs/technical/architecture.md) ·
[protocol](docs/technical/protocol.md) ·
[platform quirks](docs/technical/platform-quirks.md) ·
[build & release](docs/technical/build-and-release.md)

The short version of the protocol: a screen-to-camera link has no
back-channel, so the sender streams fountain-coded frames ([Luby
transform](https://en.wikipedia.org/wiki/Luby_transform_code)) — the receiver
collects *any* ~K·1.15 distinct frames in any order and peels the file out.
Dropped frames cost time, never correctness.

## Run it yourself

```bash
npm install
npm run dev               # https dev server with HMR
npm run serve             # build, then serve the production bundle
npm run demo              # demo mode: only the bundled payloads can be sent
npm test                  # golden wire-format vectors and unit tests
npm run build             # the hosted site → dist/
npm run build:standalone  # both self-contained pages → dist-standalone/
npm run build:all         # everything
npm run desktop:mac       # macOS x64 + arm64 DMGs and .app directories
npm run desktop:win       # Windows x64 portable EXE
npm run desktop:package   # configured targets for the current platform
```

Open `https://localhost:5173/send/` on the sending device and the printed
`Network` URL on the receiving phone (accept the self-signed certificate
once). Walkthrough: [quick start](docs/user/quick-start.md).

## Similar projects

The concept here was arrived at independently. It turns out several people
have had similar ideas, and their takes are all worth a look:

- [mohankumarelec/airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer):
  browser-based QR file transfer with compression and sequential chunking.
  Discovered after publicly demoing this project; convergent evolution in
  action.
- [divan/txqr](https://github.com/divan/txqr) (2018): animated QR plus
  fountain codes in Go, with two excellent write-ups on why fountain coding
  beats sequential looping.
- [sz3/libcimbar](https://github.com/sz3/libcimbar): goes past QR entirely
  with a custom high-density color code purpose-built for this channel.

Built by [Evan Crawley (Bash Alarmist)](https://www.linkedin.com/in/evan-crawley), with
[node-qrcode](https://github.com/soldair/node-qrcode) and
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm).

## License

MIT
