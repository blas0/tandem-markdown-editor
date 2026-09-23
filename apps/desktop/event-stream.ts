import type { AppEvent, EventPage } from '../../packages/contracts';

export class EventStream {
  private cursor: string | undefined;
  private pending = new Map<string, AppEvent>();
  private syncing: Promise<void> | undefined;
  constructor(
    private readonly source: {
      snapshot: () => Promise<{ sequence: string }>;
      read: (after: string) => Promise<EventPage>;
      receive: (event: AppEvent) => void;
    },
  ) {}
  receive(event: AppEvent) {
    if (this.cursor !== undefined && BigInt(event.sequence) <= BigInt(this.cursor)) return false;
    this.pending.set(event.sequence, event);
    this.flush();
    return this.cursor === undefined || this.pending.size > 0;
  }
  private flush() {
    if (this.cursor === undefined) return;
    while (this.cursor !== undefined) {
      const next: string = String(BigInt(this.cursor) + 1n),
        event = this.pending.get(next);
      if (!event) break;
      this.pending.delete(next);
      this.cursor = next;
      this.source.receive(event);
    }
  }
  synchronize() {
    if (this.syncing) return this.syncing;
    this.syncing = this.run().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  private async run() {
    if (this.cursor === undefined) {
      this.cursor = (await this.source.snapshot()).sequence;
      for (const sequence of this.pending.keys())
        if (BigInt(sequence) <= BigInt(this.cursor)) this.pending.delete(sequence);
    }
    while (true) {
      const page = await this.source.read(this.cursor);
      if (page.reset) {
        this.cursor = undefined;
        await this.run();
        return;
      }
      for (const event of page.events) this.receive(event);
      this.flush();
      if (!page.more) break;
    }
  }
}
