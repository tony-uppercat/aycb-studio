# AYCB v2 Phase 2 — Port Remaining Nodes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the remaining 15 nodes from v0 to v2's folder-per-node structure with manifests and auto-discovery.

**Architecture:** Each node is a folder in `frontend/src/nodes/{kebab-name}/` with `node.manifest.ts` + `{PascalName}Node.tsx` + optional CSS module. Auto-discovered via `import.meta.glob` in `nodes/index.ts`. Zero other files modified per node.

**Source codebase (v0):** `C:\Users\upper\Uppercat Dropbox\Antonio Cottone\00_aycb\aycb\frontend\src\components\nodes\`
**Target project (v2):** `C:\Users\upper\Documents\00_aycb_v2\frontend\src\nodes\`

**CRITICAL RULE:** Copy v0 code verbatim first, fix imports, verify it works, then split if >300 lines. Never rewrite logic during porting.

**All helpers already exist in v2:** NodeShell, ExpandableText, CopyButton, cascadeRun, useFileDrop, useCropOverlay, useSplitOverlay, MediaPreview, useMediaPreview, costEstimate, nodeErrors, jsonColorize, edgeStyles.

---

## Import Path Reference

When moving a node from `components/nodes/X.tsx` to `nodes/{kebab-name}/X.tsx`, these import paths change:

| v0 import | v2 import |
|---|---|
| `../NodeShell` | `../_shared/NodeShell` |
| `./ExpandableText` | `../_shared/ExpandableText` |
| `./Node.module.css` | `../_shared/Node.module.css` |
| `../../api` | `../../api` |
| `../../stores/canvasStore` | `../../stores/canvasStore` |
| `../../hooks/useDataPropagation` | `../../hooks/useDataPropagation` |
| `../../hooks/useFileDrop` | `../../hooks/useFileDrop` |
| `../../hooks/useCropOverlay` | `../../hooks/useCropOverlay` |
| `../../hooks/useSplitOverlay` | `../../hooks/useSplitOverlay` |
| `../../utils/costEstimate` | `../../utils/costEstimate` |
| `../../utils/nodeErrors` | `../../utils/nodeErrors` |
| `../../utils/jsonColorize` | `../../utils/jsonColorize` |
| `../../utils/cascadeRun` | `../../utils/cascadeRun` |
| `../../mediaStore` | `../../mediaStore` |
| `../../components/SettingsContext` | `../../components/SettingsContext` |
| `../../components/media/MediaPreview` | `../../components/media/MediaPreview` |
| `../ui/CopyButton` | `../../components/ui/CopyButton` |

**Every node must add `export default` (or `export default memo(...)`) at the bottom.**

---

## Batch A — Simple Nodes (< 170 lines, no split needed)

### Task 1: Port SwitchNode (61 lines)

**Files:**
- Create: `frontend/src/nodes/switch/node.manifest.ts`
- Copy: `frontend/src/nodes/switch/SwitchNode.tsx`
- Create: `frontend/src/nodes/switch/switch.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'switch',
  label: 'Switch',
  icon: '⇄',
  category: 'utility',
  description: 'Select one of multiple inputs to pass through',
  defaultData: { selectedIndex: 0 },
  inputs: [{ type: 'media', handleId: 'media-in' }],
  outputs: [{ type: 'media', handleId: 'media-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/switch"
mkdir -p "$V2"
cp "$V0/SwitchNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`. Add `export default SwitchNode` at the bottom.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('SwitchNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('switch')
    expect(manifest.category).toBe('utility')
  })
})
```

- [ ] **Step 5: Run test**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend
npx vitest run src/nodes/switch/switch.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
git add frontend/src/nodes/switch/ && git commit -m "[node] Port Switch from v0"
```

---

### Task 2: Port ResultViewerNode (63 lines)

**Files:**
- Create: `frontend/src/nodes/result-viewer/node.manifest.ts`
- Copy: `frontend/src/nodes/result-viewer/ResultViewerNode.tsx`
- Create: `frontend/src/nodes/result-viewer/result-viewer.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'resultViewer',
  label: 'Result Viewer',
  icon: '📄',
  category: 'utility',
  description: 'Display text and JSON output from connected nodes',
  defaultData: {},
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/result-viewer"
mkdir -p "$V2"
cp "$V0/ResultViewerNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./ExpandableText` → `../_shared/ExpandableText`, `./Node.module.css` → `../_shared/Node.module.css`, `../ui/CopyButton` → `../../components/ui/CopyButton`. Add `export default ResultViewerNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ResultViewerNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('resultViewer')
    expect(manifest.category).toBe('utility')
    expect(manifest.inputs.length).toBe(1)
    expect(manifest.outputs.length).toBe(0)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/result-viewer/result-viewer.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/result-viewer/ && git commit -m "[node] Port ResultViewer from v0"
```

