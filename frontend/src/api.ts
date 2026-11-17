export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    if (typeof detail === "string") throw new Error(detail);
    if (Array.isArray(detail)) {
      throw new Error("Confira o preenchimento dos campos e tente novamente.");
    }
    throw new Error("Não foi possível concluir a operação. Tente novamente.");
  }

  return response.status === 204 ? (undefined as T) : response.json();
}
