import { useRef, useState } from "react";
import { FileUp, Check, Trash2 } from "lucide-react";
import { api } from "./api";
import { SearchSelect } from "./search-select";

type Upload = {
  file_name: string;
  content: string;
  account_id?: string;
  decisions: Record<string, "new" | "skip">;
};
type Row = {
  document: string;
  row: number;
  posted_on: string;
  description: string;
  amount: string;
  direction: string;
  status: string;
  balance: string;
};
type FilePreview = {
  file_name: string;
  branch: string;
  account: string;
  account_id: string | null;
  account_label: string | null;
  account_options: { value: string; label: string }[];
  count: number;
  credits: string;
  debits: string;
  repeated: boolean;
  pending: number;
  new: number;
  rows: Row[];
};
type Preview = {
  files: FilePreview[];
  ready: boolean;
  new: number;
  token: string;
};

export function brl(value: string) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
export function brazilDate(value: string) {
  return value.slice(0, 10).split("-").reverse().join("/");
}

export function StatementImport({
  organizationId,
  onDone,
  onBusyChange,
}: {
  organizationId: string;
  onDone: (count: number, fileIds: string[]) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [files, setFiles] = useState<Upload[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const path = "/organizations/" + organizationId + "/statements";
  function working(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }
  async function analyze(next: Upload[]) {
    setError("");
    working(true);
    try {
      const result = await api<Preview>(path + "/preview", {
        method: "POST",
        body: JSON.stringify({ files: next }),
      });
      setPreview(result);
      setStale(false);
      setFiles(
        next.map((file, index) => ({
          ...file,
          account_id: result.files[index].account_id ?? undefined,
        })),
      );
    } catch (problem) {
      setError((problem as Error).message);
      setPreview(null);
    } finally {
      working(false);
    }
  }
  async function choose(selected: File[]) {
    if (!selected.length) return;
    setError("");
    if (
      selected.length + files.length > 10 ||
      selected.some((file) => file.size > 5 * 1024 * 1024) ||
      selected.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024
    ) {
      setError(
        "Use até 10 arquivos, com até 5 MB por arquivo e 20 MB por lote.",
      );
      return;
    }
    working(true);
    try {
      const added = await Promise.all(
        selected.map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 8192)
            binary += String.fromCharCode(
              ...bytes.subarray(index, index + 8192),
            );
          return { file_name: file.name, content: btoa(binary), decisions: {} };
        }),
      );
      const next = [...files, ...added];
      setFiles(next);
      await analyze(next);
    } catch (problem) {
      setError((problem as Error).message);
      working(false);
    }
  }
  async function commit() {
    working(true);
    setError("");
    try {
      const result = await api<{ imported: number; file_ids: string[] }>(
        path + "/commit",
        {
          method: "POST",
          body: JSON.stringify({ files, token: preview?.token }),
        },
      );
      onDone(result.imported, result.file_ids);
    } catch (problem) {
      setError((problem as Error).message);
      setStale(true);
    } finally {
      working(false);
    }
  }
  return (
    <div className="statement-import" aria-busy={busy}>
      <div
        className="statement-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) void choose(Array.from(event.dataTransfer.files));
        }}
      >
        <FileUp size={26} aria-hidden="true" />
        <div>
          <strong>Arraste seus extratos para cá</strong>
          <p>
            Selecionamos a conta pelo cabeçalho. Você confere e importa o lote.
          </p>
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          accept=".xlsx,.csv"
          aria-label="Arquivos de extrato"
          disabled={busy}
          onChange={(event) => {
            void choose(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button
          className="primary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Lendo extratos…" : "Selecionar arquivos"}
        </button>
        <small>Santander XLSX ou CSV · Até 10 arquivos por lote</small>
      </div>
      <fieldset disabled={busy}>
        {files.map((file, index) => {
          const item = preview?.files[index];
          return (
            <section className="statement-file" key={index}>
              <header>
                <div>
                  <strong>{file.file_name}</strong>
                  {item && (
                    <small>
                      Agência {item.branch} · Conta {item.account} ·{" "}
                      {item.count} movimentos
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  className="text-button"
                  aria-label={"Remover " + file.file_name}
                  onClick={() => {
                    const next = files.filter(
                      (_, position) => position !== index,
                    );
                    setFiles(next);
                    setPreview(null);
                    if (next.length) void analyze(next);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </header>
              {item && (
                <>
                  <div className="statement-account">
                    <label htmlFor={"statement-account-" + index}>
                      Conta bancária
                    </label>
                    <SearchSelect
                      id={"statement-account-" + index}
                      value={file.account_id ?? ""}
                      options={item.account_options}
                      required
                      onChange={(value) => {
                        setFiles((previous) =>
                          previous.map((entry, position) =>
                            position === index
                              ? { ...entry, account_id: value || undefined }
                              : entry,
                          ),
                        );
                        setStale(true);
                      }}
                    />
                    {!item.account_id && (
                      <p className="error">
                        Cadastre ou complete a conta indicada no cabeçalho para
                        importar este arquivo.
                      </p>
                    )}
                    {item.account_id && (
                      <small className="statement-match">
                        <Check size={15} aria-hidden="true" /> Conta
                        identificada pelo cabeçalho
                      </small>
                    )}
                  </div>
                  <div className="statement-summary">
                    <span>
                      Créditos <strong>{brl(item.credits)}</strong>
                    </span>
                    <span>
                      Débitos <strong>{brl(item.debits)}</strong>
                    </span>
                    <span>
                      {item.repeated
                        ? "Arquivo já importado. Não será repetido."
                        : item.new + " novos movimentos"}
                    </span>
                  </div>
                  {item.pending > 0 && (
                    <div className="statement-review-note">
                      <p>
                        Possíveis repetições em outro extrato. Confira as linhas
                        destacadas abaixo.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const decisions = { ...file.decisions };
                          for (const row of item.rows)
                            if (row.status === "review")
                              decisions[String(row.row)] = "skip";
                          const next = files.map((entry, position) =>
                            position === index
                              ? { ...entry, decisions }
                              : entry,
                          );
                          setFiles(next);
                          void analyze(next);
                        }}
                      >
                        Marcar {item.pending} como já importados
                      </button>
                    </div>
                  )}
                  <details open={item.pending > 0}>
                    <summary>
                      {item.pending > 0
                        ? "Conferir possíveis repetições"
                        : "Ver movimentos do arquivo"}
                    </summary>
                    <div className="table-scroll statement-preview">
                      <table>
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Histórico</th>
                            <th>Documento</th>
                            <th>Valor</th>
                            <th>Saldo</th>
                            <th>Conferência</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.rows
                            .filter((row) =>
                              item.pending
                                ? row.status === "review" ||
                                  !!file.decisions[String(row.row)]
                                : true,
                            )
                            .map((row) => (
                              <tr key={row.row}>
                                <td>{brazilDate(row.posted_on)}</td>
                                <td>{row.description}</td>
                                <td>{row.document || "—"}</td>
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
                                <td>{brl(row.balance)}</td>
                                <td>
                                  {row.status === "review" ||
                                  file.decisions[String(row.row)] ? (
                                    <SearchSelect
                                      id={"decision-" + index + "-" + row.row}
                                      value={
                                        file.decisions[String(row.row)] ?? ""
                                      }
                                      options={[
                                        {
                                          value: "",
                                          label: "Escolha uma ação",
                                        },
                                        {
                                          value: "skip",
                                          label: "Já importado — ignorar",
                                        },
                                        {
                                          value: "new",
                                          label: "É outro movimento — manter",
                                        },
                                      ]}
                                      onChange={(value) => {
                                        setFiles((previous) =>
                                          previous.map((entry, position) => {
                                            if (position !== index)
                                              return entry;
                                            const decisions = {
                                              ...entry.decisions,
                                            };
                                            if (value)
                                              decisions[String(row.row)] =
                                                value as "new" | "skip";
                                            else
                                              delete decisions[String(row.row)];
                                            return { ...entry, decisions };
                                          }),
                                        );
                                        setStale(true);
                                      }}
                                    />
                                  ) : row.status === "duplicate" ? (
                                    "Já importado"
                                  ) : (
                                    "Novo"
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </section>
          );
        })}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!!files.length && (
        <footer className="statement-footer">
          <span>
            {preview
              ? preview.new + " novos movimentos no lote"
              : "Confira os arquivos antes de continuar."}
          </span>
          {!preview || stale ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void analyze(files)}
            >
              Conferir lote
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || !preview.ready}
              onClick={() => void commit()}
            >
              {busy ? "Importando…" : "Importar e identificar"}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
