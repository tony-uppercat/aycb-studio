---
name: aycb-node-creator
description: >
  Create and port AYCB Studio v2 nodes. Trigger when creating new nodes,
  porting from v0, or modifying existing nodes.
---

# AYCB v2 Node Creator

## Rules (from CLAUDE.md)

- Max 300 lines per file. Split at 250 into component + hook.
- Node folder is self-contained. Touch zero files outside it.
- Auto-discovered via `import.meta.glob` in `nodes/index.ts`.
- No emoji in UI labels. Title Case labels.

## Node Folder Structure

```
frontend/src/nodes/{kebab-name}/
  node.manifest.ts          # type, label, category, inputs, outputs
  {PascalName}Node.tsx       # Component using NodeShell, must have default export
  {kebab-name}.test.ts       # At minimum: manifest validation test
  {PascalName}.module.css    # Optional, only if node has custom styles
  use{PascalName}.ts         # Optional hook, only if component > 250 lines
```

## Manifest Template

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'camelCase',           // unique across all nodes
  label: 'Title Case',        // no emoji
  icon: '📝',                 // temporary, will be replaced with Lucide
  category: 'input',          // input | media-model | llm | utility
  description: 'What it does',
  defaultData: {},
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

## Porting from v0

Source: `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\00_aycb\aycb\frontend\src\components\nodes\`

Steps:
1. Create folder + manifest
2. Copy component verbatim
3. Fix imports (see table below)
4. Add `export default` or `export default memo(...)`
5. If >300 lines: extract logic into `use{Name}.ts` hook
6. Write test
7. Verify: `npx vitest run src/nodes/{name}/{name}.test.ts`

### Import Path Map (v0 → v2)

| v0 | v2 |
|---|---|
| `../NodeShell` | `../_shared/NodeShell` |
| `./ExpandableText` | `../_shared/ExpandableText` |
| `./Node.module.css` | `../_shared/Node.module.css` |
| `../../api` | `../../api` |
| `../../stores/canvasStore` | `../../stores/canvasStore` |
| `../../hooks/*` | `../../hooks/*` |
| `../../utils/*` | `../../utils/*` |
| `../../mediaStore` | `../../mediaStore` |
| `../../components/SettingsContext` | `../../components/SettingsContext` |
| `../../components/media/MediaPreview` | `../../components/media/MediaPreview` |
| `../ui/CopyButton` | `../../components/ui/CopyButton` |

## Test Template

```typescript
import { describe, it, expect } from 'vitest'

describe('{PascalName}Node', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('{camelCase}')
    expect(manifest.category).toBe('{category}')
  })
})
```

## Available Helpers (already in v2)

NodeShell, ExpandableText, CopyButton, cascadeRun, useFileDrop, useCropOverlay,
useSplitOverlay, MediaPreview/useMediaPreview, costEstimate, nodeErrors,
jsonColorize, edgeStyles, useDataPropagation, useCanvasHistory.

## v2 Traps (lessons from porting)

These are real bugs we hit. Check every ported node against this list.

1. **Type is `NodeManifest`, not `NodeCatalogEntry`.** v0 used `NodeCatalogEntry` — that type does not exist in v2. Replace every occurrence with `NodeManifest`.

2. **Property is `label`, not `name`.** `NodeManifest` has `.label` for the display name. v0 components reference `.name` — change to `.label`.

3. **`getCompatibleNodes` needs catalog as first arg.** Signature: `getCompatibleNodes(NODE_CATALOG, slotType, direction)`. v0 had the catalog baked in.

4. **`findHandleForSlot` needs catalog as first arg.** Signature: `findHandleForSlot(NODE_CATALOG, nodeType, slotType, direction)`. Import `NODE_CATALOG` from `../../nodes/index`.

5. **NodeShell slots use `{id, label, type}`, not `{handleId, type}`.** The manifest uses `handleId` but NodeShell props expect `id`. When passing slots to NodeShell, use `id`.

6. **Accent color is `#F52776`**, not amber or blue. CSS variable `--amber` is `#F52776`. Text on accent backgrounds should be white, not black.

7. **Ports are 5100 (frontend) and 5101 (backend).** Not 3000/3001. Those are v0.

8. **Providers self-register.** They are imported as side-effects in `api.ts`. No manual registration needed. Don't add import lines for providers.

## NEVER DO

- Modify `nodes/index.ts` or `_shared/` files
- Import from another node's folder
- Create a node without `node.manifest.ts`
- Skip the default export
- Use hardcoded colors (use design tokens)
- Exceed 300 lines without splitting
