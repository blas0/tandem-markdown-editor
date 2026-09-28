import { Compartment, EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import {
  documentReadOnly,
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

it('keeps recovered source locked after review unlocks, while allowing selection and view changes', () => {
  const presentation = new Compartment();
  let state = EditorState.create({
    doc: 'Recovered **source**',
    extensions: [editorLock, documentReadOnly.of(true), presentation.of([])],
  });
  expect(state.readOnly).toBe(true);
  state = state.update({ effects: setEditorReadOnly.of(true) }).state;
  state = state.update({ effects: setEditorReadOnly.of(false) }).state;
  expect(state.readOnly).toBe(true);
  state = state.update({ changes: { from: 0, insert: 'Typed' }, userEvent: 'input' }).state;
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: 'Accepted' },
    annotations: internalEditorChange.of(true),
  }).state;
  expect(state.doc.toString()).toBe('Recovered **source**');
  state = state.update({
    selection: { anchor: 0, head: 9 },
    effects: presentation.reconfigure([]),
  }).state;
  expect(state.selection.main.from).toBe(0);
  expect(state.selection.main.to).toBe(9);
  expect(state.doc.toString()).toBe('Recovered **source**');
});

it('updates the document lock without releasing an active review lock', () => {
  const documentLock = new Compartment();
  let state = EditorState.create({
    doc: 'Original',
    extensions: [editorLock, documentLock.of(documentReadOnly.of(false))],
  });
  state = state.update({ effects: documentLock.reconfigure(documentReadOnly.of(true)) }).state;
  expect(state.readOnly).toBe(true);
  state = state.update({ effects: setEditorReadOnly.of(true) }).state;
  state = state.update({ effects: documentLock.reconfigure(documentReadOnly.of(false)) }).state;
  expect(state.readOnly).toBe(true);
  state = state.update({ changes: { from: 0, insert: 'Typed' } }).state;
  expect(state.doc.toString()).toBe('Original');
  state = state.update({ effects: setEditorReadOnly.of(false) }).state;
  expect(state.readOnly).toBe(false);
  state = state.update({ changes: { from: 8, insert: ' restored' } }).state;
  expect(state.doc.toString()).toBe('Original restored');
});
