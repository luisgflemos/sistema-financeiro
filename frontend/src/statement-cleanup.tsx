import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { brazilDate } from "./statement-import";

type Summary = {
  file_id: string;
  file_name: string;
  account_label: string;
  period_start: string;
  period_end: string;
  movements: number;
  identifications: number;
  suggestions: number;
  token: string;
};

export function StatementCleanup({
  base,
  statements,
  onClose,
  onChanged,
}: {
  base: string;
  statements: { id: string; file_name: string; account_label: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [fileId, setFileId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [removed, setRemoved] = useState<{ id: string; summary: Summary }[]>(
    [],
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const endpoint = base + "/statement-cleanup";
  useEffect(() => {
    const controller = new AbortController();
    api<{ id: string; summary: Summary }[]>(endpoint, {
      signal: controller.signal,
    })
      .then(setRemoved)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error.message));
      });
    return () => controller.abort();
  }, [endpoint, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setError("");
    if (fileId)
      api<Summary>(endpoint + "/" + fileId + "/preview", {
        signal: controller.signal,
      })
        .then(setSummary)
        .catch((error) => {
          if (!controller.signal.aborted) setError(String(error.message));
        });
    return () => controller.abort();
  }, [endpoint, fileId]);
  async function remove() {
    if (!summary) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ removed: number }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          file_id: summary.file_id,
          token: summary.token,
        }),
      });
      setNotice(
        `${result.removed} movimentos retirados. Cadastros e lançamentos previstos preservados.`,
      );
      setFileId("");
      setSummary(null);
      setRefresh((value) => value + 1);
      onChanged();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível retirar o lote.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restore(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ restored: number }>(
        endpoint + "/" + id + "/restore",
        { method: "POST", body: "{}" },
      );
      setNotice(`${result.restored} movimentos restaurados.`);
      setRefresh((value) => value + 1);
      onChanged();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Não foi possível restaurar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Retirar Lote de Teste" busy={busy} onClose={onClose}>
      <p>
        Selecione o extrato do teste. Seus movimentos e identificações sairão do
        histórico e do aprendizado da IA.
      </p>
      <p className="notice">
        <strong>Cadastros e lançamentos previstos serão preservados.</strong>{" "}
        Uma cópia integral ficará disponível para restauração.
      </p>
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
      <label htmlFor="cleanup-file">Extrato do teste</label>
      <SearchSelect
        id="cleanup-file"
        value={fileId}
        options={[
          { value: "", label: "Selecione o extrato" },
          ...statements.map((item) => ({
            value: item.id,
            label: `${item.account_label} · ${item.file_name}`,
          })),
        ]}
        onChange={(value) => {
          if (!busy) {
            setFileId(value);
            setNotice("");
          }
        }}
      />
      {summary && (
        <section className="panel" style={{ padding: 20, marginTop: 16 }}>
          <h3>{summary.account_label}</h3>
          <p>{summary.file_name}</p>
          <p>
            {brazilDate(summary.period_start)} a{" "}
            {brazilDate(summary.period_end)}
          </p>
          <p>
            <strong>{summary.movements} movimentos</strong> ·{" "}
            {summary.identifications} identificações · {summary.suggestions}{" "}
            sugestões
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void remove()}>
              {busy ? "Aguarde…" : "Retirar Movimentos deste Extrato"}
            </button>
          </div>
        </section>
      )}
      {removed.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3>Lotes Retirados</h3>
          <p className="field-help">
            Restaurar recupera os movimentos, o arquivo original e as
            identificações. Uma reimportação posterior pode impedir a
            restauração por duplicidade.
          </p>
          {removed.map((item) => (
            <div
              key={item.id}
              className="panel"
              style={{ padding: 16, marginTop: 8 }}
            >
              <strong>
                {item.summary.account_label} · {item.summary.movements}{" "}
                movimentos
              </strong>
              <p>{item.summary.file_name}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(item.id)}
              >
                Restaurar Lote
              </button>
            </div>
          ))}
        </section>
      )}
    </Modal>
  );
}
