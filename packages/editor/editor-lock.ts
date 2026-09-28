import { Annotation, EditorState, Facet, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const setEditorReadOnly = StateEffect.define<boolean>();
export const internalEditorChange = Annotation.define<boolean>();
/** A document-level lock cannot be released by the temporary review lock. */
export const documentReadOnly = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});
const locked = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setEditorReadOnly)) value = effect.value;
    return value;
  },
  provide: (field) => [
    EditorState.readOnly.compute(
      [field, documentReadOnly],
      (state) => state.field(field) || state.facet(documentReadOnly),
    ),
    EditorView.contentAttributes.compute([field, documentReadOnly], (state) => ({
      'aria-readonly': String(state.field(field) || state.facet(documentReadOnly)),
    })),
  ],
});
export const editorLock = [
  locked,
  EditorState.transactionFilter.of((transaction) =>
    transaction.docChanged &&
    (transaction.startState.facet(documentReadOnly) ||
      (transaction.startState.field(locked) && !transaction.annotation(internalEditorChange)))
      ? []
      : transaction,
  ),
];
