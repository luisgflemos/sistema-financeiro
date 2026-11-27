import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { CatalogSearch } from "./catalog-search";
import { MoneyInput, moneyDecimal } from "./money-input";
import { brl, brazilDate } from "./statement-import";
import { SortHeader, useTableSort } from "./table-sort";
import { ActionButton } from "./action-button";
import { RotateCcw } from "lucide-react";
import "./bank-balances.css";

type Position = {
  date: string;
  amount: string;
  source?: string;
  file_name: string | null;
  source_row: number | null;
};
type Summary = {
  account_id: string;
  label: string;
  currency: string;
  active: boolean;
  state: string;
  calculated_balance: string | null;
  as_of: string | null;
  opening: Position | null;
  last_bank_balance: Position | null;
  differences: {
    date: string;
    difference: string;
    file_name: string;
    source_row: number;
  }[];
  difference_count: number;
  ambiguous_dates: string[];
  unreferenced_movements: number;
  manual_opening_superseded: boolean;
  needs_opening: boolean;
  movements: number;
  first_movement_date: string | null;
};
type TotalPosition = {
  currency: string;
  amount: string | null;
  known_accounts: number;
  missing_accounts: number;
  first_date: string | null;
  last_date: string | null;
  needs_review: boolean;
};
type BalanceEvent = {
  id: string;
  kind: string;
  posted_on: string;
  amount: string;
  reason: string;
  reversed: boolean;
  created_at: string;
};
type LedgerRow = {
  account_label?: string;
  account_id?: string;
  id: string;
  kind: string;
  posted_on: string;
  raw_description: string;
  signed_amount: string;
  calculated_balance: string | null;
  bank_balance: string | null;
  difference: string | null;
  reason: string | null;
  file_name: string | null;
  source_row: number | null;
};
type Ledger = {
  summary: Summary;
  start: string | null;
  totals: {
    opening: string | null;
    credits: string;
    debits: string;
    adjustments: string;
    closing: string | null;
  };
  rows: LedgerRow[];
  events: BalanceEvent[];
  total: number;
};
const states: Record<string, string> = {
  missing_opening: "Informe a abertura",
  difference: "Conferir divergências",
  consistent: "Referências conferem",
  adjusted: "Com ajuste manual",
  manual: "Abertura manual",
  unverified: "Aguardando conferência",
};
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const value = (amount: string | null | undefined) =>
  amount == null ? "—" : brl(amount);
