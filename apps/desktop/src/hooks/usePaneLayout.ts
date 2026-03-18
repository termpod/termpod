import { useCallback, useSyncExternalStore } from 'react';

export type PaneNode =
  | { type: 'leaf'; sessionId: string }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      children: [PaneNode, PaneNode];
    };

interface PaneLayoutStore {
  trees: Map<string, PaneNode>;
  focusedPaneId: string | null;
  listeners: Set<() => void>;
}

const store: PaneLayoutStore = {
  trees: new Map(),
  focusedPaneId: null,
  listeners: new Set(),
};

// Cached snapshot — must be referentially stable for useSyncExternalStore
let cachedSnapshot = { trees: store.trees, focusedPaneId: store.focusedPaneId };

function notify() {
  cachedSnapshot = { trees: store.trees, focusedPaneId: store.focusedPaneId };
  for (const l of store.listeners) l();
}

function getSnapshot() {
  return cachedSnapshot;
}

function subscribe(cb: () => void) {
  store.listeners.add(cb);
  return () => store.listeners.delete(cb);
}

function findLeafParent(
  node: PaneNode,
  sessionId: string,
  parent: { node: PaneNode & { type: 'split' }; childIndex: 0 | 1 } | null = null,
): {
  node: PaneNode;
  parent: { node: PaneNode & { type: 'split' }; childIndex: 0 | 1 } | null;
} | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? { node, parent } : null;
  }
  const left = findLeafParent(node.children[0], sessionId, { node, childIndex: 0 });
  if (left) return left;
  return findLeafParent(node.children[1], sessionId, { node, childIndex: 1 });
}

function collectLeafIds(node: PaneNode, out: string[] = []): string[] {
  if (node.type === 'leaf') {
    out.push(node.sessionId);
  } else {
    collectLeafIds(node.children[0], out);
    collectLeafIds(node.children[1], out);
  }
  return out;
}

export function usePaneLayout() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const getTree = useCallback(
    (tabRootSessionId: string): PaneNode => {
      return state.trees.get(tabRootSessionId) ?? { type: 'leaf', sessionId: tabRootSessionId };
    },
    [state.trees],
  );

  const hasSplits = useCallback(
    (tabRootSessionId: string): boolean => {
      const tree = state.trees.get(tabRootSessionId);
      return tree != null && tree.type === 'split';
    },
    [state.trees],
  );

  const setFocusedPane = useCallback((sessionId: string) => {
    store.focusedPaneId = sessionId;
    notify();
  }, []);

  const splitPane = useCallback(
    (sessionId: string, direction: 'horizontal' | 'vertical', newSessionId: string) => {
      // Find which tab tree contains this sessionId
      let targetTabId: string | null = null;
      let currentTree: PaneNode | null = null;

      for (const [tabId, tree] of store.trees) {
        if (findLeafParent(tree, sessionId)) {
          targetTabId = tabId;
          currentTree = tree;
          break;
        }
      }

      // If not found in any tree, this must be a root-level single pane (no tree yet)
      if (!targetTabId) {
        targetTabId = sessionId;
        currentTree = { type: 'leaf', sessionId };
      }

      if (!currentTree) return;

      const newTree = replaceLeaf(currentTree, sessionId, {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'leaf', sessionId },
          { type: 'leaf', sessionId: newSessionId },
        ],
      });

      const next = new Map(store.trees);
      next.set(targetTabId, newTree);
      store.trees = next;
      store.focusedPaneId = newSessionId;
      notify();
    },
    [],
  );

  const closePane = useCallback(
    (sessionId: string): { removedFromTree: boolean; promotedSessionId?: string } => {
      let targetTabId: string | null = null;
      let currentTree: PaneNode | null = null;

      for (const [tabId, tree] of store.trees) {
        if (findLeafParent(tree, sessionId)) {
          targetTabId = tabId;
          currentTree = tree;
          break;
        }
      }

      if (!targetTabId || !currentTree) {
        // Not in any split tree — it's a standalone pane, not in our map
        return { removedFromTree: false };
      }

      const result = findLeafParent(currentTree, sessionId);
      if (!result) return { removedFromTree: false };

      if (!result.parent) {
        // This is the only pane in the tree — remove the tree entry
        const next = new Map(store.trees);
        next.delete(targetTabId);
        store.trees = next;
        store.focusedPaneId = null;
        notify();
        return { removedFromTree: true };
      }

      // Replace the split with its sibling
      const siblingIndex: 0 | 1 = result.parent.childIndex === 0 ? 1 : 0;
      const sibling = result.parent.node.children[siblingIndex];
      const promotedId = collectLeafIds(sibling)[0];

      const newTree = replaceNode(currentTree, result.parent.node, sibling);
      const next = new Map(store.trees);
      next.set(targetTabId, newTree);
      store.trees = next;
      store.focusedPaneId = promotedId ?? null;
      notify();

      return { removedFromTree: true, promotedSessionId: promotedId };
    },
    [],
  );

  const updateRatio = useCallback((splitNode: PaneNode, ratio: number) => {
    if (splitNode.type !== 'split') return;
    // Mutate in place during drag — no re-render needed until drag ends
    (splitNode as PaneNode & { type: 'split' }).ratio = Math.max(0.1, Math.min(0.9, ratio));
    notify();
  }, []);

  const removeTabTree = useCallback((tabRootSessionId: string) => {
    const next = new Map(store.trees);
    next.delete(tabRootSessionId);
    store.trees = next;
    notify();
  }, []);

  const getLeafIdsForTab = useCallback(
    (tabRootSessionId: string): string[] => {
      const tree = state.trees.get(tabRootSessionId);
      if (!tree) return [tabRootSessionId];
      return collectLeafIds(tree);
    },
    [state.trees],
  );

  return {
    getTree,
    focusedPaneId: state.focusedPaneId,
    setFocusedPane,
    splitPane,
    closePane,
    updateRatio,
    hasSplits,
    removeTabTree,
    getLeafIdsForTab,
  };
}

