import { useEffect, useRef, useState } from "react";

export function DistrictSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0, maxHeight: 320 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const items = ["", ...options];

  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(440, Math.max(160, window.innerHeight - rect.bottom - 12)),
    });
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onLayout = () => place();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  }, [open]);

  return (
    <div className="field district" ref={root}>
      <label id="district-label" htmlFor="district-trigger">行政區</label>
      <button
        id="district-trigger"
        ref={trigger}
        type="button"
        className="district-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="district-menu"
        aria-labelledby="district-label district-value"
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
      >
        <span id="district-value">{value || "全部"}</span>
        <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          id="district-menu"
          ref={menu}
          className="district-menu"
          role="listbox"
          aria-labelledby="district-label"
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [...event.currentTarget.querySelectorAll("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
            buttons[next]?.focus();
          }}
        >
          {items.map((name) => (
            <li key={name || "all"} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={name === value}
                className={name === value ? "on" : undefined}
                onClick={() => {
                  onChange(name);
                  close();
                }}
              >
                {name || "全部"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
