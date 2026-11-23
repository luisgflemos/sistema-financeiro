import { CircleMinus, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Option } from "./catalogs";

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
}: {
  id: string;
  value: string;
  options: (Option & { emphasis?: "skip" | "fixed" })[];
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    normalize(option.label).includes(normalize(query)),
  );

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
    <div className="search-select">
      <input
        ref={input}
        id={id}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          open && filtered[highlighted]
            ? `${id}-option-${highlighted}`
            : undefined
        }
        required={required}
        value={open ? query : (selected?.label ?? "")}
        placeholder="Digite para buscar"
        onFocus={() => {
          setQuery("");
          setHighlighted(0);
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
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
      {open && (
        <div className="search-options" role="listbox" id={`${id}-options`}>
          {filtered.length ? (
            filtered.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
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
