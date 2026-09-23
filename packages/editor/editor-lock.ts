import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const setEditorReadOnly = StateEffect.define<boolean>();
export const internalEditorChange = Annotation.define<boolean>();
const locked = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setEditorReadOnly)) value = effect.value;
    return value;
  },
  provide: (field) => [
    EditorState.readOnly.from(field),
    EditorView.contentAttributes.from(field, (value) => ({ 'aria-readonly': String(value) })),
  ],
});
export const editorLock = [
  locked,
  EditorState.transactionFilter.of((transaction) =>
    transaction.docChanged &&
    transaction.startState.field(locked) &&
    !transaction.annotation(internalEditorChange)
      ? []
      : transaction,
  ),
];
