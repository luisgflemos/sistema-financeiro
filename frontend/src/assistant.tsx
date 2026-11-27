import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, X } from "lucide-react";
import { api } from "./api";
import "./assistant.css";

type Message = { role: "user" | "assistant"; content: string };
type CashFilters = {
  start?: string;
  end?: string;
  as_of?: string;
  account_id?: string;
  cost_center_id?: string;
  category_id?: string;
  focus_key?: string;
};
type Context = { id?: string; label: string; cash_flow?: CashFilters };
type Position = { x: number; y: number };
const POSITION_KEY = "finare.fin-position";

function savedPosition(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y))
      return {
        x: Math.max(0, Math.min(1, value.x)),
        y: Math.max(0, Math.min(1, value.y)),
      };
  } catch {
    /* A posição é opcional se o navegador bloquear o armazenamento. */
  }
  return null;
}

function FinIcon() {
  return (
    <span className="brand-symbol fin-symbol" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function askAssistant(context?: Context) {
  window.dispatchEvent(
    new CustomEvent("finare:assistant", { detail: context }),
  );
}

export function Assistant({
  organizationId,
  screen,
}: {
  organizationId: string;
  screen: string;
}) {
  const [open, setOpen] = useState(false);
  const [cashFilters, setCashFilters] = useState<CashFilters | null>(null);
  useEffect(() => {
    const listener = (event: Event) =>
      setCashFilters((event as CustomEvent<CashFilters | null>).detail);
    window.addEventListener("finare:cash-flow", listener);
    return () => window.removeEventListener("finare:cash-flow", listener);
  }, []);
  const [context, setContext] = useState<Context | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState<Element>(document.body);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(savedPosition);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    position: Position | null;
  } | null>(null);
  const suppressClick = useRef(false);
  function place(left: number, top: number, persist = false) {
    const rangeX = Math.max(0, window.innerWidth - 76),
      rangeY = Math.max(0, window.innerHeight - 80);
    const next = {
      x: rangeX ? Math.max(0, Math.min(1, (left - 8) / rangeX)) : 0,
      y: rangeY ? Math.max(0, Math.min(1, (top - 8) / rangeY)) : 0,
    };
    setPosition(next);
    if (drag.current) drag.current.position = next;
    if (persist) {
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(next));
      } catch {
        /* Sem persistência, o botão continua móvel nesta sessão. */
      }
    }
  }
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    function show(event: Event) {
      const next = (event as CustomEvent<Context | undefined>).detail;
      if (next) {
        // Uma mudança de movimento inicia outro contexto; não mistura conversas.
        controller.current?.abort();
        setBusy(false);
        setContext(next);
        setMessages([]);
        setError("");
        setQuestion("");
      }
      setOpen(true);
    }
    window.addEventListener("finare:assistant", show);
    const observer = new MutationObserver(() => {
      const dialogs = document.querySelectorAll("dialog[open]");
      const dialog = dialogs.item(dialogs.length - 1);
      setHost(
        dialog?.querySelector(".modal-header") ?? dialog ?? document.body,
      );
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      controller.current?.abort();
      observer.disconnect();
      window.removeEventListener("finare:assistant", show);
    };
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, host]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  async function send() {
    if (busy || !question.trim()) return;
    const text = question.trim();
    const next: Message[] = [...messages, { role: "user", content: text }];
    const request = new AbortController();
    controller.current = request;
    setMessages(next);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const recent = next.slice(-12);
      while (
        recent.length > 1 &&
        recent.reduce((total, item) => total + item.content.length, 0) > 18000
      )
        recent.shift();
      const response = await api<{ answer: string }>(
        "/organizations/" + organizationId + "/assistant/chat",
        {
          method: "POST",
          signal: request.signal,
          body: JSON.stringify({
            messages: recent,
            transaction_id: context?.id ?? null,
            screen: context?.cash_flow ? "Fluxo de Caixa" : screen,
            cash_flow:
              screen === "Fluxo de Caixa" || context?.cash_flow
                ? (context?.cash_flow ?? cashFilters ?? {})
                : null,
          }),
        },
      );
      if (!request.signal.aborted)
        setMessages([...next, { role: "assistant", content: response.answer }]);
    } catch (problem) {
      if (!request.signal.aborted) {
        setError((problem as Error).message);
        setMessages(messages);
        setQuestion(text);
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      {createPortal(
        !open && (
          <button
            type="button"
            className={"assistant-launcher" + (dragging ? " is-dragging" : "")}
            title="Fin — arraste para mover; clique para conversar"
            style={
              position
                ? {
                    position: "fixed",
                    left: 8 + position.x * Math.max(0, viewport.width - 76),
                    top: 8 + position.y * Math.max(0, viewport.height - 80),
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              const rect = event.currentTarget.getBoundingClientRect();
              suppressClick.current = false;
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: rect.left,
                top: rect.top,
                moved: false,
                position,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.id !== event.pointerId) return;
              const dx = event.clientX - current.x,
                dy = event.clientY - current.y;
              if (!current.moved && Math.hypot(dx, dy) < 5) return;
              current.moved = true;
              setDragging(true);
              place(current.left + dx, current.top + dy);
            }}
            onPointerUp={(event) => {
              const current = drag.current;
              if (!current || current.id !== event.pointerId) return;
              suppressClick.current = current.moved;
              if (current.moved && current.position) {
                try {
                  localStorage.setItem(
                    POSITION_KEY,
                    JSON.stringify(current.position),
                  );
                } catch {
                  /* Opcional. */
                }
              }
              drag.current = null;
              setDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
              suppressClick.current = true;
            }}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                place(
                  rect.left +
                    (event.key === "ArrowLeft"
                      ? -16
                      : event.key === "ArrowRight"
                        ? 16
                        : 0),
                  rect.top +
                    (event.key === "ArrowUp"
                      ? -16
                      : event.key === "ArrowDown"
                        ? 16
                        : 0),
                  true,
                );
              }
            }}
            onClick={(event) => {
              if (suppressClick.current && event.detail !== 0) {
                suppressClick.current = false;
                event.preventDefault();
                return;
              }
              suppressClick.current = false;
              setOpen(true);
            }}
            aria-label="Conversar com Assistente Finare"
            aria-describedby="fin-move-help"
          >
            <FinIcon /> <span className="fin-launcher-name">Fin</span>
            <span id="fin-move-help" className="sr-only">
              Arraste para reposicionar. Use Alt e as setas pelo teclado. Clique
              para conversar.
            </span>
          </button>
        ),
        host,
      )}
      {createPortal(
        open && (
          <aside
            className="assistant-panel"
            role="region"
            aria-label="Conversa com Assistente Finare"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <header>
              <div>
                <FinIcon />
                <div>
                  <strong>Fin</strong>
                  <small>Assistente Finare · Converse enquanto trabalha</small>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimizar assistente"
              >
                <X size={20} />
              </button>
            </header>
            <div className="assistant-context">
              <span>
                {context?.cash_flow || screen === "Fluxo de Caixa"
                  ? "Sobre o Fluxo de Caixa"
                  : context
                    ? "Sobre este lançamento"
                    : "Orientação na Finare"}
              </span>
              <strong>{context?.label ?? screen}</strong>
              {context && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setContext(null);
                    setMessages([]);
                    setError("");
                  }}
                >
                  Voltar à conversa geral
                </button>
              )}
            </div>
            <div
              className="assistant-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {!messages.length && (
                <div className="assistant-welcome">
                  <strong>Como posso ajudar?</strong>
                  <p>
                    Posso explicar sugestões, orientar o preenchimento e tirar
                    dúvidas sobre os lançamentos.
                  </p>
                  <div className="assistant-starters">
                    {(context?.cash_flow || screen === "Fluxo de Caixa"
                      ? [
                          "Explique as premissas desta projeção",
                          "Quais estimativas precisam de revisão?",
                        ]
                      : context
                        ? [
                            "Explique a sugestão deste lançamento",
                            "O que falta para identificar este movimento?",
                          ]
                        : [
                            "Como identificar os movimentos do extrato?",
                            "Como a Finare aprende com meu histórico?",
                          ]
                    ).map((text) => (
                      <button
                        type="button"
                        key={text}
                        onClick={() => {
                          setQuestion(text);
                          input.current?.focus();
                        }}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((message, index) => (
                <div
                  className={
                    "assistant-message assistant-message-" + message.role
                  }
                  key={index}
                >
                  <small>{message.role === "user" ? "Você" : "Fin"}</small>
                  <p>{message.content}</p>
                </div>
              ))}
              {busy && (
                <p role="status" className="assistant-thinking">
                  Preparando uma resposta…
                </p>
              )}
              <div ref={bottom} />
            </div>
            {error && (
              <p className="assistant-error" role="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label htmlFor="assistant-question">Sua mensagem</label>
              <textarea
                id="assistant-question"
                ref={input}
                value={question}
                maxLength={3000}
                rows={2}
                placeholder="Converse com a Fin…"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <button
                  type="button"
                  disabled={busy || !messages.length}
                  onClick={() => {
                    setMessages([]);
                    setError("");
                    setQuestion("");
                  }}
                >
                  Nova conversa
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !question.trim()}
                >
                  <Send size={16} /> Enviar
                </button>
              </div>
              <small>
                Sugestões precisam de revisão. A conversa não altera cadastros
                ou lançamentos.
              </small>
            </form>
          </aside>
        ),
        host.closest("dialog") ?? document.body,
      )}
    </>
  );
}
