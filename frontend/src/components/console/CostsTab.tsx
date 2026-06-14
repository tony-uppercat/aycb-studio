import { useState, useCallback } from 'react';
import { useProjectCosts } from '../../hooks/useProjectCosts';
import styles from './ConsolePanel.module.css';

function costColor(usd: number): string {
  if (usd >= 0.10) return styles.costRed;
  if (usd >= 0.01) return styles.costYellow;
  return styles.costGreen;
}

function shortTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Costs tab body — per-project view. Lists the active project's cost entries,
 * a total row, and a scoped export button. Reads everything from
 * useProjectCosts; the parent ConsolePanel owns the badge/total in the tab strip.
 */
export function CostsTab() {
  const { projectCosts, totalCost, exportProjectCosts } = useProjectCosts();
  const [copiedLine, setCopiedLine] = useState<string | null>(null);

  const copyText = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLine(key);
      setTimeout(() => setCopiedLine(null), 1200);
    }).catch(e => console.warn('[clipboard] copyText failed:', e.message ?? e));
  }, []);

  return (
    <>
      {projectCosts.length === 0 && <p className={styles.consoleEmpty}>No cost entries yet...</p>}
      {projectCosts.map((entry, i) => {
        const key = `c-${i}`;
        const text = `${entry.nodeName} | ${entry.model} | in:${entry.inputTokens} out:${entry.outputTokens} | $${entry.costUsd.toFixed(4)}`;
        return (
          <div key={i}
            className={`${styles.costRow} ${costColor(entry.costUsd)} ${styles.clickable} ${copiedLine === key ? styles.copied : ''}`}
            onClick={() => copyText(text, key)}
            title="Click to copy"
          >
            {copiedLine === key
              ? <span className={styles.copiedLabel}>✓ copied</span>
              : <>
                  <span className={styles.costTime}>{shortTime(entry.timestamp)}</span>
                  <span className={styles.costNode}>{entry.nodeName}</span>
                  <span className={styles.costModel}>{entry.model}</span>
                  <span className={styles.costTokens} data-s>{entry.inputTokens}+{entry.outputTokens}</span>
                  <span className={styles.costUsd} data-s>${entry.costUsd < 0.01 ? entry.costUsd.toFixed(4) : entry.costUsd.toFixed(3)}</span>
                </>
            }
          </div>
        );
      })}
      {projectCosts.length > 0 && (
        <div className={styles.costTotalRow}>
          <button className={styles.fbExportBtn} onClick={exportProjectCosts} title="Export costs JSON">Export</button>
          <span className={styles.costTotal} data-s>
            Total: ${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(3)}
          </span>
        </div>
      )}
    </>
  );
}
