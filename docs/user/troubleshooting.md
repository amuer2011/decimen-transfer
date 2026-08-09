# Troubleshooting

## "Nothing happening?"

If the camera or screen capture runs for a while without decoding a single frame, a small toast appears above the preview asking exactly that. **Help** opens source-specific tips; **Dismiss** snoozes it (it returns later if things are still dead — tapping a button doesn't make frames arrive).

The fixes are on the **sender**, which is the non-obvious part. In order:

1. On the sender, open Transfer settings and drop **bytes / frame to 1465**. The 2953-byte default is tuned for close-range phone-to-phone and is exactly what fails on an ordinary monitor at arm's length.
2. Still nothing? Drop the sender's **tx fps to 24**.
3. Fill this camera's view with the code, and prop the phone against something — autofocus hunting from hand tremor is the usual culprit.
4. Turn the sending screen's brightness all the way up.

For **Screen/window** input:

- Choose the window or tab that visibly contains the animated QR code.
- Keep it open, visible, and at full brightness; do not choose the Receive page itself.
- If the preview is black or stops changing, the operating system or remote-desktop client may block capture of a protected or minimized window. Share the whole display or an ordinary browser tab as a fallback.
- In the packaged macOS app, allow **Screen Recording** for Decimen in **System Settings → Privacy & Security**. If Decimen is missing because its old entry was removed, click **+** and add the currently opened `Decimen Optical Transfer.app`; then quit with **Cmd-Q** and reopen it. In the desktop picker, scroll through the thumbnails, select the RDP/VM source, confirm its preview, and keep that window visible.

## Input problems

- **Permission denied** — tap the browser's permission prompt carefully; if you hit Block by accident, allow camera for the site and tap **Start camera** again (no reload needed).
- **Screen sharing cancelled or denied** — choose **Screen/window**, tap **Capture screen**, and select the VM or remote-desktop source again. In the desktop app, also check the operating system screen-recording permission.
- **"camera needs a secure context"** — the page is being served over plain http. Browsers remove the camera API on insecure origins; serve over https (the dev server already does, self-signed) or use [decimen.app](https://decimen.app/).
- **Standalone receiver file** — opening `decimen-receiver.html` from `file://` will not get a camera on iOS or Android. See [Install & offline](install-and-offline.md).

## Slow transfers

See the tuning table in [Sending](sending.md) — bytes/frame and tx fps are the two levers that matter.
