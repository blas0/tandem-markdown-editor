import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands';
import {
  markdownLanguage as gfmLanguage,
  markdown as markdownLanguage,
} from '@codemirror/lang-markdown';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { ChangeSet, EditorState, Prec, EditorSelection as SourceRange } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import {
  forwardRef,
  startTransition,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Content, Edit } from '../contracts';
import { sourceFor } from '../document';
import { safeLink } from '../document/links';
import { Button } from '../ui/coss/button';
import { Input } from '../ui/coss/input';
import { X } from '../ui/icons';
import { CheckboxField, IconButton, SaveButton, TextField, TitledDialog } from '../ui/primitives';
import './editor.css';
import { editorLock, internalEditorChange, setEditorReadOnly } from './editor-lock';
import { findText } from './find';
import { sourceFindHighlight, sourceFindMatch } from './find-highlight';
import {
  type InlineDecision,
  type InlineSuggestion,
  type InlineThreadActions,
  inlineReviewDecorations,
  setInlineReviews,
} from './inline-review';
import { liveMarkdown } from './live-markdown';
import {
  activeSourceMarks,
  formatSource,
  htmlAttribute,
  orderedListEnter,
  type SourceAction,
} from './markdown-actions';
import { selectedMarkdownInput } from './markdown-input';
import { MarkdownPreview } from './markdown-preview';
import { MarkdownToolbar } from './markdown-toolbar';

// Leave ordinary Tab navigation intact outside list lines, including bare/empty list items.
function indentList(view: EditorView, outdent: boolean) {
  const { doc, selection } = view.state;
  const line = doc.lineAt(selection.main.from);
  const list = /^\s*(?:[-+*]|\d+[.)])(?:\s|$)/;
  if (
    !list.test(line.text) &&
    !(line.text.trim() === '' && line.number > 1 && list.test(doc.line(line.number - 1).text))
  )
    return false;
  return (outdent ? indentLess : indentMore)(view);
}

