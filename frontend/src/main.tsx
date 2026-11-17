import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [message, setMessage] = useState("Verificando conexão com o banco…");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        if (!response.ok) throw new Error("Serviço indisponível");

        setMessage("API e banco de dados disponíveis.");
      } catch {
        if (!controller.signal.aborted) {
          setMessage("Não foi possível conectar à API ou ao banco de dados.");
        }
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, [attempt]);

  return (
    <main>
      <h1>Auto Visão Financeiro</h1>
      <p>Conciliação bancária e fluxo de caixa</p>
      <p role="status">{message}</p>
      <button
        type="button"
        onClick={() => {
          setMessage("Verificando conexão com o banco…");
          setAttempt((value) => value + 1);
        }}
      >
        Verificar conexão
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
