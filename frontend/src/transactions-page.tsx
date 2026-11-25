import { useEffect, useState } from "react";
import {
  Sparkles,
  Upload,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Pencil,
  Eye,
  ListChecks,
} from "lucide-react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { CatalogSearch } from "./catalog-search";
import { StatementImport, brl, brazilDate } from "./statement-import";
import type { RecordData } from "./catalogs";
import { askAssistant } from "./assistant";
import { EntryLinker } from "./entry-linker";
import { categoryNature } from "./movement-nature";
import { HistoricalImport } from "./historical-import";
import { PayerLinks } from "./payer-links";
import { ActionButton } from "./action-button";
import { useTransactionSelection } from "./transaction-selection";

type Movement = {
  editable: boolean;
  import_file_id: string;
  source_row: number;
  file_name: string;
  id: string;
  account_id: string;
  account_label: string;
  posted_on: string;
  direction: string;
  amount: string;
  raw_description: string;
  raw_payload: { documento?: string; saldo?: string };
  state: string;
  version: number;
  method: string | null;
  party_id: string | null;
  customer_group_id: string | null;
  customer_group_name: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  cost_center_id: string | null;
  movement_kind: string | null;
  notes: string | null;
  planning_description: string | null;
  party_name: string | null;
  category_name: string | null;
  cost_center_name: string | null;
  suggestion_id: string | null;
  suggestion: Record<string, unknown> | null;
  reason: string | null;
  confidence: string | null;
};
type Draft = {
  party_id: string;
  customer_group_id: string;
  category_id: string;
  subcategory_id: string;
  cost_center_id: string;
  movement_kind: string;
  notes: string;
};
type Catalogs = Record<string, RecordData[]>;
type SortField =
  | "date"
  | "account"
  | "description"
  | "amount"
  | "identification";
const states = [
  { value: "pending", label: "Pendentes de identificação" },
  { value: "suggested", label: "Sugestões da IA" },
  { value: "identified", label: "Identificados" },
  { value: "all", label: "Todos os movimentos" },
];

