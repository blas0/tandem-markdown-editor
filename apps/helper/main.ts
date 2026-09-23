import { createInterface } from 'node:readline';
import { messageOf } from '../../packages/providers';
import { Application } from './service';

const root = process.argv[2];
if (!root) throw new Error('The desktop host must supply the library directory');
const app = new Application(root);
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
app.store.onEvent = (event) => send({ jsonrpc: '2.0', method: 'event', params: event });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (Buffer.byteLength(line) > 32 * 1024 * 1024) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds 32 MB' } });
    return;
  }
  let request: { id?: string | number };
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
    return;
  }
  void app.request(request).then(
    (result) => send({ jsonrpc: '2.0', id: request.id, result: result ?? null }),
    (error) =>
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: messageOf(error) } }),
  );
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}
input.on('close', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
