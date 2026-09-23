/**
 * The rendered reading view of a document: remark parses the GFM source, rehype-raw keeps
 * the inline HTML the editor writes (`<u>`, styled `<span>`, sized `<img>`), and sanitizing
 * strips everything else before react-markdown renders it.
 */
import type { CSSProperties } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { safeLink } from '../document/links';
import { Checkbox } from '../ui/coss/checkbox';

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    span: ['style'],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'],
  },
  protocols: { ...defaultSchema.protocols, src: ['http', 'https', 'data'] },
};
/** Embedded images are shown; anything remote stays a caption, as in the editor. */
const embeddedImage = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;
export const previewUrl = (url: string) => (embeddedImage.test(url) || safeLink(url) ? url : '');
/** The style properties the editor's colour and size controls write. */
const allowedStyle: Record<string, RegExp> = {
  color: /^#[0-9a-f]{3,8}$/i,
  fontSize: /^\d+(?:\.\d+)?(?:px|pt)$/,
  fontFamily: /^[\w ,'-]+$/,
};
function safeStyle(style: CSSProperties | undefined) {
  const kept: Record<string, string> = {};
  for (const [property, value] of Object.entries(style ?? {}))
    if (allowedStyle[property]?.test(String(value))) kept[property] = String(value);
  return Object.keys(kept).length ? kept : undefined;
}

export function MarkdownPreview({
  markdown,
  onOpenLink,
}: {
  markdown: string;
  onOpenLink?: (url: string) => void;
}) {
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href) onOpenLink?.(href);
        }}
      >
        {children}
      </a>
    ),
    // Embedded images render; remote ones stay a caption, since the app loads no remote media.
    img: ({ src, alt, width, height }) =>
      src && embeddedImage.test(src) ? (
        <img src={src} alt={alt ?? ''} width={width} height={height} />
      ) : (
        <span className="preview-image-caption">[Image: {alt || 'External image'}]</span>
      ),
    span: ({ style, children }) => <span style={safeStyle(style)}>{children}</span>,
    // Task-list boxes report state without editing the source.
    input: ({ checked }) => (
      <Checkbox
        className="markdown-preview-task"
        checked={Boolean(checked)}
        disabled
        aria-label={checked ? 'Done' : 'Not done'}
      />
    ),
  };
  return (
    <article className="markdown-preview" aria-label="Markdown preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        urlTransform={previewUrl}
        components={components}
      >
        {markdown}
      </Markdown>
    </article>
  );
}
