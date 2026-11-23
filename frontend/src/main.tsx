import "@fontsource-variable/inter";
import { CreditCard, Layers3, Network, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { Brand } from "./brand";
import { CatalogImport } from "./catalog-import";
import { ClassificationTree } from "./classification-tree";
import { CatalogPage } from "./catalog-page";
import { catalogIds, catalogs } from "./catalogs";
import { SessionGate } from "./session";
import "./style.css";

type CatalogId = (typeof catalogIds)[number];

type Organization = { id: string; name: string };

const catalogIcons = {
  "bank-accounts": CreditCard,
  categories: Layers3,
  "cost-centers": Network,
  parties: Users,
};

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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function CatalogIcon({ id }: { id: CatalogId }) {
  const Icon = catalogIcons[id];
  return <Icon aria-hidden="true" size={18} strokeWidth={1.75} />;
}

function App({ onLogout }: { onLogout?: () => void }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [catalog, setCatalog] = useState<CatalogId>("bank-accounts");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
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
    setImporting(false);
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Menu principal">
          <details className="nav-group" open>
            <summary>Cadastros</summary>
            <div className="nav-items">
              {catalogIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-current={catalog === id ? "page" : undefined}
                  disabled={!organizationId || loading}
                  onClick={() => {
                    setCatalog(id);
                    setCreating(false);
                    setImporting(false);
                  }}
                >
                  <CatalogIcon id={id} />
                  {catalogs[id].label}
                </button>
              ))}
            </div>
          </details>
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
            {organizationId && !creating && !importing && (
              <button type="button" onClick={() => setImporting(true)}>
                Importar cadastros
              </button>
            )}
            {onLogout && (
              <button type="button" onClick={onLogout}>
                Sair
              </button>
            )}
          </div>
        </header>
        <div className="content">
          {loading ? (
            <p role="status">Carregando organizações…</p>
          ) : error ? (
            <>
              <p role="alert" className="error">
                {error}
              </p>
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
          ) : importing ? (
            <CatalogImport
              organizationId={organizationId}
              organizationName={
                organizations.find((item) => item.id === organizationId)
                  ?.name ?? "Organização"
              }
              onClose={() => setImporting(false)}
            />
          ) : catalog === "categories" ? (
            <ClassificationTree key={organizationId} organizationId={organizationId} />
          ) : (
            <CatalogPage
              key={`${organizationId}/${catalog}`}
              id={catalog}
              organizationId={organizationId}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <SessionGate>{(onLogout) => <App onLogout={onLogout} />}</SessionGate>,
);
