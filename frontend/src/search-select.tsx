import { ChevronDown, CircleMinus, Layers } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Option } from "./catalogs";
import "./search-select.css";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function SearchSelect({
  id,
  value,
  options,
  required,
  onChange,
  ariaLabel,
  disabled,
  className,
  onSearchChange,
}: {
  id?: string;
  value: string;
  options: (Option & { emphasis?: "skip" | "fixed" })[];
  required?: boolean;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  onSearchChange?: (value: string) => void;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ up: false, height: 256 });
  const selected = options.find((option) => option.value === value);
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filtered = options.filter((option) =>
    words.every((word) => normalize(option.label).includes(word)),
  );

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!input.current) return;
      const rect = input.current.getBoundingClientRect();
      const modal = input.current.closest("dialog")?.getBoundingClientRect();
      const top = Math.max(8, modal ? modal.top + 8 : 8);
      const bottom = Math.min(
        window.innerHeight - 8,
        modal ? modal.bottom - 8 : window.innerHeight - 8,
      );
      const above = Math.max(0, rect.top - top - 6);
      const below = Math.max(0, bottom - rect.bottom - 6);
      const needed = Math.min(256, Math.max(52, filtered.length * 46));
      const up = below < needed && above > below;
      setPlacement({
        up,
        height: Math.max(40, Math.min(256, up ? above : below)),
      });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, filtered.length]);
  useEffect(() => {
    if (!open || !list.current) return;
    const item = list.current
      .querySelectorAll('[role="option"]')
      .item(highlighted);
    if (!item) return;
    const box = list.current.getBoundingClientRect();
    const option = item.getBoundingClientRect();
    if (option.bottom > box.bottom)
      list.current.scrollTop += option.bottom - box.bottom;
    else if (option.top < box.top)
      list.current.scrollTop -= box.top - option.top;
  }, [highlighted, open]);

  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? "Selecione uma opção da lista." : "",
    );
  }, [required, value]);

  function choose(option: Option) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={["search-select", className ?? ""].join(" ")}>
      <input
        ref={input}
        id={inputId}
        aria-label={ariaLabel}
        disabled={disabled}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${inputId}-options`}
        aria-activedescendant={
          open && filtered[highlighted]
            ? `${inputId}-option-${highlighted}`
            : undefined
        }
        aria-required={required}
        value={open ? query : (selected?.label ?? "")}
        placeholder="Digite para buscar"
        onClick={() => {
          if (!open) {
            setQuery("");
            onSearchChange?.("");
            setHighlighted(0);
            setOpen(true);
          }
        }}
        onFocus={() => {
          setQuery("");
          onSearchChange?.("");
          setHighlighted(0);
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          onSearchChange?.(event.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setHighlighted((current) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (filtered[highlighted]) choose(filtered[highlighted]);
          }
        }}
      />
      <ChevronDown
        className={"search-select-chevron" + (open ? " is-open" : "")}
        size={17}
        aria-hidden="true"
      />
      {open && (
        <div
          ref={list}
          className="search-options"
          role="listbox"
          id={`${inputId}-options`}
          style={{
            top: placement.up ? "auto" : "calc(100% + 0.25rem)",
            bottom: placement.up ? "calc(100% + 0.25rem)" : "auto",
            maxHeight: placement.height,
          }}
        >
          {filtered.length ? (
            filtered.map((option, index) => (
              <div
                key={option.value}
                id={`${inputId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-label={option.label}
                className={[
                  highlighted === index ? "highlighted" : "",
                  option.emphasis
                    ? `import-choice import-choice-${option.emphasis}`
                    : "",
                ].join(" ")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.emphasis ? (
                  <>
                    {option.emphasis === "fixed" ? (
                      <Layers size={20} aria-hidden="true" />
                    ) : (
                      <CircleMinus size={20} aria-hidden="true" />
                    )}
                    <span>
                      <strong>{option.label}</strong>
                      <small>
                        {option.emphasis === "fixed"
                          ? "Defina um único valor para todas as linhas"
                          : "Sem coluna associada a este campo"}
                      </small>
                    </span>
                  </>
                ) : (
                  option.label
                )}
              </div>
            ))
          ) : (
            <p role="status">Nenhuma opção encontrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
