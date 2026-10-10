import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const KEYS: [string[], string][] = [
  [['Space'], 'Turn crank / pause'],
  [['→', '.'], 'Step one physics tick (1/240 s)'],
  [['R'], 'Reverse reset (crank backwards, keep state)'],
  [['L'], 'Reload — rebuilds the world, not a mechanical reset'],
  [['E'], 'Evaluate all 16 input pairs'],
  [['1', '–', '5'], 'Speed ⅛× ¼× ½× 1× 2×'],
  [['F'], 'Fit the machine ⇄ show the whole workspace'],
  [['?'], 'Show these shortcuts'],
  [
    ['Esc'],
    'Back to live from a replay, else clear the selection; closes dialogs',
  ],
];

const VIEW: [string[], string][] = [
  [['drag'], 'Pan'],
  [['wheel', 'pinch'], 'Zoom toward the pointer'],
  [['double-click'], 'Fit the machine ⇄ workspace'],
  [['click'], 'Select a part'],
  [['+', '−'], 'Zoom (viewport focused)'],
  [['Shift', '←↑↓→'], 'Pan (viewport focused); plain arrows still step'],
  [['0'], 'Fit (viewport focused)'],
];

export function Shortcuts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  // A click on the backdrop (the dialog element itself) closes it.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      if (event.target === el) onClose();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [onClose]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="keys-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-inner">
        <header className="drawer-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="keys">
          <dl>
            {KEYS.map(([keys, text]) => (
              <div key={text} className="keys-row">
                <dt>
                  {keys.map((k) =>
                    k === '–' ? (
                      <span key={k} className="dim">
                        –
                      </span>
                    ) : (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ),
                  )}
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <h3 className="micro">Viewport</h3>
          <dl>
            {VIEW.map(([keys, text]) => (
              <div key={text} className="keys-row">
                <dt>
                  {keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="fine">
            Shortcuts are ignored while you type in a field.
          </p>
        </div>
      </div>
    </dialog>
  );
}
