# Receiving

Open `/receive/` and choose an input source:

- **Camera** — tap **Start camera** and point it at the sender's code. This is the phone-to-screen workflow.
- **Screen/window** — tap **Capture screen**, then choose the VM window, remote-desktop window, or browser tab that is displaying the sender's changing QR codes. The receiver reads the live display-capture frames in memory; it does not create PNGs or record a video.

For the portable desktop app, open **Receive** on the host, tap **Capture
screen**, and select the cloud-desktop or RDP window. Windows and older macOS
versions show a scrollable thumbnail picker with a preview confirmation; macOS
15 and newer can show the system picker. When decoding completes, use **Save**
in that same host app.

While receiving, **Pause** stops local capture and decoding while keeping the
already collected blocks. Tap **Resume** to continue. **Cancel** stops the
camera or screen stream, discards the partial transfer, and returns to source
selection.

There is no pairing: the receiver locks onto any Decimen stream mid-flight, works out on its own whether a file or text is arriving, and downloads the recovered file to the host when its checksum passes.

For camera input, fill the camera view with the code and prop the phone against something — autofocus hunting from hand tremor is the #1 throughput killer. On cameras that support it (Android, typically) continuous autofocus is enabled automatically.

For screen input, keep the remote-desktop or VM window visible and updating.
Some operating systems pause or blank a covered, minimized, protected, or
hardware-overlay window. Select the source window, not the Receive tab itself.
The desktop app protects its own window from whole-display capture and removes
it from the window list, so the receiver UI is not fed back into its decoder.
When possible, selecting the RDP/VM window directly gives the cleanest preview.

Progress counts **frames collected**, not blocks solved — fountain decoding back-loads its solve cascade, so the bar is estimated from frame rate and only verified completion reaches 100%.

## When it lands

- The file is verified against its SHA-256 before anything is offered.
- Images, video, and audio preview inline — video plays in the page (never autoplays), other files just get the **Save** link.
- **Receive another file** reloads into a fresh receiver.
- **Clear Decimen cache** scrubs the received bytes from browser storage — see [Privacy](privacy.md).
- Text snippets appear with a **Copy** button and exist only until the tab closes.

**Live diagnostics** (capture/decode fps, goodput, frames, K) is collapsible during the transfer and becomes the **Transfer summary** when it ends.

## Receive settings

Applied live while the camera runs; a device that refuses a live reconfigure (iOS, sometimes) keeps the current stream and says so. Frame rates the camera reports it cannot reach are grayed out.

| setting | default | notes |
|---|---|---|
| capture width | 1280 | 1920 costs decode time; 960 helps weak CPUs |
| capture fps | 60 | iOS delivers 30 unless the exact rate is demanded — the app handles this |
| decode workers | 2 | one WASM decoder per worker; busy workers drop frames, which the fountain absorbs |
