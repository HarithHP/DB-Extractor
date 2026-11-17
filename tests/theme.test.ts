import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils/cn";

const themeCss = readFileSync(join(__dirname, "..", "app", "theme.css"), "utf8");
const fontSizeTokens = [...themeCss.matchAll(/^\s*--text-([a-z0-9-]+):/gm)].map((m) => m[1]);

describe("theme font-size tokens", () => {
  it("defines tokens in theme.css", () => {
    expect(fontSizeTokens.length).toBeGreaterThan(0);
  });

  it.each(fontSizeTokens)("cn keeps text-%s alongside a text color", (token) => {
    expect(cn(`text-${token}`, "text-primary")).toBe(`text-${token} text-primary`);
  });

  it("still lets a later font-size token override an earlier one", () => {
    expect(cn("text-sm", "text-badge")).toBe("text-badge");
  });
});

describe("theme spacing tokens", () => {
  const spacingTokens = [...themeCss.matchAll(/^\s*--spacing-([a-z0-9-]+):/gm)].map((m) => m[1]);

  it.each(spacingTokens)("cn treats p-%s as padding", (token) => {
    expect(cn("p-4", `p-${token}`)).toBe(`p-${token}`);
  });
});
