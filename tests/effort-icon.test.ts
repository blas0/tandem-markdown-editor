import { describe, expect, it } from 'vitest';
import { effortLabel } from '../packages/ui/effort-icon';

describe('effortLabel', () => {
  it('presents Astra low effort as Light without changing its canonical value', () => {
    const effort = 'low';
    expect(effortLabel('gpt-6-astra', effort)).toBe('Light');
    expect(effort).toBe('low');
  });

  it.each([
    ['gpt-5.6-terra', 'low', 'Low'],
    ['gpt-6-astra', 'high', 'High'],
    ['claude-opus-5', 'ultra', 'Ultra'],
  ])('title-cases %s effort %s as %s', (modelId, effort, label) => {
    expect(effortLabel(modelId, effort)).toBe(label);
  });
});
