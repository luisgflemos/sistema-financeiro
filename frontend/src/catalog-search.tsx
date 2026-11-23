import { Search, X } from "lucide-react";

export function matchesCatalog(query: string, values: unknown[]) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const text = values
    .filter((value) => typeof value === "string")
    .map((value) => {
      const normalized = normalize(String(value));
      return normalized + " " + normalized.replace(/[.\/()\s-]/g, "");
    })
    .join(" ");
  return terms.every((term) => text.includes(term));
}

export function CatalogSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="catalog-search">
      <Search size={19} aria-hidden="true" />
      <input
        type="search"
        aria-label="Pesquisar cadastros"
        placeholder="Pesquisar por nome, código ou outros dados…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar pesquisa"
          onClick={() => onChange("")}
        >
          <X size={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
