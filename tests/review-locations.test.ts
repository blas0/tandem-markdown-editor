import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { unitsFor } from '../packages/document';
import { reviewLocations } from '../packages/review/locations';

it('locates review units under their source heading and numbers the correct unit kind', () => {
  const units = unitsFor({
    ...emptyContent(),
    mode: 'markdown',
    markdown:
      '# Setup\n\nFirst sentence. Second sentence.\n\n- One item\n\n## Results\n\nLast sentence.',
  });
  expect([...reviewLocations(units).values()]).toEqual([
    'Setup · Heading',
    'Setup · Sentence 1',
    'Setup · Sentence 2',
    'Setup · List item 1',
    'Results · Heading',
    'Results · Sentence 1',
  ]);
});
