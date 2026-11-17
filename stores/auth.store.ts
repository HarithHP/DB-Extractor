import { create } from "zustand";
import type { DekKeys } from "@/lib/crypto/kdf";

interface AuthState {
  username: string | null;
  /** Non-extractable in-memory keys. Never persisted to web storage. */
  dek: DekKeys | null;
  unlockedAt: number | null;
  setUnlocked: (username: string, dek: DekKeys) => void;
  lock: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  username: null,
  dek: null,
  unlockedAt: null,
  setUnlocked: (username, dek) => set({ username, dek, unlockedAt: Date.now() }),
  lock: () => set({ username: null, dek: null, unlockedAt: null }),
}));
