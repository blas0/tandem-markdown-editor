import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import { decodeRequest } from '../packages/contracts';

it('changes cadence color without overwriting newer instructions or touching documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-colors-'));
  const app = new Application(root);
  try {
    const cadence = app.store.preferences().cadences[0];
    const doc = app.store.openCadence(cadence.id);
    app.store.edit(doc.id, doc.revision, 'new-instructions', {
      kind: 'source',
      from: 0,
      to: doc.content.markdown.length,
      insert: 'Newer instructions',
    });
    const before = app.store.preferences();
    const saved = app.store.open(doc.id);
    const result = await app.request({
      jsonrpc: '2.0',
      id: 'color',
      method: 'cadences.color',
      params: { id: cadence.id, color: '#123456' },
    });
    expect(result).toEqual({
      ...before,
      cadences: before.cadences.map((item) =>
        item.id === cadence.id ? { ...item, color: '#123456' } : item,
      ),
    });
    expect(app.store.open(doc.id)).toEqual(saved);
    await expect(
      app.request({
        jsonrpc: '2.0',
        id: 'missing',
        method: 'cadences.color',
        params: { id: 'missing', color: '#123456' },
      }),
    ).rejects.toThrow('Cadence not found');
    expect(app.store.preferences()).toEqual(result);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('changes only a current folder color and rejects missing folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-colors-'));
  const app = new Application(root);
  try {
    const parent = app.store.saveFolder({ name: 'Parent' });
    const old = app.store.saveFolder({ name: 'Old' });
    const current = app.store.saveFolder({
      id: old.id,
      name: 'Renamed',
      parentId: parent.id,
      linkedPath: '/retained/folder',
    });
    const result = await app.request({
      jsonrpc: '2.0',
      id: 'color',
      method: 'folders.color',
      params: { id: old.id, color: '#123456' },
    });
    expect(result).toEqual({ ...current, color: '#123456' });
    expect(app.store.folders().find((item) => item.id === parent.id)).toEqual(parent);
    await expect(
      app.request({
        jsonrpc: '2.0',
        id: 'missing',
        method: 'folders.color',
        params: { id: 'missing', color: '#123456' },
      }),
    ).rejects.toThrow('Folder not found');
    expect(app.store.folders()).toHaveLength(2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['cadences.color', 'folders.color'])('validates the scoped %s API', (method) => {
  const request = (params: unknown) => ({ jsonrpc: '2.0', id: 'color', method, params });
  expect(decodeRequest(request({ id: 'target', color: '#123456' })).method).toBe(method);
  for (const params of [
    { id: 'target' },
    { id: 'target', color: 'x'.repeat(33) },
    { id: 'target', color: '#123456', name: 'Stale' },
  ])
    expect(() => decodeRequest(request(params))).toThrow();
});

it('resets folder and cadence colors through the scoped APIs without changing other fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-reset-colors-'));
  const app = new Application(root);
  const reset = (method: string, id: string) =>
    app.request({
      jsonrpc: '2.0',
      id: 'reset',
      method,
      params: { id, color: null },
    });
  try {
    const folder = app.store.saveFolder({ name: 'Custom', color: '#123456' });
    await reset('folders.color', folder.id);
    expect(app.store.folders().find((entry) => entry.id === folder.id)).toEqual({
      ...folder,
      color: undefined,
    });
    for (const cadence of app.store.preferences().cadences) {
      app.store.colorCadence(cadence.id, '#123456');
      await reset('cadences.color', cadence.id);
      expect(app.store.preferences().cadences.find((entry) => entry.id === cadence.id)).toEqual(
        cadence,
      );
    }
    const custom = app.store.createCadence('custom-reset', 'Custom');
    if (!custom.cadenceId) throw new Error('Expected cadence');
    app.store.colorCadence(custom.cadenceId, '#123456');
    await reset('cadences.color', custom.cadenceId);
    expect(
      app.store.preferences().cadences.find((entry) => entry.id === custom.cadenceId)?.color,
    ).toBe('#2563eb');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
