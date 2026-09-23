export function DocumentIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <span
      className="document-file-icon"
      style={{ width: size, height: size, color }}
      aria-hidden="true"
    />
  );
}
