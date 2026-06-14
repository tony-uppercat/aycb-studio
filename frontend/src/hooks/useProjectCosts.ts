import { useCallback } from 'react';
import { useCanvasStore, getTotalCost, getProjectCosts } from '../stores/canvasStore';
import type { CostEntry } from '../stores/canvasStore';
import { downloadJSON } from '../utils/downloadManager';
import { STORAGE_KEYS } from '../storage/keys';

export interface ProjectCosts {
  projectCosts: CostEntry[];
  totalCost: number;
  count: number;
  activeProjectId: string | null;
  clearProjectCosts: () => void;
  exportProjectCosts: () => void;
}

/**
 * Per-project view over the global cost ledger. Reads the canvasStore costs
 * and active project id, filters to the active project, and exposes
 * clear/export scoped to that project only (never global).
 */
export function useProjectCosts(): ProjectCosts {
  const storeCosts = useCanvasStore((s) => s.costs);
  const activeProjectId = useCanvasStore((s) => s.activeProjectId);
  const removeCostsForProject = useCanvasStore((s) => s.removeCostsForProject);

  const projectCosts = getProjectCosts(storeCosts, activeProjectId);
  const totalCost = getTotalCost(projectCosts);
  const count = projectCosts.length;

  const clearProjectCosts = useCallback(() => {
    if (activeProjectId) removeCostsForProject(activeProjectId);
  }, [activeProjectId, removeCostsForProject]);

  const exportProjectCosts = useCallback(() => {
    let projectName = activeProjectId ?? 'project';
    try {
      projectName = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || projectName;
    } catch { /* localStorage unavailable */ }
    const date = new Date().toISOString().slice(0, 10);
    downloadJSON(projectCosts, `costs_${projectName}_${date}.json`);
  }, [projectCosts, activeProjectId]);

  return { projectCosts, totalCost, count, activeProjectId, clearProjectCosts, exportProjectCosts };
}
