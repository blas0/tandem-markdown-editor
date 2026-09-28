import { type ReactNode, useEffect, useRef } from 'react';
import { ToastPrimitive } from './coss/toast';

/** Keep a document notice in the shared toast viewport for as long as it applies. */
export function DocumentNotice({
  id,
  title,
  message,
  type = 'error',
  children,
}: {
  id: string;
  title: string;
  message: string;
  type?: 'error' | 'warning' | 'info';
  children?: ReactNode;
}) {
  const { add, close } = ToastPrimitive.useToastManager();
  const description = useRef(children);
  description.current = children;
  useEffect(() => {
    add({
      id,
      title,
      description: description.current ?? message,
      type,
      timeout: type === 'info' ? 8000 : 0,
    });
    return () => close(id);
  }, [id, title, message, type, add, close]);
  return null;
}
