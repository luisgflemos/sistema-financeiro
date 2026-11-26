import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { CatalogSearch } from "./catalog-search";
import { brl, brazilDate } from "./statement-import";
import type { RecordData } from "./catalogs";
import { categoryNature } from "./movement-nature";
import { SortHeader, useTableSort } from "./table-sort";
import { MoneyInput, moneyDecimal } from "./money-input";
import { Pencil, ListChecks, Ban, Trash2, Unlink } from "lucide-react";
import { ActionButton } from "./action-button";
import "./planning.css";

export type PlannedEntry = {
  id: string;
  description: string;
  due_on: string;
  direction: "CREDIT" | "DEBIT";
  expected_amount: string;
  paid: string;
  outstanding: string;
  difference: string;
  state: string;
  situation: string;
  discount: string;
  surcharge: string;
  version: number;
  party_name: string | null;
  occurrence: number;
  occurrences: number;
  category_id: string;
  subcategory_id: string;
  cost_center_id: string | null;
  party_id: string | null;
  account_id: string | null;
  notes: string | null;
  can_delete: boolean;
};
const labels: Record<string, string> = {
  upcoming: "A vencer",
  overdue: "Vencido",
  paid: "Baixado",
  cancelled: "Cancelado",
};
type Draft = Record<string, string>;
function lastDueDate(draft: Draft) {
  const count = Number(draft.occurrences);
  if (!draft.due_on || !Number.isInteger(count) || count < 1 || count > 120)
    return "";
  const first = new Date(draft.due_on + "T12:00:00Z");
  if (Number.isNaN(first.getTime())) return "";
  if (draft.frequency === "WEEKLY")
    first.setUTCDate(first.getUTCDate() + 7 * (count - 1));
  else if (draft.frequency !== "ONCE") {
    const day = first.getUTCDate();
    first.setUTCDate(1);
    first.setUTCMonth(
      first.getUTCMonth() +
        (count - 1) * (draft.frequency === "MONTHLY" ? 1 : 12),
    );
    const end = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    );
    first.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  return first.toISOString().slice(0, 10);
}
const blank = (direction: string): Draft => ({
  description: "",
  due_on: new Date().toLocaleDateString("sv-SE"),
  direction,
  expected_amount: "",
  account_id: "",
  category_id: "",
  subcategory_id: "",
  cost_center_id: "",
  party_id: "",
  notes: "",
  frequency: "ONCE",
  occurrences: "1",
});
export function PlanningPage({ organizationId }: { organizationId: string }) {
  const base = "/organizations/" + organizationId;
  const [rows, setRows] = useState<PlannedEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({
    expected: "0",
    paid: "0",
    receivable: "0",
    payable: "0",
  });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("active");
  const [direction, setDirection] = useState("");
  const [page, setPage] = useState(1);
  const sorting = useTableSort("due_on");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, RecordData[]>>({});
  const [form, setForm] = useState(false);
  const [editing, setEditing] = useState<PlannedEntry | null>(null);
  const [draft, setDraft] = useState<Draft>(blank("DEBIT"));
  const [requestKey, setRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [cancelling, setCancelling] = useState<PlannedEntry | null>(null);
  const [excluding, setExcluding] = useState<PlannedEntry | null>(null);
  const [exclusionScope, setExclusionScope] = useState("current");
  const [exclusionPreview, setExclusionPreview] = useState<{
    count: number;
    blocked: number;
    revision: string;
    version: number;
    description: string;
    total_expected: string;
    first_due_on: string;
    last_due_on: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detail, setDetail] = useState<PlannedEntry | null>(null);
  const [settlements, setSettlements] = useState<
    {
      id: string;
      transaction_id: string;
      amount: string;
      posted_on: string;
      raw_description: string;
      reversed: boolean;
      account_label: string;
      discount: string;
      surcharge: string;
    }[]
  >([]);
  useEffect(() => {
    if (!excluding) return;
    const controller = new AbortController();
    setExclusionPreview(null);
    setPreviewLoading(true);
    setFormError("");
    api<NonNullable<typeof exclusionPreview>>(
      base +
        "/planned-entries/" +
        excluding.id +
        "/exclusion-preview?scope=" +
        exclusionScope,
      { signal: controller.signal },
    )
      .then(setExclusionPreview)
      .catch((error) => {
        if (!controller.signal.aborted) setFormError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [base, excluding, exclusionScope]);
  useEffect(() => {
    if (!form || !catalogs.categories) return;
    setDraft((previous) => {
      if (
        previous.category_id &&
        !catalogs.categories.some(
          (row) =>
            row.active &&
            row.id === previous.category_id &&
            row.kind === categoryNature(previous.direction),
        )
      )
        return { ...previous, category_id: "", subcategory_id: "" };
      return previous;
    });
  }, [form, draft.direction, catalogs]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      query: search,
      state,
      page: String(page),
      sort_by: sorting.order.field,
      sort_order: sorting.order.direction,
    });
    if (direction) params.set("direction", direction);
    api<{ rows: PlannedEntry[]; total: number; totals: typeof totals }>(
      base + "/planned-entries?" + params,
      { signal: controller.signal },
    )
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
        setTotals(data.totals);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, search, state, direction, page, refresh, sorting.order]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      [
        "bank-accounts",
        "categories",
        "subcategories",
        "cost-centers",
        "parties",
      ].map(
        async (key) =>
          [
            key,
            await api<RecordData[]>(base + "/" + key, {
              signal: controller.signal,
            }),
          ] as const,
      ),
    )
      .then((items) => setCatalogs(Object.fromEntries(items)))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base]);
  function options(key: string) {
    return (catalogs[key] ?? [])
      .filter(
        (row) =>
          row.active &&
          (key !== "categories" ||
            row.kind === categoryNature(draft.direction)),
      )
      .map((row) => ({
        value: row.id,
        label: String(row.display_name ?? row.label ?? row.name),
      }));
  }
  function update(key: string, value: string) {
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(key === "category_id" ? { subcategory_id: "" } : {}),
      ...(key === "frequency" && value === "ONCE" ? { occurrences: "1" } : {}),
      ...(key === "frequency" && value !== "ONCE" && old.occurrences === "1"
        ? { occurrences: "2" }
        : {}),
    }));
  }
  function start(direction: string, record: PlannedEntry | null = null) {
    setEditing(record);
    setDraft(
      record
        ? {
            ...blank(record.direction),
            ...Object.fromEntries(
              Object.entries(record).map(([key, value]) => [
                key,
                String(value ?? ""),
              ]),
            ),
          }
        : blank(direction),
    );
    setRequestKey(crypto.randomUUID());
    setFormError("");
    setForm(true);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const { frequency, occurrences, ...fields } = draft;
      const payload = {
        ...Object.fromEntries(
          Object.entries(fields)
            .filter(([key]) =>
              [
                "description",
                "due_on",
                "direction",
                "expected_amount",
                "account_id",
                "category_id",
                "subcategory_id",
                "cost_center_id",
                "party_id",
                "notes",
              ].includes(key),
            )
            .map(([key, value]) => [key, value || null]),
        ),
        expected_amount: moneyDecimal(draft.expected_amount),
      };
      let created = 0;
      if (editing)
        await api(base + "/planned-entries/" + editing.id, {
          method: "PUT",
          body: JSON.stringify({
            ...payload,
            expected_version: editing.version,
          }),
        });
      else {
        const result = await api<{ created: number; repeated: boolean }>(
          base + "/planned-entries",
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              frequency,
              occurrences: Number(occurrences),
              request_key: requestKey,
            }),
          },
        );
        created = result.created;
      }
      setNotice(
        editing
          ? "Lançamento atualizado."
          : `${created} lançamento(s) previsto(s) criado(s).`,
      );
      setForm(false);
      setRefresh((v) => v + 1);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    setFormError("");
    try {
      await api(base + "/planned-entries/" + cancelling.id + "/cancel", {
        method: "POST",
        body: JSON.stringify({ expected_version: cancelling.version }),
      });
      setCancelling(null);
      setRefresh((v) => v + 1);
      setNotice("Saldo em aberto cancelado. Baixas existentes preservadas.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exclude() {
    if (!excluding || !exclusionPreview || previewLoading || busy) return;
    setBusy(true);
    setFormError("");
    try {
      const result = await api<{ excluded: number }>(
        base + "/planned-entries/" + excluding.id + "/exclude",
        {
          method: "POST",
          body: JSON.stringify({
            scope: exclusionScope,
            expected_version: exclusionPreview.version,
            expected_revision: exclusionPreview.revision,
          }),
        },
      );
      setExcluding(null);
      setPage(1);
      setRefresh((value) => value + 1);
      setNotice(
        `${result.excluded} lançamento(s) excluído(s). Auditoria preservada.`,
      );
    } catch (error) {
      setFormError((error as Error).message);
      setExclusionPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function showDetail(row: PlannedEntry) {
    setError("");
    setFormError("");
    try {
      setSettlements(
        await api(base + "/planned-entries/" + row.id + "/settlements"),
      );
      setDetail(row);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reverse(tx: string) {
    setBusy(true);
    setFormError("");
    try {
      await api(base + "/planned-entries/links/" + tx + "/reverse", {
        method: "POST",
        body: "{}",
      });
      setDetail(null);
      setRefresh((v) => v + 1);
      setNotice(
        "Vínculo desfeito. O saldo em aberto foi recalculado; o movimento bancário foi preservado.",
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Lançamentos</h1>
          <p className="page-subtitle">
            Receitas e despesas previstas. A baixa vem do extrato.
          </p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => start("CREDIT")}>
            Nova Receita
          </button>
          <button className="primary" onClick={() => start("DEBIT")}>
            Nova Despesa
          </button>
        </div>
      </div>
      <div className="planning-summary">
        {[
          ["Previsto original", totals.expected],
          ["Realizado vinculado", totals.paid],
          ["A receber em aberto", totals.receivable],
          ["A pagar em aberto", totals.payable],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{brl(value)}</strong>
          </div>
        ))}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel catalog-list">
        <div className="planning-toolbar">
          <div>
            <h2>Lançamentos</h2>
            <small>{total} registros</small>
          </div>
          <CatalogSearch value={query} onChange={setQuery} />
          <SearchSelect
            ariaLabel="Situação dos lançamentos"
            value={state}
            onChange={(value) => {
              setState(value);
              setPage(1);
            }}
            options={[
              { value: "active", label: "Sem cancelados" },
              { value: "all", label: "Todas as situações" },
              ...Object.entries(labels).map(([value, label]) => ({
                value,
                label,
              })),
              { value: "partial", label: "Com baixa parcial" },
            ]}
          />
          <SearchSelect
            ariaLabel="Natureza dos lançamentos"
            value={direction}
            onChange={(value) => {
              setDirection(value);
              setPage(1);
            }}
            options={[
              { value: "", label: "Receitas e despesas" },
              { value: "CREDIT", label: "Receitas" },
              { value: "DEBIT", label: "Despesas" },
            ]}
          />
        </div>
        {loading ? (
          <p className="empty" role="status">
            Carregando lançamentos…
          </p>
        ) : !rows.length ? (
          <div className="empty">
            <strong>Nenhum lançamento encontrado</strong>
            <p>
              Cadastre uma receita ou despesa para acompanhar o previsto e o
              realizado.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    ["due_on", "Vencimento"],
                    ["description", "Descrição"],
                    ["expected_amount", "Previsto"],
                    ["paid", "Realizado"],
                    ["outstanding", "Em aberto"],
                    ["state", "Situação"],
                  ].map(([field, label]) => (
                    <SortHeader
                      key={field}
                      field={field}
                      label={label}
                      order={sorting.order}
                      onChange={(key) => {
                        sorting.change(key);
                        setPage(1);
                      }}
                    />
                  ))}
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={"planning-row-" + row.state}>
                    <td>{brazilDate(row.due_on)}</td>
                    <td>
                      <strong>{row.description}</strong>
                      <small className="planning-meta">
                        {row.direction === "CREDIT" ? "Receita" : "Despesa"}
                        {row.occurrences > 1
                          ? ` · ${row.occurrence}/${row.occurrences}`
                          : ""}
                        {row.party_name ? " · " + row.party_name : ""}
                      </small>
                    </td>
                    <td>{brl(row.expected_amount)}</td>
                    <td>{brl(row.paid)}</td>
                    <td>{brl(row.outstanding)}</td>
                    <td>
                      <span
                        className={
                          "transaction-state planning-state-" + row.situation
                        }
                      >
                        {labels[row.situation]}
                      </span>
                      {row.state === "partial" && (
                        <span className="planning-partial">Baixa parcial</span>
                      )}
                      {row.difference !== "0.00" && (
                        <small className="planning-meta">
                          Diferença: {brl(row.difference)}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {row.state === "open" && (
                          <ActionButton
                            label="Editar"
                            icon={Pencil}
                            onClick={() => start(row.direction, row)}
                          />
                        )}
                        <ActionButton
                          label="Baixas"
                          icon={ListChecks}
                          onClick={() => void showDetail(row)}
                        />
                        {["open", "partial"].includes(row.state) && (
                          <ActionButton
                            label="Cancelar"
                            icon={Ban}
                            tone="neutral"
                            onClick={() => {
                              setFormError("");
                              setCancelling(row);
                            }}
                          />
                        )}
                        <ActionButton
                          label="Excluir"
                          icon={Trash2}
                          tone="danger"
                          disabled={!row.can_delete}
                          disabledReason="Lançamentos com histórico de baixas não podem ser excluídos"
                          onClick={() => {
                            setExclusionScope("current");
                            setExclusionPreview(null);
                            setFormError("");
                            setExcluding(row);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 100 && (
          <div className="transaction-pagination">
            <button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              disabled={page * 100 >= total}
              onClick={() => setPage((v) => v + 1)}
            >
              Próxima
            </button>
          </div>
        )}
      </section>
      {form && (
        <Modal
          title={
            editing
              ? "Editar Lançamento"
              : draft.direction === "CREDIT"
                ? "Nova Receita"
                : "Nova Despesa"
          }
          busy={busy}
          onClose={() => setForm(false)}
        >
          <form
            className="planning-form"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement
              )
                event.preventDefault();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <div className="fields">
                <label className="planning-description">
                  Descrição
                  <input
                    required
                    maxLength={300}
                    value={draft.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </label>
                <label>
                  Vencimento
                  <input
                    required
                    type="date"
                    value={draft.due_on}
                    onChange={(e) => update("due_on", e.target.value)}
                  />
                </label>
                <label>
                  Valor previsto (R$)
                  <MoneyInput
                    value={draft.expected_amount}
                    onChange={(value) => update("expected_amount", value)}
                  />
                </label>
                {[
                  ["category_id", "Classificação", "categories"],
                  ["subcategory_id", "Subclassificação", "subcategories"],
                  ["cost_center_id", "Centro de Custos", "cost-centers"],
                  ["party_id", "Cliente / Fornecedor (opcional)", "parties"],
                  ["account_id", "Conta prevista (opcional)", "bank-accounts"],
                ].map(([key, label, table]) => (
                  <div className={"field planning-field-" + key} key={key}>
                    <label htmlFor={"planned-" + key}>{label}</label>
                    <SearchSelect
                      id={"planned-" + key}
                      required={["category_id", "subcategory_id"].includes(key)}
                      value={draft[key]}
                      onChange={(value) => update(key, value)}
                      options={[
                        { value: "", label: "Selecione" },
                        ...(table === "subcategories"
                          ? (catalogs[table] ?? [])
                              .filter(
                                (row) =>
                                  row.active &&
                                  row.category_id === draft.category_id,
                              )
                              .map((row) => ({
                                value: row.id,
                                label: String(row.name),
                              }))
                          : options(table)),
                      ]}
                    />
                  </div>
                ))}
                {!editing && (
                  <>
                    <div className="field">
                      <label htmlFor="planned-frequency">Recorrência</label>
                      <SearchSelect
                        id="planned-frequency"
                        value={draft.frequency}
                        onChange={(value) => update("frequency", value)}
                        options={[
                          { value: "ONCE", label: "Lançamento único" },
                          { value: "WEEKLY", label: "Semanal" },
                          { value: "MONTHLY", label: "Mensal" },
                          { value: "YEARLY", label: "Anual" },
                        ]}
                      />
                    </div>
                    <label>
                      Quantidade de ocorrências
                      <input
                        type="number"
                        disabled={draft.frequency === "ONCE"}
                        required
                        min={1}
                        max={120}
                        value={draft.occurrences}
                        onChange={(e) => update("occurrences", e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label className="planning-notes">
                  Descrição Complementar (opcional)
                  <textarea
                    rows={2}
                    maxLength={4000}
                    value={draft.notes}
                    onChange={(e) => update("notes", e.target.value)}
                  />
                </label>
              </div>
              {!editing && (
                <p className="planning-recurrence-summary" role="status">
                  <strong>
                    {draft.frequency === "ONCE"
                      ? "1 lançamento"
                      : `${draft.occurrences || "—"} lançamentos ${draft.frequency === "MONTHLY" ? "mensais" : draft.frequency === "WEEKLY" ? "semanais" : "anuais"}`}
                  </strong>
                  {" · "}
                  {draft.expected_amount
                    ? brl(moneyDecimal(draft.expected_amount))
                    : "Informe o valor"}{" "}
                  por ocorrência.{" "}
                  {lastDueDate(draft) &&
                    `De ${brazilDate(draft.due_on)} a ${brazilDate(lastDueDate(draft))}. `}
                  A quantidade inclui o primeiro vencimento.
                </p>
              )}
              {editing && (
                <p className="page-subtitle">
                  A alteração vale somente para esta ocorrência.
                </p>
              )}
              <div className="actions transaction-save">
                <button className="primary">
                  {busy
                    ? "Salvando…"
                    : !editing && draft.frequency !== "ONCE"
                      ? `Criar ${draft.occurrences || "—"} Lançamentos`
                      : "Salvar Lançamento"}
                </button>
                <button type="button" onClick={() => setForm(false)}>
                  Cancelar
                </button>
              </div>
            </fieldset>
            {formError && (
              <p role="alert" className="error">
                {formError}
              </p>
            )}
          </form>
        </Modal>
      )}
      {cancelling && (
        <Modal
          title="Cancelar Lançamento"
          busy={busy}
          onClose={() => setCancelling(null)}
        >
          <p>
            Cancelar o saldo em aberto de{" "}
            <strong>{cancelling.description}</strong>?
          </p>
          <p>
            Use quando a obrigação ou o recebimento previsto deixou de existir.
            O saldo sai da projeção; as baixas já realizadas e o histórico serão
            preservados.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Confirmar cancelamento
            </button>
            <button disabled={busy} onClick={() => setCancelling(null)}>
              Voltar
            </button>
          </div>
          {formError && (
            <p role="alert" className="error">
              {formError}
            </p>
          )}
        </Modal>
      )}
      {excluding && (
        <Modal
          title="Excluir Lançamento"
          busy={busy}
          onClose={() => setExcluding(null)}
        >
          <p>
            Excluir{" "}
            <strong>
              {exclusionPreview?.description ?? excluding.description}
            </strong>{" "}
            da listagem e das projeções?
          </p>
          <p>
            Use para registros feitos por engano ou em duplicidade. A auditoria
            será preservada.
          </p>
          {excluding.occurrences > 1 && (
            <div className="field">
              <label htmlFor="exclusion-scope">
                Quais ocorrências excluir?
              </label>
              <SearchSelect
                id="exclusion-scope"
                value={exclusionScope}
                disabled={busy}
                onChange={(value) => {
                  setExclusionPreview(null);
                  setExclusionScope(value);
                }}
                options={[
                  { value: "current", label: "Somente esta ocorrência" },
                  {
                    value: "following",
                    label: "Esta e as próximas ocorrências",
                  },
                ]}
              />
            </div>
          )}
          {previewLoading && <p role="status">Conferindo lançamentos…</p>}
          {exclusionPreview && (
            <div className="planning-exclusion-preview" role="status">
              <strong>
                {exclusionPreview.count} lançamento(s) selecionado(s)
              </strong>
              <p>
                {brazilDate(exclusionPreview.first_due_on)} a{" "}
                {brazilDate(exclusionPreview.last_due_on)}
              </p>
              <p>
                Valor previsto total:{" "}
                <strong>{brl(exclusionPreview.total_expected)}</strong>
              </p>
              {!!exclusionPreview.blocked && (
                <p className="error">
                  {exclusionPreview.blocked} lançamento(s) com histórico de
                  baixas. A seleção inteira está bloqueada; nenhuma ocorrência
                  será excluída.
                </p>
              )}
            </div>
          )}
          {formError && (
            <p role="alert" className="error">
              {formError}
            </p>
          )}
          {formError && !exclusionPreview && (
            <button
              type="button"
              disabled={busy || previewLoading}
              onClick={() => setExcluding({ ...excluding })}
            >
              Atualizar prévia
            </button>
          )}
          <div className="actions transaction-save">
            <button
              type="button"
              className="planning-danger"
              disabled={
                busy ||
                previewLoading ||
                !exclusionPreview ||
                !!exclusionPreview.blocked
              }
              onClick={() => void exclude()}
            >
              {busy ? "Excluindo…" : "Confirmar exclusão"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setExcluding(null)}
            >
              Voltar
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          title={"Baixas — " + detail.description}
          busy={busy}
          onClose={() => setDetail(null)}
        >
          {!settlements.length ? (
            <p>
              Nenhuma baixa vinculada. Associe um movimento na identificação do
              extrato.
            </p>
          ) : (
            settlements.map((item) => (
              <div className="planning-link" key={item.id}>
                <strong>
                  {brazilDate(item.posted_on)} · {brl(item.amount)}
                </strong>
                <p>{item.raw_description}</p>
                {item.discount !== "0.00" && (
                  <p>Desconto comercial: {brl(item.discount)}</p>
                )}
                {item.surcharge !== "0.00" && (
                  <p>Acréscimo comercial: {brl(item.surcharge)}</p>
                )}
                <small>
                  {item.account_label} ·{" "}
                  {item.reversed ? "Vínculo desfeito" : "Vínculo ativo"}
                </small>
                {!item.reversed && (
                  <ActionButton
                    label="Desvincular movimento"
                    tooltipAlign="start"
                    icon={Unlink}
                    tone="neutral"
                    disabled={busy}
                    onClick={() => void reverse(item.transaction_id)}
                  />
                )}
              </div>
            ))
          )}
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
