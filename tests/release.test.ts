import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  archiveName,
  releaseAssetUrl,
  updateManifest,
  updateTarget,
} from '../scripts/release-manifest';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
  bundle: { createUpdaterArtifacts?: boolean };
  plugins: { updater: { pubkey: string; endpoints: string[] } };
};

it('points installed apps at the latest GitHub Release feed over HTTPS', () => {
  const { pubkey, endpoints } = config.plugins.updater;
  expect(endpoints).toHaveLength(1);
  expect(endpoints[0]).toMatch(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\/latest\.json$/,
  );
  expect(Buffer.from(pubkey, 'base64').toString()).toContain('minisign public key');
  // Ordinary builds must not need the signing key; only `bun run release` signs.
  expect(config.bundle.createUpdaterArtifacts).toBeUndefined();
});

it('builds a feed whose archive URL names the same repository and version', () => {
  const url = releaseAssetUrl(config.plugins.updater.endpoints[0], '1.2.3', archiveName('1.2.3'));
  expect(url).toMatch(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v1\.2\.3\/Tandem_1\.2\.3_aarch64\.app\.tar\.gz$/,
  );
  expect(url.split('/releases/')[0]).toBe(
    config.plugins.updater.endpoints[0].split('/releases/')[0],
  );
  const manifest = updateManifest({
    version: '1.2.3',
    notes: 'Tandem 1.2.3',
    publishedAt: new Date('2026-01-02T03:04:05Z'),
    signature: ' signed\n',
    url,
  });
  expect(manifest).toEqual({
    version: '1.2.3',
    notes: 'Tandem 1.2.3',
    pub_date: '2026-01-02T03:04:05.000Z',
    platforms: { [updateTarget]: { signature: 'signed', url } },
  });
});

it('refuses a feed without a signature, a release version or a GitHub endpoint', () => {
  const base = { notes: '', publishedAt: new Date(0), url: 'https://example.test/a' };
  expect(() => updateManifest({ ...base, version: '1.2.3', signature: ' \n' })).toThrow(
    'no signature',
  );
  expect(() => updateManifest({ ...base, version: '1.2', signature: 'signed' })).toThrow(
    'Not a release version',
  );
  expect(() => releaseAssetUrl('https://example.test/latest.json', '1.2.3', 'a')).toThrow(
    'not a GitHub latest-release URL',
  );
});