---

### Task 3: Port ConsoleNode (35 lines)

**Files:**
- Create: `frontend/src/nodes/console/node.manifest.ts`
- Copy: `frontend/src/nodes/console/ConsoleNode.tsx`
- Create: `frontend/src/nodes/console/console.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'console',
  label: 'Console',
  icon: '📋',
  category: 'utility',
  description: 'Display server logs in real time',
  defaultData: {},
  inputs: [],
  outputs: [],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/console"
mkdir -p "$V2"
cp "$V0/ConsoleNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`, `../../api` → `../../api`. Add `export default ConsoleNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ConsoleNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('console')
    expect(manifest.inputs.length).toBe(0)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/console/console.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/console/ && git commit -m "[node] Port Console from v0"
```

---

### Task 4: Port ComparisonNode (96 lines)

**Files:**
- Create: `frontend/src/nodes/comparison/node.manifest.ts`
- Copy: `frontend/src/nodes/comparison/ComparisonNode.tsx`
- Create: `frontend/src/nodes/comparison/comparison.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'comparison',
  label: 'Comparison',
  icon: '⚖',
  category: 'llm',
  description: 'Compare two images using LLM vision analysis',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/comparison"
mkdir -p "$V2"
cp "$V0/ComparisonNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./ExpandableText` → `../_shared/ExpandableText`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports for api, stores, hooks, utils. Add `export default ComparisonNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ComparisonNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('comparison')
    expect(manifest.category).toBe('llm')
    expect(manifest.inputs.length).toBe(2)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/comparison/comparison.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/comparison/ && git commit -m "[node] Port Comparison from v0"
```

---

### Task 5: Port ImageCompareNode (128 lines)

**Files:**
- Create: `frontend/src/nodes/image-compare/node.manifest.ts`
- Copy: `frontend/src/nodes/image-compare/ImageCompareNode.tsx`
- Create: `frontend/src/nodes/image-compare/image-compare.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageCompare',
  label: 'Image Compare',
  icon: '🔍',
  category: 'utility',
  description: 'Interactive slider to compare two images side-by-side',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
  ],
  outputs: [],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/image-compare"
mkdir -p "$V2"
cp "$V0/ImageCompareNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`. Add `export default ImageCompareNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ImageCompareNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('imageCompare')
    expect(manifest.inputs.length).toBe(2)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/image-compare/image-compare.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/image-compare/ && git commit -m "[node] Port ImageCompare from v0"
```

---

### Task 6: Port ImageAnalysisNode (134 lines)

**Files:**
- Create: `frontend/src/nodes/image-analysis/node.manifest.ts`
- Copy: `frontend/src/nodes/image-analysis/ImageAnalysisNode.tsx`
- Create: `frontend/src/nodes/image-analysis/image-analysis.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageAnalysis',
  label: 'Image Analysis',
  icon: '🔬',
  category: 'llm',
  description: 'Analyze images with LLM vision — returns text and JSON',
  defaultData: { prompt: '' },
  inputs: [
    { type: 'image', handleId: 'image-in' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/image-analysis"
mkdir -p "$V2"
cp "$V0/ImageAnalysisNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./ExpandableText` → `../_shared/ExpandableText`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports. Add `export default ImageAnalysisNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ImageAnalysisNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('imageAnalysis')
    expect(manifest.category).toBe('llm')
    expect(manifest.inputs.length).toBe(2)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/image-analysis/image-analysis.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/image-analysis/ && git commit -m "[node] Port ImageAnalysis from v0"
```

---

### Task 7: Port TextCombineNode (162 lines)

**Files:**
- Create: `frontend/src/nodes/text-combine/node.manifest.ts`
- Copy: `frontend/src/nodes/text-combine/TextCombineNode.tsx`
- Create: `frontend/src/nodes/text-combine/text-combine.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'textCombine',
  label: 'Text Combine',
  icon: '📎',
  category: 'utility',
  description: 'Combine multiple text inputs with configurable separator',
  defaultData: { separator: '\\n' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/text-combine"
mkdir -p "$V2"
cp "$V0/TextCombineNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./ExpandableText` → `../_shared/ExpandableText`, `./Node.module.css` → `../_shared/Node.module.css`. Fix `../../utils/cascadeRun`, `../../utils/jsonColorize`. Add `export default TextCombineNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('TextCombineNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('textCombine')
    expect(manifest.category).toBe('utility')
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/text-combine/text-combine.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/text-combine/ && git commit -m "[node] Port TextCombine from v0"
```

