import { useEffect, useState } from "react";
import { api } from "./api";
import { SearchSelect } from "./search-select";
import { Modal } from "./modal";
import { ActionButton } from "./action-button";
import { SortHeader, useTableSort } from "./table-sort";
import { MoneyInput, moneyDecimal } from "./money-input";
import { brl, brazilDate } from "./statement-import";
import { askAssistant } from "./assistant";
import { Eye, Pencil, Sparkles, Plus, RotateCcw, Ban } from "lucide-react";
import "./cash-flow.css";

type Filters = {
  start?: string;
  end?: string;
  as_of?: string;
  account_id?: string;
  cost_center_id?: string;
  category_id?: string;
  focus_key?: string;
};
type Catalog = { id: string; name: string; active: boolean };
type Line = {
  date: string;
  realized_credit: string;
  realized_debit: string;
  registered_credit: string;
  registered_debit: string;
  forecast_credit: string;
  forecast_debit: string;
  neutral_net: string;
  balance: string | null;
};
type Item = {
  id: string;
  date: string;
  layer: string;
  amount: string;
  direction: string;
  description: string;
  account_name: string;
  category_name: string;
  subcategory_name: string;
  cost_center_name: string;
  confidence?: string;
  neutral?: boolean;
  pending?: boolean;
};
type Pattern = {
  key: string;
  period: string;
  target: string;
  actual: string;
  registered: string;
  remaining: string;
  projected: string;
  confidence: string;
  observed_months: number;
  months: number;
  last_seen: string;
  revision: string;
  excluded: boolean;
  manual: boolean;
  unscheduled: boolean;
  direction: string;
  account_name: string;
  category_name: string;
  subcategory_name: string;
  cost_center_name: string;
  reason: string;
  timing: string;
};
type Report = {
  as_of: string;
  start: string;
  end: string;
  anchor: string | null;
  closing: string | null;
  known_accounts: number;
  total_accounts: number;
  history_scanned: number;
  training_records: number;
  warnings: string[];
  totals: Line;
  daily: Line[];
  monthly: Line[];
  patterns: Pattern[];
  items: Item[];
  overdue: Item[];
  catalogs: Record<string, Catalog[]>;
};
const val = (n: string | null | undefined) => (n == null ? "—" : brl(n));
const labels: Record<string, string> = {
  realized: "Realizado",
  registered: "Cadastrado",
  forecast: "Estimativa do Fin",
};
const monthName = (day: string) =>
  new Date(day + "T12:00:00").toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });

function BalanceChart({ rows, asOf }: { rows: Line[]; asOf: string }) {
  const known = rows
    .map((r, i) => ({
      ...r,
      i,
      n: r.balance == null ? null : Number(r.balance),
    }))
    .filter((r) => r.n != null);
  if (!known.length)
    return (
      <p className="empty">
        Informe os saldos de abertura em Extrato Bancário para acompanhar a
        curva de saldo.
      </p>
    );
  const low = Math.min(0, ...known.map((r) => r.n!)),
    high = Math.max(0, ...known.map((r) => r.n!));
  const x = (i: number) => 24 + (i / Math.max(1, rows.length - 1)) * 952;
  const y = (n: number) => 146 - ((n - low) / Math.max(1, high - low)) * 128;
  const past = known.filter((r) => r.date <= asOf),
    future = known.filter((r) => r.date > asOf);
  const points = (rs: typeof known) =>
    rs.map((r) => `${x(r.i)},${y(r.n!)}`).join(" ");
  return (
    <figure className="cash-chart">
      <svg
        viewBox="0 0 1000 170"
        role="img"
        aria-label="Evolução do saldo: realizado em verde e projetado em azul tracejado"
      >
        <line
          x1="24"
          x2="976"
          y1={y(0)}
          y2={y(0)}
          stroke="#94a3b8"
          strokeDasharray="3 4"
        />
        <polyline
          points={points(past)}
          fill="none"
          stroke="#15803d"
          strokeWidth="3"
        />
        <polyline
          points={points([
            ...(past.length ? [past[past.length - 1]] : []),
            ...future,
          ])}
          fill="none"
          stroke="#2563eb"
          strokeWidth="3"
          strokeDasharray="7 4"
        />
        <text x="24" y="166">
          {brazilDate(rows[0].date)}
        </text>
        <text x="976" y="166" textAnchor="end">
          {brazilDate(rows[rows.length - 1].date)}
        </text>
        {known.map((r) => (
          <circle
            key={r.date}
            cx={x(r.i)}
            cy={y(r.n!)}
            r="2"
            fill={r.date <= asOf ? "#15803d" : "#2563eb"}
          >
            <title>
              {brazilDate(r.date)} · {val(r.balance)}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <span className="cash-dot realized" />
        Saldo realizado <span className="cash-dot forecast" />
        Saldo projetado · Contas a pagar/receber + estimativas
      </figcaption>
    </figure>
  );
}

export function CashFlowPage({ organizationId }: { organizationId: string }) {
  const base = "/organizations/" + organizationId + "/cash-flow";
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState("monthly");
  const [detail, setDetail] = useState<{ title: string; items: Item[] } | null>(
    null,
  );
  const [detailPage, setDetailPage] = useState(1);
  const [patternPage, setPatternPage] = useState(1);
  const [editing, setEditing] = useState<{
    pattern: Pattern;
    action: string;
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const [frequency, setFrequency] = useState("ONCE");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const sorting = useTableSort("date");
  const patternsSort = useTableSort("period");
  const detailSort = useTableSort("date");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setPatternPage(1);
    setError("");
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v),
    );
    api<Report>(base + "?" + params, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [base, filters, refresh]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("finare:cash-flow", { detail: filters }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("finare:cash-flow", { detail: null }),
      );
    };
  }, [filters]);
  function change(key: keyof Filters, value: string) {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
    setNotice("");
  }
  function openDetail(title: string, items: Item[]) {
    setDetail({ title, items });
    setDetailPage(1);
  }
  function edit(pattern: Pattern, action: string) {
    setEditing({ pattern, action });
    setAmount(action === "CONVERT" ? pattern.remaining : pattern.target);
    setReason("");
    setDue(pattern.period);
    setFrequency("ONCE");
    setCount(1);
    setFormError("");
    setRequestKey(crypto.randomUUID());
  }
  async function save() {
    if (!editing || busy || !data) return;
    setBusy(true);
    setFormError("");
    const p = editing.pattern,
      common = {
        filters,
        key: p.key,
        period: p.period,
        expected_revision: p.revision,
        request_key: requestKey,
      };
    try {
      const convert = editing.action === "CONVERT";
      const result = await api<{ created?: number }>(
        base + (convert ? "/convert" : "/decisions"),
        {
          method: "POST",
          body: JSON.stringify(
            convert
              ? {
                  ...common,
                  due_on: due,
                  amount: moneyDecimal(amount),
                  frequency,
                  occurrences: frequency === "ONCE" ? 1 : count,
                }
              : {
                  ...common,
                  action: editing.action,
                  amount:
                    editing.action === "ADJUST" ? moneyDecimal(amount) : null,
                  reason,
                },
          ),
        },
      );
      setEditing(null);
      setRefresh((v) => v + 1);
      setNotice(
        convert
          ? `${result.created} lançamento(s) criado(s). A projeção será recalculada para evitar duplicidade.`
          : "Estimativa revisada. Movimentos e compromissos preservados.",
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const lines = data ? [...(view === "daily" ? data.daily : data.monthly)] : [];
  const field = sorting.order.field as keyof Line;
  lines.sort((a, b) => {
    const av = a[field],
      bv = b[field];
    const result =
      field === "date"
        ? String(av).localeCompare(String(bv))
        : Number(av ?? 0) - Number(bv ?? 0);
    return sorting.order.direction === "desc" ? -result : result;
  });
  const patterns = [...(data?.patterns ?? [])];
  patterns.sort((a, b) => {
    const f = patternsSort.order.field as keyof Pattern;
    const result = [
      "target",
      "actual",
      "registered",
      "remaining",
      "projected",
    ].includes(f)
      ? Number(a[f]) - Number(b[f])
      : String(a[f]).localeCompare(String(b[f]), "pt-BR");
    return patternsSort.order.direction === "desc" ? -result : result;
  });
  const details = [...(detail?.items ?? [])];
  details.sort((a, b) => {
    const f = detailSort.order.field as keyof Item;
    const result =
      f === "amount"
        ? Number(a.amount) - Number(b.amount)
        : String(a[f] ?? "").localeCompare(String(b[f] ?? ""), "pt-BR");
    return detailSort.order.direction === "desc" ? -result : result;
  });
  return (
    <section className="cash-flow">
      <div className="page-heading">
        <div>
          <h1>Fluxo de Caixa</h1>
          <p className="page-subtitle">
            Realizado, compromissos e projeções do Fin na mesma linha do tempo.
          </p>
        </div>
        <button
          className="primary"
          onClick={() =>
            askAssistant({ label: "Fluxo de Caixa", cash_flow: filters })
          }
        >
          <Sparkles size={17} /> Conversar com Fin
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="panel cash-filters">
        {(
          [
            ["account_id", "Conta Bancária", "bank_accounts"],
            ["cost_center_id", "Centro de Custos", "cost_centers"],
            ["category_id", "Classificação", "categories"],
          ] as const
        ).map(([key, label, table]) => (
          <div className="field" key={key}>
            <label htmlFor={"cash-" + key}>{label}</label>
            <SearchSelect
              id={"cash-" + key}
              value={filters[key] ?? ""}
              onChange={(v) => change(key, v)}
              options={[
                { value: "", label: "Todos" },
                ...(data?.catalogs[table] ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              ]}
            />
          </div>
        ))}
        <label>
          De
          <input
            type="date"
            aria-label="Fluxo de"
            value={filters.start ?? data?.start ?? ""}
            onChange={(e) => change("start", e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            aria-label="Fluxo até"
            value={filters.end ?? data?.end ?? ""}
            onChange={(e) => change("end", e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            setFilters({});
            setRefresh((v) => v + 1);
          }}
          disabled={loading}
        >
          Atualizar
        </button>
      </div>
      {loading && (
        <p role="status">Analisando histórico e recalculando o fluxo…</p>
      )}
      {data && !loading && !error && (
        <>
          <div className="cash-kpis">
            <div>
              <small>Saldo bancário · {brazilDate(data.as_of)}</small>
              <strong>{val(data.anchor)}</strong>
              <small>
                {data.known_accounts} de {data.total_accounts} contas com
                referência
              </small>
            </div>
            <div>
              <small>Entradas cadastradas</small>
              <strong className="amount-credit">
                {val(data.totals.registered_credit)}
              </strong>
              <small>Saldo em aberto a vencer</small>
            </div>
            <div>
              <small>Saídas cadastradas</small>
              <strong className="amount-debit">
                {val(data.totals.registered_debit)}
              </strong>
              <small>Saldo em aberto a vencer</small>
            </div>
            <div>
              <small>Entradas estimadas pelo Fin</small>
              <strong>{val(data.totals.forecast_credit)}</strong>
              <small>Além dos compromissos cadastrados</small>
            </div>
            <div>
              <small>Saídas estimadas pelo Fin</small>
              <strong>{val(data.totals.forecast_debit)}</strong>
              <small>Além dos compromissos cadastrados</small>
            </div>
            <div className="cash-closing">
              <small>Saldo projetado · {brazilDate(data.end)}</small>
              <strong>{val(data.closing)}</strong>
              <small>
                {data.known_accounts < data.total_accounts
                  ? "Saldo parcial · confira a cobertura"
                  : "Inclui compromissos e estimativas"}
              </small>
            </div>
          </div>
          <details className="cash-assumptions">
            <summary>
              Premissas e alertas · {data.history_scanned} movimentos analisados
            </summary>
            <p>
              {data.training_records} reconhecimentos confirmados disponíveis
              para aprendizado. Sugestões não confirmadas não treinam o modelo.
            </p>
            {data.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
          {data.overdue.length > 0 && (
            <div className="cash-overdue">
              <strong>
                {data.overdue.length} títulos vencidos · Data de realização a
                definir
              </strong>
              <button
                onClick={() =>
                  openDetail(
                    "Títulos Vencidos · Fora do Saldo Projetado",
                    data.overdue,
                  )
                }
              >
                Consultar vencidos
              </button>
            </div>
          )}
          <section className="panel listing">
            <div className="cash-section-heading">
              <div>
                <h2>Linha do Tempo</h2>
                <small>
                  Verde: realizado · Âmbar: cadastrado · Azul: estimativa
                </small>
              </div>
              <SearchSelect
                ariaLabel="Agrupar fluxo"
                value={view}
                onChange={setView}
                options={[
                  { value: "monthly", label: "Mensal" },
                  { value: "daily", label: "Diário" },
                ]}
              />
            </div>
            <BalanceChart rows={data.daily} asOf={data.as_of} />
            <div className="table-scroll">
              <table className="cash-table">
                <thead>
                  <tr>
                    {[
                      ["date", "Período"],
                      ["realized_credit", "Entradas Realizadas"],
                      ["realized_debit", "Saídas Realizadas"],
                      ["registered_credit", "Entradas Cadastradas"],
                      ["registered_debit", "Saídas Cadastradas"],
                      ["forecast_credit", "Entradas Fin"],
                      ["forecast_debit", "Saídas Fin"],
                      ["balance", "Saldo"],
                    ].map(([f, l]) => (
                      <SortHeader
                        key={f}
                        field={f}
                        label={l}
                        order={sorting.order}
                        onChange={sorting.change}
                      />
                    ))}
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.date}>
                      <td>
                        {view === "daily"
                          ? brazilDate(line.date)
                          : monthName(line.date)}
                      </td>
                      {[
                        "realized_credit",
                        "realized_debit",
                        "registered_credit",
                        "registered_debit",
                        "forecast_credit",
                        "forecast_debit",
                      ].map((f) => (
                        <td
                          key={f}
                          className={
                            f.startsWith("forecast")
                              ? "cash-forecast"
                              : f.startsWith("registered")
                                ? "cash-registered"
                                : ""
                          }
                        >
                          {val(line[f as keyof Line])}
                        </td>
                      ))}
                      <td
                        className={
                          Number(line.balance) < 0 ? "amount-debit" : ""
                        }
                      >
                        <strong>{val(line.balance)}</strong>
                      </td>
                      <td>
                        <ActionButton
                          label="Ver composição"
                          icon={Eye}
                          onClick={() =>
                            openDetail(
                              "Composição · " +
                                (view === "daily"
                                  ? brazilDate(line.date)
                                  : monthName(line.date)),
                              data.items.filter((i) =>
                                view === "daily"
                                  ? i.date === line.date
                                  : i.date.slice(0, 7) ===
                                    line.date.slice(0, 7),
                              ),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel listing">
            <div className="cash-section-heading">
              <div>
                <h2>Sugestões do Fin</h2>
                <small>
                  Azul: padrão mais estável · Amarelo: revisar · Nenhuma
                  estimativa cria obrigações automaticamente.
                </small>
              </div>
            </div>
            {!patterns.length ? (
              <p className="empty">
                Ainda não há padrões recentes com pelo menos três meses de
                observações suficientes para projetar.
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        ["period", "Mês"],
                        ["subcategory_name", "Grupo de Contas"],
                        ["target", "Estimativa do Mês"],
                        ["actual", "Já Realizado"],
                        ["registered", "Coberto por Cadastro"],
                        ["projected", "Fin na Linha do Tempo"],
                      ].map(([f, l]) => (
                        <SortHeader
                          key={f}
                          field={f}
                          label={l}
                          order={patternsSort.order}
                          onChange={patternsSort.change}
                        />
                      ))}
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns
                      .slice((patternPage - 1) * 50, patternPage * 50)
                      .map((p) => (
                        <tr key={p.key + p.period}>
                          <td>
                            {monthName(p.period)}
                            <small
                              className={"cash-confidence " + p.confidence}
                            >
                              {p.manual
                                ? "Revisado pelo operador"
                                : p.confidence === "high"
                                  ? "Confiança alta"
                                  : "Revisar"}
                            </small>
                          </td>
                          <td>
                            <strong>{p.subcategory_name}</strong>
                            <small>
                              {p.category_name} · {p.cost_center_name}
                            </small>
                            <small>
                              {p.account_name} ·{" "}
                              {p.direction === "CREDIT" ? "Receita" : "Despesa"}
                            </small>
                            {p.excluded && (
                              <small className="amount-debit">
                                Desconsiderado
                              </small>
                            )}
                            {p.unscheduled && (
                              <small className="amount-debit">
                                Dia habitual já passou · revisar data
                              </small>
                            )}
                          </td>
                          <td>{val(p.target)}</td>
                          <td>{val(p.actual)}</td>
                          <td>{val(p.registered)}</td>
                          <td className="cash-forecast">{val(p.projected)}</td>
                          <td>
                            <div className="cash-row-actions">
                              <ActionButton
                                label="Entender sugestão"
                                icon={Sparkles}
                                onClick={() =>
                                  askAssistant({
                                    label:
                                      p.subcategory_name +
                                      " · " +
                                      monthName(p.period),
                                    cash_flow: { ...filters, focus_key: p.key },
                                  })
                                }
                              />
                              <ActionButton
                                label="Ajustar estimativa"
                                icon={Pencil}
                                onClick={() => edit(p, "ADJUST")}
                              />
                              <ActionButton
                                label={
                                  p.excluded || p.manual
                                    ? "Restaurar estimativa"
                                    : "Desconsiderar estimativa"
                                }
                                icon={p.excluded || p.manual ? RotateCcw : Ban}
                                onClick={() =>
                                  edit(
                                    p,
                                    p.excluded || p.manual
                                      ? "RESET"
                                      : "EXCLUDE",
                                  )
                                }
                              />
                              <ActionButton
                                label="Criar lançamento"
                                icon={Plus}
                                disabled={
                                  p.excluded || Number(p.remaining) <= 0
                                }
                                onClick={() => edit(p, "CONVERT")}
                              />
                            </div>
                            <details>
                              <summary>Premissas</summary>
                              <p>{p.reason}</p>
                              <p>
                                {p.timing} · Última ocorrência:{" "}
                                {brazilDate(p.last_seen)}.
                              </p>
                            </details>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <p>
            Valores realizados vêm do extrato. Movimentos neutros permanecem
            separados de receitas e despesas.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    ["date", "Data"],
                    ["description", "Descrição"],
                    ["layer", "Origem"],
                    ["account_name", "Conta"],
                    ["amount", "Valor"],
                  ].map(([f, l]) => (
                    <SortHeader
                      key={f}
                      field={f}
                      label={l}
                      order={detailSort.order}
                      onChange={detailSort.change}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {details
                  .slice((detailPage - 1) * 100, detailPage * 100)
                  .map((i) => (
                    <tr key={i.layer + i.id}>
                      <td>{brazilDate(i.date)}</td>
                      <td>
                        {i.description}
                        <small>
                          {i.category_name} · {i.subcategory_name} ·{" "}
                          {i.cost_center_name}
                        </small>
                        {i.neutral && (
                          <small>
                            Movimento neutro · Fora de receitas/despesas
                          </small>
                        )}
                        {i.pending && (
                          <small className="amount-debit">A identificar</small>
                        )}
                      </td>
                      <td>
                        <span className={"cash-layer " + i.layer}>
                          {labels[i.layer]}
                        </span>
                      </td>
                      <td>{i.account_name}</td>
                      <td
                        className={
                          i.direction === "CREDIT"
                            ? "amount-credit"
                            : "amount-debit"
                        }
                      >
                        {i.direction === "DEBIT" ? "− " : "+ "}
                        {val(i.amount)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!details.length && (
            <p className="empty">Sem movimentos nesta seleção.</p>
          )}
          {details.length > 100 && (
            <div className="transaction-pagination">
              <button
                disabled={detailPage === 1}
                onClick={() => setDetailPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                {detailPage} · {details.length} registros
              </span>
              <button
                disabled={detailPage * 100 >= details.length}
                onClick={() => setDetailPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </Modal>
      )}
      {editing && (
        <Modal
          title={
            editing.action === "CONVERT"
              ? "Confirmar Lançamento a Partir da Projeção"
              : "Revisar Estimativa do Fin"
          }
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <form
            className="cash-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p>
              <strong>{editing.pattern.subcategory_name}</strong> ·{" "}
              {editing.pattern.cost_center_name} ·{" "}
              {monthName(editing.pattern.period)}
            </p>
            <p>{editing.pattern.reason}</p>
            <fieldset disabled={busy}>
              <div className="fields">
                {(editing.action === "ADJUST" ||
                  editing.action === "CONVERT") && (
                  <label>
                    {editing.action === "CONVERT"
                      ? "Valor do compromisso"
                      : "Orçamento estimado do mês (antes das coberturas)"}
                    <MoneyInput value={amount} onChange={setAmount} />
                  </label>
                )}
                {editing.action === "CONVERT" ? (
                  <>
                    <label>
                      Vencimento
                      <input
                        type="date"
                        required
                        min={
                          data
                            ? new Date(
                                new Date(data.as_of + "T12:00:00").getTime() +
                                  86400000,
                              )
                                .toISOString()
                                .slice(0, 10)
                            : undefined
                        }
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </label>
                    <div className="field">
                      <label>Recorrência</label>
                      <SearchSelect
                        ariaLabel="Recorrência da projeção"
                        value={frequency}
                        onChange={setFrequency}
                        options={[
                          { value: "ONCE", label: "Uma vez" },
                          { value: "MONTHLY", label: "Mensal" },
                        ]}
                      />
                    </div>
                    {frequency === "MONTHLY" && (
                      <label>
                        Quantidade de meses
                        <input
                          type="number"
                          min="1"
                          max="12"
                          required
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                        />
                      </label>
                    )}
                    <p>
                      Esta confirmação cria {frequency === "ONCE" ? 1 : count}{" "}
                      compromisso(s) em Lançamentos. A estimativa será reduzida
                      pelo valor cadastrado.
                    </p>
                  </>
                ) : (
                  <label className="cash-wide">
                    Justificativa
                    <textarea
                      required
                      minLength={3}
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="actions">
                <button className="primary">
                  {busy
                    ? "Salvando…"
                    : editing.action === "CONVERT"
                      ? "Confirmar criação"
                      : "Confirmar revisão"}
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
              </div>
            </fieldset>
            {formError && (
              <p className="error" role="alert">
                {formError}
              </p>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}
