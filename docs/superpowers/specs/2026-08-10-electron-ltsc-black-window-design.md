# Electron LTSC Black Window Compatibility Design

## Context

The packaged Electron application renders a black native window on Windows 10 Enterprise LTSC 2019 (build 17763). The same page served by the app's loopback HTTP server renders normally in a regular browser, so the page bundle and local server are not the failure boundary.

The Electron main process currently calls `window.setContentProtection(true)` for every platform. Electron documents that Windows versions before 10 version 2004 fall back to `WDA_MONITOR` behavior for this API. That behavior can produce a black surface on older or virtual display stacks.

## Goal

Keep content protection on platforms where Electron supports the modern Windows behavior, while allowing the main window to render on Windows builds below 19041, including LTSC 2019 build 17763.

## Selected Approach

Add a small, pure CommonJS helper at `desktop/content-protection.cjs`:

```text
shouldProtectWindow(platform, systemVersion) -> boolean
```

The helper applies these rules:

- Non-Windows platforms return `true`.
- Windows system versions with build `>= 19041` return `true`.
- Windows system versions with build `< 19041` return `false`.
- An unparseable Windows version returns `false` so an unknown legacy environment does not fall back to a black window.

`desktop/main.cjs` will call the helper with `process.platform` and Electron's `process.getSystemVersion()`. It will call `setContentProtection(true)` only when the helper returns `true`. No page code, local server behavior, screen-capture picker behavior, or transfer protocol code will change.

## Alternatives Considered

1. Disable content protection on every Windows version. This is simpler but unnecessarily removes the existing capture-feedback protection on supported Windows systems.
2. Keep protection enabled and detect a black surface at runtime. Electron does not expose a reliable success/failure result for this API, so this would be fragile and difficult to test.
3. Gate the call by Windows build. This is the selected approach because it is deterministic, preserves current behavior on supported systems, and directly addresses the confirmed LTSC boundary.

## Testing

Add `tests/content-protection.test.ts` using the repository's Node test runner and `tsx`. The tests will cover:

- Windows `10.0.17763` returns `false`.
- Windows `10.0.19041` returns `true`.
- Windows `10.0.19044` returns `true`.
- Windows `10.0.26100` returns `true`.
- macOS and Linux return `true`.
- An unparseable Windows version returns `false`.

The test will be written and run red before the helper is implemented, then run green after the helper and main-process integration are added.

## Verification

After implementation:

1. Run the focused regression test.
2. Run `npm test`.
3. Run `npm run build`.
4. Run `npm run desktop:win` to produce the portable x64 EXE.
5. Confirm the packaged output contains the updated main process and report whether the EXE can be visually exercised on the available Windows environment.

The final Windows LTSC visual check remains environment-dependent; the current development host cannot reproduce the user's LTSC 2019 compositor behavior.

## Out of Scope

- Disabling GPU acceleration permanently.
- Changing the dark UI theme.
- Replacing Electron or the local HTTP server.
- Changing screen capture permissions or transfer settings.
