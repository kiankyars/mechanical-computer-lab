import { useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  FolderOpen,
  Keyboard,
  Share2,
  SquarePen,
} from 'lucide-react';
import { BrandMark, GitHubMark } from './Marks';
import { MachineThumb } from './MachineThumb';

export type PickerEntry = {
  key: string;
  title: string;
  blurb: string;
  tag: string;
  text: string;
};

type Props = {
  entries: PickerEntry[];
  currentKey: string | null;
  onPick: (key: string) => void;
  onOpenFile: () => void;
  onEdit: () => void;
  onShare: () => void;
  onSaveTrace: () => void;
  canSaveTrace: boolean;
  onKeys: () => void;
};

export const REPO_URL = 'https://github.com/kiankyars/mechanical-computer-lab';

function Picker({
  entries,
  currentKey,
  onPick,
}: Pick<Props, 'entries' | 'currentKey' | 'onPick'>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = entries.find((e) => e.key === currentKey);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="picker" ref={root}>
      <button
        ref={button}
        type="button"
        className="picker-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="picker-label micro">Machine</span>
        <span className="picker-title">{current?.title ?? 'Loading…'}</span>
        {current && <span className="picker-tag">{current.tag}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-panel" id={id}>
          <p className="micro dim picker-head">Gallery</p>
          <ul>
            {entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="picker-item"
                  aria-current={entry.key === currentKey || undefined}
                  onClick={() => {
                    setOpen(false);
                    onPick(entry.key);
                  }}
                >
                  <MachineThumb text={entry.text} />
                  <span className="picker-item-text">
                    <span className="picker-item-title">
                      {entry.title}
                      <span className="picker-tag">{entry.tag}</span>
                    </span>
                    <span className="picker-item-blurb">{entry.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Header(props: Props) {
  return (
    <header className="masthead">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <h1 className="brand-name">Mechanical Computer Lab</h1>
          <p className="brand-sub">
            <span>Experiment 01</span> · <span>two-bit adder</span> ·{' '}
            <span>rigid-body physics</span>
          </p>
        </div>
      </div>
      <div className="masthead-tools">
        <Picker
          entries={props.entries}
          currentKey={props.currentKey}
          onPick={props.onPick}
        />
        <div className="actions">
          <button
            type="button"
            className="tool"
            onClick={props.onOpenFile}
            title="Open a machine JSON file (it stays in this browser)"
          >
            <FolderOpen size={16} aria-hidden="true" />
            <span>Open JSON</span>
          </button>
          <button
            type="button"
            className="tool"
            onClick={props.onEdit}
            title="Edit the machine JSON"
          >
            <SquarePen size={16} aria-hidden="true" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="tool"
            onClick={props.onShare}
            title="Copy a link that carries this machine inside the URL"
          >
            <Share2 size={16} aria-hidden="true" />
            <span>Share link</span>
          </button>
          <button
            type="button"
            className="tool"
            onClick={props.onSaveTrace}
            disabled={!props.canSaveTrace}
            title="Save the recorded frames as JSON"
          >
            <Download size={16} aria-hidden="true" />
            <span>Save trace</span>
          </button>
          <span className="tool-sep" aria-hidden="true" />
          <button
            type="button"
            className="tool tool-icon tool-keys"
            onClick={props.onKeys}
            aria-label="Keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={16} aria-hidden="true" />
          </button>
          <a
            className="tool tool-icon"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="Source on GitHub"
          >
            <GitHubMark />
          </a>
        </div>
      </div>
    </header>
  );
}
