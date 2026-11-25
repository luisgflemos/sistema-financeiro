import { useState } from "react";
import { FileUp, Check } from "lucide-react";
import { api } from "./api";
import { Modal } from "./modal";
import { SearchSelect } from "./search-select";
import { brl, brazilDate } from "./statement-import";

type Group = {
  account_label: string;
  count: number;
  credits: string;
  debits: string;
  period_start: string;
  period_end: string;
  transfers: number;
  repeated: boolean;
};
type Preview = {
  count: number;
  new: number;
  credits: string;
  debits: string;
  groups: Group[];
  token: string;
  sheet: string;
  renamed_subcategories: {
    category: string;
    source: string;
    current: string;
    count: number;
  }[];
};
type Upload = {
  file_name: string;
  content: string;
  mode: "initial" | "append";
};

function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function HistoricalImport({
  organizationId,
  onClose,
  onDone,
}: {
  organizationId: string;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mode, setMode] = useState<"initial" | "append">("initial");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [verification, setVerification] = useState<
    (Group & { identified: number })[]
  >([]);
  const base = "/organizations/" + organizationId + "/historical-import";
  async function choose(file?: File) {
    setPreview(null);
    setUpload(null);
    setError("");
    setDone(false);
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".xlsx") ||
      file.size > 20 * 1024 * 1024
    ) {
      setError("Selecione um XLSX de até 20 MB com a aba LANÇAMENTOS.");
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
      const data = { file_name: file.name, content, mode };
      setUpload(data);
      setPreview(
        await api<Preview>(base + "/preview", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível validar a base.",
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
        imported: number;
        repeated: boolean;
        file_ids: string[];
      }>(base + "/commit", {
        method: "POST",
        body: JSON.stringify({ ...upload, token: preview.token }),
      });
      const filters = new URLSearchParams();
      result.file_ids.forEach((id) => filters.append("file_ids", id));
      const stored = await api<(Group & { identified: number })[]>(
        base + "/summary?" + filters,
      );
      const valid = preview.groups.every((expected) =>
        stored.some(
          (actual) =>
            actual.account_label === expected.account_label &&
            actual.count === expected.count &&
            actual.identified === expected.count &&
            cents(actual.credits) === cents(expected.credits) &&
            cents(actual.debits) === cents(expected.debits),
        ),
      );
      if (!valid)
        throw new Error(
          "A gravação respondeu, mas a conferência dos totais não coincidiu com a prévia. Não repita a carga; confira o Histórico.",
        );
      setVerification(stored);
      setDone(true);
      setUpload(null);
      onDone(result.imported);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar a importação. Confira o Histórico antes de repetir.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Importar Base Histórica" busy={busy} onClose={onClose}>
      <div className="historical-import">
        <p>
          Carregue a planilha já identificada. A aba{" "}
          <strong>LANÇAMENTOS</strong> será lida e cada Unidade será vinculada à
          sua conta bancária.
        </p>
        <div className="panel" style={{ padding: 16, margin: "16px 0" }}>
          <strong>
            Todos os movimentos serão preservados, inclusive os iguais.
          </strong>
          <p className="field-help">
            Classificações, subclasses e centros serão vinculados aos cadastros
            existentes. Transferências próprias serão neutras. Esta carga não
            cria cadastros nem lançamentos previstos.
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!done && (
          <div style={{ display: "grid", gap: 8 }}>
            <label htmlFor="historical-mode">Tipo de carga</label>
            <SearchSelect
              id="historical-mode"
              value={mode}
              disabled={busy}
              options={[
                { value: "initial", label: "Carga inicial" },
                { value: "append", label: "Acrescentar período ao histórico" },
              ]}
              onChange={(value) => {
                setMode(value === "append" ? "append" : "initial");
                setUpload(null);
                setPreview(null);
                setError("");
              }}
            />
            <span className="field-help">
              {mode === "append"
                ? "Use um arquivo contendo apenas o novo período. Contas com movimentos sobrepostos serão bloqueadas. O histórico existente será preservado."
                : "Para uma base vazia ou a repetição exata da carga inicial."}
            </span>
            <label htmlFor="historical-file">Planilha histórica XLSX</label>
            <input
              key={mode}
              id="historical-file"
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            <span className="field-help">
              Até 20 MB e 100.000 movimentos. A mesma carga não será gravada
              novamente.
            </span>
          </div>
        )}
        {busy && (
          <p role="status">
            {preview
              ? "Gravando e conferindo os totais. Aguarde sem fechar a janela…"
              : "Lendo a base e conferindo os vínculos…"}
          </p>
        )}
        {preview && (
          <section style={{ marginTop: 20 }}>
            <h3>{done ? "Importação Conferida" : "Conferência por Conta"}</h3>
            {preview.renamed_subcategories.length > 0 && (
              <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
                <strong>Vínculos preservados após renomeação</strong>
                <p className="field-help">
                  O histórico de alterações comprova que são os mesmos
                  cadastros. Os nomes originais da planilha serão preservados na
                  origem.
                </p>
                {preview.renamed_subcategories.map((item) => (
                  <p key={item.category + item.source}>
                    {item.category}: {item.source} → {item.current} ·{" "}
                    {item.count.toLocaleString("pt-BR")} movimentos
                  </p>
                ))}
              </div>
            )}
            <p>
              <strong>
                {preview.count.toLocaleString("pt-BR")} movimentos
              </strong>{" "}
              · Créditos {brl(preview.credits)} · Débitos {brl(preview.debits)}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th>Movimentos</th>
                    <th>Créditos</th>
                    <th>Débitos</th>
                  </tr>
                </thead>
                <tbody>
                  {(done ? verification : preview.groups).map((group) => (
                    <tr key={group.account_label}>
                      <td>
                        <strong>{group.account_label}</strong>
                        <div className="field-help">
                          {brazilDate(group.period_start)} a{" "}
                          {brazilDate(group.period_end)}
                        </div>
                      </td>
                      <td>{group.count.toLocaleString("pt-BR")}</td>
                      <td>{brl(group.credits)}</td>
                      <td>{brl(group.debits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {done ? (
              <p className="notice" role="status">
                <Check size={18} /> Base histórica gravada e identificada.
                Quantidades e totais por conta conferidos. Cadastros
                preservados.
              </p>
            ) : (
              <div className="actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void commit()}
                >
                  <FileUp size={18} />
                  {preview.new
                    ? `Importar ${preview.new.toLocaleString("pt-BR")} Movimentos Identificados`
                    : "Conferir Carga já Importada"}
                </button>
                <button type="button" disabled={busy} onClick={onClose}>
                  Cancelar
                </button>
              </div>
            )}
          </section>
        )}
        {done && (
          <div className="actions" style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={onClose}>
              Ver Histórico
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
