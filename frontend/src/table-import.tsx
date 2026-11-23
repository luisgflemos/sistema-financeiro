import { useState } from "react";
import { api } from "./api";
import { SearchSelect } from "./search-select";
import type { CatalogId } from "./catalogs";

type Kind = Exclude<CatalogId, "subcategories">;
type Source = { file_name: string; content: string; sheet?: string; header_row: number };
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
}: {
  kind: Kind;
  organizationId: string;
  onDone: () => void;
}) {
  const path = `/organizations/${organizationId}/table-imports/${kind}`;
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      const next = { file_name: file.name, content: btoa(binary), header_row: 1 };
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

  const ready = preview?.fields
    .filter((field) => field.required)
    .every((field) => mapping[field.name] !== undefined);

  return (
    <div className="import-wizard">
      <p>Use seu arquivo ou baixe um modelo. Limite de 2.000 linhas e 5 MB por carga.</p>
      <div className="actions">
        <a className="download-link" href={`/api${path}/template?format=xlsx`} download>Modelo XLSX</a>
        <a className="download-link" href={`/api${path}/template?format=csv`} download>Modelo CSV</a>
      </div>
      <p>Ativo aceita Sim/Não. Em classificações, Natureza aceita Receita/Despesa/Neutra.
        Em clientes, Tipo aceita Cliente/Fornecedor/Ambos. Campos de código, documento,
        agência e conta devem ser texto para preservar zeros à esquerda.</p>
      <fieldset disabled={busy || committed}>
        <label>
          Arquivo CSV ou XLSX
          <input type="file" accept=".csv,.xlsx" onChange={(event) => void choose(event.target.files?.[0])} />
        </label>
        {source && (
          <div className="import-source">
            {!!preview?.sheets.length && (
              <label>
                Aba da planilha
                <select value={source.sheet ?? preview.sheets[0]} onChange={(event) =>
                  void reload({ ...source, sheet: event.target.value })
                }>
                  {preview.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}
                </select>
              </label>
            )}
            <label>
              Linha do cabeçalho
              <input type="number" min={1} max={100} value={source.header_row} onChange={(event) => {
                setSource({ ...source, header_row: Number(event.target.value) });
                setReport(null);
                setPreview(null);
              }} />
            </label>
            <button type="button" onClick={() => void reload(source)}>Ler cabeçalho</button>
          </div>
        )}
        {preview && (
          <>
            <h3>Associar colunas</h3>
            <p>{preview.total} linhas encontradas. Confira as associações sugeridas.</p>
            <div className="import-mapping">
              {preview.fields.map((field) => (
                <div className="field" key={field.name}>
                  <label htmlFor={`mapping-${field.name}`}>{field.label}{field.required ? " *" : ""}</label>
                  <SearchSelect
                    id={`mapping-${field.name}`}
                    value={mapping[field.name] === undefined ? "" : String(mapping[field.name])}
                    options={[
                      { value: "", label: "Não importar esta coluna" },
                      ...preview.headers.map((header, index) => ({
                        value: String(index),
                        label: `${index + 1} · ${header}`,
                      })),
                    ]}
                    onChange={(selected) => {
                      setMapping((previous) => {
                        const next = { ...previous };
                        if (selected === "") delete next[field.name];
                        else next[field.name] = Number(selected);
                        return next;
                      });
                      setReport(null);
                    }}
                  />
                </div>
              ))}
            </div>
            <h3>Prévia do arquivo</h3>
            <div className="table-scroll">
              <table><thead><tr>{preview.headers.map((header, index) =>
                <th key={index}>{header}</th>,
              )}</tr></thead>
              <tbody>{preview.sample.map((row, index) => <tr key={index}>
                {preview.headers.map((_, column) => <td key={column}>{row[column] ?? ""}</td>)}
              </tr>)}</tbody></table>
            </div>
            {!report && <button className="primary" type="button" disabled={!ready} onClick={() => void execute("validate")}>
              {busy ? "Validando…" : "Validar importação"}
            </button>}
          </>
        )}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      {report && (
        <>
          <p role="status">{committed ? "Importação concluída." : "Validação concluída."}
            {" "}{report.new} linhas com novos cadastros, {report.duplicates} já cadastradas e {report.errors} com erro.</p>
          <div className="table-scroll import-report">
            <table><thead><tr><th>Linha</th><th>Resultado</th></tr></thead>
              <tbody>{report.rows.map((row) => <tr key={row.row}>
                <td>{row.row}</td><td>{row.message}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {report.errors > 0 && <p>Corrija o arquivo ou o mapeamento e valide novamente. A gravação exige todas as linhas válidas.</p>}
          {!committed && report.errors === 0 && <button type="button" className="primary" disabled={busy} onClick={() => void execute("commit")}>
            {busy ? "Gravando…" : "Confirmar importação"}
          </button>}
        </>
      )}
      {committed && <button type="button" className="primary" onClick={onDone}>Concluir</button>}
    </div>
  );
}