export function BankBalancesPage({
  organizationId,
}: {
  organizationId: string;
}) {
  const base = "/organizations/" + organizationId + "/bank-balances";
  const [accounts, setAccounts] = useState<Summary[]>([]);
  const [totals, setTotals] = useState<TotalPosition[]>([]);
  const [account, setAccount] = useState("");
  const [data, setData] = useState<Ledger | null>(null);
  const [allData, setAllData] = useState<{
    currency: string;
    rows: LedgerRow[];
    total: number;
  } | null>(null);
  const isAll = account.startsWith("all:");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sorting = useTableSort("date");
  const [form, setForm] = useState<"OPENING" | "ADJUSTMENT" | null>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [sign, setSign] = useState("positive");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [history, setHistory] = useState(false);
  const [reversing, setReversing] = useState<BalanceEvent | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    api<{ accounts: Summary[]; totals: TotalPosition[] }>(base, {
      signal: c.signal,
    })
      .then((result) => {
        setAccounts(result.accounts);
        setTotals(result.totals);
        setAccount((old) =>
          (old.startsWith("all:") &&
            result.totals.some((t) => "all:" + t.currency === old)) ||
          result.accounts.some((a) => a.account_id === old)
            ? old
            : (result.accounts.find((a) => a.movements > 0)?.account_id ??
              result.accounts[0]?.account_id ??
              ""),
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [base, refresh]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      query: search,
      sort_by:
        !account.startsWith("all:") && sorting.order.field === "account"
          ? "date"
          : sorting.order.field,
      sort_order: sorting.order.direction,
    });
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const all = account.startsWith("all:");
    if (all) params.set("currency", account.slice(4));
    api<Ledger & { currency: string }>(
      base + "/" + (all ? "all" : account) + "?" + params,
      { signal: c.signal },
    )
      .then((result) => {
        if (all) setAllData(result);
        else setData(result);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [base, account, start, end, page, search, sorting.order, refresh]);
  const selected =
    data?.summary.account_id === account
      ? data.summary
      : accounts.find((a) => a.account_id === account);
  const current = isAll
    ? allData?.currency === account.slice(4)
      ? allData
      : null
    : data?.summary.account_id === account
      ? data
      : null;
  function selectAccount(id: string) {
    setAccount(id);
    setData(null);
    setAllData(null);
    setStart("");
    setEnd("");
    setQuery("");
    setPage(1);
    setNotice("");
  }
  function open(kind: "OPENING" | "ADJUSTMENT") {
    setForm(kind);
    setDate(
      kind === "OPENING" ? (selected?.first_movement_date ?? today()) : today(),
    );
    setAmount("");
    setSign("positive");
    setReason("");
    setKey(crypto.randomUUID());
    setFormError("");
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    setFormError("");
    try {
      await api(base + "/" + account + "/events", {
        method: "POST",
        body: JSON.stringify({
          request_key: key,
          kind: form,
          posted_on: date,
          amount: (sign === "negative" ? "-" : "") + moneyDecimal(amount),
          reason: reason.trim(),
        }),
      });
      setForm(null);
      setRefresh((v) => v + 1);
      setNotice("Registro de saldo salvo. Extrato original preservado.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reverse() {
    if (!reversing || busy) return;
    setBusy(true);
    setFormError("");
    try {
      await api(base + "/" + account + "/events/" + reversing.id + "/reverse", {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setReversing(null);
      setRefresh((v) => v + 1);
      setNotice("Registro de saldo estornado. Histórico preservado.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bank-balances">
      <div className="page-heading">
        <div>
          <h1>Extrato Bancário</h1>
          <p className="page-subtitle">
            Saldos de conta corrente conforme os movimentos importados.
          </p>
        </div>
        <div className="actions">
          {account && !isAll && (
            <>
              <button
                type="button"
                disabled={!current || loading}
                onClick={() => setHistory(true)}
              >
                Referências e Ajustes
              </button>
              <button
                className="primary"
                disabled={!selected}
                onClick={() =>
                  open(selected?.needs_opening ? "OPENING" : "ADJUSTMENT")
                }
              >
                {selected?.needs_opening
                  ? "Informar Saldo de Abertura"
                  : "Ajustar Saldo"}
              </button>
            </>
          )}
        </div>
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
      <div className="bank-account-cards" aria-label="Saldos por conta">
        {totals.map((total) => (
          <button
            type="button"
            onClick={() => selectAccount("all:" + total.currency)}
            aria-label={"Ver extrato de todas as contas " + total.currency}
            aria-pressed={account === "all:" + total.currency}
            className="bank-total-card"
            key={total.currency}
          >
            <strong>Saldo Total</strong>
            <span className="bank-card-value">
              {total.amount == null
                ? "—"
                : new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: total.currency,
                  }).format(Number(total.amount))}{" "}
              <small>{total.currency}</small>
            </span>
            <small>
              {total.first_date && total.last_date
                ? total.first_date === total.last_date
                  ? "Posição de " + brazilDate(total.last_date)
                  : "Posições de " +
                    brazilDate(total.first_date) +
                    " a " +
                    brazilDate(total.last_date)
                : "Sem posição disponível"}
            </small>
            <span className="bank-total-coverage">
              {total.known_accounts} de{" "}
              {total.known_accounts + total.missing_accounts} contas com saldo
            </span>
            {total.missing_accounts > 0 && (
              <small>{total.missing_accounts} sem saldo · Total parcial</small>
            )}
            {total.needs_review && (
              <small>Há saldos que precisam de conferência</small>
            )}
          </button>
        ))}
        {accounts.map((a) => (
          <button
            type="button"
            key={a.account_id}
            aria-label={"Ver extrato de " + a.label}
            aria-pressed={account === a.account_id}
            onClick={() => selectAccount(a.account_id)}
          >
            <strong>
              {a.label}
              {!a.active ? " · Inativa" : ""}
            </strong>
            <span className="bank-card-value">
              {value(a.calculated_balance)} <small>{a.currency}</small>
            </span>
            <small>
              {a.as_of
                ? "Posição de " + brazilDate(a.as_of)
                : "Sem posição importada"}
            </small>
            <span className={"bank-balance-state bank-balance-" + a.state}>
              {states[a.state]}
            </span>
          </button>
        ))}
      </div>
      {!accounts.length && !error && (
        <p className="empty">
          Cadastre uma conta bancária para acompanhar seus saldos.
        </p>
      )}
      {(selected || isAll) && (
        <>
          {isAll && (
            <p className="bank-balance-note">
              Todas as contas · {account.slice(4)}. Os saldos exibidos em cada
              linha pertencem à conta de origem. Inclui movimentos anteriores à
              referência de saldo; nesses casos, o saldo permanece não
              informado.
            </p>
          )}
          {selected && (
            <>
              <div className="bank-position">
                <strong>
                  {selected.label} ·{" "}
                  {selected.as_of
                    ? "Última posição: " + brazilDate(selected.as_of)
                    : "Sem posição"}
                </strong>
                <span>
                  Saldo calculado: <b>{value(selected.calculated_balance)}</b>
                </span>
                <span>
                  Último saldo informado:{" "}
                  <b>{value(selected.last_bank_balance?.amount)}</b>
                  {selected.last_bank_balance
                    ? " · " + brazilDate(selected.last_bank_balance.date)
                    : ""}
                </span>
              </div>
              {selected.state === "unverified" && (
                <p className="bank-balance-alert">
                  Há movimentos posteriores ao último saldo informado pelo
                  banco. O saldo calculado aguarda uma nova referência para
                  conferência.
                </p>
              )}
              {selected.needs_opening && (
                <div className="bank-balance-alert" role="status">
                  <strong>Falta uma referência de saldo.</strong>
                  <span>
                    Não há saldo suficiente no extrato para calcular a abertura
                    com segurança. Informe o saldo antes dos movimentos da data
                    escolhida.
                  </span>
                  <button className="primary" onClick={() => open("OPENING")}>
                    Informar Saldo de Abertura
                  </button>
                </div>
              )}
              {selected.difference_count > 0 && (
                <div
                  className="bank-balance-alert bank-balance-alert-danger"
                  role="status"
                >
                  <strong>
                    {selected.difference_count} divergência(s) entre o saldo
                    calculado e o banco.
                  </strong>
                  <span>
                    Confira períodos incompletos e importações antes de
                    registrar um ajuste.
                  </span>
                  {selected.differences.slice(0, 3).map((d, i) => (
                    <small key={i}>
                      {brazilDate(d.date)} · Diferença: {brl(d.difference)} ·{" "}
                      {d.file_name} · Linha {d.source_row}
                    </small>
                  ))}
                </div>
              )}
              {selected.ambiguous_dates.length > 0 && (
                <p className="bank-balance-alert">
                  A ordem entre arquivos do mesmo dia precisa ser conferida:{" "}
                  {selected.ambiguous_dates.map(brazilDate).join(", ")}. Os
                  saldos calculados desse trecho são provisórios.
                </p>
              )}
              {selected.unreferenced_movements > 0 && (
                <p className="bank-balance-note">
                  {selected.unreferenced_movements} movimento(s) anteriores à
                  referência disponível. Consulte-os pelo período; os saldos
                  anteriores não foram presumidos.
                </p>
              )}
              {selected.manual_opening_superseded && (
                <p className="bank-balance-note">
                  A referência importada passou a ser usada no lugar da abertura
                  manual. O registro manual foi preservado.
                </p>
              )}
              {selected.opening && (
                <p className="bank-balance-note">
                  Referência{" "}
                  {selected.opening.source === "statement"
                    ? "do extrato"
                    : "manual"}
                  : {brl(selected.opening.amount)} antes dos movimentos
                  disponíveis de {brazilDate(selected.opening.date)}
                  {selected.opening.file_name
                    ? " · " +
                      selected.opening.file_name +
                      " · Linha " +
                      selected.opening.source_row
                    : ""}
                  . A conferência cobre os movimentos importados.
                </p>
              )}
              {data && data.summary.account_id === account && (
                <div
                  className="bank-period-totals"
                  aria-label="Totais do período"
                >
                  {[
                    ["Saldo inicial", data.totals.opening],
                    ["Créditos", data.totals.credits],
                    ["Débitos", data.totals.debits],
                    ["Ajustes", data.totals.adjustments],
                    ["Saldo final calculado", data.totals.closing],
                  ].map(([label, number]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{value(number)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <section className="panel listing">
            <div className="catalog-toolbar bank-ledger-toolbar">
              <div className="catalog-toolbar-title">
                <h2>Movimentos</h2>
                <span className="catalog-toolbar-count">
                  {current?.total ?? 0} registros
                </span>
              </div>
              <CatalogSearch value={query} onChange={setQuery} />
              <SearchSelect
                ariaLabel="Conta do extrato bancário"
                value={account}
                onChange={selectAccount}
                options={[
                  ...totals.map((t) => ({
                    value: "all:" + t.currency,
                    label: "Todas as contas · " + t.currency,
                  })),
                  ...accounts.map((a) => ({
                    value: a.account_id,
                    label: a.label,
                  })),
                ]}
              />
            </div>
            <div className="bank-ledger-dates">
              <label>
                De
                <input
                  type="date"
                  aria-label="Extrato de"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  aria-label="Extrato até"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <small>
                {isAll
                  ? "Sem data inicial: todos os movimentos importados. Pesquise também pelo nome da conta."
                  : "Sem data inicial: desde a referência de abertura. Totais abrangem o período completo; a busca filtra as linhas."}
              </small>
            </div>
            {loading ? (
              <p className="empty" role="status">
                Conferindo saldos…
              </p>
            ) : current && !current.rows.length ? (
              <p className="empty">Nenhum movimento no período.</p>
            ) : (
              current && (
                <div className="table-scroll">
                  <table className="bank-ledger-table">
                    <thead>
                      <tr>
                        {[
                          ["date", "Data"],
                          ...(isAll ? [["account", "Conta Bancária"]] : []),
                          ["description", "Histórico do Banco"],
                          ["amount", "Valor"],
                          ["balance", "Saldo Calculado"],
                          ["reported", "Saldo Informado"],
                          ["difference", "Diferença"],
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
                      </tr>
                    </thead>
                    <tbody>
                      {current.rows.map((r) => (
                        <tr
                          key={r.kind + r.id}
                          className={
                            r.difference && r.difference !== "0.00"
                              ? "bank-row-difference"
                              : ""
                          }
                        >
                          <td>{brazilDate(r.posted_on)}</td>
                          {isAll && <td>{r.account_label}</td>}
                          <td>
                            {r.raw_description}
                            {r.kind === "ADJUSTMENT" && (
                              <span className="bank-balance-state bank-balance-adjusted">
                                Ajuste
                              </span>
                            )}
                            <small>
                              {r.reason ??
                                (r.file_name
                                  ? `${r.file_name} · Linha ${r.source_row}`
                                  : "")}
                            </small>
                          </td>
                          <td
                            className={
                              r.signed_amount.startsWith("-")
                                ? "amount-debit"
                                : "amount-credit"
                            }
                          >
                            {r.signed_amount.startsWith("-") ? "" : "+ "}
                            {brl(r.signed_amount)}
                          </td>
                          <td>{value(r.calculated_balance)}</td>
                          <td>{value(r.bank_balance)}</td>
                          <td>{value(r.difference)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {current && current.total > 100 && (
              <div className="transaction-pagination">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Anterior
                </button>
                <span>Página {page}</span>
                <button
                  disabled={page * 100 >= current.total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Próxima
                </button>
              </div>
            )}
          </section>
        </>
      )}
      {form && (
        <Modal
          title={
            form === "OPENING" ? "Informar Saldo de Abertura" : "Ajustar Saldo"
          }
          busy={busy}
          onClose={() => setForm(null)}
        >
          <form
            className="bank-balance-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p>
              {form === "OPENING"
                ? "Informe o saldo antes dos movimentos da data escolhida. Será usado somente enquanto não houver referência suficiente nos extratos."
                : "O ajuste entra no fim do dia. Não altera o extrato nem cria receita ou despesa."}
            </p>
            <fieldset disabled={busy}>
              <div className="fields">
                <label>
                  Data de referência
                  <input
                    type="date"
                    required
                    max={today()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <div className="field">
                  <label htmlFor="balance-sign">
                    {form === "OPENING"
                      ? "Situação do saldo"
                      : "Efeito do ajuste"}
                  </label>
                  <SearchSelect
                    id="balance-sign"
                    value={sign}
                    onChange={setSign}
                    options={[
                      {
                        value: "positive",
                        label:
                          form === "OPENING"
                            ? "Saldo positivo"
                            : "Aumentar saldo",
                      },
                      {
                        value: "negative",
                        label:
                          form === "OPENING"
                            ? "Saldo negativo"
                            : "Diminuir saldo",
                      },
                    ]}
                  />
                </div>
                <label>
                  Valor ({selected?.currency ?? "BRL"})
                  <MoneyInput value={amount} onChange={setAmount} />
                </label>
                <label className="bank-balance-reason">
                  Justificativa
                  <textarea
                    rows={2}
                    required
                    minLength={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </div>
              <div className="actions">
                <button className="primary">
                  {busy ? "Salvando…" : "Salvar referência"}
                </button>
                <button type="button" onClick={() => setForm(null)}>
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
      {history && (
        <Modal title="Referências e Ajustes" onClose={() => setHistory(false)}>
          <p>
            Registros manuais desta conta. Estornar preserva a justificativa e a
            auditoria.
          </p>
          {current?.events.length ? (
            data?.events.map((e) => (
              <div className="bank-event" key={e.id}>
                <strong>
                  {e.kind === "OPENING" ? "Abertura manual" : "Ajuste de saldo"}{" "}
                  · {brazilDate(e.posted_on)} · {brl(e.amount)}
                </strong>
                <p>{e.reason}</p>
                <small>
                  {e.reversed
                    ? "Estornado"
                    : "Registrado em " +
                      new Date(e.created_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                </small>
                {!e.reversed && (
                  <ActionButton
                    label="Estornar registro de saldo"
                    icon={RotateCcw}
                    tone="neutral"
                    onClick={() => {
                      setHistory(false);
                      setReversing(e);
                      setReason("");
                      setFormError("");
                    }}
                  />
                )}
              </div>
            ))
          ) : (
            <p>
              Nenhum registro manual. As referências do extrato são usadas
              automaticamente.
            </p>
          )}
        </Modal>
      )}
      {reversing && (
        <Modal
          title="Estornar Registro de Saldo"
          busy={busy}
          onClose={() => setReversing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void reverse();
            }}
          >
            <p>
              {brazilDate(reversing.posted_on)} · {brl(reversing.amount)} ·{" "}
              {reversing.reason}
            </p>
            <label>
              Motivo do estorno
              <textarea
                required
                minLength={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Confirmar estorno
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReversing(null)}
              >
                Voltar
              </button>
            </div>
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
