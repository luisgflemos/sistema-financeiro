import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "./api";
import { Modal } from "./modal";
import { brl, brazilDate } from "./statement-import";

type Row = { id: string; editable: boolean; raw_description: string };
type Preview = {
  count: number;
  blocked: number;
  identified: number;
  first_date: string;
  last_date: string;
  accounts: string[];
  credits: string;
  debits: string;
  token: string;
};

export function useTransactionSelection(
  base: string,
  scope: string,
  rows: Row[],
  total: number,
  onDone: (count: number) => void,
) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const currentScope = useRef(base + "?" + scope);
  currentScope.current = base + "?" + scope;
  useEffect(() => {
    setIds(new Set());
    setPreview(null);
    setError("");
  }, [scope, base]);
  const visible = [
    ...new Map(
      rows.filter((row) => row.editable).map((r) => [r.id, r]),
    ).values(),
  ];
  const allPage = !!visible.length && visible.every((r) => ids.has(r.id));
  function togglePage() {
    setIds((previous) => {
      const next = new Set(previous);
      visible.forEach((r) => (allPage ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }
  async function selectAll() {
    const requestedScope = base + "?" + scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ids: string[] }>(
        base + "/transactions?" + scope + "&selection_only=true",
      );
      if (currentScope.current === requestedScope) setIds(new Set(result.ids));
    } catch (problem) {
      if (currentScope.current === requestedScope)
        setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    const requestedScope = base + "?" + scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<Preview>(
        base + "/transaction-exclusions/preview",
        {
          method: "POST",
          body: JSON.stringify({ ids: [...ids] }),
        },
      );
      if (currentScope.current === requestedScope) setPreview(result);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!preview || preview.blocked) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ removed: number }>(
        base + "/transaction-exclusions",
        {
          method: "POST",
          body: JSON.stringify({ ids: [...ids], token: preview.token }),
        },
      );
      setPreview(null);
      setIds(new Set());
      onDone(result.removed);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    header: (
      <th scope="col" className="transaction-selection-cell">
        <input
          type="checkbox"
          aria-label="Selecionar movimentos desta página"
          checked={allPage}
          disabled={busy || !visible.length}
          onChange={togglePage}
          ref={(node) => {
            if (node)
              node.indeterminate =
                !allPage && visible.some((r) => ids.has(r.id));
          }}
        />
      </th>
    ),
    cell: (row: Row) => (
      <td className="transaction-selection-cell">
        <input
          type="checkbox"
          aria-label={"Selecionar movimento: " + row.raw_description}
          checked={ids.has(row.id)}
          disabled={busy || !row.editable}
          onChange={() =>
            setIds((previous) => {
              const next = new Set(previous);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              return next;
            })
          }
        />
      </td>
    ),
    toolbar: (
      <>
        <div className="transaction-selection-toolbar">
          <strong aria-live="polite">
            {ids.size.toLocaleString("pt-BR")} selecionados
          </strong>
          <button
            type="button"
            disabled={busy || !total}
            onClick={() => void selectAll()}
          >
            Selecionar todos os resultados
          </button>
          {!!ids.size && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setIds(new Set())}
            >
              Limpar seleção
            </button>
          )}
          <button
            type="button"
            className="transaction-delete"
            disabled={busy || !ids.size}
            onClick={() => void prepare()}
          >
            <Trash2 size={16} /> Excluir selecionados
          </button>
        </div>
        {error && !preview && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <Modal
            title="Excluir Movimentos Selecionados"
            onClose={() => {
              if (!busy) {
                setPreview(null);
                setError("");
              }
            }}
          >
            <div className="transaction-exclusion-summary">
              <strong>
                {preview.count.toLocaleString("pt-BR")} movimentos serão
                excluídos
              </strong>
              <p>
                {brazilDate(preview.first_date)} a{" "}
                {brazilDate(preview.last_date)}
              </p>
              <p>Contas: {preview.accounts.join(" · ")}</p>
              <dl>
                <div>
                  <dt>Créditos</dt>
                  <dd>{brl(preview.credits)}</dd>
                </div>
                <div>
                  <dt>Débitos</dt>
                  <dd>{brl(preview.debits)}</dd>
                </div>
              </dl>
              {!!preview.identified && (
                <p>
                  {preview.identified} movimentos já identificados estão
                  incluídos na seleção.
                </p>
              )}
            </div>
            <p>
              Os movimentos sairão das listagens e das análises da IA. Cadastros
              e lançamentos previstos serão preservados. O original permanece na
              auditoria; reimportar o arquivo não restaura os movimentos
              excluídos.
            </p>
            {!!preview.blocked && (
              <p className="error" role="alert">
                {preview.blocked} registros possuem histórico de baixa ou são
                compartilhados com outro extrato. Nenhum registro desta seleção
                será excluído. Revise a seleção.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="transaction-selection-toolbar">
              <button
                type="button"
                className="transaction-delete"
                disabled={busy || !!preview.blocked}
                onClick={() => void remove()}
              >
                {busy ? "Aguarde…" : "Confirmar exclusão"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setError("");
                }}
              >
                Voltar sem excluir
              </button>
            </div>
          </Modal>
        )}
      </>
    ),
  };
}
