import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X, Sparkles } from "lucide-react";
import { api } from "./api";
import "./assistant.css";

type Message = { role: "user" | "assistant"; content: string };
type Context = { id: string; label: string };

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
  const [context, setContext] = useState<Context | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState<Element>(document.body);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

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
      setHost(dialogs.item(dialogs.length - 1) ?? document.body);
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
            screen,
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

  return createPortal(
    <>
      {!open && (
        <button
          type="button"
          className="assistant-launcher"
          onClick={() => setOpen(true)}
          aria-label="Conversar com Assistente Finare"
        >
          <MessageCircle size={20} /> Assistente Finare
        </button>
      )}
      {open && (
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
              <Sparkles size={20} />
              <div>
                <strong>Assistente Finare</strong>
                <small>Converse enquanto trabalha</small>
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
              {context ? "Sobre este lançamento" : "Orientação na Finare"}
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
                  {(context
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
                <small>{message.role === "user" ? "Você" : "Finare"}</small>
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
              placeholder="Pergunte à Finare…"
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
              Sugestões precisam de revisão. A conversa não altera cadastros ou
              lançamentos.
            </small>
          </form>
        </aside>
      )}
    </>,
    host,
  );
}
