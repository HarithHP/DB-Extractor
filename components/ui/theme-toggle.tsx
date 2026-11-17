"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { switchThemeAnimated, type ThemePreference } from "@/lib/utils/theme-transition";
import { Button } from "./button";
import { SegmentedControl } from "./segmented";

export type { ThemePreference };

const subscribe = () => () => {};

/** True only after hydration, so theme-dependent UI never mismatches the server render. */
function useMounted() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Light / dark / system switch with an animated reveal. The choice is persisted
 * by next-themes in localStorage under `hhp-theme` (see ThemeProvider).
 */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "segmented" }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  if (variant === "segmented") {
    return (
      <SegmentedControl<ThemePreference>
        ariaLabel="Color theme"
        value={mounted ? ((theme as ThemePreference) ?? "system") : "system"}
        onChange={(pref) => switchThemeAnimated(pref, setTheme)}
        options={[
          { value: "light", label: "Light", icon: <Sun /> },
          { value: "dark", label: "Dark", icon: <Moon /> },
          { value: "system", label: "System", icon: <Monitor /> },
        ]}
      />
    );
  }

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        switchThemeAnimated(isDark ? "light" : "dark", setTheme, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun key="sun" className="animate-icon-in" /> : <Moon key="moon" className="animate-icon-in" />}
    </Button>
  );
}
