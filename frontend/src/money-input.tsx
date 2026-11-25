import { useLayoutEffect, useRef } from "react";

// Strings keep the displayed cents exact; the API receives a decimal string.
export function formatMoney(value: string) {
  if (!/\d/.test(value)) return "";
  const clean = value.replace(/[^\d,.]/g, "");
  const separator = clean.includes(",")
    ? clean.lastIndexOf(",")
    : /^\d+\.\d{1,2}$/.test(clean)
      ? clean.lastIndexOf(".")
      : -1;
  const whole =
    (separator < 0 ? clean : clean.slice(0, separator))
      .replace(/\D/g, "")
      .replace(/^0+(?=\d)/, "") || "0";
  const cents =
    separator < 0
      ? "00"
      : clean
          .slice(separator + 1)
          .replace(/\D/g, "")
          .slice(0, 2)
          .padEnd(2, "0");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + cents;
}

export function moneyDecimal(value: string) {
  return formatMoney(value).replaceAll(".", "").replace(",", ".");
}

export function MoneyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  const formatted = formatMoney(value);
  useLayoutEffect(() => {
    if (cursor.current != null && document.activeElement === input.current) {
      input.current?.setSelectionRange(cursor.current, cursor.current);
      cursor.current = null;
    }
  });
  return (
    <input
      ref={input}
      required
      inputMode="decimal"
      placeholder="0,00"
      value={formatted}
      onKeyDown={(event) => {
        if ((event.key === "," || event.key === ".") && formatted) {
          event.preventDefault();
          const start = formatted.indexOf(",") + 1;
          event.currentTarget.setSelectionRange(start, formatted.length);
        }
      }}
      onChange={(event) => {
        const raw = event.target.value;
        const position = event.target.selectionStart ?? raw.length;
        const before = raw.slice(0, position);
        const next = formatMoney(raw);
        const digits = before.replace(/\D/g, "").length;
        let seen = 0;
        let caret = 0;
        for (; caret < next.length && seen < digits; caret++) {
          if (/\d/.test(next[caret])) seen++;
        }
        if (before.endsWith(",")) caret = next.indexOf(",") + 1;
        cursor.current = caret;
        onChange(next);
      }}
    />
  );
}
