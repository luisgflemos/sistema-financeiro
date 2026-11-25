import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import "./table-sort.css";

export type TableOrder = { field: string; direction: "asc" | "desc" };
const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export function compareValues(
  a: unknown,
  b: unknown,
  direction: "asc" | "desc",
) {
  const missing = (value: unknown) =>
    value == null || value === "" || value === "—";
  if (missing(a) || missing(b))
    return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
  const value =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return direction === "asc" ? value : -value;
}

export function useTableSort(field: string, direction: "asc" | "desc" = "asc") {
  const [order, setOrder] = useState<TableOrder>({ field, direction });
  function change(next: string) {
    setOrder((previous) => ({
      field: next,
      direction:
        previous.field === next && previous.direction === "asc"
          ? "desc"
          : "asc",
    }));
  }
  function sorted<T>(rows: T[], value: (row: T, field: string) => unknown) {
    return rows
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) =>
          compareValues(
            value(a.row, order.field),
            value(b.row, order.field),
            order.direction,
          ) || a.index - b.index,
      )
      .map((item) => item.row);
  }
  return { order, change, sorted };
}

export function SortHeader({
  field,
  label,
  order,
  onChange,
}: {
  field: string;
  label: string;
  order: TableOrder;
  onChange: (field: string) => void;
}) {
  const active = order.field === field;
  const next =
    active && order.direction === "asc" ? "decrescente" : "crescente";
  const Icon = active
    ? order.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? order.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="sortable-header-button"
        data-active={active}
        aria-label={`Ordenar por ${label}: ${next}`}
        title={`Ordenar por ${label} (${next})`}
        onClick={() => onChange(field)}
      >
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
  );
}