---

### Task 8: Port MetapromptNode (163 lines)

**Files:**
- Create: `frontend/src/nodes/metaprompt/node.manifest.ts`
- Copy: `frontend/src/nodes/metaprompt/MetapromptNode.tsx`
- Create: `frontend/src/nodes/metaprompt/metaprompt.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'metaprompt',
  label: 'Metaprompt',
  icon: '🎨',
  category: 'llm',
  description: 'Compare original + overpainted images to generate art direction prompts',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/metaprompt"
mkdir -p "$V2"
cp "$V0/MetapromptNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./ExpandableText` → `../_shared/ExpandableText`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports. Add `export default MetapromptNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('MetapromptNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('metaprompt')
    expect(manifest.category).toBe('llm')
    expect(manifest.inputs.length).toBe(3)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/metaprompt/metaprompt.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/metaprompt/ && git commit -m "[node] Port Metaprompt from v0"
```

---

### Task 9: Port ImageFxNode (176 lines)

**Files:**
- Create: `frontend/src/nodes/image-fx/node.manifest.ts`
- Copy: `frontend/src/nodes/image-fx/ImageFxNode.tsx`
- Create: `frontend/src/nodes/image-fx/image-fx.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageFx',
  label: 'Image FX',
  icon: '🎛',
  category: 'utility',
  description: 'Apply image effects — Canny edge detection, depth estimation',
  defaultData: { mode: 'off' },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/image-fx"
mkdir -p "$V2"
cp "$V0/ImageFxNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports. Add `export default ImageFxNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('ImageFxNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('imageFx')
    expect(manifest.category).toBe('utility')
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/image-fx/image-fx.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/image-fx/ && git commit -m "[node] Port ImageFx from v0"
```

---

## Batch B — Medium Nodes (170-300 lines, no split needed)

### Task 10: Port GroupNode (217 lines)

**Files:**
- Create: `frontend/src/nodes/group/node.manifest.ts`
- Copy: `frontend/src/nodes/group/GroupNode.tsx`
- Create: `frontend/src/nodes/group/group.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'group',
  label: 'Group',
  icon: '▢',
  category: 'utility',
  description: 'Container for organizing nodes — collapsible with custom colors',
  defaultData: { label: 'Group', color: '#333', collapsed: false },
  inputs: [],
  outputs: [],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/group"
mkdir -p "$V2"
cp "$V0/GroupNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports and add default export**

This node does NOT use NodeShell — it renders its own wrapper with `NodeResizer`, `Handle`, `Position` from `@xyflow/react`. Fix `../../stores/canvasStore` → `../../stores/canvasStore`. Add `export default GroupNode`.

- [ ] **Step 4: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('GroupNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('group')
    expect(manifest.category).toBe('utility')
    expect(manifest.inputs.length).toBe(0)
    expect(manifest.outputs.length).toBe(0)
  })
})
```

- [ ] **Step 5: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/group/group.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/group/ && git commit -m "[node] Port Group from v0"
```

---

## Batch C — Large Nodes (>300 lines, need split)

### Task 11: Port VideoAnalysisNode (355 lines → split)

**Files:**
- Create: `frontend/src/nodes/video-analysis/node.manifest.ts`
- Copy: `frontend/src/nodes/video-analysis/VideoAnalysisNode.tsx`
- Copy: `frontend/src/nodes/video-analysis/VideoAnalysisNode.module.css`
- Create: `frontend/src/nodes/video-analysis/useVideoAnalysis.ts`
- Create: `frontend/src/nodes/video-analysis/video-analysis.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'videoAnalysis',
  label: 'Video Analysis',
  icon: '🎬',
  category: 'llm',
  description: 'Analyze video by extracting key frames — sharpness or scene cut detection',
  defaultData: { mode: 'sharp', maxFrames: 3 },
  inputs: [
    { type: 'video', handleId: 'video-in' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component and CSS from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/video-analysis"
mkdir -p "$V2"
cp "$V0/VideoAnalysisNode.tsx" "$V2/"
cp "$V0/VideoAnalysisNode.module.css" "$V2/"
```

- [ ] **Step 3: Fix imports**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports. Keep `./VideoAnalysisNode.module.css` as-is (same folder).

- [ ] **Step 4: Split — extract useVideoAnalysis hook**

Read the component. Move all state variables and functions related to analysis execution (API calls, frame extraction config, result handling, cost tracking) into `useVideoAnalysis.ts`. The component keeps only JSX and event handlers that call the hook.

