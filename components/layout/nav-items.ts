import { Database, History, ScrollText, Settings } from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/projects", label: "Projects", icon: Database },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export const DESKTOP_NAV = [
  ...PRIMARY_NAV,
  { href: "/logs", label: "Logs", icon: ScrollText },
] as const;

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
