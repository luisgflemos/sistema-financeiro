import { useRef, useState } from "react";
import { FileUp, Check, Trash2 } from "lucide-react";
import { ActionButton } from "./action-button";
import { api } from "./api";
import { SearchSelect } from "./search-select";

type Upload = {
  file_name: string;
  content: string;
  account_id?: string;
  decisions: Record<string, "new" | "skip">;
  selected_dates?: string[];
};
type Row = {
  reason: string;
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
  reimported: boolean;
  restored: number;
  pending: number;
  duplicates: number;
  new: number;
  rows: Row[];
  selected_count: number;
  selected_dates: string[];
  date_options: {
    date: string;
    count: number;
    credits: string;
    debits: string;
  }[];
};
type Preview = {
  files: FilePreview[];
  ready: boolean;
  new: number;
  token: string;
  stage: "dates" | "duplicates";
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
  const [selectingDates, setSelectingDates] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const path = "/organizations/" + organizationId + "/statements";
  function working(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }
  async function analyze(next: Upload[], inspect = false) {
    setError("");
    working(true);
    try {
      const result = await api<Preview>(
        path + (inspect ? "/inspect" : "/preview"),
        {
          method: "POST",
          body: JSON.stringify({ files: next }),
        },
      );
      setPreview(result);
      setSelectingDates(inspect);
      setStale(false);
      setFiles(
        next.map((file, index) => ({
          ...file,
          account_id: result.files[index].account_id ?? undefined,
          selected_dates: result.files[index].selected_dates,
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
      await analyze(next, true);
    } catch (problem) {
      setError((problem as Error).message);
      working(false);
    }
  }
  function selectDates(index: number, dates: string[]) {
    setFiles((previous) =>
      previous.map((file, position) => ({
        ...file,
        decisions: {},
        ...(position === index ? { selected_dates: dates } : {}),
      })),
    );
    setSelectingDates(true);
    setStale(true);
    setError("");
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
            Confira a conta, escolha as datas e depois verificamos as
            repetições.
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
                <ActionButton
                  label="Remover arquivo"
                  icon={Trash2}
                  tone="danger"
                  ariaLabel={"Remover " + file.file_name}
                  onClick={() => {
                    const next = files.filter(
                      (_, position) => position !== index,
                    );
                    setFiles(next);
                    setPreview(null);
                    if (next.length) void analyze(next, true);
                  }}
                />
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
                  <fieldset className="statement-dates">
                    <legend>Datas para importar</legend>
                    <div className="statement-dates-heading">
                      <span>Selecione um ou mais dias deste arquivo.</span>
                      <div className="statement-dates-actions">
                        <button
                          type="button"
                          onClick={() =>
                            selectDates(
                              index,
                              item.date_options.map((day) => day.date),
                            )
                          }
                        >
                          Selecionar todas
                        </button>
                        <button
                          type="button"
                          onClick={() => selectDates(index, [])}
                        >
                          Limpar seleção
                        </button>
                      </div>
                    </div>
                    <div className="statement-dates-grid">
                      {item.date_options.map((day) => (
                        <label className="statement-date-choice" key={day.date}>
                          <input
                            type="checkbox"
                            checked={
                              file.selected_dates?.includes(day.date) ?? true
                            }
                            onChange={(event) =>
                              selectDates(
                                index,
                                event.target.checked
                                  ? [
                                      ...(file.selected_dates ??
                                        item.selected_dates),
                                      day.date,
                                    ]
                                  : (
                                      file.selected_dates ?? item.selected_dates
                                    ).filter((value) => value !== day.date),
                              )
                            }
                          />
                          <span>
                            <strong>{brazilDate(day.date)}</strong>
                            <small>
                              {day.count} movimentos · Créditos{" "}
                              {brl(day.credits)} · Débitos {brl(day.debits)}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <small className="statement-date-count" role="status">
                      {(file.selected_dates ?? item.selected_dates).length} de{" "}
                      {item.date_options.length} datas selecionadas ·{" "}
                      {item.date_options
                        .filter((day) =>
                          (file.selected_dates ?? item.selected_dates).includes(
                            day.date,
                          ),
                        )
                        .reduce((total, day) => total + day.count, 0)}{" "}
                      movimentos
                    </small>
                    {selectingDates && (
                      <p className="statement-date-next">
                        A verificação de registros repetidos será feita somente
                        após confirmar esta seleção.
                      </p>
                    )}
                  </fieldset>
                  {!selectingDates && (
                    <>
                      <div className="statement-summary">
                        <span>
                          Créditos <strong>{brl(item.credits)}</strong>
                        </span>
                        <span>
                          Débitos <strong>{brl(item.debits)}</strong>
                        </span>
                        <span>
                          {item.repeated
                            ? "Os movimentos das datas selecionadas já foram importados."
                            : item.reimported
                              ? item.restored +
                                " movimentos excluídos serão reimportados para identificação."
                              : item.new + " novos movimentos"}
                        </span>
                      </div>
                      {item.duplicates > 0 && !item.repeated && (
                        <p className="statement-match">
                          {item.duplicates} movimentos já existentes serão
                          mantidos, sem duplicação.
                        </p>
                      )}
                      {item.pending > 0 && (
                        <div className="statement-review-note">
                          <p>
                            A ferramenta concluiu a análise. Somente{" "}
                            {item.pending} caso(s) ainda precisa(m) da sua
                            confirmação.
                          </p>
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
                                      {row.status === "review" && (
                                        <small className="statement-ambiguity-reason">
                                          {row.reason}
                                        </small>
                                      )}
                                      {row.status === "review" ||
                                      file.decisions[String(row.row)] ? (
                                        <SearchSelect
                                          id={
                                            "decision-" + index + "-" + row.row
                                          }
                                          value={
                                            file.decisions[String(row.row)] ??
                                            ""
                                          }
                                          options={[
                                            {
                                              value: "",
                                              label: "Confirmação necessária",
                                            },
                                            {
                                              value: "skip",
                                              label: "Já importado — ignorar",
                                            },
                                            {
                                              value: "new",
                                              label:
                                                "É outro movimento — manter",
                                            },
                                          ]}
                                          onChange={(value) => {
                                            setFiles((previous) =>
                                              previous.map(
                                                (entry, position) => {
                                                  if (position !== index)
                                                    return entry;
                                                  const decisions = {
                                                    ...entry.decisions,
                                                  };
                                                  if (value)
                                                    decisions[String(row.row)] =
                                                      value as "new" | "skip";
                                                  else
                                                    delete decisions[
                                                      String(row.row)
                                                    ];
                                                  return {
                                                    ...entry,
                                                    decisions,
                                                  };
                                                },
                                              ),
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
            {selectingDates
              ? "Escolha as datas de cada arquivo antes de verificar duplicidades."
              : preview
                ? preview.new + " novos movimentos no lote"
                : "Confira os arquivos antes de continuar."}
          </span>
          {!preview || stale || selectingDates ? (
            <button
              className="primary"
              disabled={
                busy || files.some((file) => file.selected_dates?.length === 0)
              }
              onClick={() => void analyze(files, !preview)}
            >
              {selectingDates ? "Verificar duplicidades" : "Conferir lote"}
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
