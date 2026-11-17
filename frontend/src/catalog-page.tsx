import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import { catalogs } from "./catalogs";
import type { CatalogId, RecordData } from "./catalogs";

type Draft = Record<string, string | boolean>;

export function CatalogPage({
  id,
  organizationId,
  onOpenCatalog,
}: {
  id: CatalogId;
  organizationId: string;
  onOpenCatalog: (id: CatalogId) => void;
}) {
  const catalog = catalogs[id];
  const base = `/organizations/${organizationId}`;
  const path = `${base}/${id}`;
  const blank = () =>
    Object.fromEntries([
      ...catalog.fields.map((field) => [field.name, field.defaultValue ?? ""]),
      ["active", true],
    ]) as Draft;
  const [records, setRecords] = useState<RecordData[]>([]);
  const [references, setReferences] = useState<RecordData[]>([]);
  const [editing, setEditing] = useState<RecordData | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [filter, setFilter] = useState("all");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const formTitle = useRef<HTMLHeadingElement>(null);
  const reference = catalog.fields.find((field) => field.reference)?.reference;

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };

    async function load() {
      try {
        const [items, linked] = await Promise.all([
          api<RecordData[]>(path, options),
          reference && reference !== id
            ? api<RecordData[]>(`${base}/${reference}`, options)
            : Promise.resolve([]),
        ]);
        if (controller.signal.aborted) return;
        setRecords(items);
        setReferences(linked);
      } catch {
        if (!controller.signal.aborted) {
          setLoadError("Não foi possível carregar os cadastros.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt, base, id, path, reference]);

  function begin(record?: RecordData) {
    setEditing(record ?? null);
    setDraft(
      record
        ? {
            ...Object.fromEntries(
              catalog.fields.map((field) => [
                field.name,
                record[field.name] ?? "",
              ]),
            ),
            active: record.active,
          }
        : blank(),
    );
    setSaveError("");
    setNotice("");
    formTitle.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = catalog.fields.map((field) => {
      const value = String(draft[field.name] ?? "").trim();
      return [field.name, value || null];
    });
    setSaving(true);
    setSaveError("");
    setNotice("");

    try {
      const saved = await api<RecordData>(
        editing ? `${path}/${editing.id}` : path,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            ...Object.fromEntries(values),
            active: draft.active,
          }),
        },
      );
      setRecords((previous) =>
        previous.some((record) => record.id === saved.id)
          ? previous.map((record) => (record.id === saved.id ? saved : record))
          : [...previous, saved],
      );
      setEditing(null);
      setDraft(blank());
      setFilter("all");
      setNotice("Cadastro salvo.");
    } catch (problem) {
      setSaveError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const linkedRecords = reference === id ? records : references;
  const needsCategory =
    id === "subcategories" &&
    !editing &&
    !linkedRecords.some((item) => item.active);
  const visible = records.filter(
    (record) => filter === "all" || record.active === (filter === "active"),
  );
  const sortField = id === "parties" ? "display_name" : "code";
  visible.sort((a, b) =>
    String(a[sortField]).localeCompare(String(b[sortField]), "pt-BR"),
  );

  function format(record: RecordData, name: string) {
    const field = catalog.fields.find((item) => item.name === name);
    const value = record[name];
    if (!value) return "—";
    if (field?.reference) {
      const linked = linkedRecords.find((item) => item.id === value);
      return linked ? String(linked.name) : "—";
    }
    return (
      field?.options?.find((option) => option.value === value)?.label ??
      String(value)
    );
  }

  return (
    <>
      <div className="page-heading">
        <h1>{catalog.label}</h1>
        <button
          type="button"
          className="primary"
          onClick={() => begin()}
          disabled={loading || saving || !!loadError || needsCategory}
        >
          Novo cadastro
        </button>
      </div>
      {loading ? (
        <p role="status">Carregando cadastros…</p>
      ) : loadError ? (
        <>
          <p role="alert" className="error">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError("");
              setAttempt((value) => value + 1);
            }}
          >
            Tentar novamente
          </button>
        </>
      ) : (
        <div className="catalog-grid">
          <section className="panel listing" aria-labelledby="records-title">
            <div className="panel-header">
              <h2 id="records-title">
                Registros <span>{records.length}</span>
              </h2>
              <select
                aria-label="Filtrar por situação"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">Todas as situações</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
              </select>
            </div>
            {visible.length === 0 ? (
              <div className="empty">
                <strong>
                  {records.length
                    ? "Nenhum resultado"
                    : "Nenhum registro cadastrado"}
                </strong>
                <p>
                  {records.length
                    ? "Selecione outra situação para ver os registros."
                    : needsCategory
                      ? "Uma classificação ativa é necessária para cadastrar a primeira subclasse."
                      : "Preencha o formulário para adicionar o primeiro registro."}
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table aria-labelledby="records-title">
                  <thead>
                    <tr>
                      <th scope="col">
                        {id === "bank-accounts" ? "Titular" : "Nome"}
                      </th>
                      {catalog.columns.map((column) => (
                        <th key={column.name} scope="col">
                          {column.label}
                        </th>
                      ))}
                      <th scope="col">Situação</th>
                      <th scope="col">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((record) => (
                      <tr key={record.id}>
                        <th scope="row">
                          {String(record[catalog.titleField])}
                        </th>
                        {catalog.columns.map((column) => (
                          <td key={column.name}>
                            {format(record, column.name)}
                          </td>
                        ))}
                        <td>
                          <span
                            className={
                              record.active ? "status active" : "status"
                            }
                          >
                            {record.active ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            disabled={saving}
                            onClick={() => begin(record)}
                            aria-label={`Editar ${record[catalog.titleField]}`}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel editor" aria-labelledby="editor-title">
            <h2 id="editor-title" ref={formTitle} tabIndex={-1}>
              {editing ? "Editar cadastro" : `Adicionar ${catalog.singular}`}
            </h2>
            {needsCategory ? (
              <>
                <p>
                  Cadastre ou reative uma classificação antes de adicionar uma
                  subclasse.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenCatalog("categories")}
                >
                  Abrir classificações
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                <fieldset disabled={saving}>
                  <div className="fields">
                    {catalog.fields.map((field) => {
                      const value = String(draft[field.name] ?? "");
                      const options = field.reference
                        ? linkedRecords
                            .filter(
                              (item) =>
                                item.id !== editing?.id &&
                                (item.active || item.id === value),
                            )
                            .map((item) => ({
                              value: item.id,
                              label: `${item.code} · ${item.name}`,
                            }))
                        : field.options;
                      return (
                        <div className="field" key={field.name}>
                          <label htmlFor={field.name}>{field.label}</label>
                          {options ? (
                            <select
                              id={field.name}
                              required={field.required}
                              value={value}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [field.name]: event.target.value,
                                })
                              }
                            >
                              <option value="">
                                {field.required ? "Selecione" : "Nenhum"}
                              </option>
                              {options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={field.name}
                              value={value}
                              type={field.type ?? "text"}
                              required={field.required}
                              placeholder={field.placeholder}
                              pattern={field.pattern}
                              maxLength={field.maxLength}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  [field.name]: event.target.value,
                                })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.active)}
                      onChange={(event) =>
                        setDraft({ ...draft, active: event.target.checked })
                      }
                    />
                    Cadastro ativo
                  </label>
                  <div className="actions">
                    <button className="primary">
                      {saving ? "Salvando…" : "Salvar cadastro"}
                    </button>
                    {editing && (
                      <button type="button" onClick={() => begin()}>
                        Cancelar edição
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
            )}
            {saveError && (
              <p className="error" role="alert">
                {saveError}
              </p>
            )}
            <p className="notice" role="status">
              {notice}
            </p>
          </section>
        </div>
      )}
    </>
  );
}