Target: component < 200 lines, hook < 200 lines.

- [ ] **Step 5: Add default export**

Add `export default VideoAnalysisNode` at the bottom of the component.

- [ ] **Step 6: Write test**

```typescript
import { describe, it, expect } from 'vitest'

describe('VideoAnalysisNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('videoAnalysis')
    expect(manifest.category).toBe('llm')
  })
})
```

- [ ] **Step 7: Run test and commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/video-analysis/video-analysis.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/video-analysis/ && git commit -m "[node] Port VideoAnalysis from v0 — split into component + hook"
```

---

### Task 12: Port VideoUploadNode (359 lines → split)

**Files:**
- Create: `frontend/src/nodes/video-upload/node.manifest.ts`
- Copy: `frontend/src/nodes/video-upload/VideoUploadNode.tsx`
- Create: `frontend/src/nodes/video-upload/useVideoUpload.ts`
- Create: `frontend/src/nodes/video-upload/video-upload.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'videoUpload',
  label: 'Video Upload',
  icon: '🎥',
  category: 'input',
  description: 'Upload video with player, timeline scrubbing, and frame capture',
  defaultData: {},
  inputs: [],
  outputs: [{ type: 'video', handleId: 'video-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/video-upload"
mkdir -p "$V2"
cp "$V0/VideoUploadNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports**

Update `../NodeShell` → `../_shared/NodeShell`, `./Node.module.css` → `../_shared/Node.module.css`. Fix all `../../` imports for mediaStore, hooks, utils.

- [ ] **Step 4: Split — extract useVideoUpload hook**

Move file handling, video player state, frame capture logic, timeline scrubbing into `useVideoUpload.ts`. Component keeps JSX.

Target: component < 200 lines, hook < 200 lines.

- [ ] **Step 5: Add default export, write test, run, commit**

Same pattern. `export default VideoUploadNode`.

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/video-upload/video-upload.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/video-upload/ && git commit -m "[node] Port VideoUpload from v0 — split into component + hook"
```

---

### Task 13: Port JsonParserBlendNode (390 lines → split)

**Files:**
- Create: `frontend/src/nodes/json-parser-blend/node.manifest.ts`
- Copy: `frontend/src/nodes/json-parser-blend/JsonParserBlendNode.tsx`
- Create: `frontend/src/nodes/json-parser-blend/useJsonBlend.ts`
- Create: `frontend/src/nodes/json-parser-blend/json-parser-blend.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'jsonParserBlend',
  label: 'JSON Blend',
  icon: '🔀',
  category: 'utility',
  description: 'Blend multiple JSON objects with key selection and override',
  defaultData: { mode: 'json' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy, fix imports, split, test, commit**

Same pattern as Task 11-12. Split blend logic into `useJsonBlend.ts`.

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/json-parser-blend"
mkdir -p "$V2"
cp "$V0/JsonParserBlendNode.tsx" "$V2/"
```

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/json-parser-blend/json-parser-blend.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/json-parser-blend/ && git commit -m "[node] Port JsonParserBlend from v0 — split into component + hook"
```

---

### Task 14: Port GenerateVideoNode (405 lines → split)

**Files:**
- Create: `frontend/src/nodes/generate-video/node.manifest.ts`
- Copy: `frontend/src/nodes/generate-video/GenerateVideoNode.tsx`
- Copy: `frontend/src/nodes/generate-video/GenerateVideoNode.module.css`
- Create: `frontend/src/nodes/generate-video/useGenerateVideo.ts`
- Create: `frontend/src/nodes/generate-video/generate-video.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateVideo',
  label: 'Generate Video',
  icon: '🎞',
  category: 'media-model',
  description: 'Generate video from text or image — Seedance, Kling',
  defaultData: { selectedModel: 'seedance-1.0-lite' },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'image', handleId: 'image-in' },
  ],
  outputs: [{ type: 'video', handleId: 'video-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component and CSS from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/generate-video"
mkdir -p "$V2"
cp "$V0/GenerateVideoNode.tsx" "$V2/"
cp "$V0/GenerateVideoNode.module.css" "$V2/"
```

- [ ] **Step 3: Fix imports, split into component + useGenerateVideo hook**

Move model list, polling logic, generation state into hook. Component keeps JSX + dropdowns.

Target: component < 250 lines, hook < 200 lines.

- [ ] **Step 4: Add default export, write test, run, commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/generate-video/generate-video.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/generate-video/ && git commit -m "[node] Port GenerateVideo from v0 — split into component + hook"
```

---

### Task 15: Port ImageMergeNode (420 lines → split)

**Files:**
- Create: `frontend/src/nodes/image-merge/node.manifest.ts`
- Copy: `frontend/src/nodes/image-merge/ImageMergeNode.tsx`
- Copy: `frontend/src/nodes/image-merge/ImageMergeNode.module.css`
- Create: `frontend/src/nodes/image-merge/useImageMerge.ts`
- Create: `frontend/src/nodes/image-merge/image-merge.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageMerge',
  label: 'Image Merge',
  icon: '🧩',
  category: 'utility',
  description: 'Merge images into collage — grid, horizontal, or vertical layout',
  defaultData: { layout: 'grid', gap: 4, background: '#000000' },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component and CSS from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/image-merge"
mkdir -p "$V2"
cp "$V0/ImageMergeNode.tsx" "$V2/"
cp "$V0/ImageMergeNode.module.css" "$V2/"
```

- [ ] **Step 3: Fix imports, split into component + useImageMerge hook**

Move canvas rendering logic, layout calculation, merge execution into hook. Component keeps JSX + layout options UI.

- [ ] **Step 4: Add default export, write test, run, commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/image-merge/image-merge.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/image-merge/ && git commit -m "[node] Port ImageMerge from v0 — split into component + hook"
```

---

### Task 16: Port ImageUploadNode (468 lines → split)

**Files:**
- Create: `frontend/src/nodes/image-upload/node.manifest.ts`
- Copy: `frontend/src/nodes/image-upload/ImageUploadNode.tsx`
- Create: `frontend/src/nodes/image-upload/useImageUpload.ts`
- Create: `frontend/src/nodes/image-upload/image-upload.test.ts`

- [ ] **Step 1: Create manifest**

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageUpload',
  label: 'Image Upload',
  icon: '📷',
  category: 'input',
  description: 'Upload images with crop overlay, split grid, and frame capture',
  defaultData: {},
  inputs: [],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}
export default manifest
```

- [ ] **Step 2: Copy component from v0**

```bash
V0="C:/Users/upper/Uppercat Dropbox/Antonio Cottone/00_aycb/aycb/frontend/src/components/nodes"
V2="C:/Users/upper/Documents/00_aycb_v2/frontend/src/nodes/image-upload"
mkdir -p "$V2"
cp "$V0/ImageUploadNode.tsx" "$V2/"
```

- [ ] **Step 3: Fix imports, split into component + useImageUpload hook**

Move file handling, crop state management, split grid state into hook. Component keeps JSX + overlays. This node uses `useFileDrop`, `useCropOverlay`, `useSplitOverlay` — those stay as imports.

Target: component < 250 lines, hook < 250 lines.

- [ ] **Step 4: Add default export, write test, run, commit**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend && npx vitest run src/nodes/image-upload/image-upload.test.ts
cd /c/Users/upper/Documents/00_aycb_v2 && git add frontend/src/nodes/image-upload/ && git commit -m "[node] Port ImageUpload from v0 — split into component + hook"
```

---

## Task 17: Full Integration Verification

**Files:** No new files. Verification only.

- [ ] **Step 1: Run all tests**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend
npx vitest run
```

Expected: All 20 node manifest tests pass + existing tests pass.

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Users/upper/Documents/00_aycb_v2/frontend
npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 3: Verify node catalog**

Start servers, open http://localhost:5100. Node catalog (Tab key) should show 20 nodes across 4 categories:

- **Input:** Text Input, Image Upload, Video Upload
- **Media Models:** Generate Image, Generate Video
- **LLM:** LLM, Image Analysis, Video Analysis, Comparison, Metaprompt
- **Utility:** JSON Parser, JSON Blend, Batch, Switch, Text Combine, Result Viewer, Image Compare, Image FX, Image Merge, Console, Group

- [ ] **Step 4: Commit gate**

```bash
cd /c/Users/upper/Documents/00_aycb_v2
git add -A && git commit -m "[gate] Phase 2 complete — all 20 nodes ported"
```

---

## Summary

| Batch | Nodes | Lines each | Split? | Tasks |
|-------|-------|-----------|--------|-------|
| A — Simple | Switch, ResultViewer, Console, Comparison, ImageCompare, ImageAnalysis, TextCombine, Metaprompt, ImageFx | 35-176 | No | 1-9 |
| B — Medium | Group | 217 | No | 10 |
| C — Large | VideoAnalysis, VideoUpload, JsonParserBlend, GenerateVideo, ImageMerge, ImageUpload | 355-468 | Yes (hook extraction) | 11-16 |
| Verify | — | — | — | 17 |

Total: 15 nodes + 1 verification = 16 tasks, 20 nodes total after Phase 2.
