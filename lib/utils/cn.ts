import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Keep in sync with the `--text-*` / `--spacing-*` tokens in app/theme.css; otherwise
// tailwind-merge treats them as text colors and drops them next to `text-primary` etc.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "btn-sm",
        "btn-md",
        "btn-lg",
        "table",
        "table-head",
        "badge",
        "field",
        "label",
        "page-title",
        "section-title",
        "stat",
      ],
      spacing: ["card", "card-sm"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
