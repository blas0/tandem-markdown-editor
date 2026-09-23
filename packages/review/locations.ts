import type { Unit } from '../contracts';
export function reviewLocations(units: Unit[]) {
  const result = new Map<string, string>();
  let section = 'Document';
  const counts = new Map<string, number>();
  const labels: Record<Unit['kind'], string> = {
    sentence: 'Sentence',
    line: 'Line',
    'list-item': 'List item',
    'table-cell': 'Table cell',
    heading: 'Heading',
  };
  for (const unit of units) {
    if (unit.kind === 'heading') {
      section = unit.text.replace(/<[^>]*>/g, '').trim();
      counts.clear();
      result.set(unit.id, `${section} · Heading`);
      continue;
    }
    const number = (counts.get(unit.kind) ?? 0) + 1;
    counts.set(unit.kind, number);
    result.set(unit.id, `${section} · ${labels[unit.kind]} ${number}`);
  }
  return result;
}
