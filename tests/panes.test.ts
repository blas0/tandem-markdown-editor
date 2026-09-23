import { expect, it } from 'vitest';
import {
  closePane,
  minimumPaneShare,
  type PaneLayout,
  paneDividers,
  paneIds,
  paneRects,
  resizeSplit,
  splitPane,
} from '../apps/desktop/panes';

it('splits the focused pane in half, to the right or below', () => {
  const right = splitPane({ pane: 'a' }, 'a', 'row', 'b');
  expect(right).toEqual({ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }] });
  const down = splitPane(right, 'b', 'column', 'c');
  expect(paneIds(down)).toEqual(['a', 'b', 'c']);
  expect(paneRects(down)).toEqual([
    { id: 'a', x: 0, y: 0, width: 0.5, height: 1 },
    { id: 'b', x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { id: 'c', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]);
});

it('gives a closed pane space to its neighbor and focuses it', () => {
  const layout: PaneLayout = {
    split: 'row',
    children: [{ pane: 'a' }, { split: 'column', children: [{ pane: 'b' }, { pane: 'c' }] }],
  };
  expect(closePane(layout, 'c')).toEqual({
    layout: { split: 'row', children: [{ pane: 'a' }, { pane: 'b' }] },
    focus: 'b',
  });
  expect(closePane(layout, 'a')).toEqual({
    layout: { split: 'column', children: [{ pane: 'b' }, { pane: 'c' }] },
    focus: 'b',
  });
  expect(closePane({ pane: 'a' }, 'a')).toBeNull();
  // A three-way group keeps its remaining shares, and the closed share joins its neighbour.
  const three: PaneLayout = {
    split: 'row',
    children: [{ pane: 'a' }, { pane: 'b' }, { pane: 'c' }],
    sizes: [0.5, 0.3, 0.2],
  };
  expect(closePane(three, 'a')?.layout).toEqual({
    split: 'row',
    children: [{ pane: 'b' }, { pane: 'c' }],
    sizes: [0.8, 0.2],
  });
  expect(closePane(three, 'c')?.layout).toEqual({
    split: 'row',
    children: [{ pane: 'a' }, { pane: 'b' }],
    sizes: [0.5, 0.5],
  });
});

it('places a divider between siblings and drags it within the minimum shares', () => {
  const layout = splitPane(splitPane({ pane: 'a' }, 'a', 'row', 'b'), 'b', 'column', 'c');
  expect(paneDividers(layout)).toEqual([
    {
      path: [],
      index: 0,
      orientation: 'vertical',
      x: 0.5,
      y: 0,
      width: 0,
      height: 1,
      groupLength: 1,
    },
    {
      path: [1],
      index: 0,
      orientation: 'horizontal',
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0,
      groupLength: 1,
    },
  ]);
  const round = (value: number) => Number(value.toFixed(6));
  const wider = resizeSplit(layout, [], 0, 0.2);
  expect(paneRects(wider).map((rect) => [rect.id, round(rect.x), round(rect.width)])).toEqual([
    ['a', 0, 0.7],
    ['b', 0.7, 0.3],
    ['c', 0.7, 0.3],
  ]);
  // The nested divider moves only its own group, and the drag stops at the minimum share.
  const taller = resizeSplit(wider, [1], 0, 0.9);
  expect(paneRects(taller).map((rect) => [rect.id, round(rect.y), round(rect.height)])).toEqual([
    ['a', 0, 1],
    ['b', 0, 1 - minimumPaneShare],
    ['c', 1 - minimumPaneShare, minimumPaneShare],
  ]);
  const nested = paneDividers(taller)[1];
  expect([nested.y, nested.x, nested.width].map(round)).toEqual([1 - minimumPaneShare, 0.7, 0.3]);
  expect(resizeSplit(layout, [], 5, 0.1)).toBe(layout);
  expect(resizeSplit(layout, [], 0, 0)).toBe(layout);
});
