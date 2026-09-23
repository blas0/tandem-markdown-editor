import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { folderColors, folderTones, palette } from '../packages/ui/palette';
import { RecolorControls } from '../packages/ui/primitives';

const slider = (html: string) => html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '';

describe('folder recolor tones', () => {
  it('stops folder shades at 700 and tints related folders with the family 900', () => {
    expect(folderTones).toEqual([50, 100, 200, 300, 400, 500, 600, 700]);
    expect(folderColors(palette.blue[500])).toEqual({
      base: palette.blue[500],
      tint: palette.blue[900],
    });
    expect(folderColors(palette.rose[700])).toEqual({
      base: palette.rose[700],
      tint: palette.rose[900],
    });
  });

  it('shows shades saved above the folder range at 700', () => {
    for (const tone of ['800', '900', '950'] as const)
      expect(folderColors(palette.emerald[tone])).toEqual({
        base: palette.emerald[700],
        tint: palette.emerald[900],
      });
  });

  it('keeps colors outside the palette and leaves uncolored folders to the theme', () => {
    expect(folderColors('#123456')).toEqual({ base: '#123456', tint: '#123456' });
    expect(folderColors(undefined)).toBeUndefined();
    expect(folderColors(null)).toBeUndefined();
  });

  it('offers only folder shades in the folder Shade slider and keeps the full scale elsewhere', () => {
    const folder = slider(
      renderToStaticMarkup(
        createElement(RecolorControls, {
          value: palette.blue[900],
          tones: folderTones,
          onChange: () => {},
        }),
      ),
    );
    expect(folder).toContain('max="7"');
    expect(folder).toContain('aria-valuetext="700"');
    const cadence = slider(
      renderToStaticMarkup(
        createElement(RecolorControls, { value: palette.blue[950], onChange: () => {} }),
      ),
    );
    expect(cadence).toContain('max="10"');
    expect(cadence).toContain('aria-valuetext="950"');
  });
});
