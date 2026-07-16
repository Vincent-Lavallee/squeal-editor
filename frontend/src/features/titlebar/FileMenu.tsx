import { useEffect, useRef, useState } from 'react';

interface Item {
  label: string;
  onSelect: () => void;
}

interface Props {
  items: Item[];
}

/**
 * The topbar's one menu.
 *
 * Deliberately not a menu *bar*: the app has two globally-true actions, and a
 * row of mostly-empty menus is the kind of furniture the design system exists to
 * keep out. A second menu earns its place when it has something to hold.
 */
export default function FileMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // An open menu outlives the click that opened it, so it has to watch the
  // whole document to know when it is no longer wanted.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent): void {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button
        className={`menu__trigger ${open ? 'menu__trigger--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        File
      </button>

      {open && (
        <div className="menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              className="menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
