import type { DocumentMeta, Folder } from '../contracts';

const parentDirectory = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

export function symlinkRows(folders: Folder[], documents: DocumentMeta[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const directoryFor = (id: string | null): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = byId.get(id);
      if (!folder) break;
      if (folder.linkedPath) return [folder.linkedPath.replace(/\/$/, ''), ...names].join('/');
      names.unshift(folder.name);
      id = folder.parentId;
    }
    return names.join('/');
  };
  const groups = new Map<
    string,
    Array<{ document: DocumentMeta; name: string; directory: string }>
  >();
  for (const document of documents) {
    const path = document.linkedPath;
    const directory = path ? parentDirectory(path) : directoryFor(document.folderId);
    const group = parentDirectory(directory);
    const row = { document, name: path?.split('/').at(-1) || document.title, directory };
    const entries = groups.get(group) ?? [];
    entries.push(row);
    groups.set(group, entries);
  }
  let top = 0;
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([group, entries], groupIndex) =>
      entries
        .sort(
          (a, b) =>
            a.directory.localeCompare(b.directory) ||
            (a.document.order ?? Number.MAX_SAFE_INTEGER) -
              (b.document.order ?? Number.MAX_SAFE_INTEGER) ||
            a.name.localeCompare(b.name) ||
            a.document.id.localeCompare(b.document.id),
        )
        .map((entry, index) => {
          const separator = groupIndex > 0 && index === 0;
          const row = { ...entry, group, separator, top, height: separator ? 64 : 48 };
          top += row.height;
          return row;
        }),
    );
}
