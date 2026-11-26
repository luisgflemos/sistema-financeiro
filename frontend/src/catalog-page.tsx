import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { TableImport } from "./table-import";
import { SearchSelect } from "./search-select";
import { matchesCatalog } from "./catalog-search";
import { CatalogToolbar } from "./catalog-toolbar";
import { catalogs } from "./catalogs";
import type { CatalogId, RecordData } from "./catalogs";
import { SortHeader, useTableSort } from "./table-sort";
import { Pencil } from "lucide-react";
import { ActionButton } from "./action-button";

type Draft = Record<string, string | boolean>;

export function CatalogPage({
  id,
  organizationId,
  category,
  editorOnly = false,
  initialRecord,
  onSaved,
  onCancel,
}: {
  id: CatalogId;
  organizationId: string;
  category?: RecordData;
  editorOnly?: boolean;
  initialRecord?: RecordData;
  onSaved?: (record: RecordData) => void;
  onCancel?: () => void;
}) {
  const catalog = catalogs[id];
  const { fields, columns } = catalog;
  const uid = useId();
  const base = `/organizations/${organizationId}`;
  const path = `${base}/${id}`;
  const blank = () =>
    Object.fromEntries([
      ...fields.map((field) => [field.name, field.defaultValue ?? ""]),
      ["active", true],
    ]) as Draft;
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [records, setRecords] = useState<RecordData[]>([]);
  const [customerGroups, setCustomerGroups] = useState<RecordData[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecordData | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const sorting = useTableSort(id === "parties" ? "display_name" : "code");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const formTitle = useRef<HTMLHeadingElement>(null);
  const categoryId = category?.id;
  const needsCategory = !!category && !category.active && !editing;

  useEffect(() => {
    if (editorOnly) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const options = { signal: controller.signal };

    async function load() {
      try {
        const [items, groups] = await Promise.all([
          api<RecordData[]>(path, options),
          id === "parties"
            ? api<RecordData[]>(base + "/customer-groups", options)
            : Promise.resolve([]),
        ]);
        if (controller.signal.aborted) return;
        setCustomerGroups(groups);
        setRecords(
          categoryId
            ? items.filter((item) => item.category_id === categoryId)
            : items,
        );
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
  }, [attempt, categoryId, path, editorOnly]);

  function begin(record?: RecordData) {
    setFormOpen(true);
    setEditing(record ?? null);
    setDraft(
      record
        ? {
            ...Object.fromEntries(
              fields.map((field) => [field.name, record[field.name] ?? ""]),
            ),
            active: record.active,
          }
        : blank(),
    );
    setSaveError("");
    setNotice("");
    formTitle.current?.focus();
  }

  useEffect(() => {
    if (editorOnly && initialRecord) begin(initialRecord);
  }, [editorOnly, initialRecord]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = fields
      .filter((field) => !field.readOnly)
      .map((field) => {
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
            ...(categoryId ? { category_id: categoryId } : {}),
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
      setFormOpen(false);
      onSaved?.(saved);
    } catch (problem) {
      setSaveError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = records.filter(
    (record) =>
      (filter === "all" || record.active === (filter === "active")) &&
      matchesCatalog(query, [
        record.code,
        ...fields.flatMap((field) => [
          record[field.name],
          field.options?.find((option) => option.value === record[field.name])
            ?.label,
          field.reference
            ? (field.reference === "customer-groups"
                ? customerGroups
                : records
              ).find((item) => item.id === record[field.name])?.name
            : "",
        ]),
      ]),
  );
  const visible = sorting.sorted(filtered, (record, field) =>
    field === "status"
      ? record.active
        ? "Ativo"
        : pending(record)
          ? "A completar"
          : "Inativo"
      : field === catalog.titleField
        ? title(record)
        : format(record, field),
  );

  function title(record: RecordData) {
    return String(
      record[catalog.titleField] ?? record.holder_name ?? record.code,
    );
  }

  function pending(record: RecordData) {
    return (
      (id === "bank-accounts" &&
        (!record.bank_code ||
          !record.branch ||
          !record.account_number_masked)) ||
      (id === "categories" && !record.kind)
    );
  }

  function format(record: RecordData, name: string) {
    const field = catalog.fields.find((item) => item.name === name);
    const value = record[name];
    if (!value) return "—";
    if (field?.reference) {
      const linked = (
        field.reference === "customer-groups" ? customerGroups : records
      ).find((item) => item.id === value);
      return linked ? String(linked.name) : "—";
    }
    return (
      field?.options?.find((option) => option.value === value)?.label ??
      String(value)
    );
  }

  const editorForm = (
    <section
      className="panel editor modal-editor"
      aria-labelledby={`${uid}-editor`}
    >
      <h2
        id={`${uid}-editor`}
        ref={formTitle}
        tabIndex={-1}
        className="sr-only"
      >
        {editing ? "Editar cadastro" : `Adicionar ${catalog.singular}`}
      </h2>
      {needsCategory ? (
        <p>Reative a classificação para cadastrar uma subclassificação.</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving}>
            <div className="fields catalog-fields">
              {fields.map((field) => {
                const value =
                  field.name === "account_number_masked" && draft.account_number
                    ? "**" + String(draft.account_number).slice(-4)
                    : String(draft[field.name] ?? "");
                const options = field.reference
                  ? records
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
                const availableOptions =
                  options &&
                  value &&
                  !options.some((item) => item.value === value)
                    ? [...options, { value, label: value }]
                    : options;
                return (
                  <div
                    className={"field catalog-field-" + field.name}
                    key={field.name}
                  >
                    <label htmlFor={`${uid}-${field.name}`}>
                      {field.label}
                    </label>
                    {field.readOnly && field.reference === "customer-groups" ? (
                      <input
                        id={`${uid}-${field.name}`}
                        readOnly
                        value={
                          customerGroups.find((g) => g.id === value)?.name
                            ? String(
                                customerGroups.find((g) => g.id === value)
                                  ?.name,
                              )
                            : ""
                        }
                        placeholder={field.placeholder}
                      />
                    ) : availableOptions &&
                      (field.name === "bank_code" ||
                        field.name === "currency") ? (
                      <SearchSelect
                        id={`${uid}-${field.name}`}
                        value={value}
                        options={availableOptions}
                        required={field.required}
                        onChange={(selected) =>
                          setDraft({ ...draft, [field.name]: selected })
                        }
                      />
                    ) : availableOptions ? (
                      <SearchSelect
                        id={`${uid}-${field.name}`}
                        className={
                          field.name === "kind" ? `nature-${value}` : undefined
                        }
                        required={field.required}
                        value={value}
                        onChange={(selected) =>
                          setDraft({
                            ...draft,
                            [field.name]: selected,
                          })
                        }
                        options={[
                          {
                            value: "",
                            label: field.required ? "Selecione" : "Nenhum",
                          },
                          ...availableOptions,
                        ]}
                      />
                    ) : (
                      <input
                        id={`${uid}-${field.name}`}
                        value={value}
                        type={field.type ?? "text"}
                        required={field.required}
                        readOnly={field.readOnly}
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
            <div className="active-toggle">
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(draft.active)}
                aria-label="Cadastro ativo"
                className="toggle"
                onClick={() => setDraft({ ...draft, active: !draft.active })}
              >
                <span />
              </button>
              <span>Cadastro {draft.active ? "ativo" : "inativo"}</span>
            </div>
            <div className="actions">
              <button className="primary">
                {saving ? "Salvando…" : "Salvar cadastro"}
              </button>
              {(editing || formOpen || editorOnly) && (
                <button
                  type="button"
                  onClick={() =>
                    editorOnly ? onCancel?.() : setFormOpen(false)
                  }
                >
                  Cancelar
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
    </section>
  );

  return (
    <>
      {!editorOnly && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {importOpen && id !== "subcategories" && id !== "customer-groups" && (
        <Modal
          title={`Importar ${catalog.label}`}
          busy={importBusy}
          onClose={() => {
            setImportOpen(false);
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          <TableImport
            kind={id}
            onBusyChange={setImportBusy}
            organizationId={organizationId}
            onDone={() => {
              setImportOpen(false);
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          />
        </Modal>
      )}
      {!editorOnly && (
        <div className="page-heading">
          {category ? <h3>{catalog.label}</h3> : <h1>{catalog.label}</h1>}
          <div className="actions">
            {id !== "subcategories" && id !== "customer-groups" && (
              <button
                type="button"
                className="primary"
                onClick={() => setImportOpen(true)}
              >
                Importar
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => begin()}
              disabled={loading || saving || !!loadError || needsCategory}
            >
              {category ? "+ Nova subclassificação" : "Novo cadastro"}
            </button>
          </div>
        </div>
      )}
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
        <div className={editorOnly ? "editor-only" : "catalog-list"}>
          {!editorOnly && (
            <section
              className="panel listing"
              aria-labelledby={`${uid}-records`}
            >
              <CatalogToolbar
                title="Registros"
                headingId={`${uid}-records`}
                shown={visible.length}
                total={records.length}
                query={query}
                onQueryChange={setQuery}
                filter={filter}
                onFilterChange={setFilter}
              />
              {visible.length === 0 ? (
                <div className="empty">
                  <strong>
                    {records.length
                      ? "Nenhum resultado"
                      : "Nenhum registro cadastrado"}
                  </strong>
                  <p>
                    {records.length
                      ? "Altere a pesquisa ou o filtro de situação para ver os registros."
                      : needsCategory
                        ? "Esta classificação está inativa."
                        : "Preencha o formulário para adicionar o primeiro registro."}
                  </p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table aria-labelledby={`${uid}-records`}>
                    <thead>
                      <tr>
                        <SortHeader
                          field={catalog.titleField}
                          label={
                            id === "bank-accounts" ? "Nome da conta" : "Nome"
                          }
                          order={sorting.order}
                          onChange={sorting.change}
                        />
                        {columns.map((column) => (
                          <SortHeader
                            key={column.name}
                            field={column.name}
                            label={column.label}
                            order={sorting.order}
                            onChange={sorting.change}
                          />
                        ))}
                        <SortHeader
                          field="status"
                          label="Situação"
                          order={sorting.order}
                          onChange={sorting.change}
                        />
                        <th scope="col">
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((record) => (
                        <Fragment key={record.id}>
                          <tr>
                            <th scope="row">
                              {id === "categories" ? (
                                <button
                                  type="button"
                                  className="text-button category-toggle"
                                  aria-expanded={expanded === record.id}
                                  onClick={() =>
                                    setExpanded(
                                      expanded === record.id ? null : record.id,
                                    )
                                  }
                                >
                                  {String(record.name)}
                                </button>
                              ) : (
                                title(record)
                              )}
                            </th>
                            {columns.map((column) => (
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
                                {record.active
                                  ? "Ativo"
                                  : pending(record)
                                    ? "A completar"
                                    : "Inativo"}
                              </span>
                            </td>
                            <td>
                              <ActionButton
                                label="Editar"
                                icon={Pencil}
                                disabled={saving}
                                onClick={() => begin(record)}
                                ariaLabel={`Editar ${title(record)}`}
                              />
                            </td>
                          </tr>
                          {expanded === record.id && (
                            <tr className="nested-row">
                              <td colSpan={columns.length + 3}>
                                <section
                                  aria-label={`Subclassificações de ${record.name}`}
                                >
                                  <CatalogPage
                                    id="subcategories"
                                    organizationId={organizationId}
                                    category={record}
                                  />
                                </section>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {editorOnly ? (
            editorForm
          ) : formOpen ? (
            <Modal
              title={
                editing
                  ? `Editar ${catalog.singular}`
                  : `Novo cadastro de ${catalog.singular}`
              }
              busy={saving}
              onClose={() => setFormOpen(false)}
            >
              {editorForm}
            </Modal>
          ) : null}{" "}
        </div>
      )}
    </>
  );
}
