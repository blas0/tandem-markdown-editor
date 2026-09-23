import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import {
  editorLock,
  internalEditorChange,
  setEditorReadOnly,
} from '../packages/editor/editor-lock';

it('blocks user changes synchronously while allowing review application and later editing', () => {
  let state = EditorState.create({ doc: 'Original', extensions: [editorLock] });
  state = state.update({ effects: setEditorReadOnly.of(true) }).state;
  state = state.update({ changes: { from: 0, insert: 'Typed' }, userEvent: 'input' }).state;
  expect(state.doc.toString()).toBe('Original');
  state = state.update({
    changes: { from: 0, to: 8, insert: 'Accepted' },
    annotations: internalEditorChange.of(true),
  }).state;
  expect(state.doc.toString()).toBe('Accepted');
  state = state.update({ effects: setEditorReadOnly.of(false) }).state;
  state = state.update({ changes: { from: 8, insert: ' next' } }).state;
  expect(state.doc.toString()).toBe('Accepted next');
});
