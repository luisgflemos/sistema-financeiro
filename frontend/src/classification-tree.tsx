import { Fragment, useEffect, useState } from "react";
import { api } from "./api";
import { NatureBadge } from "./nature";
import { Modal } from "./modal";
import { TableImport } from "./table-import";
import { CatalogPage } from "./catalog-page";
import type { RecordData } from "./catalogs";

type Editor = { category?: RecordData; record?: RecordData; key: number };

export function ClassificationTree({
  organizationId,
}: {
  organizationId: string;
}) {
  const [categories, setCategories] = useState<RecordData[]>([]);
  const [children, setChildren] = useState<RecordData[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor>({ key: 0 });
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const base = `/organizations/${organizationId}`;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<RecordData[]>(`${base}/categories`, { signal: controller.signal }),
      api<RecordData[]>(`${base}/subcategories`, { signal: controller.signal }),
    ])
      .then(([parents, subs]) => {
        if (controller.signal.aborted) return;
        setCategories(parents);
        setChildren(subs);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Não foi possível carregar as classificações.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, base]);

  function openEditor(record?: RecordData, category?: RecordData) {
    setFormOpen(true);
    setNotice("");
    setEditor((previous) => ({ record, category, key: previous.key + 1 }));
  }

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function matches(record: RecordData) {
    return filter === "all" || record.active === (filter === "active");
  }

  function status(record: RecordData) {
    return (
      <span className={record.active ? "status active" : "status"}>
        {record.active
          ? "Ativo"
          : record.kind === null
            ? "A completar"
            : "Inativo"}
      </span>
    );
  }

  const ordered = [...categories].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "pt-BR"),
  );
  const visible = ordered.filter(
    (parent) =>
      matches(parent) ||
      children.some(
        (child) => child.category_id === parent.id && matches(child),
      ),
  );

  return (
    <>
      <p className="notice" role="status">
        {notice}
      </p>
      {importOpen && (
        <Modal
          title="Importar Classificações"
          busy={importBusy}
          onClose={() => {
            setImportOpen(false);
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          <TableImport
            kind="categories"
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
      <div className="page-heading">
        <h1>Classificações</h1>
        <div className="actions">
          <button type="button" className="primary" onClick={() => setImportOpen(true)}>
            Importar
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => openEditor()}
          >
            Nova classificação
          </button>
        </div>
      </div>
      {loading ? (
        <p role="status">Carregando classificações…</p>
      ) : error ? (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Tentar novamente
          </button>
        </>
      ) : (
        <div className="catalog-list">
          <section
            className="panel listing"
            aria-label="Classificações e subclassificações"
          >
            <div className="panel-header">
              <h2>
                Classificações <span>{categories.length}</span>
              </h2>
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(new Set(categories.map((item) => item.id)))
                  }
                >
                  Expandir tudo
                </button>
                <button type="button" onClick={() => setExpanded(new Set())}>
                  Recolher tudo
                </button>
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
            </div>
            <div className="table-scroll">
              <table className="classification-tree">
                <caption className="sr-only">
                  Classificações com suas subclassificações
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Código</th>
                    <th scope="col">Natureza</th>
                    <th scope="col">Situação</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((parent) => {
                    const subs = children
                      .filter(
                        (child) =>
                          child.category_id === parent.id && matches(child),
                      )
                      .sort((a, b) =>
                        String(a.name).localeCompare(String(b.name), "pt-BR"),
                      );
                    const isOpen = expanded.has(parent.id);
                    return (
                      <Fragment key={parent.id}>
                        <tr className="tree-parent">
                          <th scope="row">
                            <button
                              type="button"
                              className="tree-disclosure"
                              aria-expanded={isOpen}
                              onClick={() => toggle(parent.id)}
                            >
                              <span
                                className="tree-sign"
                                aria-hidden="true"
                              ></span>
                              {String(parent.name)}
                              <span className="tree-count">{subs.length}</span>
                            </button>
                          </th>
                          <td>{String(parent.code)}</td>
                          <td>
                            <NatureBadge value={String(parent.kind)} />
                          </td>
                          <td>{status(parent)}</td>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              aria-label={`Editar ${parent.name}`}
                              onClick={() => openEditor(parent)}
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <>
                            {subs.map((sub) => (
                              <tr key={sub.id} className="tree-child">
                                <th scope="row">
                                  <span
                                    className="tree-branch"
                                    aria-hidden="true"
                                  >
                                    └
                                  </span>
                                  {String(sub.name)}
                                </th>
                                <td>{String(sub.code)}</td>
                                <td>—</td>
                                <td>{status(sub)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="text-button"
                                    aria-label={`Editar ${sub.name} em ${parent.name}`}
                                    onClick={() => openEditor(sub, parent)}
                                  >
                                    Editar
                                  </button>
                                </td>
                              </tr>
                            ))}
                            <tr className="tree-child tree-add">
                              <td colSpan={5}>
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={!parent.active}
                                  aria-label={`Nova subclassificação em ${parent.name}`}
                                  onClick={() => openEditor(undefined, parent)}
                                >
                                  + Nova subclassificação
                                </button>
                              </td>
                            </tr>
                          </>
                        )}
                      </Fragment>
                    );
                  })}
                  {!visible.length && (
                    <tr>
                      <td colSpan={5}>Nenhuma classificação encontrada.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {formOpen && (
            <Modal
              title={
                editor.record
                  ? "Editar cadastro"
                  : editor.category
                    ? "Nova subclassificação"
                    : "Nova classificação"
              }
              onClose={() => setFormOpen(false)}
            >
              {editor.category && (
                <p className="editor-context">
                  Subclassificação de{" "}
                  <strong>{String(editor.category.name)}</strong>
                </p>
              )}
              <CatalogPage
                key={editor.key}
                id={editor.category ? "subcategories" : "categories"}
                organizationId={organizationId}
                category={editor.category}
                initialRecord={editor.record}
                editorOnly
                onCancel={() => setFormOpen(false)}
                onSaved={(saved) => {
                  const update = (items: RecordData[]) =>
                    items.some((item) => item.id === saved.id)
                      ? items.map((item) =>
                          item.id === saved.id ? saved : item,
                        )
                      : [...items, saved];
                  if (editor.category) setChildren(update);
                  else setCategories(update);
                  setFormOpen(false);
                  setNotice("Cadastro salvo.");
                }}
              />
            </Modal>
          )}
        </div>
      )}
    </>
  );
}