export type EditorHandle = {
  setReadOnly: (value: boolean) => void;
  cursor: () => number;
  selection: () => { from: number; to: number } | null;
  /** Collapses a text selection to its head, ending its highlight. */
  deselect: () => void;
  apply: (edits: Edit[], content: Content) => void;
  focus: (from?: number, to?: number) => void;
  find: () => void;
  undo: () => void;
  redo: () => void;
};
export type EditorSelection = {
  from: number;
  to: number;
  viewport: { left: number; top: number; bottom: number };
};
type Props = {
  suggestions?: InlineSuggestion[];
  onDecide?: InlineDecision;
  /** Accept all, reject all and clear, shown at the end of the suggestion thread. */
  reviewActions?: InlineThreadActions | null;
  content: Content;
  onOpenLink: (url: string) => void;
  onEdit: (edit: Edit) => void;
  onImage: () => Promise<{ src: string; alt: string } | null>;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  /** Only the focused split pane opens Find from the keyboard. */
  active?: boolean;
  /**
   * Where the formatting toolbar renders: in place when undefined, into a shared
   * split-view strip when an element, and nowhere when null.
   */
  toolbarHost?: HTMLElement | null;
};
export const DocumentEditor = forwardRef<EditorHandle, Props>(
  (
    {
      content,
      suggestions = [],
      onDecide,
      reviewActions = null,
      onEdit,
      onImage,
      onOpenLink,
      onSelectionChange,
      active = true,
      toolbarHost,
    },
    ref,
  ) => {
    const sourceHost = useRef<HTMLDivElement>(null),
      scrollHost = useRef<HTMLDivElement>(null),
      source = useRef<EditorView | null>(null),
      suppress = useRef(false),
      change = useRef(onEdit);
    const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectionChange = useRef(onSelectionChange);
    const reportedSelection = useRef<EditorSelection | null>(null);
    selectionChange.current = onSelectionChange;
    const reportSelection = (next: EditorSelection | null) => {
      const current = reportedSelection.current;
      if (
        current === next ||
        (current !== null &&
          next !== null &&
          current.from === next.from &&
          current.to === next.to &&
          current.viewport.left === next.viewport.left &&
          current.viewport.top === next.viewport.top &&
          current.viewport.bottom === next.viewport.bottom)
      )
        return;
      reportedSelection.current = next;
      selectionChange.current?.(next);
    };
    const decision = useRef(onDecide);
    decision.current = onDecide;
    const decideInline = useRef<InlineDecision>((...args) => decision.current?.(...args));
    const [zoom, setZoom] = useState(() => {
      const saved = Number(localStorage.getItem('tandem:document-zoom'));
      return Number.isFinite(saved) && saved >= 0.5 && saved <= 2 ? saved : 1;
    });
    useEffect(() => {
      const key = (event: KeyboardEvent) => {
        if (
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          event.isComposing ||
          !['-', '+', '=', '0'].includes(event.key)
        )
          return;
        if (
          event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"]')
        )
          return;
        event.preventDefault();
        setZoom((old) => {
          const next =
            event.key === '0'
              ? 1
              : Math.max(
                  0.5,
                  Math.min(2, Math.round((old + (event.key === '-' ? -0.1 : 0.1)) * 10) / 10),
                );
          localStorage.setItem('tandem:document-zoom', String(next));
          return next;
        });
      };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, []);
    change.current = onEdit;
    const [link, setLink] = useState<string | null>(null);
    const [imageProperties, setImageProperties] = useState<{
      src: string;
      alt: string;
      width: string;
    } | null>(null);
    const [codeLanguage, setCodeLanguage] = useState<string | null>(null);
    // The rendered preview reads the editor's own document, so unsaved typing shows too.
    const [preview, setPreview] = useState(false),
      [previewSource, setPreviewSource] = useState('');
    const previewOn = useRef(false);
    const togglePreview = () => {
      const next = !preview;
      previewOn.current = next;
      if (next) setPreviewSource(source.current?.state.doc.toString() ?? sourceFor(content));
      setPreview(next);
      if (!next) requestAnimationFrame(() => source.current?.focus());
    };
    const [findOpen, setFindOpen] = useState(false),
      [findQuery, setFindQuery] = useState(''),
      [matchCase, setMatchCase] = useState(false),
      [findIndex, setFindIndex] = useState(-1);
    const findInput = useRef<HTMLInputElement>(null);
    const openFind = () => {
      setFindOpen(true);
      findInput.current?.focus();
      findInput.current?.select();
    };
    const [toolbarMarks, setToolbarMarks] = useState<string[]>([]),
      toolbarMarksRef = useRef(toolbarMarks);
    const updateToolbarMarks = (state: EditorState) => {
      const { from, to } = state.selection.main;
      // A whole-document selection cannot be wholly inside an inline mark. Skip
      // syntax-tree work on the large Control/Command+A path used before copy.
      const next =
        from === 0 && to === state.doc.length
          ? []
          : activeSourceMarks({ tree: syntaxTree(state), doc: state.doc, from, to });
      const current = toolbarMarksRef.current;
      if (next.length === current.length && next.every((mark, index) => mark === current[index]))
        return;
      toolbarMarksRef.current = next;
      startTransition(() => setToolbarMarks(next));
    };
    useEffect(() => {
      if (!sourceHost.current) return;
      const view = new EditorView({
        parent: sourceHost.current,
        state: EditorState.create({
          doc: sourceFor(content),
          extensions: [
            history(),
            editorLock,
            selectedMarkdownInput,
            EditorState.allowMultipleSelections.of(true),
            indentUnit.of('  '),
            Prec.highest(
              keymap.of([
                {
                  key: 'Enter',
                  run: (view) => {
                    if (view.state.selection.ranges.length !== 1) return false;
                    const selection = view.state.selection.main;
                    const edit = orderedListEnter({
                      text: view.state.doc.toString(),
                      from: selection.from,
                      to: selection.to,
                      tree: syntaxTree(view.state),
                    });
                    if (!edit) return false;
                    view.dispatch({
                      changes: { from: edit.from, to: edit.to, insert: edit.insert },
                      selection: { anchor: edit.anchor },
                      scrollIntoView: true,
                      userEvent: 'input',
                    });
                    return true;
                  },
                },
              ]),
            ),
            keymap.of([
              {
                key: 'Tab',
                run: (view) => indentList(view, false),
                shift: (view) => indentList(view, true),
              },
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            markdownLanguage({ base: gfmLanguage }),
            liveMarkdown,
            drawSelection(),
            highlightSelectionMatches(),
            sourceFindHighlight,
            inlineReviewDecorations,
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              'aria-label': 'Markdown source',
              spellcheck: 'true',
            }),
            EditorView.updateListener.of((update) => {
              if (update.selectionSet || update.docChanged) updateToolbarMarks(update.state);
              if (update.docChanged && previewOn.current) {
                const text = update.state.doc.toString();
                startTransition(() => setPreviewSource(text));
              }
              if (
                update.selectionSet ||
                update.docChanged ||
                update.viewportChanged ||
                update.geometryChanged
              ) {
                if (selectionTimer.current) clearTimeout(selectionTimer.current);
                const currentRange = update.state.selection.main;
                if (currentRange.empty) {
                  selectionTimer.current = null;
                  if (update.selectionSet || update.docChanged) reportSelection(null);
                } else {
                  selectionTimer.current = setTimeout(() => {
                    const view = update.view;
                    const range = view.state.selection.main;
                    if (range.empty) {
                      reportSelection(null);
                      return;
                    }
                    const visible = view.visibleRanges.find(
                      (candidate) => candidate.to >= range.from && candidate.from <= range.to,
                    );
                    const firstVisible = view.visibleRanges[0];
                    const lastVisible = view.visibleRanges.at(-1);
                    const nearestVisible =
                      range.head < (firstVisible?.from ?? 0) ? firstVisible?.from : lastVisible?.to;
                    const visibleFrom = visible
                      ? Math.max(range.from, visible.from)
                      : (nearestVisible ?? range.head);
                    const visibleTo = visible
                      ? Math.min(range.to, visible.to)
                      : (nearestVisible ?? range.head);
                    const start = view.coordsAtPos(visibleFrom);
                    const end = view.coordsAtPos(visibleTo);
                    const fallback = view.dom.getBoundingClientRect();
                    reportSelection({
                      from: range.from,
                      to: range.to,
                      viewport: {
                        left:
                          start && end
                            ? (start.left + end.right) / 2
                            : (fallback.left + fallback.right) / 2,
                        top: start && end ? Math.min(start.top, end.top) : fallback.top,
                        bottom: start && end ? Math.max(start.bottom, end.bottom) : fallback.bottom,
                      },
                    });
                  }, 32);
                }
              }
              if (!update.docChanged || suppress.current) return;
              const edits: Edit[] = [];
              update.changes.iterChanges((from, to, _from, _to, insert) =>
                edits.unshift({ kind: 'source', from, to, insert: insert.toString() }),
              );
              change.current({ kind: 'batch', edits });
            }),
          ],
        }),
      });
      source.current = view;
      updateToolbarMarks(view.state);
      return () => {
        if (selectionTimer.current) clearTimeout(selectionTimer.current);
        view.destroy();
        source.current = null;
      };
    }, []);
    useEffect(() => {
      source.current?.dispatch({
        effects: setInlineReviews.of({
          suggestions,
          onDecide: decideInline.current,
          actions: reviewActions,
        }),
      });
    }, [suggestions, reviewActions]);
    useImperativeHandle(
      ref,
      () => ({
        setReadOnly: (value) => {
          source.current?.dispatch({ effects: setEditorReadOnly.of(value) });
        },
        find: openFind,
        undo: () => {
          if (source.current) {
            source.current.focus();
            undo(source.current);
          }
        },
        redo: () => {
          if (source.current) {
            source.current.focus();
            redo(source.current);
          }
        },
        cursor: () => source.current?.state.selection.main.head ?? 0,
        selection: () => {
          const range = source.current?.state.selection.main;
          return range && !range.empty ? { from: range.from, to: range.to } : null;
        },
        deselect: () => {
          const view = source.current;
          const range = view?.state.selection.main;
          if (view && range && !range.empty)
            view.dispatch({ selection: SourceRange.cursor(range.head) });
        },
        focus: (from, to) => {
          if (source.current) {
            source.current.dispatch({
              selection: { anchor: from ?? 0, head: to ?? from ?? 0 },
              scrollIntoView: true,
            });
            source.current.focus();
          }
        },
        apply: (edits, next) => {
          suppress.current = true;
          try {
            if (source.current) {
              const view = source.current;
              let changes = ChangeSet.empty(view.state.doc.length);
              const apply = (edit: Edit) => {
                if (edit.kind === 'batch') edit.edits.forEach(apply);
                else if (edit.kind === 'source')
                  changes = changes.compose(
                    ChangeSet.of(
                      { from: edit.from, to: edit.to, insert: edit.insert },
                      changes.newLength,
                    ),
                  );
                else
                  changes = ChangeSet.of(
                    { from: 0, to: view.state.doc.length, insert: sourceFor(next) },
                    view.state.doc.length,
                  );
              };
              edits.forEach(apply);
              view.dispatch({
                changes,
                userEvent: 'input.review',
                annotations: [isolateHistory.of('full'), internalEditorChange.of(true)],
              });
            }
          } finally {
            suppress.current = false;
          }
        },
      }),
      [],
    );
    const format = (action: SourceAction) => {
      const view = source.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const change = formatSource(
        { text: view.state.doc.toString(), from, to, tree: syntaxTree(view.state) },
        action,
      );
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.anchor, head: change.head },
        annotations: isolateHistory.of('full'),
        scrollIntoView: true,
      });
      view.focus();
    };
    const insertImage = async () => {
      const image = await onImage();
      if (image) setImageProperties({ ...image, width: '' });
    };
    const matches = findOpen
      ? findText(source.current?.state.doc.toString() ?? '', findQuery, matchCase)
      : [];
    useEffect(() => {
      source.current?.dispatch({ effects: sourceFindMatch.of(null) });
    }, [findOpen, findQuery, matchCase]);
    const closeFind = () => {
      setFindOpen(false);
      source.current?.focus();
    };
    const findNext = (direction = 1) => {
      if (!matches.length) return;
      const index =
        findIndex < 0
          ? direction > 0
            ? 0
            : matches.length - 1
          : (findIndex + direction + matches.length) % matches.length;
      setFindIndex(index);
      const range = matches[index];
      if (source.current) {
        source.current.dispatch({
          selection: { anchor: range.from, head: range.to },
          effects: sourceFindMatch.of(range),
          scrollIntoView: true,
        });
      }
      findInput.current?.focus();
    };
    useEffect(() => {
      const key = (e: KeyboardEvent) => {
        if (!active) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          e.stopPropagation();
          openFind();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g' && findOpen) {
          e.preventDefault();
          e.stopPropagation();
          findNext(e.shiftKey ? -1 : 1);
        }
      };
      window.addEventListener('keydown', key, true);
      return () => window.removeEventListener('keydown', key, true);
    }, [active, findOpen, findQuery, findIndex, matchCase]);
    const toolbar = (
      <MarkdownToolbar
        format={format}
        activeMarks={toolbarMarks}
        link={() => setLink('')}
        image={() => void insertImage()}
        undo={() => {
          if (source.current) {
            undo(source.current);
            source.current.focus();
          }
        }}
        redo={() => {
          if (source.current) {
            redo(source.current);
            source.current.focus();
          }
        }}
        code={() => setCodeLanguage('')}
        preview={preview}
        onTogglePreview={togglePreview}
      />
    );
    return (
      <div
        className="editor-adapter"
        onClickCapture={(e) => {
          const anchor = (e.target as HTMLElement).closest('a[href]');
          if (anchor) {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey)
              onOpenLink(anchor.getAttribute('href') ?? anchor.getAttribute('data-md-href') ?? '');
          }
        }}
      >
        {findOpen && (
          <search className="find-bar" aria-label="Find in document">
            <Input
              aria-label="Find text"
              ref={findInput}
              value={findQuery}
              autoFocus
              onChange={(e) => {
                setFindQuery(e.target.value);
                setFindIndex(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  findNext(e.shiftKey ? -1 : 1);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeFind();
                }
              }}
            />
            <CheckboxField
              label="Match case"
              checked={matchCase}
              onChange={(e) => {
                setMatchCase(e.target.checked);
                setFindIndex(-1);
              }}
            />
            <Button disabled={!matches.length} onClick={() => findNext(-1)}>
              Previous
            </Button>
            <Button disabled={!matches.length} onClick={() => findNext()}>
              Next
            </Button>
            <span role="status">
              {matches.length ? `${Math.max(0, findIndex + 1)} of ${matches.length}` : 'No matches'}
            </span>
            <IconButton label="Close find" onClick={closeFind}>
              <X size={15} />
            </IconButton>
          </search>
        )}
        {toolbarHost === undefined ? toolbar : toolbarHost && createPortal(toolbar, toolbarHost)}
        <div ref={scrollHost} className="document-scroll source-scroll" hidden={preview}>
          <div className="source-editor" style={{ zoom }} ref={sourceHost} />
        </div>
        {preview && (
          <div className="document-scroll preview-scroll">
            <div style={{ zoom }}>
              <MarkdownPreview markdown={previewSource} onOpenLink={onOpenLink} />
            </div>
          </div>
        )}
        <TitledDialog
          open={link !== null}
          onOpenChange={(v) => {
            if (!v) setLink(null);
          }}
          title="Edit link"
        >
          <div className="flex flex-col gap-4">
            <TextField
              label="URL"
              value={link ?? ''}
              onChange={(e) => setLink(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <SaveButton
                variant="default"
                onClick={() => {
                  if (link && safeLink(link))
                    format({
                      kind: 'wrap',
                      before: '[',
                      after: `](<${link.replace(/[<>\r\n]/g, '')}>)`,
                      placeholder: 'Link text',
                    });
                  setLink(null);
                }}
              >
                Save link
              </SaveButton>
            </div>
          </div>
        </TitledDialog>
        <TitledDialog
          open={codeLanguage !== null}
          onOpenChange={(open) => {
            if (!open) setCodeLanguage(null);
          }}
          title="Code language"
        >
          <div className="flex flex-col gap-4">
            <TextField
              label="Language"
              placeholder="Plain text"
              value={codeLanguage ?? ''}
              onChange={(e) => setCodeLanguage(e.target.value)}
              autoFocus
            />
            <SaveButton
              variant="default"
              disabled={!/^[\w#+.-]*$/.test(codeLanguage ?? '')}
              onClick={() => {
                {
                  const view = source.current;
                  const selected =
                    view?.state.sliceDoc(
                      view.state.selection.main.from,
                      view.state.selection.main.to,
                    ) ?? '';
                  const fence = '`'.repeat(
                    Math.max(3, ...(selected.match(/`+/g) ?? []).map((run) => run.length + 1)),
                  );
                  format({ kind: 'block', text: `${fence}${codeLanguage}\n${selected}\n${fence}` });
                }
                setCodeLanguage(null);
              }}
            >
              Save language
            </SaveButton>
          </div>
        </TitledDialog>
        <TitledDialog
          open={imageProperties !== null}
          onOpenChange={(open) => {
            if (!open) setImageProperties(null);
          }}
          title="Image properties"
        >
          {imageProperties && (
            <div className="flex flex-col gap-4">
              <TextField
                label="Alt text"
                value={imageProperties.alt}
                onChange={(e) => setImageProperties({ ...imageProperties, alt: e.target.value })}
                autoFocus
              />
              <TextField
                label="Width in pixels"
                type="number"
                min={1}
                max={10000}
                placeholder="Original size"
                value={imageProperties.width}
                onChange={(e) => setImageProperties({ ...imageProperties, width: e.target.value })}
              />
              <SaveButton
                variant="default"
                disabled={
                  !!imageProperties.width &&
                  (!Number.isInteger(Number(imageProperties.width)) ||
                    Number(imageProperties.width) < 1 ||
                    Number(imageProperties.width) > 10000)
                }
                onClick={() => {
                  const attrs = {
                    src: imageProperties.src,
                    alt: imageProperties.alt,
                    width: imageProperties.width ? Number(imageProperties.width) : null,
                    height: null,
                  };
                  format({
                    kind: 'block',
                    text: `<img src="${htmlAttribute(attrs.src)}" alt="${htmlAttribute(attrs.alt)}"${attrs.width ? ` width="${attrs.width}"` : ''}>`,
                  });
                  setImageProperties(null);
                }}
              >
                Insert image
              </SaveButton>
            </div>
          )}
        </TitledDialog>
      </div>
    );
  },
);
