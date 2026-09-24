import { describe, expect, test } from 'vitest';
import { findDebt, parsePatch } from '../scripts/check-added-lines';

const check = (path: string, text: string) => findDebt([{ path, line: 1, text }]);

describe('added-line check', () => {
  test('blocks focused and skipped tests', () => {
    expect(check('tests/a.test.ts', "test.only('x', () => {});")).toHaveLength(1);
    expect(check('tests/a.test.ts', "describe.skip('x', () => {});")).toHaveLength(1);
    expect(check('tests/e2e/a.spec.ts', "test.describe.only('x', () => {});")).toHaveLength(1);
    expect(check('tests/a.test.ts', "test.skipIf(process.env.CI)('x', () => {});")).toEqual([]);
  });

  test('blocks debug output only where it is debt', () => {
    expect(check('apps/desktop/src/app.tsx', "console.log('state', state);")).toHaveLength(1);
    expect(check('scripts/dev.ts', "console.log('Starting');")).toEqual([]);
    expect(check('apps/desktop/src/app.tsx', '  debugger;')).toHaveLength(1);
    expect(check('src-tauri/src/main.rs', 'dbg!(&window);')).toHaveLength(1);
  });

  test('blocks unfinished-work markers in code but not in docs', () => {
    expect(check('packages/editor/src/x.ts', '// TODO: handle tables')).toHaveLength(1);
    expect(check('apps/helper/src/y.ts', '// FIXME later')).toHaveLength(1);
    expect(check('docs/PRODUCT.md', 'TODO lists are a feature.')).toEqual([]);
    expect(check('apps/helper/src/y.ts', 'const todos = [];')).toEqual([]);
  });

  test('allows suppressions only with a reason', () => {
    expect(check('apps/desktop/src/a.ts', '// @ts-ignore')).toHaveLength(1);
    expect(check('apps/desktop/src/a.ts', '// @ts-expect-error')).toHaveLength(1);
    expect(
      check('apps/desktop/src/a.ts', '// @ts-expect-error the SDK types omit this field'),
    ).toEqual([]);
    expect(
      check('apps/desktop/src/a.ts', '// biome-ignore lint/style/noNonNullAssertion:'),
    ).toHaveLength(1);
    expect(
      check('apps/desktop/src/a.tsx', '{/* biome-ignore lint/a11y/useButtonType */}'),
    ).toHaveLength(1);
    expect(
      check('apps/desktop/src/a.ts', '// biome-ignore lint/style/noNonNullAssertion: set in init'),
    ).toEqual([]);
  });

  test('reads added lines and their numbers from a zero-context patch', () => {
    const patch = [
      'diff --git a/apps/desktop/src/a.ts b/apps/desktop/src/a.ts',
      '--- a/apps/desktop/src/a.ts',
      '+++ b/apps/desktop/src/a.ts',
      '@@ -10,0 +11,2 @@',
      '+const a = 1;',
      "+console.log('a', a);",
      'diff --git a/old.ts b/old.ts',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-// TODO: gone',
    ].join('\n');
    expect(findDebt(parsePatch(patch))).toEqual([
      'apps/desktop/src/a.ts:12: console.log in app source. Remove it or report through the app.',
    ]);
  });
});
