/**
 * Editor panes form a split tree, like terminal panes: splitting halves the focused pane,
 * closing one gives its space back to the pane or group beside it, and the divider between
 * two siblings drags to change how their group's space is shared.
 */
export type PaneLayout =
  | { pane: string }
  | {
      split: 'row' | 'column';
      children: PaneLayout[];
      /** Each child's share of the group, summing to 1; equal shares when absent. */
      sizes?: number[];
    };
export type PaneRect = { id: string; x: number; y: number; width: number; height: number };
export type PaneDivider = {
  /** Child indexes from the root to the split that owns this divider. */
  path: number[];
  /** The divider sits after this child. */
  index: number;
  /** A row split's dividers are vertical lines; a column split's are horizontal. */
  orientation: 'vertical' | 'horizontal';
  x: number;
  y: number;
  width: number;
  height: number;
  /** The owning group's length along the drag axis, as a fraction of the pane area. */
  groupLength: number;
};
/** No child shrinks below this share of its group. */
export const minimumPaneShare = 0.15;

export function paneIds(layout: PaneLayout): string[] {
  return 'pane' in layout ? [layout.pane] : layout.children.flatMap(paneIds);
}

const shares = (layout: Extract<PaneLayout, { split: string }>) =>
  layout.sizes?.length === layout.children.length
    ? layout.sizes
    : layout.children.map(() => 1 / layout.children.length);

/** Replaces `id` with a split holding it and the new pane after it. */
export function splitPane(
  layout: PaneLayout,
  id: string,
  direction: 'row' | 'column',
  newId: string,
): PaneLayout {
  if ('pane' in layout)
    return layout.pane === id ? { split: direction, children: [layout, { pane: newId }] } : layout;
  return { ...layout, children: layout.children.map((c) => splitPane(c, id, direction, newId)) };
}

/**
 * Removes `id`. The pane that takes over its space receives focus: the next sibling's first
 * pane, or the previous sibling's last pane when it was the last in its group.
 */
export function closePane(
  layout: PaneLayout,
  id: string,
): { layout: PaneLayout; focus: string } | null {
  if ('pane' in layout) return null;
  const index = layout.children.findIndex((c) => 'pane' in c && c.pane === id);
  if (index >= 0) {
    const children = layout.children.filter((_, i) => i !== index);
    const neighbor = children[Math.min(index, children.length - 1)];
    const ids = paneIds(neighbor);
    // The closed pane's share goes to the sibling that takes its place.
    const old = shares(layout);
    const sizes = old.filter((_, i) => i !== index);
    sizes[Math.min(index, sizes.length - 1)] += old[index];
    return {
      layout: children.length === 1 ? children[0] : { ...layout, children, sizes },
      focus: index < children.length ? ids[0] : ids[ids.length - 1],
    };
  }
  for (const [i, child] of layout.children.entries()) {
    const result = closePane(child, id);
    if (result) {
      const children = layout.children.map((c, j) => (j === i ? result.layout : c));
      return { layout: { ...layout, children }, focus: result.focus };
    }
  }
  return null;
}

/** Each pane's box as fractions of the pane area. */
export function paneRects(
  layout: PaneLayout,
  box: Omit<PaneRect, 'id'> = { x: 0, y: 0, width: 1, height: 1 },
): PaneRect[] {
  if ('pane' in layout) return [{ id: layout.pane, ...box }];
  const sizes = shares(layout);
  let offset = 0;
  return layout.children.flatMap((child, i) => {
    const start = offset;
    offset += sizes[i];
    return paneRects(
      child,
      layout.split === 'row'
        ? { ...box, x: box.x + box.width * start, width: box.width * sizes[i] }
        : { ...box, y: box.y + box.height * start, height: box.height * sizes[i] },
    );
  });
}

/** The drag handles between siblings, as fractions of the pane area. */
export function paneDividers(
  layout: PaneLayout,
  box: Omit<PaneRect, 'id'> = { x: 0, y: 0, width: 1, height: 1 },
  path: number[] = [],
): PaneDivider[] {
  if ('pane' in layout) return [];
  const sizes = shares(layout);
  const result: PaneDivider[] = [];
  let offset = 0;
  layout.children.forEach((child, i) => {
    const start = offset;
    offset += sizes[i];
    const childBox =
      layout.split === 'row'
        ? { ...box, x: box.x + box.width * start, width: box.width * sizes[i] }
        : { ...box, y: box.y + box.height * start, height: box.height * sizes[i] };
    result.push(...paneDividers(child, childBox, [...path, i]));
    if (i < layout.children.length - 1)
      result.push(
        layout.split === 'row'
          ? {
              path,
              index: i,
              orientation: 'vertical',
              x: box.x + box.width * offset,
              y: box.y,
              width: 0,
              height: box.height,
              groupLength: box.width,
            }
          : {
              path,
              index: i,
              orientation: 'horizontal',
              x: box.x,
              y: box.y + box.height * offset,
              width: box.width,
              height: 0,
              groupLength: box.height,
            },
      );
  });
  return result;
}

/**
 * Moves the divider after child `index` of the split at `path` by `delta`, a fraction of
 * that group's own length. Only the two neighbours change, and neither drops below the
 * minimum share.
 */
export function resizeSplit(
  layout: PaneLayout,
  path: number[],
  index: number,
  delta: number,
): PaneLayout {
  if ('pane' in layout) return layout;
  if (path.length)
    return {
      ...layout,
      children: layout.children.map((child, i) =>
        i === path[0] ? resizeSplit(child, path.slice(1), index, delta) : child,
      ),
    };
  const sizes = [...shares(layout)];
  if (index < 0 || index >= sizes.length - 1) return layout;
  const pair = sizes[index] + sizes[index + 1];
  const first = Math.min(Math.max(sizes[index] + delta, minimumPaneShare), pair - minimumPaneShare);
  if (first === sizes[index]) return layout;
  sizes[index] = first;
  sizes[index + 1] = pair - first;
  return { ...layout, sizes };
}
