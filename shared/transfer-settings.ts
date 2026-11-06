type Section = "send" | "receive";
type Control = HTMLInputElement | HTMLSelectElement;

declare global {
  interface Window {
    decimenSettings?: {
      get(section: Section): unknown;
      set(section: Section, values: Record<string, string>): boolean;
    };
  }
}

function validValue(control: Control, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return;
  if (control instanceof HTMLSelectElement) {
    return [...control.options].some(option => option.value === value) ? value : undefined;
  }
  const number = Number(value);
  const min = Number(control.min);
  const max = Number(control.max);
  const step = Number(control.step || 1);
  if (!Number.isSafeInteger(number) || number < min || number > max || (number - min) % step !== 0) return;
  return String(number);
}

/** Remember tuning only; never persist a file, clipboard text or transfer data. */
export function rememberSettings<K extends string>(section: Section, controls: Record<K, Control>): () => Record<K, string> {
  const keys = Object.keys(controls) as K[];
  const previous = Object.fromEntries(keys.map(key => [key, controls[key].value])) as Record<K, string>;
  const storageKey = `decimen-${section}-settings`;
  try {
    const saved = window.decimenSettings
      ? window.decimenSettings.get(section)
      : JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const key of keys) {
        const value = validValue(controls[key], (saved as Record<string, unknown>)[key]);
        if (value !== undefined) controls[key].value = previous[key] = value;
      }
    }
  } catch { /* Standalone storage can be disabled; keep usable defaults. */ }

  const read = (): Record<K, string> => {
    for (const key of keys) controls[key].value = previous[key] = validValue(controls[key], controls[key].value) ?? previous[key];
    return { ...previous };
  };
  const save = () => {
    const values = read();
    try {
      if (window.decimenSettings) window.decimenSettings.set(section, values);
      else localStorage.setItem(storageKey, JSON.stringify(values));
    } catch { /* Storage failure must not interrupt a transfer. */ }
  };
  for (const control of Object.values(controls) as Control[]) {
    control.addEventListener("change", save);
    if (control instanceof HTMLInputElement && control.type === "range") control.addEventListener("input", save);
  }
  return read;
}
