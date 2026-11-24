import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { CatalogSearch } from "./catalog-search";
import { brl, brazilDate } from "./statement-import";
import type { RecordData } from "./catalogs";
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
  version: number;
  party_name: string | null;
  occurrence: number;
  occurrences: number;
  category_id: string;
  subcategory_id: string;
  cost_center_id: string;
  party_id: string | null;
  account_id: string | null;
  notes: string | null;
};
const labels: Record<string, string> = {
  open: "Em aberto",
  partial: "Parcialmente realizado",
  realized: "Realizado",
  cancelled: "Cancelado",
};
type Draft = Record<string, string>;
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
  const [state, setState] = useState("all");
  const [direction, setDirection] = useState("");
  const [page, setPage] = useState(1);
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
    }[]
  >([]);
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
  }, [base, search, state, direction, page, refresh]);
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
      .filter((row) => row.active)
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
        expected_amount: draft.expected_amount.includes(",")
          ? draft.expected_amount.replaceAll(".", "").replace(",", ".")
          : draft.expected_amount,
      };
      if (editing)
        await api(base + "/planned-entries/" + editing.id, {
          method: "PUT",
          body: JSON.stringify({
            ...payload,
            expected_version: editing.version,
          }),
        });
      else
        await api(base + "/planned-entries", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            frequency,
            occurrences: Number(occurrences),
            request_key: requestKey,
          }),
        });
      setNotice(
        editing
          ? "Lançamento atualizado."
          : `${occurrences} lançamento(s) previsto(s) criado(s).`,
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
              { value: "all", label: "Todas as situações" },
              ...Object.entries(labels).map(([value, label]) => ({
                value,
                label,
              })),
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
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Previsto</th>
                  <th>Realizado</th>
                  <th>Em aberto</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
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
                          "transaction-state transaction-state-" +
                          (row.state === "realized" ? "identified" : "pending")
                        }
                      >
                        {labels[row.state]}
                      </span>
                      {row.difference !== "0.00" && (
                        <small className="planning-meta">
                          Diferença: {brl(row.difference)}
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="actions">
                        {row.state === "open" && (
                          <button
                            className="text-button"
                            onClick={() => start(row.direction, row)}
                          >
                            Editar
                          </button>
                        )}
                        <button
                          className="text-button"
                          onClick={() => void showDetail(row)}
                        >
                          Baixas
                        </button>
                        {["open", "partial"].includes(row.state) && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setFormError("");
                              setCancelling(row);
                            }}
                          >
                            Cancelar
                          </button>
                        )}
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
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <div className="fields">
                <label>
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
                  <input
                    required
                    inputMode="decimal"
                    placeholder="0,00"
                    value={draft.expected_amount}
                    onChange={(e) => update("expected_amount", e.target.value)}
                  />
                </label>
                {[
                  ["category_id", "Classificação", "categories"],
                  ["subcategory_id", "Subclassificação", "subcategories"],
                  ["cost_center_id", "Centro de Custos", "cost-centers"],
                  ["party_id", "Cliente / Fornecedor (opcional)", "parties"],
                  ["account_id", "Conta prevista (opcional)", "bank-accounts"],
                ].map(([key, label, table]) => (
                  <div className="field" key={key}>
                    <label htmlFor={"planned-" + key}>{label}</label>
                    <SearchSelect
                      id={"planned-" + key}
                      required={[
                        "category_id",
                        "subcategory_id",
                        "cost_center_id",
                      ].includes(key)}
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
                    {draft.frequency !== "ONCE" && (
                      <label>
                        Quantidade de ocorrências
                        <input
                          type="number"
                          required
                          min={1}
                          max={120}
                          value={draft.occurrences}
                          onChange={(e) =>
                            update("occurrences", e.target.value)
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                <label>
                  Descrição Complementar (opcional)
                  <textarea
                    rows={2}
                    maxLength={4000}
                    value={draft.notes}
                    onChange={(e) => update("notes", e.target.value)}
                  />
                </label>
              </div>
              {editing && (
                <p className="page-subtitle">
                  A alteração vale somente para esta ocorrência.
                </p>
              )}
              <div className="actions transaction-save">
                <button className="primary">
                  {busy ? "Salvando…" : "Salvar Lançamento"}
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
          <p>As baixas já realizadas e o histórico serão preservados.</p>
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
                <small>
                  {item.account_label} ·{" "}
                  {item.reversed ? "Vínculo desfeito" : "Vínculo ativo"}
                </small>
                {!item.reversed && (
                  <button
                    disabled={busy}
                    onClick={() => void reverse(item.transaction_id)}
                  >
                    Desvincular movimento
                  </button>
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
