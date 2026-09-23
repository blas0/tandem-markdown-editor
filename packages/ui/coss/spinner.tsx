import type React from 'react';
import { LoaderCircle } from '../icons';
import { cn } from './utils';

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircle>): React.ReactElement {
  return (
    <LoaderCircle
      aria-label="Loading"
      className={cn('animate-spin', className)}
      role="status"
      {...props}
    />
  );
}
