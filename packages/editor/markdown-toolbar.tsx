import { type ComponentProps, useState } from 'react';
import { Button } from '../ui/coss/button';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/coss/select';
import { ToggleGroup, ToggleGroupItem } from '../ui/coss/toggle-group';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from '../ui/coss/toolbar';
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '../ui/coss/tooltip';
import {
  Bold,
  Eye,
  Image,
  Italic,
  Link,
  MoreHorizontal,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from '../ui/icons';
import { ActionMenu, ColorPicker } from '../ui/primitives';
import { htmlAttribute, type SourceAction } from './markdown-actions';

export function ToolbarSelect({
  label,
  options,
  value,
  onValueChange,
  compact = false,
  disabled = false,
}: {
  label: string;
  compact?: boolean;
  disabled?: boolean;
  options: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ToolbarButton
              aria-label={label}
              render={
                <SelectTrigger size="sm" className={compact ? 'w-auto min-w-16' : undefined}>
                  <SelectValue />
                </SelectTrigger>
              }
            />
          }
        />
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function FormatButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof ToolbarButton>, 'render'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToolbarButton
            {...props}
            aria-label={label}
            render={<Button variant="ghost" size="icon-xs" />}
          >
            {children}
          </ToolbarButton>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function FormatToggle({
  label,
  children,
  ...props
}: ComponentProps<typeof ToggleGroupItem> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToolbarButton aria-label={label} render={<ToggleGroupItem {...props} />}>
            {children}
          </ToolbarButton>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function FormatMenu({
  label,
  disabled = false,
  ...props
}: ComponentProps<typeof ActionMenu> & { label: string; disabled?: boolean }) {
  return (
    <ActionMenu
      {...props}
      label={label}
      trigger={
        <ToolbarButton
          aria-label={label}
          disabled={disabled}
          render={<Button variant="ghost" size="icon-xs" />}
        >
          <MoreHorizontal />
        </ToolbarButton>
      }
    />
  );
}

export function MarkdownToolbar({
  format,
  activeMarks = [],
  link,
  image,
  undo,
  redo,
  code,
  preview = false,
  onTogglePreview,
}: {
  format: (action: SourceAction) => void;
  activeMarks?: string[];
  link: () => void;
  image: () => void;
  undo: () => void;
  redo: () => void;
  code: () => void;
  /** While the rendered preview is shown, the editing controls rest. */
  preview?: boolean;
  onTogglePreview?: () => void;
}) {
  const [size, setSize] = useState('16px'),
    [color, setColor] = useState('');
  const style = (property: string, value: string) =>
    format({
      kind: 'wrap',
      before: `<span style="${property}:${htmlAttribute(value)}">`,
      after: '</span>',
      placeholder: 'Text',
    });
  return (
    <TooltipProvider>
      <Toolbar
        className="flex-wrap items-center rounded-t-none border-x-0 border-t-0"
        aria-label="Text formatting"
      >
        <ToolbarGroup>
          <ToolbarSelect
            label="Paragraph"
            disabled={preview}
            value="p"
            options={[
              { value: 'p', label: 'Paragraph' },
              ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Heading ${n}` })),
            ]}
            onValueChange={(value) =>
              format({
                kind: 'lines',
                prefix: value === 'p' ? '' : `${'#'.repeat(Number(value))} `,
                replaceHeading: true,
              })
            }
          />
          <ToolbarSelect
            label="Size"
            disabled={preview}
            compact
            value={size}
            options={[12, 14, 16, 18, 20, 24, 30, 36].map((n) => ({
              value: `${n}px`,
              label: String(n),
            }))}
            onValueChange={(value) => {
              setSize(value);
              style('font-size', value);
            }}
          />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToggleGroup
          multiple
          size="sm"
          aria-label="Text marks"
          value={activeMarks}
          disabled={preview}
        >
          {[
            { label: 'Bold', before: '**', after: '**', Icon: Bold },
            { label: 'Italic', before: '*', after: '*', Icon: Italic },
            { label: 'Underline', before: '<u>', after: '</u>', Icon: Underline },
            { label: 'Strikethrough', before: '~~', after: '~~', Icon: Strikethrough },
          ].map(({ label, before, after, Icon }) => (
            <FormatToggle
              key={label}
              label={label}
              value={label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format({ kind: 'wrap', before, after })}
            >
              <Icon size={16} />
            </FormatToggle>
          ))}
        </ToggleGroup>
        <ColorPicker
          trigger={
            <ToolbarButton
              aria-label="Text color"
              disabled={preview}
              render={<Button variant="ghost" size="icon-xs" />}
            />
          }
          value={color}
          onChange={(value) => {
            setColor(value ?? '');
            if (value) style('color', value);
            else format({ kind: 'resetColor' });
          }}
        />
        <FormatButton label="Link" disabled={preview} onClick={link}>
          <Link size={15} />
        </FormatButton>
        <FormatButton label="Insert image" disabled={preview} onClick={image}>
          <Image size={15} />
        </FormatButton>
        <FormatMenu
          label="More formatting"
          disabled={preview}
          items={[
            { label: 'Bullet list', onSelect: () => format({ kind: 'lines', prefix: '- ' }) },
            { label: 'Numbered list', onSelect: () => format({ kind: 'lines', prefix: '1. ' }) },
            { label: 'Checklist', onSelect: () => format({ kind: 'lines', prefix: '- [ ] ' }) },
            { label: 'Quote', onSelect: () => format({ kind: 'lines', prefix: '> ' }) },
            { label: 'Inline code', onSelect: () => format({ kind: 'wrap', before: '`' }) },
            { label: 'Code block', onSelect: code },
            {
              label: 'Insert table',
              onSelect: () =>
                format({ kind: 'block', text: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |' }),
            },
            { label: 'Horizontal rule', onSelect: () => format({ kind: 'block', text: '---' }) },
          ]}
        />
        <FormatButton label="Undo" disabled={preview} onClick={undo}>
          <Undo2 size={15} />
        </FormatButton>
        <FormatButton label="Redo" disabled={preview} onClick={redo}>
          <Redo2 size={15} />
        </FormatButton>
        <ToolbarSeparator />
        <FormatButton
          label="Preview"
          aria-pressed={preview}
          data-pressed={preview ? '' : undefined}
          onClick={onTogglePreview}
        >
          <Eye size={15} />
        </FormatButton>
      </Toolbar>
    </TooltipProvider>
  );
}
