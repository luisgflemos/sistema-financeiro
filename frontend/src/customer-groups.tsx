import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { api } from "./api";
import { Modal } from "./modal";
import { CatalogToolbar } from "./catalog-toolbar";
import { matchesCatalog } from "./catalog-search";
import { SortHeader, useTableSort } from "./table-sort";
import { ActionButton } from "./action-button";
import "./customer-groups.css";

type Group = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  member_ids: string[];
};
type Client = {
  id: string;
  display_name: string;
  type: string;
  active: boolean;
  customer_group_id: string | null;
};

export function CustomerGroups({ organizationId }: { organizationId: string }) {
  const base = `/organizations/${organizationId}`;
  const [groups, setGroups] = useState<Group[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    active: boolean;
    member_ids: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const sorting = useTableSort("name");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api<Group[]>(base + "/customer-groups", { signal: controller.signal }),
      api<Client[]>(base + "/parties", { signal: controller.signal }),
    ])
      .then(([g, p]) => {
        if (!controller.signal.aborted) {
          setGroups(g);
          setClients(p);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, attempt]);
  function begin(group?: Group) {
    setDraft(group ? { ...group } : { name: "", active: true, member_ids: [] });
    setMemberSearch("");
    setFormError("");
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    setFormError("");
    try {
      await api<Group>(
        base + "/customer-groups" + (draft.id ? "/" + draft.id : ""),
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: draft.name.trim(),
            active: draft.active,
            member_ids: draft.member_ids,
          }),
        },
      );
      setDraft(null);
      setAttempt((v) => v + 1);
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Não foi possível salvar o grupo.",
      );
    } finally {
      setSaving(false);
    }
  }
  const visible = sorting.sorted(
    groups.filter(
      (g) =>
        (filter === "all" || g.active === (filter === "active")) &&
        matchesCatalog(query, [
          g.name,
          g.code,
          ...clients
            .filter((p) => g.member_ids.includes(p.id))
            .map((p) => p.display_name),
        ]),
    ),
    (g, key) =>
      key === "members"
        ? g.member_ids.length
        : key === "active"
          ? g.active
            ? "Ativo"
            : "Inativo"
          : key === "code"
            ? g.code
            : g.name,
  );
  const options = clients.filter(
    (c) =>
      c.type !== "SUPPLIER" && matchesCatalog(memberSearch, [c.display_name]),
  );
  return (
    <>
      <div className="page-heading">
        <h1>Grupos de Clientes</h1>
        <button
          type="button"
          className="primary"
          disabled={loading || !!error}
          onClick={() => begin()}
        >
          Novo Grupo
        </button>
      </div>
      {loading ? (
        <p role="status">Carregando grupos…</p>
      ) : error ? (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button onClick={() => setAttempt((v) => v + 1)}>
            Tentar novamente
          </button>
        </>
      ) : (
        <section className="panel listing">
          <CatalogToolbar
            title="Grupos"
            shown={visible.length}
            total={groups.length}
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
          />
          {visible.length === 0 ? (
            <div className="empty">
              <strong>
                {groups.length ? "Nenhum resultado" : "Nenhum grupo cadastrado"}
              </strong>
              <p>Crie um grupo e selecione os clientes que fazem parte dele.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table aria-label="Grupos de Clientes">
                <thead>
                  <tr>
                    <SortHeader
                      field="name"
                      label="Nome"
                      order={sorting.order}
                      onChange={sorting.change}
                    />
                    <SortHeader
                      field="code"
                      label="Código"
                      order={sorting.order}
                      onChange={sorting.change}
                    />
                    <SortHeader
                      field="members"
                      label="Clientes"
                      order={sorting.order}
                      onChange={sorting.change}
                    />
                    <SortHeader
                      field="active"
                      label="Situação"
                      order={sorting.order}
                      onChange={sorting.change}
                    />
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => (
                    <tr key={g.id}>
                      <th scope="row">{g.name}</th>
                      <td>{g.code}</td>
                      <td>
                        <strong>{g.member_ids.length}</strong>
                        <div className="field-help">
                          {clients
                            .filter((p) => g.member_ids.includes(p.id))
                            .map((p) => p.display_name)
                            .join(", ") || "Nenhum cliente vinculado"}
                        </div>
                      </td>
                      <td>
                        <span className={g.active ? "status active" : "status"}>
                          {g.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td>
                        <ActionButton
                          icon={Pencil}
                          label="Editar"
                          ariaLabel={`Editar grupo ${g.name}`}
                          onClick={() => begin(g)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {draft && (
        <Modal
          title={
            draft.id ? "Editar Grupo de Clientes" : "Novo Grupo de Clientes"
          }
          busy={saving}
          onClose={() => setDraft(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={saving}>
              <div className="field">
                <label htmlFor="customer-group-name">Nome do Grupo</label>
                <input
                  id="customer-group-name"
                  value={draft.name}
                  maxLength={200}
                  required
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <section className="group-members">
                <div className="group-members-heading">
                  <strong>Clientes do Grupo</strong>
                  <span>{draft.member_ids.length} selecionados</span>
                </div>
                <input
                  type="search"
                  aria-label="Pesquisar clientes para o grupo"
                  placeholder="Digite parte do nome do cliente…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                <div className="group-member-list">
                  {options.map((c) => {
                    const other =
                      c.customer_group_id && c.customer_group_id !== draft.id;
                    return (
                      <label key={c.id} className="group-member">
                        <input
                          type="checkbox"
                          checked={draft.member_ids.includes(c.id)}
                          disabled={!!other || saving}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              member_ids: e.target.checked
                                ? [...draft.member_ids, c.id]
                                : draft.member_ids.filter((id) => id !== c.id),
                            })
                          }
                        />
                        <span>
                          {c.display_name}
                          {other && (
                            <small>
                              Já pertence a{" "}
                              {groups.find((g) => g.id === c.customer_group_id)
                                ?.name || "outro grupo"}
                            </small>
                          )}
                          {!c.active && <small>Cliente inativo</small>}
                        </span>
                      </label>
                    );
                  })}
                  {options.length === 0 && <p>Nenhum cliente encontrado.</p>}
                </div>
              </section>
              <button
                type="button"
                className="group-active"
                role="switch"
                aria-checked={draft.active}
                aria-label="Grupo ativo"
                onClick={() => setDraft({ ...draft, active: !draft.active })}
              >
                <span className="group-switch" data-active={draft.active}>
                  <span />
                </span>
                Grupo ativo
              </button>
              {formError && (
                <p className="error" role="alert">
                  {formError}
                </p>
              )}
              <div className="actions">
                <button className="primary" type="submit">
                  {saving ? "Salvando…" : "Salvar Grupo"}
                </button>
                <button type="button" onClick={() => setDraft(null)}>
                  Cancelar
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </>
  );
}
