export type ValidationMode = 'quick' | 'full';
export type ValidationStep = { id: string; command: string[] };

const quick: ValidationStep[] = [
  { id: 'install', command: ['bun', 'install', '--frozen-lockfile', '--ignore-scripts'] },
  { id: 'typecheck', command: ['bun', 'run', 'typecheck'] },
  { id: 'lint', command: ['bun', 'run', 'lint'] },
  { id: 'unit', command: ['bun', 'run', 'test'] },
];
const full: ValidationStep[] = [
  ...quick,
  { id: 'build', command: ['bun', 'run', 'build'] },
  { id: 'integration', command: ['bun', 'run', 'test:integration'] },
  {
    id: 'browsers',
    command: ['bun', 'x', '--no-install', 'playwright', 'install', 'chromium', 'webkit'],
  },
  { id: 'e2e', command: ['bun', 'run', 'test:e2e', '--reporter=list,html'] },
  {
    id: 'native',
    command: ['cargo', 'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml'],
  },
  // E2E builds dist/web with its test bridge. Never package that build.
  { id: 'production-build', command: ['bun', 'run', 'build'] },
  { id: 'package', command: ['bun', 'run', 'tauri', 'build', '--', '--locked'] },
];

export function parseValidationMode(args: string[]): ValidationMode {
  if (args.length === 0) return 'full';
  if (args.length === 1 && args[0] === '--quick') return 'quick';
  throw new Error('Usage: bun run validate [--quick]');
}

export async function runValidation(
  mode: ValidationMode,
  execute: (step: ValidationStep) => Promise<number>,
): Promise<void> {
  for (const step of mode === 'full' ? full : quick) {
    const exitCode = await execute(step);
    if (exitCode !== 0)
      throw new Error(`Validation failed at ${step.id} with exit code ${exitCode}`);
  }
}
