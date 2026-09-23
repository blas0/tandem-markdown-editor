import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderConnectionCard } from '../../packages/ui/compositions';
import { Alert, AlertDescription } from '../../packages/ui/coss/alert';
import { Badge } from '../../packages/ui/coss/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '../../packages/ui/coss/breadcrumb';
import { Button } from '../../packages/ui/coss/button';
import { Card } from '../../packages/ui/coss/card';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '../../packages/ui/coss/empty';
import { Group } from '../../packages/ui/coss/group';
import { Kbd, KbdGroup } from '../../packages/ui/coss/kbd';
import { Progress } from '../../packages/ui/coss/progress';
import { Separator } from '../../packages/ui/coss/separator';
import { ToggleGroup, ToggleGroupItem } from '../../packages/ui/coss/toggle-group';
import { Toolbar, ToolbarButton } from '../../packages/ui/coss/toolbar';
import { TooltipProvider } from '../../packages/ui/coss/tooltip';
import { ArrowUpRight, Minus, Plus } from '../../packages/ui/icons';
import {
  ActionMenu,
  CheckboxField,
  ColorPicker,
  Combobox,
  DiffText,
  ExpandToggle,
  IconButton,
  InlineTitle,
  ResizablePanel,
  SaveButton,
  SegmentedControl,
  SelectField,
  SettingsRow,
  SettingsSection,
  StatusBadge,
  SwitchField,
  SwitchMenu,
  TextAreaField,
  TextField,
  TitledDialog,
} from '../../packages/ui/primitives';
import { DevTools } from './dev-tools';
import './app.css';
import './gallery.css';

const sampleTitle = 'A guide to writing API documentation that people can use';

