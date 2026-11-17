import { LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "./api";
import { Brand } from "./brand";

function Login({ onLogin }: { onLogin: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await api("/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(data)),
      });
      onLogin();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="login-icon" aria-hidden="true">
        <LockKeyhole size={22} strokeWidth={1.75} />
      </div>
      <h1 id="login-title">Entrar na Finare</h1>
      <p>Use suas credenciais para acessar o sistema.</p>
      <fieldset className="fields" disabled={saving}>
        <label>
          Usuário
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="primary" type="submit">
          {saving ? "Entrando…" : "Entrar"}
        </button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function SessionGate({
  children,
}: {
  children: (onLogout?: () => void) => ReactNode;
}) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    const expire = () => setAuthenticated(false);
    window.addEventListener("finare:session-expired", expire);
    void api<{ authenticated: boolean }>("/session", {
      signal: controller.signal,
    })
      .then((state) => setAuthenticated(state.authenticated))
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Não foi possível verificar o acesso à Finare.");
        }
      });
    return () => {
      controller.abort();
      window.removeEventListener("finare:session-expired", expire);
    };
  }, [attempt]);

  async function logout() {
    try {
      await api("/session", { method: "DELETE" });
      setAuthenticated(false);
    } catch {
      setError("Não foi possível sair. Tente novamente.");
    }
  }

  if (import.meta.env.DEV) return children();
  if (authenticated) {
    return (
      <>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {children(logout)}
      </>
    );
  }

  return (
    <main className="login-layout">
      <aside className="login-brand">
        <Brand />
        <p>Inteligência para sua gestão financeira.</p>
      </aside>
      <section className="panel login-panel" aria-label="Acesso à Finare">
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setAttempt((current) => current + 1);
              }}
            >
              Tentar novamente
            </button>
          </>
        ) : authenticated === null ? (
          <p role="status">Verificando acesso…</p>
        ) : (
          <Login onLogin={() => setAuthenticated(true)} />
        )}
      </section>
    </main>
  );
}
