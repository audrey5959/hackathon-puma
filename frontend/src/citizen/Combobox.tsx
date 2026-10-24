import { useEffect, useId, useRef, useState } from "react";

export type Option = { key: string; label: string };

// 可以打字篩選的下拉選單；value 是輸入框平常顯示的文字，options 依目前輸入的字算出來
export default function Combobox({ label, value, options, empty, onSelect }: {
  label: string;
  value: string;
  options: (query: string) => Option[];
  empty: string;
  onSelect: (key: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // null 代表沒在打字，輸入框顯示 value
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = open ? options(text ?? "") : [];

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // 沒打字時從目前選的那一項開始移動
  function show(query = "") {
    setOpen(true);
    setActive(query ? 0 : Math.max(0, options("").findIndex((o) => o.label === value)));
  }
  // 收合時放掉打到一半的字，輸入框回到 value
  function close() {
    setOpen(false);
    setText(null);
  }
  function pick(o: Option) {
    close();
    onSelect(o.key);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (shown.length ? (i + step + shown.length) % shown.length : 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className="combo">
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="done"
        value={text ?? value}
        onFocus={(e) => { e.target.select(); show(); }}
        onClick={() => !open && show()}
        onChange={(e) => { setText(e.target.value); show(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {open && (
        // mousedown 不搶走輸入框的焦點，點選項時才不會先觸發 onBlur 收合
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
          {shown.length === 0 && <li className="empty">{empty}</li>}
          {shown.map((o, i) => (
            <li
              key={o.key}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseMove={() => setActive(i)}
              onClick={() => { pick(o); input.current?.blur(); }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
