import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import { emptyContent } from '../packages/contracts';
import { backupLibrary } from '../packages/files/backup';

it('backs up nested folders and Markdown in a ZIP, excluding linked folders and documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-backup-test-'));
  const app = new Application(root);
  try {
    app.store.saveFolder({ id: 'parent', name: 'Projects' });
    app.store.saveFolder({ id: 'child', name: 'Nested', parentId: 'parent' });
    app.store.saveFolder({ id: 'linked', name: 'External', linkedPath: '/external' });
    app.store.saveFolder({ id: 'linked-child', name: 'External child', parentId: 'linked' });
    const content = { ...emptyContent(), mode: 'markdown' as const, markdown: '# Stored\n' };
    app.store.create({ title: 'Readme.md', folderId: 'child', content });
    app.store.create({ title: 'Hidden.md', folderId: 'linked-child', content });
    app.store.create({ title: 'Linked.md', linkedPath: '/external/file.md', content });
    const target = join(root, 'backup.zip');
    const result = await backupLibrary(app.files, target);
    expect(result.documents).toBe(1);
    expect(result.folders).toBe(2);
    const { stdout } = await promisify(execFile)('/usr/bin/unzip', ['-Z1', target]);
    expect(stdout).toContain('Library/Projects/Nested/Readme.md');
    expect(stdout).not.toContain('External');
    expect(stdout).not.toContain('Linked.md');
    const exported = await promisify(execFile)('/usr/bin/unzip', [
      '-p',
      target,
      'Library/Projects/Nested/Readme.md',
    ]);
    expect(exported.stdout).toBe('# Stored\n');
    expect((await readFile(target)).subarray(0, 2).toString()).toBe('PK');
  } finally {
    await app.close();
  }
});
