import { useEffect, useState } from "react";
import { api } from "./api";
import { SearchSelect } from "./search-select";
import { brl, brazilDate } from "./statement-import";
import type { PlannedEntry } from "./planning-page";

export function EntryLinker({
  organizationId,
  movement,
  onModeChange,
  onDone,
}: {
  organizationId: string;
  movement: {
    id: string;
    amount: string;
    direction: string;
    version: number;
    notes: string | null;
  };
  onModeChange: (value: boolean) => void;
  onDone: (message: string) => void;
}) {
  const base = "/organizations/" + organizationId + "/planned-entries";
  const [mode, setMode] = useState("direct");
  const [linked, setLinked] = useState<{ entry: PlannedEntry } | null>(null);
  const [entries, setEntries] = useState<PlannedEntry[]>([]);
  const [entryId, setEntryId] = useState("");
  const [chosen, setChosen] = useState<PlannedEntry | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [finish, setFinish] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ entry: PlannedEntry } | null>(base + "/links/" + movement.id, {
      signal: controller.signal,
    })
      .then((link) => {
        setLinked(link);
        if (link) {
          setMode("existing");
          onModeChange(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base, movement.id, onModeChange]);
  useEffect(() => {
    if (mode !== "existing" || linked) return;
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
  }, [base, mode, linked, movement.direction, query]);
  const selected = entries.find((row) => row.id === entryId) ?? chosen;
  const candidates =
    selected && !entries.some((row) => row.id === selected.id)
      ? [selected, ...entries]
      : entries;
  const difference =
    selected && Number(movement.amount) !== Number(selected.outstanding);
  const needsConfirmation =
    selected &&
    (Number(movement.amount) > Number(selected.outstanding) ||
      (finish && difference));
  async function link() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(base + "/" + selected.id + "/settle", {
        method: "POST",
        body: JSON.stringify({
          transaction_id: movement.id,
          expected_transaction_version: movement.version,
          expected_entry_version: selected.version,
          finish,
          confirm_difference: confirmed,
          notes: movement.notes,
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
  return (
    <section
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
          <button type="button" disabled={busy} onClick={() => void reverse()}>
            Desvincular lançamento
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="identification-path">
              Como identificar este movimento?
            </label>
            <SearchSelect
              id="identification-path"
              value={mode}
              disabled={busy}
              onChange={(value) => {
                setMode(value);
                onModeChange(value === "existing");
                setError("");
              }}
              options={[
                { value: "direct", label: "Identificar diretamente" },
                {
                  value: "existing",
                  label: "Vincular a receita ou despesa já lançada",
                },
              ]}
            />
          </div>
          {mode === "existing" && (
            <>
              <div className="field">
                <label htmlFor="existing-planned-entry">
                  Lançamento existente
                </label>
                <SearchSelect
                  id="existing-planned-entry"
                  disabled={busy}
                  value={entryId}
                  onSearchChange={setQuery}
                  onChange={(value) => {
                    setEntryId(value);
                    setChosen(entries.find((row) => row.id === value) ?? null);
                    setFinish(false);
                    setConfirmed(false);
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
              {selected && (
                <>
                  <div className="planning-link">
                    <strong>{selected.description}</strong>
                    <span>
                      Previsto: {brl(selected.expected_amount)} · Em aberto:{" "}
                      {brl(selected.outstanding)}
                    </span>
                    <span>
                      Valor do extrato para baixa: {brl(movement.amount)}
                    </span>
                    <small>
                      Classificação, subclassificação e centro de custos serão
                      copiados do lançamento.
                    </small>
                  </div>
                  {difference && (
                    <div className="planning-link-warning">
                      {Number(movement.amount) < Number(selected.outstanding)
                        ? "O valor menor fará uma baixa parcial; o restante continuará em aberto."
                        : "O valor é maior que o saldo previsto. A diferença ficará registrada."}
                    </div>
                  )}
                  {Number(movement.amount) < Number(selected.outstanding) && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={finish}
                        onChange={(e) => {
                          setFinish(e.target.checked);
                          setConfirmed(false);
                        }}
                      />
                      Encerrar o lançamento mesmo com a diferença
                    </label>
                  )}
                  {needsConfirmation && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      Confirmo a baixa com diferença de valor
                    </label>
                  )}
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || Boolean(needsConfirmation && !confirmed)}
                    onClick={() => void link()}
                  >
                    {busy ? "Vinculando…" : "Vincular e dar baixa"}
                  </button>
                </>
              )}
              {!loading && !entries.length && (
                <p>
                  Nenhum lançamento em aberto encontrado. Cadastre-o na aba
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
