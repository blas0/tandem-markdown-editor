import { lazy, Suspense } from 'react';

// Vite removes this import and the toolbar from production and E2E builds.
const Agentation = import.meta.env.DEV
  ? lazy(() => import('agentation').then((module) => ({ default: module.Agentation })))
  : null;

export function DevTools() {
  return Agentation ? (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  ) : null;
}
