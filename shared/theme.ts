type Theme = "light" | "dark";
export {};
declare global {
  interface Window {
    decimenAppearance?: { getTheme(): Theme; setTheme(theme: Theme): void };
  }
}
const STORAGE_KEY = "decimen-theme";

function savedTheme(): Theme {
  if (window.decimenAppearance) return window.decimenAppearance.getTheme();
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be disabled for standalone pages. */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-theme]")];
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#111113" : "#f7f7f5",
  );
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  }
}
applyTheme(savedTheme());
for (const button of buttons) {
  button.addEventListener("click", () => {
    const theme = button.dataset.theme as Theme;
    applyTheme(theme);
    window.decimenAppearance?.setTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Best effort. */ }
  });
}