function replaceLeaf(node: PaneNode, targetSessionId: string, replacement: PaneNode): PaneNode {
  if (node.type === 'leaf') {
    return node.sessionId === targetSessionId ? replacement : node;
  }
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], targetSessionId, replacement),
      replaceLeaf(node.children[1], targetSessionId, replacement),
    ],
  };
}

function replaceNode(root: PaneNode, target: PaneNode, replacement: PaneNode): PaneNode {
  if (root === target) return replacement;
  if (root.type === 'leaf') return root;
  return {
    ...root,
    children: [
      replaceNode(root.children[0], target, replacement),
      replaceNode(root.children[1], target, replacement),
    ],
  };
}

/** Find the closest neighboring leaf in a given direction from the focused pane */
export function findNeighborPane(
  root: PaneNode,
  fromId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): string | null {
  const leaves = collectLeavesWithPositions(root);
  const from = leaves.find((l) => l.id === fromId);
  if (!from) return null;

  const isHorizontal = direction === 'left' || direction === 'right';
  const isForward = direction === 'right' || direction === 'down';

  const candidates = leaves.filter((l) => {
    if (l.id === fromId) return false;
    if (isHorizontal) {
      // Must overlap vertically
      const overlaps = l.top < from.bottom && l.bottom > from.top;
      return overlaps && (isForward ? l.left > from.left : l.left < from.left);
    } else {
      // Must overlap horizontally
      const overlaps = l.left < from.right && l.right > from.left;
      return overlaps && (isForward ? l.top > from.top : l.top < from.top);
    }
  });

  if (candidates.length === 0) return null;

  // Pick the closest one
  const sorted = candidates.sort((a, b) => {
    if (isHorizontal) {
      return isForward ? a.left - b.left : b.left - a.left;
    } else {
      return isForward ? a.top - b.top : b.top - a.top;
    }
  });

  return sorted[0].id;
}

interface LeafBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function collectLeavesWithPositions(
  node: PaneNode,
  x = 0,
  y = 0,
  w = 1,
  h = 1,
  out: LeafBounds[] = [],
): LeafBounds[] {
  if (node.type === 'leaf') {
    out.push({ id: node.sessionId, left: x, top: y, right: x + w, bottom: y + h });
    return out;
  }

  if (node.direction === 'horizontal') {
    const w1 = w * node.ratio;
    const w2 = w * (1 - node.ratio);
    collectLeavesWithPositions(node.children[0], x, y, w1, h, out);
    collectLeavesWithPositions(node.children[1], x + w1, y, w2, h, out);
  } else {
    const h1 = h * node.ratio;
    const h2 = h * (1 - node.ratio);
    collectLeavesWithPositions(node.children[0], x, y, w, h1, out);
    collectLeavesWithPositions(node.children[1], x, y + h1, w, h2, out);
  }

  return out;
}
