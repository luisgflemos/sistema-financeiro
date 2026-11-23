import { Check, Download, FileSpreadsheet, Upload, ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { SearchSelect } from "./search-select";
import type { CatalogId } from "./catalogs";

type Kind = Exclude<CatalogId, "subcategories">;
type Source = {
  file_name: string;
  content: string;
  sheet?: string;
  header_row: number;
};
type Preview = {
  sheets: string[];
  headers: string[];
  sample: string[][];
  total: number;
  fields: { name: string; label: string; required: boolean }[];
  mapping: Record<string, number>;
};
type Report = {
  rows: { row: number; status: string; message: string }[];
  new: number;
  duplicates: number;
  errors: number;
};

export function TableImport({
  kind,
  organizationId,
  onDone,
  onBusyChange,
}: {
  kind: Kind;
  organizationId: string;
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const path = `/organizations/${organizationId}/table-imports/${kind}`;
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function read(next: Source) {
    setPreview(null);
    setReport(null);
    const data = await api<Preview>(`${path}/preview`, {
      method: "POST",
      body: JSON.stringify(next),
    });
    setPreview(data);
    setMapping(data.mapping);
  }

  async function choose(file?: File) {
    setSource(null);
    setPreview(null);
    setReport(null);
    setCommitted(false);
    setError("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("O limite por arquivo é 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      const next = {
        file_name: file.name,
        content: btoa(binary),
        header_row: 1,
      };
      setSource(next);
      await read(next);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reload(next: Source) {
    setBusy(true);
    setError("");
    setSource(next);
    try {
      await read(next);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function execute(action: "validate" | "commit") {
    setBusy(true);
    setError("");
    try {
      const data = await api<Report>(`${path}/${action}`, {
        method: "POST",
        body: JSON.stringify({ ...source, mapping }),
      });
      setReport(data);
      if (action === "commit") setCommitted(true);
    } catch (problem) {
      setReport(null);
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const ready = preview?.fields
    .filter((field) => field.required)
    .every((field) => mapping[field.name] !== undefined);

  const step = committed || report ? 2 : preview ? 1 : 0;
  const guidance = {
    "bank-accounts": [
      ["Banco", "Informe o código de três dígitos, como 033."],
      ["Agência e conta", "Use formato de texto para preservar zeros à esquerda."],
      ["Moeda", "Se ficar vazia, será usada BRL."],
    ],
    categories: [
      ["Natureza", "Receita, Despesa ou Neutra."],
      ["Subclassificação", "Cada linha pode vincular uma sub à classificação."],
    ],
    "cost-centers": [
      ["Centro superior", "Opcional. Cadastre o superior antes dos subordinados."],
    ],
    parties: [
      ["Tipo", "Cliente, Fornecedor ou Ambos."],
      ["CPF ou CNPJ", "Pode conter pontos, barra e hífen."],
    ],
  }[kind];

  return (
    <div className="import-wizard" aria-busy={busy}>
      <ol className="import-steps" aria-label="Etapas da importação">
        {["Arquivo", "Associar colunas", "Revisar e importar"].map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}
            className={index < step ? "complete" : ""}>
            {index < step ? <Check size={16} aria-hidden="true" /> : <span className="step-dot" />}
            {label}
          </li>
        ))}
      </ol>

      {!preview && !report && (
        <div className="import-start">
          <section className="import-upload-card" aria-labelledby="import-file-title">
            <h3 id="import-file-title">Escolha o arquivo</h3>
            <p>Importe sua tabela e confira os dados antes de gravar.</p>
            <div
              className={dragging ? "import-dropzone dragging" : "import-dropzone"}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) void choose(event.dataTransfer.files[0]);
              }}
            >
              <span className="upload-symbol"><Upload size={28} strokeWidth={1.7} aria-hidden="true" /></span>
              <strong>Arraste seu arquivo para cá</strong>
              <span>ou selecione no seu computador</span>
              <input ref={fileInput} className="sr-only" type="file"
                aria-label="Arquivo CSV ou XLSX" accept=".csv,.xlsx" disabled={busy}
                onChange={(event) => void choose(event.target.files?.[0])} />
              <button type="button" className="primary" disabled={busy}
                onClick={() => fileInput.current?.click()}>
                <FileSpreadsheet size={18} aria-hidden="true" />
                {busy ? "Lendo arquivo…" : "Selecionar arquivo"}
              </button>
              <small>CSV ou XLSX · Até 5 MB e 2.000 linhas</small>
            </div>
            {source && <p className="import-reading" role="status">{source.file_name}</p>}
          </section>
          <aside className="import-help">
            <section className="import-models" aria-labelledby="import-model-title">
              <span className="import-side-icon"><FileSpreadsheet size={22} aria-hidden="true" /></span>
              <h3 id="import-model-title">Precisa de um modelo?</h3>
              <p>Baixe com as colunas deste cadastro e preencha seus registros.</p>
              <div className="import-downloads">
                <a href={`/api${path}/template?format=xlsx`} download><Download size={17} aria-hidden="true" /> Modelo XLSX</a>
                <a href={`/api${path}/template?format=csv`} download><Download size={17} aria-hidden="true" /> Modelo CSV</a>
              </div>
            </section>
            <details className="import-guidance">
              <summary>Orientações de preenchimento</summary>
              <dl>
                {guidance.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
                <div><dt>Ativo</dt><dd>Sim ou Não. Se ficar vazio, será usado Sim.</dd></div>
              </dl>
            </details>
          </aside>
        </div>
      )}

      {source && preview && (
        <div className="import-filebar">
          <FileSpreadsheet size={22} aria-hidden="true" />
          <div><strong>{source.file_name}</strong><span>{preview.total} linhas encontradas</span></div>
          {!committed && <button type="button" disabled={busy} onClick={() => {
            setSource(null); setPreview(null); setReport(null); setError("");
          }}><RotateCcw size={16} aria-hidden="true" /> Trocar arquivo</button>}
        </div>
      )}

      {source && !report && (
        <fieldset className="import-working" disabled={busy}>
          <details className="import-source-options">
            <summary>Ajustar aba e cabeçalho</summary>
            <div className="import-source">
              {!!preview?.sheets.length && <label>Aba da planilha
                <select value={source.sheet ?? preview.sheets[0]} onChange={(event) =>
                  void reload({ ...source, sheet: event.target.value })
                }>{preview.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}</select>
              </label>}
              <label>Linha do cabeçalho
                <input type="number" min={1} max={100} value={source.header_row}
                  onChange={(event) => {
                    setSource({ ...source, header_row: Number(event.target.value) });
                    setReport(null);
                    setPreview(null);
                  }} />
              </label>
              <button type="button" onClick={() => void reload(source)}>Ler cabeçalho</button>
            </div>
          </details>
          {preview && <>
            <section className="import-section" aria-labelledby="mapping-title">
              <header><h3 id="mapping-title">Associar colunas</h3><p>Selecione a coluna do seu arquivo para cada campo da Finare. Os campos com * são obrigatórios.</p></header>
              <div className="import-mapping">
                {preview.fields.map((field) => <div className="field" key={field.name}>
                  <label htmlFor={`mapping-${field.name}`}>{field.label}{field.required ? " *" : ""}</label>
                  <SearchSelect id={`mapping-${field.name}`}
                    value={mapping[field.name] === undefined ? "" : String(mapping[field.name])}
                    options={[
                      { value: "", label: "Não importar esta coluna" },
                      ...preview.headers.map((header, index) => ({ value: String(index), label: `${index + 1} · ${header}` })),
                    ]}
                    onChange={(selected) => {
                      setMapping((previous) => {
                        const next = { ...previous };
                        if (selected === "") delete next[field.name];
                        else next[field.name] = Number(selected);
                        return next;
                      });
                      setReport(null);
                    }} />
                </div>)}
              </div>
            </section>
            <details className="import-sample">
              <summary>Ver prévia do arquivo <span>Primeiras 5 linhas</span></summary>
              <div className="table-scroll"><table><thead><tr>{preview.headers.map((header, index) =>
                <th key={index}>{header}</th>,
              )}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>
                {preview.headers.map((_, column) => <td key={column}>{row[column] ?? ""}</td>)}
              </tr>)}</tbody></table></div>
            </details>
          </>}
        </fieldset>
      )}

      {error && <p role="alert" className="error">{error}</p>}

      {report && (
        <section className="import-review" aria-label="Resultado da validação">
          <header className="import-review-heading">
            <h3>{committed ? "Importação concluída" : report.errors ? "Revise os registros indicados" : "Tudo pronto para importar"}</h3>
            <p role="status">{committed ? "Importação concluída." : "Validação concluída."}
              {" "}{report.errors ? "Corrija os erros antes de gravar os cadastros." : "Confira o resumo da carga."}</p>
          </header>
          <div className="import-totals">
            <div><strong>{report.new}</strong><span>Linhas com novos cadastros</span></div>
            <div><strong>{report.duplicates}</strong><span>Já cadastradas</span></div>
            <div className={report.errors ? "has-errors" : ""}><strong>{report.errors}</strong><span>Linhas com erro</span></div>
          </div>
          <div className="table-scroll import-report"><table><thead><tr><th>Linha do arquivo</th><th>Resultado</th></tr></thead>
            <tbody>{report.rows.map((row) => <tr key={row.row} className={row.status === "error" ? "import-row-error" : ""}>
              <td>{row.row}</td><td>{row.message}</td>
            </tr>)}</tbody></table></div>
        </section>
      )}

      {(preview || report) && (
        <footer className="import-footer">
          <span>{committed ? "Os cadastros já estão disponíveis na Finare." : report ? "A gravação será feita após sua confirmação." : "Confira o mapeamento antes de continuar."}</span>
          <div className="actions">
            {report && !committed && <button type="button" disabled={busy} onClick={() => setReport(null)}>Voltar ao mapeamento</button>}
            {!report && <button className="primary" type="button" disabled={!ready || busy}
              onClick={() => void execute("validate")}>{busy ? "Validando…" : "Validar importação"} <ArrowRight size={17} aria-hidden="true" /></button>}
            {report && !committed && !report.errors && <button className="primary" type="button" disabled={busy}
              onClick={() => void execute("commit")}>{busy ? "Gravando…" : "Confirmar importação"} <ArrowRight size={17} aria-hidden="true" /></button>}
            {committed && <button type="button" className="primary" onClick={onDone}>Concluir <Check size={17} aria-hidden="true" /></button>}
          </div>
        </footer>
      )}
    </div>
  );
}
