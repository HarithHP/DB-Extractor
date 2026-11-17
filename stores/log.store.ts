import { create } from "zustand";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  details?: string;
}

interface LogState {
  entries: LogEntry[];
  append: (entry: LogEntry) => void;
  clear: () => void;
}

const MAX_ENTRIES = 500;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  append: (entry) =>
    set((state) => ({
      entries: state.entries.length >= MAX_ENTRIES ? [...state.entries.slice(1), entry] : [...state.entries, entry],
    })),
  clear: () => set({ entries: [] }),
}));
