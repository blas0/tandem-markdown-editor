import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Archive } from '../packages/ui/archive';

const noop = async () => {};

it('renders the archive with dialog-title typography and no item filter', () => {
  const html = renderToStaticMarkup(
    createElement(Archive, {
      documents: [],
      folders: [],
      cadences: [],
      onRestoreDocument: noop,
      onRestoreFolder: noop,
      onRestoreCadence: noop,
      onClear: noop,
    }),
  );

  expect(html).toContain('archive-title font-heading font-semibold text-xl leading-none');
  expect(html).toContain('Archive is empty');
  expect(html).not.toContain('Item type');
  expect(html).not.toContain('archive-filters');
});

it('labels the selected enabled model with the Coss info badge', () => {
  const source = readFileSync(new URL('../packages/ui/compositions.tsx', import.meta.url), 'utf8');

  expect(source).toContain('<Badge variant="info">Selected</Badge>');
  expect(source).toContain('provider === current.provider && model.id === current.model');
});

it('moves to Cadences without reopening the editor and gives theme icons the text tint', () => {
  const source = readFileSync(new URL('../apps/desktop/main.tsx', import.meta.url), 'utf8');
  const action = source.slice(
    source.indexOf("label: d.linkedPath ? 'Copy to Cadences' : 'Move to Cadences'"),
    source.indexOf("label: d.linkedPath ? 'Disconnect symlink' : 'Move to archive'"),
  );
  const toCadence = source.slice(
    source.indexOf('const moveToCadence = '),
    source.indexOf('const focusPane = '),
  );

  expect(action).toContain('moveToCadence(d)');
  expect(toCadence).toContain("await rpc<Cadence>('documents.toCadence', { id: d.id })");
  // The moved document keeps its editor; openCadence would navigate away from it.
  expect(toCadence).not.toContain('openCadence');
  expect(source.match(/className="\[&_svg\]:opacity-100"/g)).toHaveLength(2);
});
