import { expect, it } from 'vitest';
import { EventStream } from '../apps/desktop/event-stream';
import type { AppEvent } from '../packages/contracts';

const event = (sequence: number): AppEvent => ({
  id: String(sequence),
  sequence: String(sequence),
  version: 1,
  timestamp: new Date().toISOString(),
  type: 'library.changed',
});
it('replays a missed durable event before a later live event and ignores duplicate delivery', async () => {
  const received: string[] = [];
  let saved: AppEvent[] = [];
  const stream = new EventStream({
    snapshot: async () => ({ sequence: '0' }),
    read: async (after) => ({
      events: saved.filter((e) => BigInt(e.sequence) > BigInt(after)),
      sequence: String(saved.length),
      more: false,
      reset: false,
    }),
    receive: (e) => received.push(e.sequence),
  });
  await stream.synchronize();
  saved = [event(1), event(2)];
  stream.receive(saved[1]);
  expect(received).toEqual([]);
  await stream.synchronize();
  stream.receive(saved[0]);
  expect(received).toEqual(['1', '2']);
});
it('keeps events arriving while the initial snapshot is in flight', async () => {
  const received: string[] = [];
  let resolve!: (value: { sequence: string }) => void;
  const stream = new EventStream({
    snapshot: () =>
      new Promise((done) => {
        resolve = done;
      }),
    read: async () => ({ events: [], sequence: '2', more: false, reset: false }),
    receive: (e) => received.push(e.sequence),
  });
  const ready = stream.synchronize();
  stream.receive(event(2));
  resolve({ sequence: '1' });
  await ready;
  expect(received).toEqual(['2']);
});
