# Privacy

**Nothing is transmitted anywhere except as light.** There is no account, no pairing, no analytics, and no network path between the devices — the site works with the network off after the first visit.

**The channel is not confidential.** Whatever is on the sending screen is readable by *any* camera pointed at it. The property Decimen gives you is *no network*, not encryption. Don't stream secrets in a room you don't trust.

**Integrity is checked.** Every received file is verified against its SHA-256 before being offered; a corrupted stream fails loudly rather than handing over damaged bytes.

**Screen capture is explicit.** The receiver asks the browser or desktop app to let you choose a display, window, or tab. Screen input is decoded from in-memory frames on the host and is not uploaded or recorded. Do not select a window containing information you do not want transferred through the optical link.

## What persists on the receiving device

- **Text snippets: nothing.** Shown with a Copy button, gone when the tab closes.
- **Files you save** go wherever your browser puts downloads.
- **Received media** (video/audio, so the in-page player can seek) is staged in the browser's Cache API and would otherwise linger until the next transfer overwrites it. The **Clear Decimen cache** button next to *Receive another file* deletes it on the spot — use it before handing the phone to someone.
- The service worker's offline cache holds the **app itself**, never transferred content.
