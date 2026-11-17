import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { CatalogPage } from "./catalog-page";
import { catalogIds, catalogs } from "./catalogs";
import type { CatalogId } from "./catalogs";
import "./style.css";

type Organization = { id: string; name: string };

function OrganizationForm({
  onCreate,
  onCancel,
}: {
  onCreate: (organization: Organization) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const organization = await api<Organization>("/organizations", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      onCreate(organization);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel setup" onSubmit={submit}>
      <h2>Nova organização</h2>
      <p>Crie a organização que vai reunir os seus cadastros.</p>
      <fieldset disabled={saving}>
        <label>
          Nome da organização
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </label>
        <div className="actions">
          <button className="primary" disabled={!name.trim()}>
            {saving ? "Criando…" : "Criar organização"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}

function App() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [catalog, setCatalog] = useState<CatalogId>("bank-accounts");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadOrganizations() {
      try {
        const data = await api<Organization[]>("/organizations", {
          signal: controller.signal,
        });
        setOrganizations(data);
        const saved = localStorage.getItem("autovisao.organization");
        setOrganizationId(
          data.find((item) => item.id === saved)?.id ?? data[0]?.id ?? "",
        );
      } catch {
        if (!controller.signal.aborted) {
          setError("Não foi possível carregar as organizações.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadOrganizations();
    return () => controller.abort();
  }, [attempt]);

  function selectOrganization(id: string) {
    localStorage.setItem("autovisao.organization", id);
    setOrganizationId(id);
    setCreating(false);
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="monogram" aria-hidden="true">AV</span>
          <span>Auto Visão <small>Financeiro</small></span>
        </div>
        <nav aria-label="Cadastros">
          {catalogIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={catalog === id ? "page" : undefined}
              disabled={!organizationId || loading}
              onClick={() => {
                setCatalog(id);
                setCreating(false);
              }}
            >
              {catalogs[id].label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="toolbar">
          <span>Cadastros</span>
          <div className="organization-tools">
            {organizations.length > 0 && (
              <select
                aria-label="Organização"
                value={organizationId}
                onChange={(event) => selectOrganization(event.target.value)}
              >
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {organizationId && !creating && (
              <button type="button" onClick={() => setCreating(true)}>
                Nova organização
              </button>
            )}
          </div>
        </header>
        <div className="content">
          {loading ? (
            <p role="status">Carregando organizações…</p>
          ) : error ? (
            <>
              <p role="alert" className="error">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError("");
                  setAttempt((value) => value + 1);
                }}
              >
                Tentar novamente
              </button>
            </>
          ) : creating || !organizationId ? (
            <>
              <h1>Organizações</h1>
              <OrganizationForm
                onCreate={(organization) => {
                  setOrganizations((current) => [...current, organization]);
                  selectOrganization(organization.id);
                }}
                onCancel={organizationId ? () => setCreating(false) : undefined}
              />
            </>
          ) : (
            <CatalogPage
              key={`${organizationId}/${catalog}`}
              id={catalog}
              organizationId={organizationId}
              onOpenCatalog={setCatalog}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
