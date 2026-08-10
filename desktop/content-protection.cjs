const MINIMUM_PROTECTED_WINDOWS_BUILD = 19041;

function windowsBuild(systemVersion) {
  const match = /^10\.0\.(\d+)(?:\.|$)/.exec(systemVersion);
  return match ? Number(match[1]) : undefined;
}

function shouldProtectWindow(platform, systemVersion) {
  if (platform !== "win32") return true;
  const build = windowsBuild(systemVersion);
  return build !== undefined && build >= MINIMUM_PROTECTED_WINDOWS_BUILD;
}

module.exports = { shouldProtectWindow };
