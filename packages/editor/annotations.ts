import type { Content } from '../contracts';
import { unitsFor } from '../document';

export function selectionUnitIds(content: Content, from: number, to: number): string[] {
  if (from >= to) return [];
  return unitsFor(content)
    .filter((unit) => unit.to > from && unit.from < to)
    .map((unit) => unit.id);
}
