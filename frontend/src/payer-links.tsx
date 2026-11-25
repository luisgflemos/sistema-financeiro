import { useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { brl, brazilDate } from "./statement-import";

type Group = {
  payer: string;
  client: string;
  count: number;
  total: string;
  existing: number;
};
type Preview = {
  groups: Group[];
  count: number;
  new: number;
  total: string;
  through: string;
  token: string;
};
type Upload = { file_name: string; content: string; through: string };

export function PayerLinks({
  organizationId,
  onClose,
  onDone,
}: {
  organizationId: string;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [through, setThrough] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const base = `/organizations/${organizationId}/payer-links`;
  async function choose(file?: File) {
    setError("");
    setUpload(null);
    setPreview(null);
    setDone(null);
    if (!file) return;
    if (
      !through ||
      !file.name.toLowerCase().endsWith(".csv") ||
      file.size > 1024 * 1024
    ) {
      setError("Informe a data limite e selecione um CSV de até 1 MB.");
      return;
    }
    setBusy(true);
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const data = { file_name: file.name, content, through };
      setPreview(
        await api<Preview>(base + "/preview", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      );
      setUpload(data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível conferir os vínculos.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!upload || !preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        linked: number;
        verified: number;
        groups: Group[];
      }>(base + "/commit", {
        method: "POST",
        body: JSON.stringify({ ...upload, token: preview.token }),
      });
      if (result.verified !== preview.count || result.linked !== preview.new) {
        throw new Error(
          "A conferência do lote divergiu. Confira o histórico antes de repetir.",
        );
      }
      setDone(
        `${result.linked} vínculos gravados. ${result.verified} movimentos conferidos. Valores, datas, classificações e cadastros preservados.`,
      );
      setUpload(null);
      onDone(result.linked);
      setPreview({ ...preview, groups: result.groups, new: 0 });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível gravar os vínculos.",
      );
    } finally {
      setBusy(false);
    }
  }
  const template =
    "data:text/csv;charset=utf-8," +
    encodeURIComponent(
      "Pagador;Cliente;Quantidade;Total\nPagador do extrato;Cliente cadastrado;2;100.00\n",
    );
  return (
    <Modal title="Vincular Clientes ao Histórico" onClose={onClose} busy={busy}>
      <div className="historical-import">
        <p>
          Associe os pagadores dos <strong>PIX Faturados já confirmados</strong>{" "}
          aos clientes cadastrados, com conferência de quantidade e valor por
          grupo.
        </p>
        <div className="panel" style={{ padding: 16, margin: "16px 0" }}>
          <strong>Somente o vínculo de cliente será preenchido.</strong>
          <p className="field-help">
            Não substitui clientes já vinculados nem altera dados do extrato,
            classificações, centros de custos ou lançamentos previstos.
            Movimentos com histórico de baixa exigem revisão individual.
          </p>
          <a href={template} download="modelo-vinculos-clientes.csv">
            Baixar modelo CSV
          </a>
        </div>
        {!done && (
          <fieldset disabled={busy}>
            <div className="fields">
              <div className="field">
                <label htmlFor="payer-through">Movimentos até</label>
                <input
                  id="payer-through"
                  type="date"
                  value={through}
                  onChange={(e) => {
                    setThrough(e.target.value);
                    setPreview(null);
                    setUpload(null);
                    setError("");
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="payer-file">Arquivo de vínculos CSV</label>
                <input
                  id="payer-file"
                  type="file"
                  accept=".csv"
                  disabled={!through || busy}
                  onChange={(e) => void choose(e.target.files?.[0])}
                  onClick={(e) => {
                    e.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
            <p className="field-help">
              CSV UTF-8 separado por ponto e vírgula. Colunas: Pagador, Cliente,
              Quantidade e Total. Para grupos, use Grupo no lugar de Cliente no
              cabeçalho. Use o nome cadastrado e o total sem separador de
              milhar.
            </p>
          </fieldset>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <section className="panel" style={{ padding: 16, marginTop: 16 }}>
            <h3>
              {preview.groups.length} grupos ·{" "}
              {preview.count.toLocaleString("pt-BR")} movimentos
            </h3>
            <p>
              {brl(preview.total)} · Até {brazilDate(preview.through)}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Pagador no extrato</th>
                    <th>Cliente ou Grupo</th>
                    <th>Movimentos</th>
                    <th>Total</th>
                    <th>Já vinculados</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.groups.map((g) => (
                    <tr key={g.payer}>
                      <td>{g.payer}</td>
                      <td>
                        <strong>{g.client}</strong>
                      </td>
                      <td>{g.count}</td>
                      <td>{brl(g.total)}</td>
                      <td>{g.existing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!done && (
              <div className="actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !preview.new}
                  onClick={() => void commit()}
                >
                  {busy ? "Gravando…" : `Confirmar ${preview.new} Vínculos`}
                </button>
                <button type="button" disabled={busy} onClick={onClose}>
                  Cancelar
                </button>
              </div>
            )}
          </section>
        )}
        {done && (
          <>
            <p className="notice" role="status">
              {done}
            </p>
            <button type="button" className="primary" onClick={onClose}>
              Ver Histórico
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