export function TransactionsPage({
  organizationId,
  mode = "import",
}: {
  organizationId: string;
  mode?: "import" | "history";
}) {
  const base = "/organizations/" + organizationId;
  const [catalogs, setCatalogs] = useState<Catalogs>({});
  const [rows, setRows] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ field: SortField; order: "asc" | "desc" }>(
    { field: "date", order: "desc" },
  );
  const [state, setState] = useState(mode === "history" ? "all" : "pending");
  const [linkMode, setLinkMode] = useState(false);
  const [account, setAccount] = useState("");
  const [statementId, setStatementId] = useState("");
  const [statements, setStatements] = useState<
    { id: string; file_name: string; account_label: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [direction, setDirection] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [historicalImport, setHistoricalImport] = useState(false);
  const [payerLinks, setPayerLinks] = useState(false);
  const [busyImport, setBusyImport] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [selected, setSelected] = useState<Movement | null>(null);
  const [aiFields, setAiFields] = useState<Set<keyof Draft>>(new Set());
  const [editedFields, setEditedFields] = useState<Set<keyof Draft>>(new Set());
  const [rechecking, setRechecking] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    party_id: "",
    customer_group_id: "",
    category_id: "",
    subcategory_id: "",
    cost_center_id: "",
    movement_kind: "NORMAL",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const selectionParams = new URLSearchParams({ state, query: search });
  if (account) selectionParams.set("account_id", account);
  if (statementId) selectionParams.set("statement_id", statementId);
  if (start) selectionParams.set("start", start);
  if (end) selectionParams.set("end", end);
  if (direction) selectionParams.set("direction", direction);
  const selection = useTransactionSelection(
    base,
    selectionParams.toString(),
    rows,
    total,
    (count) => {
      setNotice(`${count.toLocaleString("pt-BR")} movimentos excluídos.`);
      setPage(1);
      setRefresh((value) => value + 1);
    },
  );
  useEffect(() => {
    if (!selected || !catalogs.categories) return;
    setDraft((previous) => {
      if (previous.movement_kind === "AUTOMATIC_PROCESS") {
        if (
          [
            previous.party_id,
            previous.customer_group_id,
            previous.category_id,
            previous.subcategory_id,
            previous.cost_center_id,
          ].some(Boolean)
        )
          return {
            ...previous,
            party_id: "",
            customer_group_id: "",
            category_id: "",
            subcategory_id: "",
            cost_center_id: "",
          };
        return previous;
      }
      const nature = categoryNature(selected.direction, previous.movement_kind);
      if (
        previous.category_id &&
        !catalogs.categories.some(
          (row) =>
            row.id === previous.category_id &&
            row.active &&
            row.kind === nature,
        )
      )
        return { ...previous, category_id: "", subcategory_id: "" };
      if (
        previous.subcategory_id &&
        !(catalogs.subcategories ?? []).some(
          (row) =>
            row.id === previous.subcategory_id &&
            row.active &&
            row.category_id === previous.category_id,
        )
      )
        return { ...previous, subcategory_id: "" };
      return previous;
    });
  }, [selected?.id, selected?.direction, draft.movement_kind, catalogs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ id: string; file_name: string; account_label: string }[]>(
      base + "/statements",
      { signal: controller.signal },
    )
      .then(setStatements)
      .catch(() => {});
    Promise.all(
      [
        "bank-accounts",
        "categories",
        "subcategories",
        "cost-centers",
        "parties",
        "customer-groups",
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
      .then((entries) => setCatalogs(Object.fromEntries(entries)))
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Não foi possível carregar os cadastros de identificação.");
      });
    api<{ enabled: boolean }>(base + "/recognition/config", {
      signal: controller.signal,
    })
      .then((value) => setAiEnabled(value.enabled))
      .catch(() => {});
    return () => controller.abort();
  }, [base, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      state,
      query: search,
      page: String(page),
      sort_by: sort.field,
      sort_order: sort.order,
    });
    if (account) params.set("account_id", account);
    if (statementId) params.set("statement_id", statementId);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (direction) params.set("direction", direction);
    api<{ rows: Movement[]; total: number }>(base + "/transactions?" + params, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.rows);
          setTotal(data.total);
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError((problem as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    base,
    state,
    account,
    statementId,
    start,
    end,
    direction,
    search,
    page,
    sort,
    refresh,
  ]);

  function edit(row: Movement) {
    setLinkMode(false);
    const source = row.version ? row : (row.suggestion ?? row);
    setAiFields(
      new Set(
        !row.version && row.suggestion
          ? (
              [
                "party_id",
                "customer_group_id",
                "category_id",
                "subcategory_id",
                "cost_center_id",
                "movement_kind",
              ] as (keyof Draft)[]
            ).filter(
              (key) =>
                !!row.suggestion?.[key] &&
                (key !== "movement_kind" || row.suggestion[key] !== "NORMAL"),
            )
          : [],
      ),
    );
    setEditedFields(new Set());
    setDraft({
      party_id: String(source.party_id ?? ""),
      customer_group_id: String(source.customer_group_id ?? ""),
      category_id: String(source.category_id ?? ""),
      subcategory_id: String(source.subcategory_id ?? ""),
      cost_center_id: String(source.cost_center_id ?? ""),
      movement_kind: String(source.movement_kind ?? "NORMAL"),
      notes: row.notes ?? "",
    });
    setSelected(row);
    setSaveError("");
  }
  function manualFields(...keys: (keyof Draft)[]) {
    setEditedFields((previous) => new Set([...previous, ...keys]));
    setAiFields(
      (previous) => new Set([...previous].filter((key) => !keys.includes(key))),
    );
  }
  function aiClass(field: keyof Draft) {
    return selected &&
      !selected.version &&
      aiFields.has(field) &&
      !!draft[field] &&
      draft[field] === selected.suggestion?.[field]
      ? fieldConfidence(field) === "HIGH"
        ? " ai-field-high"
        : " ai-field-review"
      : "";
  }
  function fieldConfidence(field: keyof Draft) {
    const fields = selected?.suggestion?.field_confidence;
    const confidence =
      fields && typeof fields === "object"
        ? (fields as Record<string, string>)[field]
        : undefined;
    return confidence ?? overallConfidence();
  }
  function overallConfidence() {
    const suggestion = selected?.suggestion;
    if (
      selected?.confidence === "HIGH" &&
      suggestion?.movement_kind === "NORMAL" &&
      ["category_id", "subcategory_id", "cost_center_id"].some(
        (key) => !suggestion[key],
      )
    )
      return "MEDIUM";
    return selected?.confidence;
  }
  function aiBadge(field: keyof Draft) {
    return aiClass(field) ? (
      <span className="ai-field-badge" aria-hidden="true">
        <Sparkles size={12} aria-hidden="true" />
        {fieldConfidence(field) === "HIGH" ? "IA · Alta" : "IA · Revisar"}
      </span>
    ) : null;
  }
  async function recheckSuggestion() {
    if (!selected || rechecking) return;
    setRechecking(true);
    setSaveError("");
    const changes = new Set(editedFields);
    const previousDraft = draft;
    try {
      const result = await api<{
        updated_suggestions?: {
          transaction_id: string;
          suggestion_id: string;
          suggestion: Movement["suggestion"];
          reason: string;
          confidence: string;
        }[];
      }>(base + "/recognition/run", {
        method: "POST",
        body: JSON.stringify({ transaction_id: selected.id }),
      });
      const update = result.updated_suggestions?.find(
        (item) => item.transaction_id === selected.id,
      );
      if (!update)
        throw new Error(
          "A IA não encontrou evidência suficiente para uma nova sugestão. Revise os campos ou converse com o Fin.",
        );
      edit({ ...selected, ...update });
      setDraft((value) => ({
        ...value,
        ...Object.fromEntries(
          [...changes].map((key) => [key, previousDraft[key]]),
        ),
      }));
      setAiFields(
        (value) => new Set([...value].filter((key) => !changes.has(key))),
      );
      setEditedFields(changes);
      setRefresh((value) => value + 1);
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setRechecking(false);
    }
  }
  async function save(next: boolean) {
    if (!selected) return;
    setSaving(true);
    setSaveError("");
    try {
      await api(base + "/transactions/" + selected.id + "/identification", {
        method: "PUT",
        body: JSON.stringify({
          ...Object.fromEntries(
            Object.entries(draft).map(([key, value]) => [key, value || null]),
          ),
          expected_version: selected.version,
          suggestion_id: selected.suggestion_id,
        }),
      });
      const following = rows.find(
        (row) => row.id !== selected.id && !row.version,
      );
      setNotice("Identificação salva.");
      setRefresh((value) => value + 1);
      if (next && following) edit(following);
      else setSelected(null);
    } catch (problem) {
      setSaveError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function recognize(testOnly = false) {
    if (aiBusy) return;
    setAiBusy(true);
    setNotice(
      "A IA está analisando os movimentos. Você pode continuar trabalhando.",
    );
    setError("");
    let automatic = 0,
      suggestions = 0;
    const attempted: string[] = [];
    try {
      for (let iteration = 0; iteration < 500; iteration++) {
        const data = await api<{
          automatic: number;
          suggestions: number;
          processed: number;
          analyzed: string[];
          verified?: boolean;
        }>(base + "/recognition/run", {
          method: "POST",
          body: JSON.stringify({ exclude: attempted, test: testOnly }),
        });
        if (data.verified) {
          setNotice("Conexão com a IA verificada.");
          return;
        }
        attempted.push(...data.analyzed);
        automatic += data.automatic;
        suggestions += data.suggestions;
        setRefresh((value) => value + 1);
        if (data.processed < 20) break;
      }
      setNotice(
        automatic +
          " identificações por padrões confirmados e " +
          suggestions +
          " sugestões da IA para revisar.",
      );
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setAiBusy(false);
    }
  }
  function options(key: string) {
    return (catalogs[key] ?? [])
      .filter(
        (row) =>
          row.active &&
          (key !== "categories" ||
            row.kind ===
              categoryNature(
                selected?.direction ?? "CREDIT",
                draft.movement_kind,
              )),
      )
      .map((row) => ({
        value: row.id,
        label: String(row.display_name ?? row.label ?? row.name ?? row.code),
      }));
  }
  const fieldLabels = [
    ["party_id", "Cliente / Fornecedor (opcional)", "parties"],
    ["category_id", "Classificação", "categories"],
    ["subcategory_id", "Subclassificação", "subcategories"],
    ["cost_center_id", "Centro de Custos", "cost-centers"],
  ];
  function sortButton(field: SortField, label: string) {
    const active = sort.field === field;
    const nextOrder = active && sort.order === "asc" ? "desc" : "asc";
    const Icon = active
      ? sort.order === "asc"
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;
    return (
      <button
        type="button"
        className="transaction-sort"
        data-active={active}
        aria-label={`Ordenar por ${label}: ${nextOrder === "asc" ? "crescente" : "decrescente"}`}
        title={`Ordenar por ${label} (${nextOrder === "asc" ? "crescente" : "decrescente"})`}
        onClick={() => {
          setSort({ field, order: nextOrder });
          setPage(1);
        }}
      >
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    );
  }
  function ariaSort(
    ...fields: SortField[]
  ): "ascending" | "descending" | "none" {
    return fields.includes(sort.field)
      ? sort.order === "asc"
        ? "ascending"
        : "descending"
      : "none";
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{mode === "history" ? "Histórico" : "Transações"}</h1>
          <p className="page-subtitle">
            {mode === "history"
              ? "Movimentos bancários importados, com identificação e rastreabilidade."
              : "Importe os extratos e identifique os movimentos pendentes."}
          </p>
        </div>
        {mode === "history" && (
          <div className="actions">
            <button type="button" onClick={() => setPayerLinks(true)}>
              Vincular Clientes
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setHistoricalImport(true)}
            >
              <Upload size={17} />
              Importar Base Histórica
            </button>
          </div>
        )}
        {mode === "import" && (
          <div className="actions">
            <button
              type="button"
              disabled={aiBusy || !aiEnabled}
              title={
                !aiEnabled
                  ? "Configure OPENAI_API_KEY no Railway"
                  : "Analisar pendências com IA generativa"
              }
              onClick={() => void recognize(total === 0)}
            >
              <Sparkles size={17} />
              {aiBusy
                ? "IA analisando…"
                : total === 0
                  ? "Testar IA"
                  : "Identificar com IA"}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setImporting(true)}
            >
              <Upload size={17} />
              Importar Extratos
            </button>
          </div>
        )}
      </div>
      {historicalImport && (
        <HistoricalImport
          organizationId={organizationId}
          onClose={() => setHistoricalImport(false)}
          onDone={(count) => {
            setStatementId("");
            setState("all");
            setPage(1);
            setRefresh((value) => value + 1);
            setNotice(
              `${count.toLocaleString("pt-BR")} movimentos importados da base histórica.`,
            );
          }}
        />
      )}
      {payerLinks && (
        <PayerLinks
          organizationId={organizationId}
          onClose={() => setPayerLinks(false)}
          onDone={(count) => {
            setNotice(
              `${count.toLocaleString("pt-BR")} vínculos de clientes gravados.`,
            );
            setRefresh((value) => value + 1);
          }}
        />
      )}
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
      <section className="panel listing">
        <div className="transaction-toolbar">
          <div className="catalog-toolbar-title">
            <h2>Movimentos</h2>
            <span className="catalog-toolbar-count">{total} resultados</span>
          </div>
          <CatalogSearch value={query} onChange={setQuery} />
          <SearchSelect
            id="transaction-state"
            value={state}
            options={states}
            onChange={(value) => {
              setState(value);
              setPage(1);
            }}
          />
        </div>
        <div className="transaction-filters">
          <div>
            <label htmlFor="transaction-account">Conta bancária</label>
            <SearchSelect
              id="transaction-account"
              value={account}
              options={[
                { value: "", label: "Todas as contas" },
                ...options("bank-accounts"),
              ]}
              onChange={(value) => {
                setAccount(value);
                setPage(1);
              }}
            />
          </div>
          <div className="statement-filter">
            <label htmlFor="transaction-statement">Extrato</label>
            <SearchSelect
              id="transaction-statement"
              value={statementId}
              options={[
                { value: "", label: "Todos os extratos" },
                ...statements.map((item) => ({
                  value: item.id,
                  label: item.account_label + " · " + item.file_name,
                })),
              ]}
              onChange={(value) => {
                setStatementId(value);
                setPage(1);
              }}
            />
          </div>
          <label>
            De
            <input
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <div>
            <label htmlFor="transaction-direction">Movimento</label>
            <SearchSelect
              id="transaction-direction"
              value={direction}
              options={[
                { value: "", label: "Créditos e débitos" },
                { value: "CREDIT", label: "Créditos" },
                { value: "DEBIT", label: "Débitos" },
              ]}
              onChange={(value) => {
                setDirection(value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {mode === "import" && selection.toolbar}
        {loading ? (
          <p className="empty" role="status">
            Carregando movimentos…
          </p>
        ) : !rows.length ? (
          <div className="empty">
            <strong>Nenhum movimento nesta seleção</strong>
            <p>Importe um extrato ou ajuste os filtros para continuar.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="transactions-table">
              <thead>
                <tr>
                  {mode === "import" && selection.header}
                  <th scope="col" aria-sort={ariaSort("date", "account")}>
                    <span className="transaction-sort-pair">
                      {sortButton("date", "Data")}
                      <span aria-hidden="true">/</span>
                      {sortButton("account", "Conta")}
                    </span>
                  </th>
                  <th scope="col" aria-sort={ariaSort("description")}>
                    {sortButton("description", "Histórico do Banco")}
                  </th>
                  <th scope="col" aria-sort={ariaSort("amount")}>
                    {sortButton("amount", "Valor")}
                  </th>
                  <th scope="col" aria-sort={ariaSort("identification")}>
                    {sortButton("identification", "Identificação")}
                  </th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={
                      row.import_file_id + "/" + row.source_row + "/" + row.id
                    }
                  >
                    {mode === "import" && selection.cell(row)}
                    <td>
                      {brazilDate(row.posted_on)}
                      <small>{row.account_label}</small>
                    </td>
                    <td className="transaction-description">
                      {row.raw_description}
                      {row.movement_kind !== "AUTOMATIC_PROCESS" &&
                        (row.party_name ||
                          row.customer_group_name ||
                          row.category_name ||
                          row.cost_center_name) && (
                          <small>
                            {[
                              row.party_name,
                              row.customer_group_name
                                ? `Grupo: ${row.customer_group_name}`
                                : null,
                              row.category_name,
                              row.cost_center_name,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        )}
                      {row.notes && <small>{row.notes}</small>}
                      {row.planning_description && (
                        <small>Vinculado a: {row.planning_description}</small>
                      )}
                    </td>
                    <td
                      className={
                        row.direction === "CREDIT"
                          ? "amount-credit"
                          : "amount-debit"
                      }
                    >
                      {row.direction === "DEBIT" ? "− " : "+ "}
                      {brl(row.amount)}
                    </td>
                    <td>
                      <span
                        className={
                          "transaction-state transaction-state-" +
                          (["AUTOMATIC_PROCESS", "INTERNAL_TRANSFER"].includes(
                            row.movement_kind ?? "",
                          )
                            ? "neutral"
                            : row.state)
                        }
                      >
                        {row.state === "identified"
                          ? row.movement_kind === "AUTOMATIC_PROCESS"
                            ? "Processos Automáticos"
                            : row.movement_kind === "INTERNAL_TRANSFER"
                              ? "Transferência própria"
                              : row.method === "PATTERN"
                                ? "Automático"
                                : "Identificado"
                          : row.state === "suggested"
                            ? "Sugestão da IA"
                            : row.state === "duplicate"
                              ? "Já existente"
                              : "Pendente"}
                      </span>
                    </td>
                    <td>
                      <ActionButton
                        label={
                          !row.editable
                            ? "Ver detalhe"
                            : row.version
                              ? "Revisar"
                              : "Identificar"
                        }
                        icon={
                          !row.editable
                            ? Eye
                            : row.version
                              ? Pencil
                              : ListChecks
                        }
                        ariaLabel={
                          "Identificar movimento de " +
                          brazilDate(row.posted_on) +
                          " " +
                          row.raw_description
                        }
                        onClick={() => edit(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 100 && (
          <footer className="transaction-pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>
              Página {page} de {Math.ceil(total / 100)}
            </span>
            <button
              disabled={page * 100 >= total}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </footer>
        )}
      </section>
      {importing && (
        <Modal
          title="Importar Extratos"
          busy={busyImport}
          onClose={() => setImporting(false)}
        >
          <StatementImport
            organizationId={organizationId}
            onBusyChange={setBusyImport}
            onDone={(count, fileIds) => {
              setImporting(false);
              setState("pending");
              setPage(1);
              setQuery("");
              setAccount("");
              setStatementId(
                count > 0 && fileIds.length === 1 ? fileIds[0] : "",
              );
              setStart("");
              setEnd("");
              setDirection("");
              setNotice(
                count
                  ? count + " movimentos importados. Prontos para identificar."
                  : "Nenhum movimento novo. Os registros existentes foram preservados.",
              );
              setRefresh((value) => value + 1);
              if (aiEnabled && count > 0) void recognize();
            }}
          />
        </Modal>
      )}
      {selected && (
        <Modal
          key={selected.id}
          title={
            selected.version ? "Revisar Identificação" : "Identificar Movimento"
          }
          busy={saving}
          onClose={() => setSelected(null)}
        >
          <div className="transaction-original">
            <button
              type="button"
              disabled={!selected.editable}
              className="text-button"
              onClick={() =>
                askAssistant({
                  id: selected.id,
                  label: selected.raw_description,
                })
              }
            >
              Conversar sobre este lançamento
            </button>
            <div className="transaction-overview-actions">
              <button
                type="button"
                className="text-button transaction-overview"
                onClick={() => setSelected(null)}
              >
                ← Voltar à visão geral
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setStatementId(selected.import_file_id);
                  setState("all");
                  setAccount("");
                  setStart("");
                  setEnd("");
                  setDirection("");
                  setQuery("");
                  setPage(1);
                  setSelected(null);
                }}
              >
                Ver extrato completo
              </button>
            </div>
            <span>
              {brazilDate(selected.posted_on)} · {selected.account_label}
            </span>
            <strong>{selected.raw_description}</strong>
            <small>
              {selected.file_name} · Linha {selected.source_row}
            </small>
            <strong
              className={
                selected.direction === "CREDIT"
                  ? "amount-credit"
                  : "amount-debit"
              }
            >
              {selected.direction === "DEBIT" ? "− " : "+ "}
              {brl(selected.amount)}
            </strong>
            <div className="transaction-header-footer">
              <small>
                Documento: {selected.raw_payload.documento || "Não informado"} ·
                Saldo informado: {brl(selected.raw_payload.saldo ?? "0")}
              </small>
              {selected.editable && draft.movement_kind === "NORMAL" && (
                <div className="transaction-header-action">
                  <button
                    type="button"
                    className="primary"
                    aria-expanded={linkMode}
                    aria-controls="previous-entry-panel"
                    onClick={() => setLinkMode(true)}
                  >
                    Identificar com Lançamento Prévio
                  </button>
                </div>
              )}
            </div>
          </div>
          {selected.editable && (
            <EntryLinker
              key={selected.id}
              organizationId={organizationId}
              movement={selected}
              enabled={linkMode}
              notes={draft.notes}
              onNotesChange={(value) =>
                setDraft((previous) => ({ ...previous, notes: value }))
              }
              onModeChange={setLinkMode}
              onDone={(message) => {
                setNotice(message);
                setRefresh((value) => value + 1);
                setSelected(null);
              }}
            />
          )}
          {!linkMode && !selected.version && selected.suggestion && (
            <div
              className={
                "transaction-ai " +
                (overallConfidence() === "HIGH"
                  ? "ai-confidence-high"
                  : "ai-confidence-review")
              }
            >
              <strong>
                <Sparkles size={17} /> Sugestão da IA · Confiança{" "}
                {overallConfidence() === "HIGH"
                  ? "alta"
                  : overallConfidence() === "MEDIUM"
                    ? "média"
                    : "baixa"}
              </strong>
              <p>{selected.reason}</p>
              <small>Confira os vínculos abaixo antes de salvar.</small>
              <div
                className="ai-confidence-legend"
                aria-label="Legenda das sugestões da IA"
              >
                <span className="ai-legend-high">Azul · Alta confiança</span>
                <span className="ai-legend-review">Amarelo · Revisar</span>
              </div>
              <button
                type="button"
                className="ai-recheck"
                disabled={rechecking || saving}
                onClick={() => void recheckSuggestion()}
              >
                {rechecking ? "Analisando histórico…" : "Reavaliar sugestão"}
              </button>
            </div>
          )}
          {selected.editable ? (
            !linkMode && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(true);
                }}
              >
                <fieldset disabled={saving || rechecking}>
                  <div
                    className={
                      draft.movement_kind === "AUTOMATIC_PROCESS"
                        ? "fields automatic-process-fields"
                        : "fields"
                    }
                  >
                    <div className={"field" + aiClass("movement_kind")}>
                      <label htmlFor="movement-kind">
                        Tratamento do movimento
                        {aiBadge("movement_kind")}
                      </label>
                      <SearchSelect
                        id="movement-kind"
                        ariaLabel="Tratamento do movimento"
                        description={
                          aiClass("movement_kind")
                            ? "Sugestão da IA. Confira a confiança indicada na legenda antes de confirmar."
                            : undefined
                        }
                        value={draft.movement_kind}
                        options={[
                          {
                            value: "NORMAL",
                            label:
                              selected.direction === "CREDIT"
                                ? "Receita"
                                : "Despesa",
                          },
                          {
                            value: "AUTOMATIC_PROCESS",
                            label: "Processos Automáticos",
                          },
                          {
                            value: "INTERNAL_TRANSFER",
                            label: "Transferência entre contas próprias",
                          },
                        ]}
                        onChange={(value) => {
                          manualFields(
                            "movement_kind",
                            "category_id",
                            "subcategory_id",
                            ...(value === "AUTOMATIC_PROCESS"
                              ? ([
                                  "party_id",
                                  "cost_center_id",
                                ] as (keyof Draft)[])
                              : []),
                          );
                          setDraft((previous) => ({
                            ...previous,
                            movement_kind: value,
                            customer_group_id: "",
                            category_id: "",
                            subcategory_id: "",
                            ...(value === "AUTOMATIC_PROCESS"
                              ? { party_id: "", cost_center_id: "" }
                              : {}),
                          }));
                        }}
                      />
                    </div>
                    {draft.movement_kind !== "NORMAL" && (
                      <p className="transaction-neutral">
                        {draft.movement_kind === "AUTOMATIC_PROCESS"
                          ? "Processo automático neutro. Não exige classificação, subclassificação, centro de custos ou cliente/fornecedor. O registro original permanece no extrato, sem receita ou despesa gerencial."
                          : "Transferência entre contas próprias: tratamento neutro no consolidado. A classificação, se informada, deve ser neutra; os demais vínculos são opcionais."}
                      </p>
                    )}
                    {(draft.movement_kind === "AUTOMATIC_PROCESS"
                      ? []
                      : fieldLabels
                    ).map(([field, label, key]) => (
                      <div
                        className={"field" + aiClass(field as keyof Draft)}
                        key={field}
                      >
                        <label
                          className="identification-label"
                          htmlFor={"identify-" + field}
                        >
                          {label}
                          {aiBadge(field as keyof Draft)}
                        </label>
                        <SearchSelect
                          id={"identify-" + field}
                          ariaLabel={label}
                          description={
                            aiClass(field as keyof Draft)
                              ? "Sugestão da IA. Confira a confiança indicada na legenda antes de confirmar."
                              : undefined
                          }
                          value={draft[field as keyof Draft]}
                          required={
                            draft.movement_kind === "NORMAL" &&
                            field !== "party_id"
                          }
                          options={[
                            { value: "", label: "Selecione" },
                            ...(key === "subcategories"
                              ? (catalogs[key] ?? [])
                                  .filter(
                                    (row) =>
                                      row.active &&
                                      row.category_id === draft.category_id,
                                  )
                                  .map((row) => ({
                                    value: row.id,
                                    label: String(row.name),
                                  }))
                              : options(key)),
                          ]}
                          onChange={(value) => {
                            manualFields(
                              field as keyof Draft,
                              ...(field === "category_id"
                                ? (["subcategory_id"] as (keyof Draft)[])
                                : []),
                            );
                            setDraft((previous) => ({
                              ...previous,
                              [field]: value,
                              ...(field === "party_id" && value
                                ? { customer_group_id: "" }
                                : {}),
                              ...(field === "category_id"
                                ? { subcategory_id: "" }
                                : {}),
                            }));
                          }}
                        />
                      </div>
                    ))}
                    {selected.direction === "CREDIT" &&
                      draft.movement_kind === "NORMAL" &&
                      !draft.party_id && (
                        <div className={"field" + aiClass("customer_group_id")}>
                          <label htmlFor="identify-customer-group">
                            Grupo de Clientes (opcional)
                            {aiBadge("customer_group_id")}
                          </label>
                          <SearchSelect
                            id="identify-customer-group"
                            ariaLabel="Grupo de Clientes (opcional)"
                            value={draft.customer_group_id}
                            options={[
                              { value: "", label: "Sem grupo" },
                              ...(catalogs["customer-groups"] ?? [])
                                .filter((g) => g.active)
                                .map((g) => ({
                                  value: g.id,
                                  label: String(g.name),
                                })),
                            ]}
                            onChange={(value) => {
                              manualFields("customer_group_id");
                              setDraft({ ...draft, customer_group_id: value });
                            }}
                          />
                          <small>
                            {draft.customer_group_id
                              ? "Cliente/loja não identificado. Este recebimento será associado somente ao grupo."
                              : "Use somente quando não for possível identificar o cliente ou a loja."}
                          </small>
                        </div>
                      )}
                    <div className="field complementary-field">
                      <label htmlFor="identification-complementary">
                        Descrição Complementar
                      </label>
                      <textarea
                        id="identification-complementary"
                        aria-describedby="identification-complementary-hint"
                        value={draft.notes}
                        onChange={(event) => {
                          manualFields("notes");
                          setDraft({ ...draft, notes: event.target.value });
                        }}
                        maxLength={4000}
                        rows={2}
                      />
                      <small id="identification-complementary-hint">
                        Opcional. Complementa o lançamento sem alterar o
                        histórico do banco.
                      </small>
                    </div>
                  </div>
                  <div className="actions transaction-save">
                    <button className="primary" type="submit">
                      {saving ? "Salvando…" : "Salvar e próximo"}
                      <ArrowRight size={17} />
                    </button>
                    <button type="button" onClick={() => void save(false)}>
                      Salvar e fechar
                    </button>
                  </div>
                </fieldset>
              </form>
            )
          ) : (
            <p className="notice">
              Esta linha foi desconsiderada na importação para evitar
              duplicidade. Os dados originais permanecem disponíveis para
              consulta.
            </p>
          )}
          {saveError && (
            <p className="error" role="alert">
              {saveError}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
