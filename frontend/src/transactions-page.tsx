import { useEffect, useState } from "react";
import { Sparkles, Upload, ArrowRight } from "lucide-react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { CatalogSearch } from "./catalog-search";
import { StatementImport, brl, brazilDate } from "./statement-import";
import type { RecordData } from "./catalogs";
import { askAssistant } from "./assistant";
import { EntryLinker } from "./entry-linker";

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
  suggestion: Record<string, string | null> | null;
  reason: string | null;
  confidence: string | null;
};
type Draft = {
  party_id: string;
  category_id: string;
  subcategory_id: string;
  cost_center_id: string;
  movement_kind: string;
  notes: string;
};
type Catalogs = Record<string, RecordData[]>;
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
  const [busyImport, setBusyImport] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [selected, setSelected] = useState<Movement | null>(null);
  const [draft, setDraft] = useState<Draft>({
    party_id: "",
    category_id: "",
    subcategory_id: "",
    cost_center_id: "",
    movement_kind: "NORMAL",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
    refresh,
  ]);

  function edit(row: Movement) {
    setLinkMode(false);
    const source = row.version ? row : (row.suggestion ?? row);
    setDraft({
      party_id: String(source.party_id ?? ""),
      category_id: String(source.category_id ?? ""),
      subcategory_id: String(source.subcategory_id ?? ""),
      cost_center_id: String(source.cost_center_id ?? ""),
      movement_kind: String(source.movement_kind ?? "NORMAL"),
      notes: row.notes ?? "",
    });
    setSelected(row);
    setSaveError("");
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
      .filter((row) => row.active)
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
                  <th>Data / Conta</th>
                  <th>Histórico do Banco</th>
                  <th>Valor</th>
                  <th>Identificação</th>
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
                    <td>
                      {brazilDate(row.posted_on)}
                      <small>{row.account_label}</small>
                    </td>
                    <td>
                      {row.raw_description}
                      {(row.party_name ||
                        row.category_name ||
                        row.cost_center_name) && (
                        <small>
                          {[
                            row.party_name,
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
                          "transaction-state transaction-state-" + row.state
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
                      <button
                        className="text-button"
                        type="button"
                        aria-label={
                          "Identificar movimento de " +
                          brazilDate(row.posted_on) +
                          " " +
                          row.raw_description
                        }
                        onClick={() => edit(row)}
                      >
                        {!row.editable
                          ? "Ver detalhe"
                          : row.version
                            ? "Revisar"
                            : "Identificar"}
                        <ArrowRight size={15} />
                      </button>
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
            <small>
              Documento: {selected.raw_payload.documento || "Não informado"} ·
              Saldo informado: {brl(selected.raw_payload.saldo ?? "0")}
            </small>
          </div>
          {selected.editable && (
            <EntryLinker
              key={selected.id}
              organizationId={organizationId}
              movement={selected}
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
            <div className="transaction-ai">
              <strong>
                <Sparkles size={17} /> Sugestão da IA · Confiança{" "}
                {selected.confidence === "HIGH"
                  ? "alta"
                  : selected.confidence === "MEDIUM"
                    ? "média"
                    : "baixa"}
              </strong>
              <p>{selected.reason}</p>
              <small>Confira os vínculos abaixo antes de salvar.</small>
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
                <fieldset disabled={saving}>
                  <div className="fields">
                    <div className="field">
                      <label htmlFor="movement-kind">
                        Tratamento do movimento
                      </label>
                      <SearchSelect
                        id="movement-kind"
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
                        onChange={(value) =>
                          setDraft({ ...draft, movement_kind: value })
                        }
                      />
                    </div>
                    {draft.movement_kind !== "NORMAL" && (
                      <p className="transaction-neutral">
                        O movimento permanece no extrato bancário, com
                        tratamento neutro para a visão gerencial.
                      </p>
                    )}
                    {fieldLabels.map(([field, label, key]) => (
                      <div className="field" key={field}>
                        <label
                          className="identification-label"
                          htmlFor={"identify-" + field}
                        >
                          {label}
                        </label>
                        <SearchSelect
                          id={"identify-" + field}
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
                          onChange={(value) =>
                            setDraft((previous) => ({
                              ...previous,
                              [field]: value,
                              ...(field === "category_id"
                                ? { subcategory_id: "" }
                                : {}),
                            }))
                          }
                        />
                      </div>
                    ))}
                    <div className="field complementary-field">
                      <label htmlFor="identification-complementary">
                        Descrição Complementar
                      </label>
                      <textarea
                        id="identification-complementary"
                        aria-describedby="identification-complementary-hint"
                        value={draft.notes}
                        onChange={(event) =>
                          setDraft({ ...draft, notes: event.target.value })
                        }
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
