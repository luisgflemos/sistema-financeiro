import type { ReactNode } from "react";
import { CatalogSearch } from "./catalog-search";
import { SearchSelect } from "./search-select";

export function CatalogToolbar({
  title,
  headingId,
  shown,
  total,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  children,
}: {
  title: string;
  headingId?: string;
  shown: number;
  total: number;
  query: string;
  onQueryChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="catalog-toolbar">
      <div className="catalog-toolbar-title">
        <h2 id={headingId}>{title}</h2>
        <span className="catalog-toolbar-count" role="status">
          {shown} de {total}
        </span>
      </div>
      <CatalogSearch value={query} onChange={onQueryChange} />
      <div className="catalog-toolbar-actions">{children}</div>
      <SearchSelect
        ariaLabel="Filtrar por situação"
        value={filter}
        onChange={onFilterChange}
        options={[
          { value: "all", label: "Todas as situações" },
          { value: "active", label: "Ativos" },
          { value: "inactive", label: "Inativos" },
        ]}
      />
    </div>
  );
}
