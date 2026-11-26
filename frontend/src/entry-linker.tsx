import { useEffect, useState } from "react";
import { api } from "./api";
import { SearchSelect } from "./search-select";
import { brl, brazilDate } from "./statement-import";
import type { PlannedEntry } from "./planning-page";
import type { RecordData } from "./catalogs";
import { Unlink } from "lucide-react";
import { ActionButton } from "./action-button";
import "./settlement-review.css";

function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}
function decimal(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
type Candidate = PlannedEntry & { confidence: string; reason: string };
type Fields = {
  category_id: string;
  subcategory_id: string;
  cost_center_id: string;
  party_id: string;
};
export function EntryLinker({
  organizationId,
  movement,
  partyId,
  catalogs,
  onModeChange,
  onDone,
  notes,
  onNotesChange,
  enabled,
}: {
  organizationId: string;
  movement: {
    id: string;
    amount: string;
    direction: string;
    version: number;
    notes: string | null;
  };
  partyId: string;
  catalogs: Record<string, RecordData[]>;
  onModeChange: (value: boolean) => void;
  onDone: (message: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  enabled: boolean;
}) {
  const base = "/organizations/" + organizationId + "/planned-entries";
  const [linked, setLinked] = useState<{ entry: PlannedEntry } | null>(null);
  const [entries, setEntries] = useState<PlannedEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<PlannedEntry | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [treatment, setTreatment] = useState("KEEP_OPEN");
  const [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState<Fields>({
    category_id: "",
    subcategory_id: "",
    cost_center_id: "",
    party_id: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    api<{ entry: PlannedEntry } | null>(base + "/links/" + movement.id, {
      signal: controller.signal,
    })
      .then((link) => {
        setLinked(link);
        if (link) onModeChange(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base, movement.id, onModeChange]);
  useEffect(() => {
    const controller = new AbortController();
    setSuggestions([]);
    setChosen(null);
    setConfirmed(false);
    api<{ rows: Candidate[] }>(
      base +
        "/suggestions/" +
        movement.id +
        "?derive_party=false" +
        (partyId ? "&party_id=" + encodeURIComponent(partyId) : ""),
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSuggestions(result.rows);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base, movement.id, partyId]);
  useEffect(() => {
    if (!enabled || linked) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<{ rows: PlannedEntry[] }>(
        base +
          "?" +
          new URLSearchParams({
            state: "open",
            direction: movement.direction,
            query,
            page_size: "500",
          }),
        { signal: controller.signal },
      )
        .then((result) => setEntries(result.rows))
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, enabled, linked, movement.direction, query]);
  function choose(row: PlannedEntry) {
    setChosen(row);
    setFields({
      category_id: row.category_id,
      subcategory_id: row.subcategory_id,
      cost_center_id: row.cost_center_id ?? "",
      party_id: row.party_id ?? "",
    });
    setTreatment(
      cents(movement.amount) > cents(row.outstanding)
        ? "SURCHARGE"
        : "KEEP_OPEN",
    );
    setConfirmed(false);
    setError("");
    onModeChange(true);
  }
  const candidates = [
    ...new Map(
      [...suggestions, ...entries, ...(chosen ? [chosen] : [])].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  ];
  const received = cents(movement.amount);
  const remaining = chosen ? cents(chosen.outstanding) : 0n;
  const discount =
    chosen && treatment === "DISCOUNT" && remaining > received
      ? remaining - received
      : 0n;
  const surcharge = chosen && received > remaining ? received - remaining : 0n;
  const balance =
    chosen && treatment === "KEEP_OPEN" && remaining > received
      ? remaining - received
      : 0n;
  const needsConfirmation = discount > 0n || surcharge > 0n;
  async function link() {
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(base + "/" + chosen.id + "/settle", {
        method: "POST",
        body: JSON.stringify({
          transaction_id: movement.id,
          expected_transaction_version: movement.version,
          expected_entry_version: chosen.version,
          difference_treatment: treatment,
          confirm_difference: confirmed,
          ...Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, value || null]),
          ),
          notes,
        }),
      });
      onDone("Movimento vinculado e baixa registrada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reverse() {
    setBusy(true);
    setError("");
    try {
      await api(base + "/links/" + movement.id + "/reverse", {
        method: "POST",
        body: "{}",
      });
      onDone(
        "Vínculo desfeito. Previsão recalculada e movimento bancário preservado.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled && !linked && !suggestions.length && !error) return null;
  return (
    <section
      id="previous-entry-panel"
      className="planning-link-controls"
      aria-label="Vinculação ao planejamento"
    >
      {linked ? (
        <div className="transaction-ai">
          <strong>Vinculado a {linked.entry.description}</strong>
          <p>
            Vencimento: {brazilDate(linked.entry.due_on)} · Previsto:{" "}
            {brl(linked.entry.expected_amount)} · Realizado:{" "}
            {brl(linked.entry.paid)}
          </p>
          <ActionButton
            label="Desvincular lançamento"
            tooltipAlign="start"
            icon={Unlink}
            tone="neutral"
            disabled={busy}
            onClick={() => void reverse()}
          />
        </div>
      ) : (
        <>
          {!enabled && suggestions.length > 0 && (
            <div
              className="settlement-suggestions"
              aria-label="Sugestões de vínculo"
            >
              <strong>Títulos em aberto deste cliente</strong>
              <span>Sugestões aguardam sua confirmação.</span>
              {suggestions.slice(0, 3).map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={
                    row.confidence === "HIGH"
                      ? "settlement-suggestion-high"
                      : "settlement-suggestion-review"
                  }
                  onClick={() => choose(row)}
                >
                  <strong>
                    {row.description} · {brl(row.outstanding)}
                  </strong>
                  <span>
                    Vencimento: {brazilDate(row.due_on)} · Confiança{" "}
                    {row.confidence === "HIGH" ? "alta" : "média"}
                  </span>
                  <small>{row.reason}</small>
                  <span>Conferir vínculo →</span>
                </button>
              ))}
            </div>
          )}
          {enabled && (
            <>
              <div className="actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => onModeChange(false)}
                >
                  ← Voltar à Identificação Direta
                </button>
              </div>
              <div className="field">
                <label htmlFor="existing-planned-entry">
                  Lançamento existente
                </label>
                <SearchSelect
                  id="existing-planned-entry"
                  disabled={busy}
                  value={chosen?.id ?? ""}
                  onSearchChange={setQuery}
                  onChange={(value) => {
                    const row = candidates.find((item) => item.id === value);
                    if (row) choose(row);
                    else setChosen(null);
                  }}
                  options={[
                    { value: "", label: "Pesquise um lançamento em aberto" },
                    ...candidates.map((row) => ({
                      value: row.id,
                      label:
                        row.description +
                        " · " +
                        brazilDate(row.due_on) +
                        " · " +
                        brl(row.outstanding),
                    })),
                  ]}
                />
              </div>
              {loading && <small role="status">Pesquisando lançamentos…</small>}
              {chosen && (
                <>
                  <div
                    className="settlement-summary"
                    aria-label="Conferência de valores"
                  >
                    <div>
                      <span>Saldo do título</span>
                      <strong>{brl(chosen.outstanding)}</strong>
                    </div>
                    <div>
                      <span>Valor do extrato · fixo</span>
                      <strong>{brl(movement.amount)}</strong>
                    </div>
                    <div>
                      <span>Saldo após a baixa</span>
                      <strong>{brl(decimal(balance))}</strong>
                    </div>
                  </div>
                  {received !== remaining && (
                    <div className="settlement-difference">
                      <strong>
                        Há diferença de valor. Escolha o tratamento.
                      </strong>
                      <SearchSelect
                        ariaLabel="Tratamento da diferença"
                        disabled={busy}
                        value={treatment}
                        onChange={(value) => {
                          setTreatment(value);
                          setConfirmed(false);
                        }}
                        options={
                          received < remaining
                            ? [
                                {
                                  value: "KEEP_OPEN",
                                  label:
                                    "Baixa parcial — manter saldo em aberto",
                                },
                                {
                                  value: "DISCOUNT",
                                  label: "Desconto comercial — quitar o saldo",
                                },
                              ]
                            : [
                                {
                                  value: "SURCHARGE",
                                  label:
                                    "Acréscimo comercial — quitar o título",
                                },
                              ]
                        }
                      />
                      <span>
                        {discount
                          ? "Desconto comercial: " + brl(decimal(discount))
                          : surcharge
                            ? "Acréscimo comercial: " + brl(decimal(surcharge))
                            : "O restante permanece em aberto para um próximo recebimento."}
                      </span>
                      {needsConfirmation && (
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                          />
                          Confirmo a baixa com diferença de valor e o{" "}
                          {discount ? "desconto" : "acréscimo"} comercial
                        </label>
                      )}
                    </div>
                  )}
                  <div className="settlement-fields">
                    <h3>Identificação da baixa</h3>
                    <small>
                      Revise os dados abaixo. O título original será preservado.
                    </small>
                    <div className="fields">
                      {(
                        [
                          [
                            "category_id",
                            "Classificação da baixa",
                            "categories",
                          ],
                          [
                            "subcategory_id",
                            "Subclassificação da baixa",
                            "subcategories",
                          ],
                          [
                            "cost_center_id",
                            "Centro de Custos da baixa",
                            "cost-centers",
                          ],
                          [
                            "party_id",
                            "Cliente / Fornecedor da baixa (opcional)",
                            "parties",
                          ],
                        ] as const
                      ).map(([key, label, table]) => (
                        <div className="field" key={key}>
                          <label htmlFor={"settlement-" + key}>{label}</label>
                          <SearchSelect
                            id={"settlement-" + key}
                            value={fields[key]}
                            disabled={busy}
                            onChange={(value) => {
                              setFields((old) => ({
                                ...old,
                                [key]: value,
                                ...(key === "category_id"
                                  ? { subcategory_id: "" }
                                  : {}),
                              }));
                              setConfirmed(false);
                            }}
                            options={[
                              { value: "", label: "Selecione" },
                              ...(catalogs[table] ?? [])
                                .filter(
                                  (row) =>
                                    row.active &&
                                    (table !== "categories" ||
                                      row.kind ===
                                        (movement.direction === "CREDIT"
                                          ? "REVENUE"
                                          : "EXPENSE")) &&
                                    (table !== "subcategories" ||
                                      row.category_id === fields.category_id),
                                )
                                .map((row) => ({
                                  value: row.id,
                                  label: String(row.display_name ?? row.name),
                                })),
                            ]}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <label htmlFor="linked-complementary">
                    Descrição Complementar (opcional)
                  </label>
                  <textarea
                    id="linked-complementary"
                    rows={2}
                    maxLength={4000}
                    value={notes}
                    onChange={(event) => onNotesChange(event.target.value)}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      busy ||
                      !fields.category_id ||
                      !fields.subcategory_id ||
                      !fields.cost_center_id ||
                      (needsConfirmation && !confirmed)
                    }
                    onClick={() => void link()}
                  >
                    {busy ? "Vinculando…" : "Vincular e dar baixa"}
                  </button>
                </>
              )}
              {!loading && !chosen && !candidates.length && (
                <p>
                  Nenhum lançamento em aberto encontrado. Cadastre-o no menu
                  Lançamentos ou use a identificação direta.
                </p>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
