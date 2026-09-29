import { expect, it } from 'vitest';
import type { DocumentMeta } from '../packages/contracts';
import { symlinkRows } from '../packages/ui/symlink-groups';

const document = (id: string, linkedPath: string): DocumentMeta => ({
  id,
  title: 'Display title',
  titleOrigin: 'import',
  titleRevision: 0,
  folderId: null,
  linkedPath,
  revision: 0,
  createdAt: '',
  modifiedAt: '',
  trashedAt: null,
});

it('groups sibling skill files by full grandparent path and separates direct children', () => {
  const rows = symlinkRows(
    [],
    [
      document('unrot', '/fixture/me/.claude/skills/unrot/SKILL.md'),
      document('claude', '/fixture/me/.claude/CLAUDE.md'),
      document('other', '/fixture/other/.claude/skills/unrot/SKILL.md'),
      document('out-unrot', '/fixture/me/.claude/skills/out-unrot/SKILL.md'),
      document('old', '/fixture/me/.claude/old-CLAUDE.md'),
    ],
  );
  expect(rows.map((row) => row.document.id)).toEqual([
    'claude',
    'old',
    'out-unrot',
    'unrot',
    'other',
  ]);
  expect(rows.map((row) => row.separator)).toEqual([false, false, true, false, true]);
  expect(rows[2].group).toBe('/fixture/me/.claude/skills');
  expect(rows[2].name).toBe('SKILL.md');
  expect(rows[2].directory).toBe('/fixture/me/.claude/skills/out-unrot');
  expect(rows.map((row) => row.top)).toEqual([0, 48, 96, 160, 208]);
});

it('resolves inherited linked paths and handles files at the filesystem root', () => {
  const inherited = { ...document('inherited', ''), title: 'Notes.md', folderId: 'child' };
  const rows = symlinkRows(
    [
      { id: 'root', name: 'External', parentId: null, linkedPath: '/notes/', trashedAt: null },
      { id: 'child', name: 'Drafts', parentId: 'root', trashedAt: null },
    ],
    [inherited, document('root-file', '/README.md')],
  );
  expect(rows.find((row) => row.document.id === 'inherited')).toMatchObject({
    directory: '/notes/Drafts',
    group: '/notes',
    name: 'Notes.md',
  });
  expect(rows.find((row) => row.document.id === 'root-file')).toMatchObject({
    directory: '/',
    group: '/',
    name: 'README.md',
  });
  expect(symlinkRows([], [])).toEqual([]);
});

it('honors drag ordering within a directory without splitting grandparent groups', () => {
  const rows = symlinkRows(
    [],
    [
      { ...document('a', '/notes/A.md'), order: 2 },
      { ...document('z', '/notes/Z.md'), order: 1 },
      { ...document('other', '/elsewhere/C.md'), order: 3 },
    ],
  );
  expect(rows.map((row) => row.document.id)).toEqual(['other', 'z', 'a']);
  expect(rows.every((row) => !row.separator)).toBe(true);
});
