/**
 * Subnet Path Store — ephemeral (non-persisted) Zustand store tracking
 * subnet navigation depth.
 *
 * current_path is an array of subnet node ids from root to the current
 * level. Empty array = root canvas. This store is intentionally NOT
 * persisted: dive-in state is session-scoped and resets on reload or
 * project switch.
 */

import { create } from 'zustand'

export interface SubnetPathState {
  /** Array of subnet node ids from root to current level. Empty = root canvas. */
  current_path: string[]
  /** Push a subnet id onto the path (dive-in). */
  enter: (subnet_id: string) => void
  /** Pop the deepest level (up one). No-op at root. */
  exit: () => void
  /** Truncate path to given depth. goto(0) = root. Out-of-range = no-op. */
  goto: (depth: number) => void
  /** Clear the path. Called on project switch. */
  reset: () => void
}

export const useSubnetPathStore = create<SubnetPathState>((set) => ({
  current_path: [],
  enter: (subnet_id) =>
    set((s) => ({ current_path: [...s.current_path, subnet_id] })),
  exit: () =>
    set((s) => ({ current_path: s.current_path.slice(0, -1) })),
  goto: (depth) =>
    set((s) => {
      if (depth < 0 || depth > s.current_path.length) return s
      return { current_path: s.current_path.slice(0, depth) }
    }),
  reset: () => set({ current_path: [] }),
}))
