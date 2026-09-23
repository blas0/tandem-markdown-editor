import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { type Content, type Document, emptyContent, uuid } from '../contracts';
import { sourceFor } from '../document';
import type { Store } from '../persistence';
import { embedMarkdownImages } from './markdown-images';

const formats = ['md'];
// Links made before the Markdown-only release may still name TXT, RTF or Word files.
export const editableFormat = (path: string) =>
  formats.includes(extname(path).slice(1).toLowerCase());
export class Files {
  private prepared = new Map<
    string,
    { id: string; content: Content; title: string; warnings: string[]; created: number }
  >();
  private abort = new AbortController();
  dispose() {
    this.abort.abort();
  }
  constructor(
    readonly store: Store,
    readonly assets: string,
  ) {}
  async asset(path: string) {
    const bytes = await readFile(path);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Images must be smaller than 20 MB');
    const ext = extname(path).slice(1).toLowerCase();
    const mime = (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
      } as Record<string, string>
    )[ext];
    if (!mime) throw new Error('Choose a PNG, JPEG, GIF, or WebP image');
    const valid =
      mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : mime === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : mime === 'image/gif'
            ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
            : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid) throw new Error('This file does not contain a supported image');
    await mkdir(this.assets, { recursive: true });
    const name = `${uuid()}.${ext}`;
    await writeFile(join(this.assets, name), bytes);
    return {
      src: `data:${mime};base64,${bytes.toString('base64')}`,
      alt: basename(path, extname(path)),
    };
  }
  async import(
    path: string,
    confirm = false,
    importId?: string,
    encoding?: string,
    preservePaths = false,
  ): Promise<{
    document?: Document;
    warnings: string[];
    needsConfirmation?: boolean;
    needsEncoding?: boolean;
    encodingPreviews?: Record<string, string>;
  }> {
    if (confirm && importId) {
      try {
        return { document: this.store.open(importId), warnings: [] };
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Document not found') throw error;
      }
    }
    const key = importId ?? path;
    for (const [id, entry] of this.prepared)
      if (Date.now() - entry.created > 900000) this.prepared.delete(id);
    const cached = this.prepared.get(key);
    if (confirm && cached)
      return {
        document: this.store.create({
          id: cached.id,
          title: cached.title,
          titleOrigin: 'import',
          content: cached.content,
        }),
        warnings: cached.warnings,
      };
    const loaded = await this.read(path, encoding, preservePaths);
    if (!loaded.content) return loaded;
    const { content, warnings } = loaded;
    const entry = {
      id: importId ?? uuid(),
      content,
      title: basename(path).slice(0, 120) || 'Imported document',
      warnings,
      created: Date.now(),
    };
    if (warnings.length && (!confirm || importId)) {
      if (this.prepared.size >= 8) {
        const first = this.prepared.keys().next().value;
        if (first) this.prepared.delete(first);
      }
      this.prepared.set(key, entry);
      return { needsConfirmation: true, warnings };
    }
    return {
      document: this.store.create({
        id: entry.id,
        title: entry.title,
        titleOrigin: 'import',
        content,
      }),
      warnings,
    };
  }
  async read(path: string, encoding?: string, preservePaths = false) {
    const format = extname(path).slice(1).toLowerCase();
    if (!formats.includes(format)) throw new Error('Choose a Markdown file');
    if ((await stat(path)).size > 50 * 1024 * 1024)
      throw new Error('Documents must be smaller than 50 MB');
    const content = emptyContent();
    const warnings: string[] = [];
    {
      const bytes = await readFile(path);
      let text: string;
      try {
        text = encoding
          ? new TextDecoder(encoding, { fatal: true }).decode(bytes)
          : bytes[0] === 255 && bytes[1] === 254
            ? new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
            : bytes[0] === 254 && bytes[1] === 255
              ? new TextDecoder('utf-16be', { fatal: true }).decode(bytes)
              : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        if (encoding)
          throw new Error(
            'This file cannot be decoded with the selected encoding. Choose another encoding.',
          );
        const encodingPreviews: Record<string, string> = {};
        for (const candidate of ['windows-1252', 'shift_jis', 'utf-16le', 'utf-16be'])
          encodingPreviews[candidate] = new TextDecoder(candidate).decode(bytes).slice(0, 2000);
        return {
          needsEncoding: true,
          encodingPreviews,
          warnings: ['Choose the encoding that displays your text correctly.'],
        };
      }
      content.mode = 'markdown';
      const directory = await realpath(dirname(path));
      if (!preservePaths)
        text = await embedMarkdownImages(text, async (reference) => {
          if (/^(?:data:|https?:)/i.test(reference)) return reference;
          const candidate = await realpath(resolve(dirname(path), decodeURIComponent(reference)));
          if (!candidate.startsWith(`${directory}/`))
            throw new Error(
              'An image points outside the document folder. Move a copy into the document folder before importing.',
            );
          return (await this.asset(candidate)).src;
        });
      content.markdown = text;
    }
    return { content, warnings };
  }
  async export(id: string, path: string, expectedHash?: string, exclusive = false) {
    const format = extname(path).slice(1).toLowerCase();
    if (!formats.includes(format)) throw new Error('Choose a Markdown export extension');
    const doc = this.store.open(id);
    // Edits are already durable in the operation journal. Plain exports only read them.
    const temp = join(dirname(path), `.tandem-${uuid()}.${format}`);
    let completed = false;
    try {
      {
        let source = sourceFor(doc.content);
        const directory = `${basename(path, extname(path))}.assets`;
        for (const match of [
          ...source.matchAll(/data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)/g),
        ]) {
          const bytes = Buffer.from(match[2], 'base64');
          const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
          await mkdir(join(dirname(path), directory), { recursive: true });
          await writeFile(join(dirname(path), directory, name), bytes);
          source = source.replaceAll(match[0], `${encodeURIComponent(directory)}/${name}`);
        }
        await writeFile(temp, source, 'utf8');
      }
      if (
        expectedHash &&
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex') !== expectedHash
      )
        throw new Error(
          'The file changed before saving. Both versions are safe; resolve the conflict in Tandem.',
        );
      if (exclusive) {
        try {
          await link(temp, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            throw new Error('An item with that name already exists in the destination');
          throw error;
        }
        await unlink(temp);
      } else await rename(temp, path);
      completed = true;
    } finally {
      if (!completed) await rm(temp, { force: true }).catch(() => {});
    }
    return { path, revision: doc.revision };
  }
}
