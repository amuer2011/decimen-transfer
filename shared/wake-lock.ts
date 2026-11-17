/** Keep the screen awake for the duration of a transfer, best effort — a
 *  sender that sleeps mid-stream kills the transfer, but a browser without
 *  the API (or a denied request) is fine to run without it.
 *
 *  A wake lock is released automatically when the page becomes hidden, so
 *  re-request it when the user comes back — otherwise the screen can sleep
 *  mid-transfer after the first app switch even though a lock was held
 *  at the start. */
let reacquireInstalled = false;
export async function requestScreenWakeLock(): Promise<void> {
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } })
      .wakeLock?.request("screen");
  } catch {
    /* fine without it */
  }
  if (!reacquireInstalled && typeof document !== "undefined") {
    reacquireInstalled = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void requestScreenWakeLock();
    });
  }
}
