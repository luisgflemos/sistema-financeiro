import { useState } from "react";
import { api } from "./api";

type CatalogData = {
  accounts: string[];
  categories: { name: string; subcategories: string[] }[];
  cost_centers: string[];
};

type Counts = Record<"accounts" | "categories" | "subcategories" | "cost_centers", number>;

function isCatalogData(value: unknown): value is CatalogData {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CatalogData>;
  return (
    Array.isArray(file.accounts) &&
    Array.isArray(file.cost_centers) &&
    Array.isArray(file.categories) &&
    file.categories.every((row) => row && Array.isArray(row.subcategories))
  );
}

export function CatalogImport({
  organizationId,
  organizationName,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CatalogData | null>(null);
  const [result, setResult] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(file?: File) {
    setData(null);
    setResult(null);
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!isCatalogData(value)) throw new Error("Formato inválido.");
      setData(value);
    } catch {
      setError("Selecione um arquivo JSON de cadastros da Finare.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api<Counts>(`/organizations/${organizationId}/catalog-imports`, {
          method: "POST",
          body: JSON.stringify(data),
        }),
      );
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totals = result ?? (data && {
    accounts: data.accounts.length,
    categories: data.categories.length,
    subcategories: data.categories.reduce(
      (total, row) => total + row.subcategories.length,
      0,
    ),
    cost_centers: data.cost_centers.length,
  });

  return (
    <>
      <h1>Importar cadastros</h1>
      <section className="panel editor setup" aria-label="Carga de cadastros">
        <h2>{organizationName}</h2>
        <label>
          Arquivo de cadastros
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
        {totals && (
          <>
            <p role="status">
              {result
                ? "Importação concluída. Novos registros gravados"
                : "Registros no arquivo"}
            </p>
            <ul>
              <li>{totals.accounts} contas bancárias</li>
              <li>{totals.categories} classificações</li>
              <li>{totals.subcategories} subclassificações</li>
              <li>{totals.cost_centers} centros de custos</li>
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          {!result && (
            <button
              type="button"
              className="primary"
              disabled={!data || busy}
              onClick={() => void save()}
            >
              {busy ? "Processando…" : "Gravar cadastros"}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