function Gallery() {
  const [theme, setTheme] = useState('light'),
    [dialog, setDialog] = useState(false);
  const [model, setModel] = useState('astra');
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState(true);
  const [marks, setMarks] = useState(['Bold', 'Italic']),
    [color, setColor] = useState<string | null>(null),
    [title, setTitle] = useState(sampleTitle);
  return (
    <div className="gallery">
      <header>
        <h1>Tandem components</h1>
        <SegmentedControl
          label="Gallery appearance"
          value={theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => {
            setTheme(v);
            document.documentElement.dataset.theme = v;
          }}
        />
      </header>
      <div className="gallery-grid">
        <div className="flex flex-col gap-3">
          <h2>Controls</h2>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Controls</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Toolbar aria-label="Text toolbar">
            <ToolbarButton render={<Button variant="ghost" />}>Copy</ToolbarButton>
            <ToolbarButton render={<Button variant="ghost" />}>Paste</ToolbarButton>
          </Toolbar>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          <SwitchField
            label="Confirm Clear review"
            description="Formatting warnings remain enabled."
            checked={confirm}
            onChange={setConfirm}
          />
          <SwitchMenu
            label="Model search"
            value={[model]}
            onChange={(value) => setModel(value[0] ?? model)}
            options={[
              { value: 'astra', label: 'Astra 6' },
              { value: 'fable', label: 'Fable 5.1' },
            ]}
          />
          <ExpandToggle
            label="Show more controls"
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
          />
          {expanded && (
            <div className="flex flex-wrap gap-2">
              {(['xs', 'sm', 'default', 'lg', 'xl'] as const).map((size) => (
                <Button key={size} size={size}>
                  Import
                </Button>
              ))}
              <Button variant="secondary">Import</Button>
              <Button variant="link">Import</Button>
              <Button variant="destructive-outline">Move to Trash</Button>
            </div>
          )}
          <StatusBadge status="connected">Connected</StatusBadge>
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="default">Accept</Button>
            <Button variant="outline">Import</Button>
            <Button variant="default">
              Continue <ArrowUpRight data-icon="inline-end" />
            </Button>
            <Button aria-invalid="true">Invalid action</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">Move to Trash</Button>
            <Button disabled>Unavailable</Button>
            <Button loading>Saving</Button>
            <IconButton label="New document">
              <Plus size={16} />
            </IconButton>
          </div>
          <Group aria-label="Text actions">
            <Button variant="outline">Copy</Button>
            <Button variant="outline">Paste</Button>
          </Group>
          <Group aria-label="Zoom actions">
            <IconButton label="Zoom out">
              <Minus />
            </IconButton>
            <IconButton label="Zoom in">
              <Plus />
            </IconButton>
          </Group>
          <Group aria-label="Nested actions">
            <Group aria-label="History actions">
              <Button variant="outline">Back</Button>
              <Button variant="outline">Forward</Button>
            </Group>
            <Group aria-label="Document actions">
              <Button variant="outline">Open</Button>
              <Button variant="outline">Close</Button>
            </Group>
          </Group>
          <TextField
            label="Invalid title"
            aria-invalid="true"
            description="Enter a document title."
            defaultValue=""
          />
          <InlineTitle title={title} onSave={async (v) => setTitle(v)} />
          <ToggleGroup
            multiple
            value={marks}
            onValueChange={setMarks}
            aria-label="Formatting states"
          >
            {['Bold', 'Italic', 'Underline'].map((mark) => (
              <ToggleGroupItem key={mark} aria-label={mark} value={mark}>
                {mark}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem aria-label="Disabled mark" value="disabled" disabled>
              Disabled
            </ToggleGroupItem>
          </ToggleGroup>
          <ColorPicker value={color ?? ''} onChange={setColor} />
          <SettingsSection title="Confirmations">
            <SettingsRow
              label="Mode-switch confirmation"
              description="Formatting warnings remain enabled."
            >
              <CheckboxField label="Confirm mode switches" defaultChecked />
            </SettingsRow>
            <SettingsRow label="Clear-review confirmation">
              <CheckboxField label="Confirm Clear review" defaultChecked />
            </SettingsRow>
          </SettingsSection>
          <TextField label="Document title" defaultValue="Interface reference" />
          <TextField label="Search documents" type="search" placeholder="Search documents" />
          <SelectField
            label="Sort by"
            value="recent"
            options={[
              { value: 'recent', label: 'Recents' },
              { value: 'title', label: 'Alphabetical' },
            ]}
            onChange={() => {}}
          />
          <Combobox
            label="Model search"
            value={model}
            options={[
              { value: 'astra', label: 'Astra 6' },
              { value: 'fable', label: 'Fable 5.1' },
              { value: 'unavailable', label: 'Unavailable model', disabled: true },
            ]}
            onChange={setModel}
          />
          <TextAreaField
            label="Cadence instructions"
            defaultValue="Use short sentences and preserve technical names."
          />
          <CheckboxField label="Queue cadence" defaultChecked />

          <ActionMenu
            items={[
              { label: 'Rename', onSelect: () => {} },
              { label: 'Duplicate', onSelect: () => {} },
              { separator: true },
              { label: 'Move to Trash', danger: true, onSelect: () => {} },
            ]}
          />
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
        </div>
        <div className="flex flex-col gap-3">
          <h2>Review</h2>
          <Card>
            <div className="flex flex-col gap-3">
              <DiffText
                before="This is a very good explanation of the API."
                after="This explanation makes the API easier to use."
              />
              <div className="flex items-center gap-3">
                <Button variant="default">Accept</Button>
                <Button variant="destructive">Reject</Button>
                <Badge>Text changed</Badge>
              </div>
            </div>
          </Card>
          <Progress value={18} max={24} aria-label="18 of 24 sentences reviewed" />
        </div>
        <div className="flex flex-col gap-3">
          <h2>Connection and feedback</h2>
          <ProviderConnectionCard
            status={{
              provider: 'codex',
              state: 'connected',
              path: '',
              version: 'Synthetic connection example',
              models: [],
            }}
            onRefresh={() => {}}
            onSetup={() => {}}
          />
          <ProviderConnectionCard
            status={{
              provider: 'claude',
              state: 'auth_required',
              path: '',
              version: '',
              models: [],
            }}
            onRefresh={() => {}}
            onSetup={() => {}}
          />
          <Alert role="status">
            <AlertDescription>Saved on this Mac.</AlertDescription>
          </Alert>
          <Alert variant="error">
            <AlertDescription>Not saved. Retry or export a recovery copy.</AlertDescription>
          </Alert>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No matching documents</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline">Clear filters</Button>
            </EmptyContent>
          </Empty>
        </div>
      </div>
      <Separator />
      <ResizablePanel
        label="Gallery panel"
        storageKey="tandem:gallery-panel"
        side="left"
        initial={320}
        min={240}
        max={480}
      >
        <Card>
          <div className="flex flex-col gap-3">
            <h2>Resizable panel</h2>
            <p>Use the separator or arrow keys to adjust the width.</p>
          </div>
        </Card>
      </ResizablePanel>
      <p className="text-muted-foreground">
        Development reference. All document and connection data on this page is synthetic.
      </p>
      <TitledDialog open={dialog} onOpenChange={setDialog} title="Document settings">
        <div className="flex flex-col gap-3">
          <TextField label="Title" defaultValue={sampleTitle} />
          <SaveButton variant="default" onClick={() => setDialog(false)}>
            Save
          </SaveButton>
        </div>
      </TitledDialog>
    </div>
  );
}
const root = document.getElementById('gallery');
if (!root) throw new Error('Gallery root is missing');
createRoot(root).render(
  <TooltipProvider>
    <div className="isolate relative flex min-h-svh flex-col">
      <Gallery />
      <DevTools />
    </div>
  </TooltipProvider>,
);
