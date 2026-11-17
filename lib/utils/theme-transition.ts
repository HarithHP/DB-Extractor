import { flushSync } from "react-dom";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

export interface RevealOrigin {
  x: number;
  y: number;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

function readDuration(root: HTMLElement): number {
  const raw = getComputedStyle(root).getPropertyValue("--theme-switch-duration").trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms : 600;
}

/** Center of the element that triggered the switch (the focused toggle), else top-right. */
function defaultOrigin(): RevealOrigin {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 32, y: 24 };
}

/**
 * Switches theme with a circular reveal from `origin` (View Transitions API),
 * falling back to a short color cross-fade. Honors prefers-reduced-motion.
 *
 * next-themes applies its class in an effect, so the class is set here directly
 * inside the transition callback to guarantee the "new" snapshot is correct.
 */
export function switchThemeAnimated(
  pref: ThemePreference,
  setTheme: (theme: string) => void,
  origin: RevealOrigin = defaultOrigin(),
) {
  const root = document.documentElement;
  const next = resolve(pref);
  const current: ResolvedTheme = root.classList.contains("dark") ? "dark" : "light";

  const commit = () => {
    root.classList.remove("light", "dark");
    root.classList.add(next);
    root.style.colorScheme = next;
    flushSync(() => setTheme(pref));
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (next === current || reduceMotion) {
    commit();
    return;
  }

  const duration = readDuration(root);

  if (typeof document.startViewTransition !== "function") {
    root.classList.add("theme-fading");
    commit();
    window.setTimeout(() => root.classList.remove("theme-fading"), duration);
    return;
  }

  root.setAttribute("data-theme-switching", "");
  const transition = document.startViewTransition(commit);
  transition.ready
    .then(() => {
      const { x, y } = origin;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  transition.finished.finally(() => root.removeAttribute("data-theme-switching"));
}
