import type { ProviderStatus } from '../contracts';

const effortOrder = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function effortOptions(statuses: ProviderStatus[], currentEffort: string): string[] {
  const discovered = statuses.flatMap((status) => status.models.flatMap((model) => model.efforts));
  return [...new Set([...effortOrder, ...discovered, currentEffort])];
}
