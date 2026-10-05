// The update feed installed apps read. Tauri's updater fetches this file from the
// latest GitHub Release, compares versions, then downloads and verifies the archive.

export type UpdateManifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};

/** The only platform Tandem builds for. */
export const updateTarget = 'darwin-aarch64';

export const releaseTag = (version: string) => `v${version}`;

export const archiveName = (version: string) => `Tandem_${version}_aarch64.app.tar.gz`;

/**
 * Where a release asset downloads from, derived from the feed endpoint in
 * tauri.conf.json so the two can't name different repositories.
 */
export function releaseAssetUrl(endpoint: string, version: string, asset: string): string {
  const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/latest\/download\/[^/]+$/.exec(
    endpoint,
  );
  if (!match) throw new Error(`Update endpoint is not a GitHub latest-release URL: ${endpoint}`);
  return `${match[1]}/releases/download/${releaseTag(version)}/${asset}`;
}

export function updateManifest(input: {
  version: string;
  notes: string;
  publishedAt: Date;
  signature: string;
  url: string;
}): UpdateManifest {
  if (!/^\d+\.\d+\.\d+$/.test(input.version))
    throw new Error(`Not a release version: ${input.version}`);
  const signature = input.signature.trim();
  if (!signature) throw new Error('The update archive has no signature');
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.publishedAt.toISOString(),
    platforms: { [updateTarget]: { signature, url: input.url } },
  };
}
