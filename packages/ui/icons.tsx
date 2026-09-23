// Keyline Icons registry, stroke/regular. https://keylineicons.com
import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number | string;
};

// https://keylineicons.com/r/arrow-up.json
export function ArrowUp({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M5 11.8771L11.5875 5.17385C11.8153 4.94205 12.1847 4.94205 12.4125 5.17385L19 11.8771M12 19V5.94129" />
    </svg>
  );
}

export function ArrowUpRight({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 6H17.5C17.77614 6 18 6.22386 18 6.5V18M7.2 16.8L17.4 6.6" />
    </svg>
  );
}

export function Check({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M5 12L9.66667 17L19 7" />
    </svg>
  );
}

export function CircleAlert({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7V13M12 17H12.01" />
    </svg>
  );
}

export function Info({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11V17M12 7H12.01" />
    </svg>
  );
}

export function TriangleAlert({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M10.3 4.2L2.8 17.2C2 18.5 3 20 4.5 20H19.5C21 20 22 18.5 21.2 17.2L13.7 4.2C13 3 11 3 10.3 4.2Z" />
      <path d="M12 9V14M12 17H12.01" />
    </svg>
  );
}

// Keyline sun-dim: https://keylineicons.com/r/stroke/sun-dim.json and r/fill/sun-dim.json.
export function SunDim({
  size = 24,
  variant = 'stroke',
  ...props
}: IconProps & { variant?: 'stroke' | 'fill' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={variant === 'stroke' ? 'currentColor' : undefined}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="sun-dim"
      data-variant={variant}
      {...props}
    >
      {variant === 'fill' ? (
        <path
          d="M17.5 12C17.5 15.0376 15.0376 17.5 12 17.5C8.9624 17.5 6.5 15.0376 6.5 12C6.5 8.9624 8.9624 6.5 12 6.5C15.0376 6.5 17.5 8.9624 17.5 12ZM21.5 12C21.5 12.5523 21.0523 13 20.5 13C19.9477 13 19.5 12.5523 19.5 12C19.5 11.4477 19.9477 11 20.5 11C21.0523 11 21.5 11.4477 21.5 12ZM19.0104 18.0104C19.0104 18.5627 18.5627 19.0104 18.0104 19.0104C17.4581 19.0104 17.0104 18.5627 17.0104 18.0104C17.0104 17.4581 17.4581 17.0104 18.0104 17.0104C18.5627 17.0104 19.0104 17.4581 19.0104 18.0104ZM13 20.5C13 21.0523 12.5523 21.5 12 21.5C11.4477 21.5 11 21.0523 11 20.5C11 19.9477 11.4477 19.5 12 19.5C12.5523 19.5 13 19.9477 13 20.5ZM6.9896 18.0104C6.9896 18.5627 6.5419 19.0104 5.9896 19.0104C5.4373 19.0104 4.9896 18.5627 4.9896 18.0104C4.9896 17.4581 5.4373 17.0104 5.9896 17.0104C6.5419 17.0104 6.9896 17.4581 6.9896 18.0104ZM4.5 12C4.5 12.5523 4.0523 13 3.5 13C2.9477 13 2.5 12.5523 2.5 12C2.5 11.4477 2.9477 11 3.5 11C4.0523 11 4.5 11.4477 4.5 12ZM6.9896 5.9896C6.9896 6.5419 6.5419 6.9896 5.9896 6.9896C5.4373 6.9896 4.9896 6.5419 4.9896 5.9896C4.9896 5.4373 5.4373 4.9896 5.9896 4.9896C6.5419 4.9896 6.9896 5.4373 6.9896 5.9896ZM13 3.5C13 4.0523 12.5523 4.5 12 4.5C11.4477 4.5 11 4.0523 11 3.5C11 2.9477 11.4477 2.5 12 2.5C12.5523 2.5 13 2.9477 13 3.5ZM19.0104 5.9896C19.0104 6.5419 18.5627 6.9896 18.0104 6.9896C17.4581 6.9896 17.0104 6.5419 17.0104 5.9896C17.0104 5.4373 17.4581 4.9896 18.0104 4.9896C18.5627 4.9896 19.0104 5.4373 19.0104 5.9896Z"
          fill="currentColor"
        />
      ) : (
        <>
          <path
            d="M16.5 12C16.5 14.4853 14.4853 16.5 12 16.5C9.5147 16.5 7.5 14.4853 7.5 12C7.5 9.5147 9.5147 7.5 12 7.5C14.4853 7.5 16.5 9.5147 16.5 12Z"
            fill="none"
          />
          <path
            d="M21.5 12C21.5 12.5523 21.0523 13 20.5 13C19.9477 13 19.5 12.5523 19.5 12C19.5 11.4477 19.9477 11 20.5 11C21.0523 11 21.5 11.4477 21.5 12ZM19.0104 18.0104C19.0104 18.5627 18.5627 19.0104 18.0104 19.0104C17.4581 19.0104 17.0104 18.5627 17.0104 18.0104C17.0104 17.4581 17.4581 17.0104 18.0104 17.0104C18.5627 17.0104 19.0104 17.4581 19.0104 18.0104ZM13 20.5C13 21.0523 12.5523 21.5 12 21.5C11.4477 21.5 11 21.0523 11 20.5C11 19.9477 11.4477 19.5 12 19.5C12.5523 19.5 13 19.9477 13 20.5ZM6.9896 18.0104C6.9896 18.5627 6.5419 19.0104 5.9896 19.0104C5.4373 19.0104 4.9896 18.5627 4.9896 18.0104C4.9896 17.4581 5.4373 17.0104 5.9896 17.0104C6.5419 17.0104 6.9896 17.4581 6.9896 18.0104ZM4.5 12C4.5 12.5523 4.0523 13 3.5 13C2.9477 13 2.5 12.5523 2.5 12C2.5 11.4477 2.9477 11 3.5 11C4.0523 11 4.5 11.4477 4.5 12ZM6.9896 5.9896C6.9896 6.5419 6.5419 6.9896 5.9896 6.9896C5.4373 6.9896 4.9896 6.5419 4.9896 5.9896C4.9896 5.4373 5.4373 4.9896 5.9896 4.9896C6.5419 4.9896 6.9896 5.4373 6.9896 5.9896ZM13 3.5C13 4.0523 12.5523 4.5 12 4.5C11.4477 4.5 11 4.0523 11 3.5C11 2.9477 11.4477 2.5 12 2.5C12.5523 2.5 13 2.9477 13 3.5ZM19.0104 5.9896C19.0104 6.5419 18.5627 6.9896 18.0104 6.9896C17.4581 6.9896 17.0104 6.5419 17.0104 5.9896C17.0104 5.4373 17.4581 4.9896 18.0104 4.9896C18.5627 4.9896 19.0104 5.4373 19.0104 5.9896Z"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
    </svg>
  );
}

// Keyline moon-star: https://keylineicons.com/r/stroke/moon-star.json and r/fill/moon-star.json.
export function MoonStar({
  size = 24,
  variant = 'stroke',
  ...props
}: IconProps & { variant?: 'stroke' | 'fill' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="moon-star"
      data-variant={variant}
      {...props}
    >
      {variant === 'fill' ? (
        <>
          <path
            d="M21 13C21 18.5228 16.5228 23 11 23C5.4772 23 1 18.5228 1 13C1 7.4772 5.4772 3 11 3C11.3844 3 11.7348 3.2203 11.9013 3.5668C12.0678 3.9133 12.021 4.3245 11.7809 4.6247C10.061 6.7746 10.2326 9.8738 12.1794 11.8206C14.1262 13.7674 17.2254 13.939 19.3753 12.2191C19.6755 11.979 20.0867 11.9322 20.4332 12.0987C20.7797 12.2652 21 12.6156 21 13Z"
            fill="currentColor"
            stroke="none"
          />
          <path d="M18.9689 2L18.9689 9M15.9378 3.75L22 7.25M22 3.75L15.9378 7.25" fill="none" />
        </>
      ) : (
        <path
          d="M20 13C20 17.9706 15.9706 22 11 22C6.0294 22 2 17.9706 2 13C2 8.0294 6.0294 4 11 4C8.9618 6.5477 9.1652 10.2206 11.4723 12.5277C13.7794 14.8348 17.4523 15.0382 20 13ZM18.9689 2L18.9689 9M15.9378 3.75L22 7.25M22 3.75L15.9378 7.25"
          fill="none"
        />
      )}
    </svg>
  );
}

export function ListChecks({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 4H22M2 11H22M2 18H6M10 18H14M18 18L20 20L22 16" />
    </svg>
  );
}

export function ChevronDown({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 9L12 15L18 9" />
    </svg>
  );
}

// https://keylineicons.com/r/chevrons-up-down.json
export function ChevronsUpDown({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M7 9L12 4L17 9M7 15L12 20L17 15" />
    </svg>
  );
}

export function ChevronRight({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M9 6L15 12L9 18" />
    </svg>
  );
}

export function Code({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M8 5L2 12L8 19M16 5L22 12L16 19" />
    </svg>
  );
}

// https://keylineicons.com/r/eye.json
export function Eye({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 12C4.4 7.3 8 5 12 5C16 5 19.6 7.3 22 12C19.6 16.7 16 19 12 19C8 19 4.4 16.7 2 12Z" />
      <path d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z" />
    </svg>
  );
}

export function Cpu({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 7C6 5.3431 7.3431 4 9 4L11 4C12.6569 4 14 5.3431 14 7C14 8.6569 12.6569 10 11 10L9 10C7.3431 10 6 8.6569 6 7ZM10 17C10 15.3431 11.3431 14 13 14L15 14C16.6569 14 18 15.3431 18 17C18 18.6569 16.6569 20 15 20L13 20C11.3431 20 10 18.6569 10 17ZM3 7H6M14 7H21M3 17H10M18 17H21" />
    </svg>
  );
}

export function FileText({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20M8 13H12M8 17H16" />
    </svg>
  );
}

export function Folder({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 17C21 18.6569 19.6569 20 18 20L6 20C4.3431 20 3 18.6569 3 17Z" />
    </svg>
  );
}

export function FolderOpen({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11" />
    </svg>
  );
}

export function FolderMove({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M10 20L6 20C4.3431 20 3 18.6569 3 17L3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 10M15 17H21M18 14L21 17L18 20" />
    </svg>
  );
}

export function FolderPlus({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M10 20L6 20C4.3431 20 3 18.6569 3 17L3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 10M18 14V20M15 17H21" />
    </svg>
  );
}

export function Folders({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 9.268C3.3812 9.6253 3 10.2855 3 11V19C3 20.1046 3.8954 21 5 21H14C14.7145 21 15.3747 20.6188 15.732 20M8 5C8 3.8954 8.8954 3 10 3L11.1716 3C11.702 3 12.2107 3.2107 12.5858 3.5858L13.4142 4.4142C13.7893 4.7893 14.298 5 14.8284 5L19 5C20.1046 5 21 5.8954 21 7L21 14C21 15.1046 20.1046 16 19 16L10 16C8.8954 16 8 15.1046 8 14Z" />
    </svg>
  );
}

export function Table({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 3H18C19.65685 3 21 4.34315 21 6V18C21 19.65685 19.65685 21 18 21H6C4.34315 21 3 19.65685 3 18V6C3 4.34315 4.34315 3 6 3ZM9 3V21M15 3V21M3 9H21M3 15H21" />
    </svg>
  );
}

export function Home({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M20.2928 9.4009L13.2928 3.4703C12.5468 2.8383 11.4532 2.8383 10.7072 3.4703L3.7072 9.4009C3.2586 9.7809 3 10.339 3 10.9268L3 19C3 20.1046 3.8954 21 5 21L19 21C20.1046 21 21 20.1046 21 19L21 10.9268C21 10.339 20.7414 9.7809 20.2928 9.4009ZM9 21V14H15V21" />
    </svg>
  );
}

export function Image({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 3L18 3C19.6569 3 21 4.3431 21 6L21 18C21 19.6569 19.6569 21 18 21L6 21C4.3431 21 3 19.6569 3 18L3 6C3 4.3431 4.3431 3 6 3ZM3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17" />
      <path
        d="M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function Link({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M9 17H7C4.23858 17 2 14.7614 2 12C2 9.23858 4.23858 7 7 7H9M15 7H17C19.7614 7 22 9.23858 22 12C22 14.7614 19.7614 17 17 17H15M8 12H16" />
    </svg>
  );
}

export function List({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 3V10M3 7L6 10L9 7M6 21V14M3 17L6 14L9 17M13 6H21M13 12H21M13 18H21" />
    </svg>
  );
}

export function LoaderCircle({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 2V6M16.24264 7.75736L19.07107 4.92893M18 12H22M16.24264 16.24264L19.07107 19.07107M12 18V22M7.75736 16.24264L4.92893 19.07107M2 12H6M7.75736 7.75736L4.92893 4.92893" />
    </svg>
  );
}

export function Minus({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M5 12H19" />
    </svg>
  );
}

export function ListOrdered({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 10V3M3 6L6 3L9 6M6 14V21M3 18L6 21L9 18M13 6H21M13 12H21M13 18H21" />
    </svg>
  );
}

export function Palette({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 7C6 5.3431 7.3431 4 9 4L11 4C12.6569 4 14 5.3431 14 7C14 8.6569 12.6569 10 11 10L9 10C7.3431 10 6 8.6569 6 7ZM10 17C10 15.3431 11.3431 14 13 14L15 14C16.6569 14 18 15.3431 18 17C18 18.6569 16.6569 20 15 20L13 20C11.3431 20 10 18.6569 10 17ZM3 7H6M14 7H21M3 17H10M18 17H21" />
    </svg>
  );
}

export function Plus({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M5 12H19M11.995 19.005V5.005" />
    </svg>
  );
}

export function FilePlus({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M17 16V22M14 19H20" />
    </svg>
  );
}

export function Redo2({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 19H10C7.2386 19 5 16.7614 5 14C5 11.2386 7.2386 9 10 9H18M14 5L18.8123 8.60957C19.0625 8.80973 19.0625 9.19027 18.8123 9.39043L14 13" />
    </svg>
  );
}

export function Search({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10ZM15 15L21 21" />
    </svg>
  );
}

export function Settings({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M13.5 4.8845C13.5 5.3482 13.8221 5.7434 14.2571 5.9041C14.4124 5.9615 14.5649 6.0247 14.7143 6.0933C15.1356 6.2869 15.6427 6.2353 15.9706 5.9076L16.5966 5.2819C16.9872 4.8916 17.6202 4.8917 18.0106 5.2821L18.7175 5.989C19.1081 6.3796 19.108 7.0129 18.7173 7.4034L18.0922 8.0283C17.7641 8.3562 17.7124 8.8636 17.9062 9.2851C17.975 9.4347 18.0383 9.5874 18.0958 9.7429C18.2566 10.1779 18.6518 10.5 19.1155 10.5L20 10.5C20.5523 10.5 21 10.9477 21 11.5L21 12.5C21 13.0523 20.5523 13.5 20 13.5L19.1155 13.5C18.6518 13.5 18.2566 13.8221 18.0956 14.257C18.0381 14.4123 17.9749 14.5648 17.9061 14.7143C17.7123 15.1355 17.7639 15.6428 18.0918 15.9707L18.7177 16.5966C19.1082 16.9871 19.1082 17.6203 18.7177 18.0108L18.0108 18.7177C17.6203 19.1082 16.9871 19.1082 16.5966 18.7177L15.9707 18.0918C15.6428 17.7639 15.1355 17.7123 14.7141 17.9058C14.5647 17.9745 14.4123 18.0376 14.2571 18.0949C13.8221 18.2556 13.5 18.6508 13.5 19.1145L13.5 20C13.5 20.5523 13.0523 21 12.5 21L11.5 21C10.9477 21 10.5 20.5523 10.5 20L10.5 19.1145C10.5 18.6508 10.1779 18.2556 9.7429 18.0951C9.5874 18.0377 9.4348 17.9746 9.2852 17.9059C8.8636 17.7124 8.3562 17.7641 8.0283 18.0922L7.4034 18.7173C7.0129 19.108 6.3796 19.1081 5.989 18.7175L5.2821 18.0106C4.8917 17.6202 4.8916 16.9872 5.2819 16.5966L5.9076 15.9706C6.2353 15.6427 6.2869 15.1356 6.0933 14.7143C6.0247 14.5649 5.9615 14.4124 5.9041 14.2571C5.7434 13.8221 5.3482 13.5 4.8845 13.5L4 13.5C3.4477 13.5 3 13.0523 3 12.5L3 11.5C3 10.9477 3.4477 10.5 4 10.5L4.8845 10.5C5.3482 10.5 5.7434 10.1779 5.904 9.7429C5.9614 9.5874 6.0245 9.4346 6.0933 9.285C6.2867 8.8635 6.2351 8.3562 5.9072 8.0283L5.2823 7.4034C4.8918 7.0129 4.8918 6.3797 5.2823 5.9892L5.9892 5.2823C6.3797 4.8918 7.0129 4.8918 7.4034 5.2823L8.0283 5.9072C8.3562 6.2351 8.8635 6.2867 9.285 6.0933C9.4346 6.0245 9.5874 5.9614 9.7429 5.904C10.1779 5.7434 10.5 5.3482 10.5 4.8845L10.5 4C10.5 3.4477 10.9477 3 11.5 3L12.5 3C13.0523 3 13.5 3.4477 13.5 4L13.5 4.8845ZM12 9.5C13.3807 9.5 14.5 10.6193 14.5 12C14.5 13.3807 13.3807 14.5 12 14.5C10.6193 14.5 9.5 13.3807 9.5 12C9.5 10.6193 10.6193 9.5 12 9.5Z" />
    </svg>
  );
}

export function PanelLeft({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6C3 4.34315 4.34315 3 6 3ZM9 3V21" />
    </svg>
  );
}

export function PanelRight({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6C3 4.34315 4.34315 3 6 3ZM15 3V21" />
    </svg>
  );
}

export function PanelLeftClose({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M9 3H6C4.34315 3 3 4.34315 3 6V18C3 19.6569 4.34315 21 6 21H9V3ZM18 3C19.6569 3 21 4.34315 21 6M21 18C21 19.6569 19.6569 21 18 21M13 3H14M13 21H14M21 10.5V13.5" />
      <path d="M16 9L13 12L16 15" />
    </svg>
  );
}

export function PanelRightClose({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M15 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H15V3ZM6 3C4.34315 3 3 4.34315 3 6M3 18C3 19.6569 4.34315 21 6 21M10 3H11M10 21H11M3 10.5V13.5" />
      <path d="M8 9L11 12L8 15" />
    </svg>
  );
}

export function Trash2({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 4L20 4C21.1046 4 22 4.8954 22 6L22 7C22 8.1046 21.1046 9 20 9L4 9C2.8954 9 2 8.1046 2 7L2 6C2 4.8954 2.8954 4 4 4ZM4 9L4 17C4 18.6569 5.3431 20 7 20L17 20C18.6569 20 20 18.6569 20 17L20 9M10 13L14 13" />
    </svg>
  );
}

export function Tuning({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 7C6 5.3431 7.3431 4 9 4L11 4C12.6569 4 14 5.3431 14 7C14 8.6569 12.6569 10 11 10L9 10C7.3431 10 6 8.6569 6 7ZM10 17C10 15.3431 11.3431 14 13 14L15 14C16.6569 14 18 15.3431 18 17C18 18.6569 16.6569 20 15 20L13 20C11.3431 20 10 18.6569 10 17ZM3 7H6M14 7H21M3 17H10M18 17H21" />
    </svg>
  );
}

export function SlidersVertical({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 9C4 7.3431 5.3431 6 7 6C8.6569 6 10 7.3431 10 9L10 11C10 12.6569 8.6569 14 7 14C5.3431 14 4 12.6569 4 11L4 9ZM14 13C14 11.3431 15.3431 10 17 10C18.6569 10 20 11.3431 20 13L20 15C20 16.6569 18.6569 18 17 18C15.3431 18 14 16.6569 14 15L14 13ZM7 3V6M7 14V21M17 3V10M17 18V21" />
    </svg>
  );
}

export function Pen({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3 21L10.0711 18.1716L20.1213 8.1213C21.2929 6.9497 21.2929 5.0503 20.1213 3.8787C18.9497 2.7071 17.0503 2.7071 15.8787 3.8787L5.8284 13.9289ZM5.8284 13.9289L10.0711 18.1716M13 21H21" />
    </svg>
  );
}

export function PenOff({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M9.8787 9.8787L5.8284 13.9289L3 21L10.0711 18.1716L14.1213 14.1213M16.9497 11.2929L20.1213 8.1213C21.2929 6.9497 21.2929 5.0503 20.1213 3.8787C18.9497 2.7071 17.0503 2.7071 15.8787 3.8787L12.7071 7.0503M5.8284 13.9289L10.0711 18.1716M2 2L22 22" />
    </svg>
  );
}

export function Undo2({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 19H14C16.7614 19 19 16.7614 19 14C19 11.2386 16.7614 9 14 9H6M10 5L5.18766 8.60957C4.93745 8.80973 4.93745 9.19027 5.18766 9.39043L10 13" />
    </svg>
  );
}

export function Upload({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M17 16V22M14 19L17 22L20 19" />
    </svg>
  );
}

export function X({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M7 7L17 17M17 7L7 17" />
    </svg>
  );
}

export function Copy({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M15.8284 4C15.4046 2.8015 14.2714 2 13 2H5C3.34315 2 2 3.34315 2 5V13C2 14.2714 2.8015 15.4046 4 15.8284M11 8H19C20.65684 8 22 9.34316 22 11V19C22 20.65684 20.65684 22 19 22H11C9.34316 22 8 20.65684 8 19V11C8 9.34316 9.34316 8 11 8Z" />
    </svg>
  );
}

export function Wrench({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M18.682 8.8536L20.2678 7.2678C20.4553 7.0802 20.7097 6.9749 20.9749 6.9749C21.4902 6.9749 21.9211 7.3664 21.9703 7.8794C21.9901 8.0857 22 8.2928 22 8.5C22 12.0899 19.0899 15 15.5 15C11.9101 15 9 12.0899 9 8.5C9 4.9101 11.9101 2 15.5 2C15.7072 2 15.9143 2.0099 16.1206 2.0297C16.6336 2.0789 17.0251 2.5098 17.0251 3.0251C17.0251 3.2903 16.9198 3.5447 16.7322 3.7322L15.1464 5.318C14.6776 5.7869 14.4142 6.4227 14.4142 7.0858C14.4142 8.4665 15.5335 9.5858 16.9142 9.5858C17.5773 9.5858 18.2131 9.3224 18.682 8.8536ZM15.3955 14.9992C15.3688 14.9987 15.342 14.9985 15.3152 14.9985C13.9891 14.9985 12.7173 15.5253 11.7797 16.463L7.1213 21.1213C6.5587 21.6839 5.7956 22 5 22C3.3431 22 2 20.6569 2 19C2 18.2044 2.3161 17.4413 2.8787 16.8787L7.537 12.2203C8.4747 11.2827 9.0015 10.0109 9.0015 8.6848C9.0015 8.658 9.0013 8.6312 9.0008 8.6045" />
    </svg>
  );
}

// Typography controls use the character they format; Keyline has no typography glyph set.
export function Bold({ size = 16 }: IconProps) {
  return (
    <span aria-hidden style={{ fontSize: size, fontWeight: 800 }}>
      B
    </span>
  );
}
export function Italic({ size = 16 }: IconProps) {
  return (
    <span aria-hidden style={{ fontSize: size, fontStyle: 'italic' }}>
      I
    </span>
  );
}
export function Underline({ size = 16 }: IconProps) {
  return (
    <span aria-hidden style={{ fontSize: size, textDecoration: 'underline' }}>
      U
    </span>
  );
}
export function Strikethrough({ size = 16 }: IconProps) {
  return (
    <span aria-hidden style={{ fontSize: size, textDecoration: 'line-through' }}>
      S
    </span>
  );
}
export function Quote({ size = 16 }: IconProps) {
  return (
    <span aria-hidden style={{ fontSize: size }}>
      “
    </span>
  );
}

export function ListX({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 4H22M2 11H22M2 18H6M10 18H14M18 16L22 20M22 16L18 20" />
    </svg>
  );
}

export function FileArrowUp({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M17 22V16M14 19L17 16L20 19" />
    </svg>
  );
}

export function Bookmark({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 5C4 3.3431 5.3431 2 7 2L17 2C18.6569 2 20 3.3431 20 5L20 20.9983C20 21.7895 19.1248 22.2673 18.4592 21.8395L12.8111 18.8514C12.317 18.5338 11.683 18.5338 11.1889 18.8514L5.5408 21.8395C4.8752 22.2673 4 21.7895 4 20.9983Z" />
    </svg>
  );
}

export function GitConnection({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 9V14C6 16.2091 7.79086 18 10 18H11M13 6H14C16.2091 6 18 7.79086 18 10V15M18 15C19.6569 15 21 16.3431 21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18C15 16.3431 16.3431 15 18 15ZM5 3H7C8.10457 3 9 3.89543 9 5V7C9 8.10457 8.10457 9 7 9H5C3.89543 9 3 8.10457 3 7V5C3 3.89543 3.89543 3 5 3Z" />
    </svg>
  );
}

// https://keylineicons.com/r/unlink.json
export function Unlink({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6.0353 12C5.2444 12.791 4.8 13.8637 4.8 14.9823C4.8 16.1009 5.2444 17.1737 6.0353 17.9647C6.8263 18.7556 7.8991 19.2 9.0177 19.2C10.1363 19.2 11.209 18.7556 12 17.9647M17.9647 12C18.7556 11.209 19.2 10.1363 19.2 9.0177C19.2 7.8991 18.7556 6.8263 17.9647 6.0353C17.1737 5.2444 16.1009 4.8 14.9823 4.8C13.8637 4.8 12.791 5.2444 12 6.0353M8.8 6.4L8.8 4M6.4 8.8L4 8.8M15.2 17.6L15.2 20M17.6 15.2L20 15.2" />
    </svg>
  );
}

// https://keylineicons.com/r/chevron-up.json
export function ChevronUp({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M6 15L12 9L18 15" />
    </svg>
  );
}

// https://keylineicons.com/r/more-horizontal.json
export function MoreHorizontal({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M6.5 12C6.5 12.8284 5.8284 13.5 5 13.5C4.1716 13.5 3.5 12.8284 3.5 12C3.5 11.1716 4.1716 10.5 5 10.5C5.8284 10.5 6.5 11.1716 6.5 12ZM13.5 12C13.5 12.8284 12.8284 13.5 12 13.5C11.1716 13.5 10.5 12.8284 10.5 12C10.5 11.1716 11.1716 10.5 12 10.5C12.8284 10.5 13.5 11.1716 13.5 12ZM20.5 12C20.5 12.8284 19.8284 13.5 19 13.5C18.1716 13.5 17.5 12.8284 17.5 12C17.5 11.1716 18.1716 10.5 19 10.5C19.8284 10.5 20.5 11.1716 20.5 12Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RotateCw({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M20 4v6h-6M20 10a8 8 0 1 0-1.8 7" />
    </svg>
  );
}

export function FastForward({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="m4 6 7 6-7 6V6Zm9 0 7 6-7 6V6Z" />
    </svg>
  );
}

// https://keylineicons.com/r/send.json
export function Send({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M20.65 3.35a1.2 1.2 0 0 0-1.22-.29L4.2 8.14a1.75 1.75 0 0 0-.13 3.27l5.5 2.34 2.34 5.5a1.74 1.74 0 0 0 1.62 1.07h.07a1.74 1.74 0 0 0 1.58-1.2l5.08-15.23a1.2 1.2 0 0 0-.29-1.22l.68.68ZM13.6 17.6l-1.93-4.54 4.51-4.51a1 1 0 1 0-1.41-1.41l-4.51 4.51-4.54-1.93 12.35-4.12L13.6 17.6Z" />
    </svg>
  );
}

// https://keylineicons.com/r/zap.json
export function Zap({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M13.7 2.33a1.25 1.25 0 0 0-1.94-.02L4.18 11.5A1.25 1.25 0 0 0 5.14 13h5.12l-.95 7.52a1.25 1.25 0 0 0 2.2.98l8.31-9.97A1.25 1.25 0 0 0 18.86 9h-5.24l.37-5.78a1.25 1.25 0 0 0-.29-.89Z" />
    </svg>
  );
}

// Keyline sliders-2-horizontal: stroke registry and icons/fill/sliders-2-horizontal.svg.
export function Sliders2Horizontal({
  size = 24,
  variant = 'stroke',
  ...props
}: IconProps & { variant?: 'stroke' | 'fill' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="sliders-2-horizontal"
      data-variant={variant}
      {...props}
    >
      {variant === 'fill' ? (
        <>
          <path
            d="M9 3L11 3C13.2091 3 15 4.7909 15 7C15 9.2091 13.2091 11 11 11L9 11C6.7909 11 5 9.2091 5 7C5 4.7909 6.7909 3 9 3ZM13 13L15 13C17.2091 13 19 14.7909 19 17C19 19.2091 17.2091 21 15 21L13 21C10.7909 21 9 19.2091 9 17C9 14.7909 10.7909 13 13 13Z"
            fill="currentColor"
            stroke="none"
          />
          <path d="M3 7H6M14 7H21M3 17H10M18 17H21" />
        </>
      ) : (
        <path d="M6 7C6 5.3431 7.3431 4 9 4L11 4C12.6569 4 14 5.3431 14 7C14 8.6569 12.6569 10 11 10L9 10C7.3431 10 6 8.6569 6 7ZM10 17C10 15.3431 11.3431 14 13 14L15 14C16.6569 14 18 15.3431 18 17C18 18.6569 16.6569 20 15 20L13 20C11.3431 20 10 18.6569 10 17ZM3 7H6M14 7H21M3 17H10M18 17H21" />
      )}
    </svg>
  );
}

// Keyline shield-check: stroke registry and icons/fill/shield-check.svg.
export function ShieldCheck({
  size = 24,
  variant = 'stroke',
  ...props
}: IconProps & { variant?: 'stroke' | 'fill' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={variant === 'stroke' ? 'currentColor' : undefined}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="shield-check"
      data-variant={variant}
      {...props}
    >
      {variant === 'fill' ? (
        <path
          d="M5.0647 4.1754C7.4506 3.8923 9.2514 2.6998 10.3279 1.6554C10.7686 1.2278 11.3816 1 12 1C12.6184 1 13.2314 1.2278 13.6721 1.6554C14.7486 2.6998 16.5495 3.8923 18.9353 4.1754C20.0939 4.3129 21 5.2554 21 6.3829L21 12.5708C21 14.5658 20.6389 16.5862 19.4031 18.1846C18.1083 19.859 16.0537 21.7334 13.1746 22.7912C12.4169 23.0696 11.5831 23.0696 10.8253 22.7911C7.9462 21.7334 5.8916 19.859 4.5969 18.1846C3.3611 16.5862 3 14.5658 3 12.5708L3 6.3829C3 5.2554 3.9062 4.3129 5.0647 4.1754ZM7.2526 12.6644L9.9193 15.6644C10.109 15.8779 10.381 16 10.6667 16C10.9523 16 11.2243 15.8779 11.4141 15.6644L16.7474 9.6644C16.9101 9.4813 17 9.2449 17 9C17 8.4477 16.5523 8 16 8C15.7144 8 15.4424 8.1221 15.2526 8.3356L10.6667 13.4948L8.7474 11.3356C8.5576 11.1221 8.2856 11 8 11C7.4477 11 7 11.4477 7 12C7 12.2449 7.0899 12.4813 7.2526 12.6644Z"
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      ) : (
        <path d="M5.18251 5.16845C7.83034 4.85425 9.82952 3.53222 11.0242 2.37315C11.537 1.87562 12.463 1.87562 12.9758 2.37315C14.1705 3.53222 16.1697 4.85425 18.8175 5.16845C19.4672 5.24554 20 5.75056 20 6.38285V12.5708C20 14.3452 19.7111 16.1513 18.612 17.5729C17.4097 19.1277 15.5033 20.8703 12.8298 21.8525C12.2945 22.0492 11.7055 22.0492 11.1702 21.8525C8.49668 20.8703 6.59026 19.1277 5.38804 17.5729C4.28885 16.1513 4 14.3452 4 12.5708V6.38285C4 5.75056 4.53284 5.24554 5.18251 5.16845ZM8 12L10.6667 15L16 9" />
      )}
    </svg>
  );
}
