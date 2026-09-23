import { expect, it } from 'vitest';
import { findText } from '../packages/editor/find';

it('finds literal Markdown source text', () => {
  expect(findText('A [sample]. Another [sample].', '[sample]')).toEqual([
    { from: 2, to: 10 },
    { from: 20, to: 28 },
  ]);
  expect(findText('A **bold** sentence.', '**bold**')).toEqual([{ from: 2, to: 10 }]);
});
