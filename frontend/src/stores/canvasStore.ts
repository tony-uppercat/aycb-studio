import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../storage/keys';

export interface NetworkEntry {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  duration: number; // ms
}

export interface ErrorEntry {
  timestamp: string;
  nodeId: string;
  message: string;
}

export interface CostEntry {
  timestamp: string;
  nodeId: string;
  nodeName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface CanvasState {
  settingsOpen: boolean;
  addMenuOpen: boolean;
  consoleOpen: boolean;
  minimapVisible: boolean;
  storagePanelOpen: boolean;
  fullscreenBrowserOpen: boolean;
  toggleSettings: () => void;
  toggleAddMenu: () => void;
  toggleConsole: () => void;
  toggleMinimap: () => void;
  toggleStorage: () => void;
  toggleFullscreenBrowser: () => void;

  logs: string[];
  setLogs: (logs: string[]) => void;

  networkLog: NetworkEntry[];
  addNetworkEntry: (entry: NetworkEntry) => void;
  clearNetworkLog: () => void;

  errors: ErrorEntry[];
  addError: (entry: ErrorEntry) => void;
  clearErrors: () => void;

  costs: CostEntry[];
  addCost: (entry: CostEntry) => void;
  clearCosts: () => void;

  exportStatus: string;
  setExportStatus: (status: string) => void;

  backendStatus: 'unknown' | 'online' | 'offline' | 'cloud';
  setBackendStatus: (status: 'unknown' | 'online' | 'offline' | 'cloud') => void;
  addLog: (msg: string) => void;

  saveStatus: 'saved' | 'saving' | 'unsaved';
  setSaveStatus: (status: 'saved' | 'saving' | 'unsaved') => void;

  /** Global snapshot function — set by FlowCanvas, callable from any node */
  snapshotCanvas: (() => void) | null;
  setSnapshotCanvas: (fn: (() => void) | null) => void;

  /** Active project ID — synced from useActiveProject, used by saveMediaForProject */
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      settingsOpen: false,
      addMenuOpen: false,
      consoleOpen: false,
      minimapVisible: false,
      storagePanelOpen: false,
      fullscreenBrowserOpen: false,
      toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
      toggleAddMenu: () => set((s) => ({ addMenuOpen: !s.addMenuOpen })),
      toggleConsole: () => set((s) => ({ consoleOpen: !s.consoleOpen })),
      toggleMinimap: () => set((s) => ({ minimapVisible: !s.minimapVisible })),
      toggleStorage: () => set((s) => ({ storagePanelOpen: !s.storagePanelOpen })),
      toggleFullscreenBrowser: () => set((s) => ({ fullscreenBrowserOpen: !s.fullscreenBrowserOpen })),

      logs: [],
      setLogs: (logs) => set({ logs }),

      networkLog: [],
      addNetworkEntry: (entry) =>
        set((s) => ({ networkLog: [...s.networkLog, entry].slice(-200) })),
      clearNetworkLog: () => set({ networkLog: [] }),

      errors: [],
      addError: (entry) =>
        set((s) => ({ errors: [...s.errors, entry].slice(-200) })),
      clearErrors: () => set({ errors: [] }),

      costs: [],
      addCost: (entry) =>
        set((s) => ({ costs: [...s.costs, entry].slice(-500) })),
      clearCosts: () => set({ costs: [] }),

      exportStatus: '',
      setExportStatus: (exportStatus) => set({ exportStatus }),

      backendStatus: 'unknown' as const,
      setBackendStatus: (backendStatus) => set({ backendStatus }),
      addLog: (msg) => set((s) => ({ logs: [...s.logs, `${new Date().toLocaleTimeString()} ${msg}`].slice(-500) })),

      saveStatus: 'saved' as const,
      setSaveStatus: (saveStatus) => set({ saveStatus }),

      snapshotCanvas: null,
      setSnapshotCanvas: (fn) => set({ snapshotCanvas: fn }),

      activeProjectId: null,
      setActiveProjectId: (id) => set({ activeProjectId: id }),
    }),
    {
      name: STORAGE_KEYS.UI_STATE,
      // Only persist panel visibility flags — not transient runtime state
      partialize: (state) => ({
        consoleOpen: state.consoleOpen,
        minimapVisible: state.minimapVisible,
        costs: state.costs,
      }),
    }
  )
);

export function getTotalCost(costs: CostEntry[]): number {
  return costs.reduce((sum, c) => sum + c.costUsd, 0);
}
