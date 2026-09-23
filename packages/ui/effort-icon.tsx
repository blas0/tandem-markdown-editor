import { palette } from './palette';

export function effortLabel(modelId: string, effort: string): string {
  if (modelId.startsWith('gpt-6-astra') && effort === 'low') return 'Light';
  return effort.length ? effort[0].toUpperCase() + effort.slice(1) : effort;
}

export function EffortIcon({ effort }: { effort: string }) {
  const count =
    (
      { light: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 5 } as Record<string, number>
    )[effort] ?? 0;
  const color =
    count === 1
      ? palette.red[500]
      : count === 2
        ? palette.orange[500]
        : count === 3
          ? palette.yellow[500]
          : effort === 'max'
            ? palette.green[800]
            : palette.green[500];
  return (
    <span className={`effort-bars ${effort === 'ultra' ? 'effort-ultra' : ''}`} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            animationDelay: `${-n * 40}ms`,
            height: 3 + n * 2,
            background: n <= count ? color : 'var(--border)',
          }}
        />
      ))}
    </span>
  );
}
