import { parseValidationMode, runValidation } from './validation';

const mode = parseValidationMode(process.argv.slice(2));
if (mode === 'full' && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw new Error('Full Tandem validation requires an Apple Silicon Mac.');
}
process.chdir(new URL('..', import.meta.url).pathname);
console.log(`Tandem validation: ${mode}`);
await runValidation(mode, async (step) => {
  const started = Date.now();
  console.log(
    JSON.stringify({ event: 'validation_step_started', id: step.id, command: step.command }),
  );
  const child = Bun.spawn(step.command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, CI: 'true', TANDEM_LIVE: '0', CARGO_TERM_COLOR: 'never' },
  });
  const exitCode = await child.exited;
  console.log(
    JSON.stringify({
      event: 'validation_step_finished',
      id: step.id,
      exitCode,
      elapsedMs: Date.now() - started,
    }),
  );
  return exitCode;
});
console.log(`Tandem ${mode} validation passed.`);
