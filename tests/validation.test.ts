import { describe, expect, test } from 'vitest';
import { parseValidationMode, runValidation } from '../scripts/validation';

describe('local validation', () => {
  test('rejects unknown arguments instead of accidentally running a different scope', () => {
    expect(parseValidationMode([])).toBe('full');
    expect(parseValidationMode(['--quick'])).toBe('quick');
    expect(() => parseValidationMode(['--quik'])).toThrow();
    expect(() => parseValidationMode(['--quick', '--full'])).toThrow();
  });

  test('stops at a failed check and never runs packaging after failure', async () => {
    const called: string[] = [];
    await expect(
      runValidation('full', async (step) => {
        called.push(step.id);
        return step.id === 'integration' ? 7 : 0;
      }),
    ).rejects.toThrow('integration');
    expect(called.at(-1)).toBe('integration');
    expect(called).not.toContain('package');
    expect(called).not.toContain('e2e');
  });

  test('rebuilds production assets after E2E before packaging', async () => {
    let assets = 'none';
    let packaged = false;
    await runValidation('full', async (step) => {
      if (step.command.join(' ') === 'bun run build') assets = 'production';
      if (step.id === 'e2e') assets = 'e2e';
      if (step.id === 'package') {
        expect(assets).toBe('production');
        packaged = true;
      }
      return 0;
    });
    expect(packaged).toBe(true);
  });

  test('quick validation does not launch browsers, converters or native builds', async () => {
    const called: string[] = [];
    await runValidation('quick', async (step) => {
      called.push(step.id);
      return 0;
    });
    expect(called).toContain('typecheck');
    expect(called).toContain('lint');
    expect(called).toContain('unit');
    for (const step of ['build', 'integration', 'browsers', 'e2e', 'native', 'package']) {
      expect(called).not.toContain(step);
    }
  });
});
