import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Providers } from '../packages/providers';

const providers = new Providers(mkdtempSync(join(tmpdir(), 'tandem-provider-probe-')));
for (const status of await providers.list())
  console.log(
    JSON.stringify({
      provider: status.provider,
      state: status.state,
      version: status.version,
      models: status.models.map((m) => ({ id: m.id, efforts: m.efforts })),
      message: status.message,
    }),
  );
