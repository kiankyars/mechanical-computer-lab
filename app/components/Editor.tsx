import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Download, Link, Play, Wand2, X } from 'lucide-react';
import { LIMITS } from '../../simulator/protocol';
import { bytes as formatBytes } from '../lib/format';
import { formatJson, locateJsonPath } from '../lib/json';
import {
  validateMachineText,
  type Issue,
  type Validation,
} from '../lib/validate';
import { REPO_URL } from './Header';

type Props = {
  open: boolean;
  initialText: string;
  title: string;
  onClose: () => void;
  onApply: (text: string) => void;
  onDownload: (text: string) => void;
  onCopyLink: (text: string) => void;
};

export function Editor(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(props.initialText);
  const [result, setResult] = useState<Validation>(() =>
    validateMachineText(props.initialText),
  );
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (props.open && !el.open) {
      setText(props.initialText);
      setResult(validateMachineText(props.initialText));
      el.showModal();
      requestAnimationFrame(() => area.current?.focus());
    } else if (!props.open && el.open) el.close();
  }, [props.open, props.initialText]);

  // Debounced live validation with the frozen schema parser.
  useEffect(() => {
    if (!props.open) return;
    setChecking(true);
    const timer = setTimeout(() => {
      setResult(validateMachineText(text));
      setChecking(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [text, props.open]);

  const lines = text.split('\n').length;
  const tooBig = result.bytes > LIMITS.fileBytes;
  const errorLine =
    !checking && !result.ok && result.position !== undefined
      ? text.slice(0, result.position).split('\n').length
      : null;

  const format = () => {
    try {
      setText(formatJson(JSON.parse(text)));
    } catch {
      // Syntax errors are already listed below.
    }
  };
  const apply = () => {
    const now = validateMachineText(text);
    setResult(now);
    if (now.ok) props.onApply(text);
  };
  /** Select a range in the text and scroll it into view (textareas do not
   * reliably scroll to a programmatic selection). */
  const select = (start: number, end: number) => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, Math.max(start, Math.min(text.length, end)));
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const before = text.slice(0, start).split('\n');
    const line = before.length - 1;
    const top = line * lineHeight + (parseFloat(style.paddingTop) || 0);
    if (top < el.scrollTop || top + lineHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    const column = before.at(-1)!.length;
    const charWidth = (parseFloat(style.fontSize) || 12) * 0.6;
    const left = column * charWidth;
    if (left < el.scrollLeft || left > el.scrollLeft + el.clientWidth - 40)
      el.scrollLeft = Math.max(0, left - 40);
  };
  const locate = (issue: Issue): { start: number; end: number } | null => {
    if (result.ok) return null;
    if (result.kind === 'syntax')
      return result.position === undefined
        ? null
        : { start: result.position, end: result.position + 1 };
    return issue.keys ? (locateJsonPath(text, issue.keys) ?? null) : null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-labelledby="editor-title"
      onClose={props.onClose}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div>
            <h2 id="editor-title">Machine editor</h2>
            <p className="fine">
              Editing a copy of <strong>{props.title}</strong>. Nothing leaves
              this browser.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close editor (Esc)"
            onClick={props.onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-tools">
          <button type="button" className="btn btn-sm" onClick={format}>
            <Wand2 size={14} aria-hidden="true" />
            Format
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => props.onDownload(text)}
          >
            <Download size={14} aria-hidden="true" />
            Download
          </button>
          <button
            type="button"
            className="btn btn-sm"
            // A link to an invalid draft would only fail for its recipient.
            disabled={!result.ok || checking}
            title={
              result.ok
                ? 'Copy a link that carries this draft inside the URL'
                : 'Fix the issues below to share this draft'
            }
            onClick={() => props.onCopyLink(text)}
          >
            <Link size={14} aria-hidden="true" />
            Copy share link
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!result.ok || checking}
            onClick={apply}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title="Apply (⌘/Ctrl + Enter)"
          >
            <Play size={14} aria-hidden="true" />
            Apply
          </button>
        </div>
        <div className="code">
          <div ref={gutter} className="code-gutter" aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => (
              <span key={i} data-error={errorLine === i + 1 || undefined}>
                {i + 1}
              </span>
            ))}
          </div>
          <textarea
            ref={area}
            className="code-area"
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            aria-label="Machine JSON"
            aria-describedby="editor-status"
            onChange={(event) => setText(event.target.value)}
            onScroll={(event) => {
              if (gutter.current)
                gutter.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <footer className="drawer-foot" id="editor-status" aria-live="polite">
          <div className="validity" data-ok={result.ok || undefined}>
            <span className="validity-glyph" aria-hidden="true">
              {checking ? '…' : result.ok ? '✓' : '✗'}
            </span>
            <span>
              {checking
                ? 'Checking…'
                : result.ok
                  ? `Schema valid · ${result.machine.bodies.length} bodies · ${result.machine.joints.length} joints. Physical checks run when applied.`
                  : result.kind === 'syntax'
                    ? 'JSON syntax error'
                    : result.kind === 'size'
                      ? 'Too large'
                      : `${result.issues.length} schema issue${result.issues.length === 1 ? '' : 's'}`}
            </span>
            <span className="size mono" data-over={tooBig || undefined}>
              {formatBytes(result.bytes)} / {LIMITS.fileBytes / 1000} KB
            </span>
          </div>
          <div className="meter meter-thin" aria-hidden="true">
            <span
              data-over={tooBig || undefined}
              style={{
                width: `${Math.min(100, (result.bytes / LIMITS.fileBytes) * 100)}%`,
              }}
            />
          </div>
          {!result.ok && !checking && (
            <ul className="issues">
              {result.issues.slice(0, 12).map((issue, i) => {
                const range = locate(issue);
                return (
                  <li key={i}>
                    {range ? (
                      <button
                        type="button"
                        className="link-btn mono"
                        title="Show this in the text"
                        onClick={() => select(range.start, range.end)}
                      >
                        {issue.path}
                      </button>
                    ) : (
                      <code>{issue.path}</code>
                    )}
                    <span>{issue.message}</span>
                  </li>
                );
              })}
              {result.issues.length > 12 && (
                <li className="dim">…and {result.issues.length - 12} more</li>
              )}
            </ul>
          )}
          {result.ok && !checking && (
            <p className="fine">
              <Check size={12} aria-hidden="true" /> Apply loads it as “Edited”
              without touching the preset. See{' '}
              <a
                href={`${REPO_URL}/blob/main/docs/machine-format.md`}
                target="_blank"
                rel="noreferrer"
              >
                the machine format
              </a>
              .
            </p>
          )}
        </footer>
      </div>
    </dialog>
  );
}
