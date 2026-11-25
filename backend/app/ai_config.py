"""Configuração compartilhada da IA; nunca expor credenciais na API ou nos logs."""

import os


def api_key():
    # Nome canônico prioritário; compatibilidade com configuração existente no Railway.
    return (os.environ.get("OPENAI_API_KEY") or "").strip() or (
        os.environ.get("OPEN_API_KEY") or ""
    ).strip()
