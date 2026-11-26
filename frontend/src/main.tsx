import "@fontsource-variable/inter";
import { Layers3, ArrowLeftRight, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { Modal } from "./modal";
import { Brand } from "./brand";
import { CatalogWorkspace } from "./catalog-workspace";
import { catalogIds, catalogs } from "./catalogs";
import { TransactionsWorkspace } from "./transactions-workspace";
import { SessionGate } from "./session";
import { Assistant } from "./assistant";
import { SearchSelect } from "./search-select";
import "./style.css";
import "./transactions.css";
import "./sidebar-navigation.css";
import "./density.css";

type CatalogId = (typeof catalogIds)[number];

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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function App({ onLogout }: { onLogout?: () => void }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [catalog, setCatalog] = useState<CatalogId | "transactions">(
    "bank-accounts",
  );
  const [lastCatalog, setLastCatalog] = useState<CatalogId>("bank-accounts");
  const [openMenu, setOpenMenu] = useState<"catalogs" | "transactions" | null>(
    "catalogs",
  );
  const [transactionView, setTransactionView] = useState<
    "import" | "history" | "planning"
  >("import");
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
        <Brand />
        <nav aria-label="Menu principal">
          <button
            type="button"
            className="menu-group-toggle"
            aria-expanded={openMenu === "catalogs"}
            aria-controls="catalog-sidebar-menu"
            disabled={!organizationId || loading}
            onClick={() => {
              setCatalog(lastCatalog);
              setOpenMenu((previous) =>
                previous === "catalogs" ? null : "catalogs",
              );
              setCreating(false);
            }}
          >
            <Layers3 size={18} aria-hidden="true" />
            Cadastros
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {openMenu === "catalogs" && (
            <div id="catalog-sidebar-menu" className="side-submenu">
              {catalogIds.map((id) => (
                <button
                  type="button"
                  key={id}
                  disabled={!organizationId || loading}
                  aria-current={catalog === id ? "page" : undefined}
                  onClick={() => {
                    setCatalog(id);
                    setLastCatalog(id);
                    setCreating(false);
                  }}
                >
                  {catalogs[id].label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="menu-group-toggle"
            aria-expanded={openMenu === "transactions"}
            aria-controls="transaction-sidebar-menu"
            disabled={!organizationId || loading}
            onClick={() => {
              setCatalog("transactions");
              setOpenMenu((previous) =>
                previous === "transactions" ? null : "transactions",
              );
              setCreating(false);
            }}
          >
            <ArrowLeftRight size={18} aria-hidden="true" />
            Transações
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {openMenu === "transactions" && (
            <div id="transaction-sidebar-menu" className="side-submenu">
              {(
                [
                  ["import", "Importar Extrato"],
                  ["history", "Histórico"],
                  ["planning", "Lançamentos"],
                ] as const
              ).map(([view, label]) => (
                <button
                  type="button"
                  key={view}
                  disabled={!organizationId || loading}
                  aria-current={
                    catalog === "transactions" && transactionView === view
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    setCatalog("transactions");
                    setTransactionView(view);
                    setCreating(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </nav>
      </aside>
      <main>
        <header className="toolbar">
          <span className="toolbar-title">
            {catalog === "transactions" ? "Transações" : "Cadastros"}
          </span>
          <div className="organization-tools">
            {organizations.length > 0 && (
              <SearchSelect
                ariaLabel="Organização"
                value={organizationId}
                onChange={selectOrganization}
                options={organizations.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            )}
            {organizationId && !creating && (
              <button type="button" onClick={() => setCreating(true)}>
                Nova organização
              </button>
            )}
            {onLogout && (
              <button type="button" onClick={onLogout}>
                Sair
              </button>
            )}
          </div>
        </header>
        {creating && (
          <Modal title="Nova organização" onClose={() => setCreating(false)}>
            <OrganizationForm
              onCreate={(organization) => {
                setOrganizations((current) => [...current, organization]);
                selectOrganization(organization.id);
              }}
              onCancel={() => setCreating(false)}
            />
          </Modal>
        )}
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
          ) : !organizationId ? (
            <>
              <h1>Organizações</h1>
              <button
                type="button"
                className="primary"
                onClick={() => setCreating(true)}
              >
                Nova organização
              </button>
            </>
          ) : catalog === "transactions" ? (
            <TransactionsWorkspace
              key={organizationId}
              organizationId={organizationId}
              view={transactionView}
            />
          ) : (
            <CatalogWorkspace
              key={organizationId}
              organizationId={organizationId}
              selected={catalog}
            />
          )}
        </div>
      </main>
      {organizationId && (
        <Assistant
          key={organizationId}
          organizationId={organizationId}
          screen={
            catalog === "transactions" ? "Transações" : catalogs[catalog].label
          }
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <SessionGate>{(onLogout) => <App onLogout={onLogout} />}</SessionGate>,
);
