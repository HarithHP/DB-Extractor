import { create } from "zustand";
import type { Project } from "@/lib/schemas";

interface ProjectState {
  projects: Project[];
  loaded: boolean;
  setProjects: (projects: Project[]) => void;
  upsert: (project: Project) => void;
  remove: (id: string) => void;
  get: (id: string) => Project | undefined;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,
  setProjects: (projects) => set({ projects, loaded: true }),
  upsert: (project) =>
    set((state) => {
      const idx = state.projects.findIndex((p) => p.id === project.id);
      if (idx === -1) return { projects: [project, ...state.projects] };
      const next = [...state.projects];
      next[idx] = project;
      return { projects: next };
    }),
  remove: (id) => set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),
  get: (id) => get().projects.find((p) => p.id === id),
  reset: () => set({ projects: [], loaded: false }),
}));
