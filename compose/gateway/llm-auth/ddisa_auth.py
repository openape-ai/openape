"""LiteLLM custom_auth hook for the llms.openape.ai gateway.

Accepts ONLY a DDISA-exchanged HS256 token (aud=iss=llms.openape.ai, typ=cli)
minted by the exchange front-end from an agent's IdP token. Validated here
against the SAME shared SESSION_SECRET (no DB, no JWKS) -> per-agent identity
(sub). The gateway is DDISA-only: the LiteLLM master_key is NOT accepted for
inference (the migration admin-net was removed); litellm still requires a
master_key set for its own admin surface, but it grants no access here.

HS256 is verified with the stdlib only (hmac/hashlib) so there is no third-party
JWT dependency to rely on inside the stock LiteLLM image.

M3 multi-account: the path-selector shim forwards the requested upstream account
as the `x-openape-account` header. The per-key `models` allowlist returned here
IS the access boundary: a caller only ever gets the models of an account they're
allowed on, so they can't reach a foreign account's deployment even by sending
the namespaced model on the default path.
"""

import base64
import hashlib
import hmac
import json
import os
import time

_SECRET = os.environ["SESSION_SECRET"].encode("utf-8")
_AUD = "llms.openape.ai"
_ISS = "llms.openape.ai"

# The default account's model set = the self-hosted headwai LocalCore models,
# the only unprefixed model_names litellm serves on the plain /v1 path.
_MODELS = ["LocalCore-Instant", "LocalCore-Thinking"]
# Accounts whose upstream serves a different model set than the default.
_ACCOUNT_MODELS = {
    "headwai": ["LocalCore-Instant", "LocalCore-Thinking"],
    "delta-mind": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
}
# The default account (plain /v1, no x-openape-account header). Ungated — any
# authenticated DDISA token gets it; named accounts above still need a grant.
# (Was "lindeverlag", now retired: it is no longer the default label and its
# codex upstream is removed from the gateway.)
_DEFAULT_ACCOUNT = "default"


def _b64url_decode(seg: str) -> bytes:
    return base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))


def _verify_hs256(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("malformed token")
    header = json.loads(_b64url_decode(parts[0]))
    if header.get("alg") != "HS256":
        raise ValueError("unexpected alg")
    expected = hmac.new(_SECRET, f"{parts[0]}.{parts[1]}".encode("utf-8"), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64url_decode(parts[2]), expected):
        raise ValueError("bad signature")
    claims = json.loads(_b64url_decode(parts[1]))
    now = int(time.time())
    if int(claims.get("exp", 0)) < now:
        raise ValueError("expired")
    if claims.get("aud") != _AUD or claims.get("iss") != _ISS:
        raise ValueError("aud/iss mismatch")
    if claims.get("typ") != "cli":
        raise ValueError("not a cli token")
    sub = claims.get("sub")
    if not isinstance(sub, str) or "@" not in sub:
        raise ValueError("sub must be an email")
    return claims


def models_for_account(account: str) -> list:
    base = _ACCOUNT_MODELS.get(account, _MODELS)
    if account == _DEFAULT_ACCOUNT:
        return list(base)
    return [f"{account}/{m}" for m in base]


def resolve_models(account: str, accounts) -> list:
    """Authorize `account` against the token's owner-granted `accounts` claim
    and return the model allowlist. `accounts` is the list the exchange stamped
    from the agent's DDISA standing grants; '*' = any account. A token without
    the claim (`accounts is None`) is rejected — the grace window for legacy
    pre-enrichment tokens was removed once every agent re-exchanged."""
    if accounts is None:
        raise ValueError("token missing accounts claim (legacy) - re-exchange required")
    # The default account is the baseline every authenticated agent gets — no
    # per-account grant needed. Named accounts still require an explicit grant.
    if account == _DEFAULT_ACCOUNT:
        return models_for_account(account)
    if account in accounts or "*" in accounts:
        return models_for_account(account)
    raise ValueError(f"no grant for account {account}")


async def user_api_key_auth(request, api_key: str):
    # litellm/fastapi imported lazily so the policy self-check runs stdlib-only.
    from litellm.proxy._types import UserAPIKeyAuth

    token = (api_key or "").replace("Bearer ", "").strip()
    claims = _verify_hs256(token)  # raises on any failure -> 401
    account = (request.headers.get("x-openape-account") or _DEFAULT_ACCOUNT).lower()
    accounts = claims.get("accounts")
    if accounts is not None and not isinstance(accounts, list):
        accounts = []  # malformed claim -> deny everything (no grant)

    models = resolve_models(account, accounts)  # raises -> 401 without a grant

    return UserAPIKeyAuth(
        api_key=token,
        user_id=claims["sub"],
        user_email=claims.get("email"),
        models=models,
    )


if __name__ == "__main__":
    # Self-check (pure-function policy). Run: python3 ddisa_auth.py
    _CODEX = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"]
    # default account -> unprefixed LocalCore, ungated for any non-legacy token
    assert models_for_account("default") == ["LocalCore-Instant", "LocalCore-Thinking"]
    assert resolve_models("default", []) == ["LocalCore-Instant", "LocalCore-Thinking"]
    assert resolve_models("default", ["headwai"]) == ["LocalCore-Instant", "LocalCore-Thinking"]
    # named accounts -> prefixed, require an explicit grant
    assert models_for_account("delta-mind") == [f"delta-mind/{m}" for m in _CODEX]
    assert models_for_account("headwai") == ["headwai/LocalCore-Instant", "headwai/LocalCore-Thinking"]
    assert resolve_models("headwai", ["headwai"]) == ["headwai/LocalCore-Instant", "headwai/LocalCore-Thinking"]
    assert resolve_models("delta-mind", ["delta-mind"]) == [f"delta-mind/{m}" for m in _CODEX]
    # wildcard grant -> any named account
    assert resolve_models("delta-mind", ["*"]) == [f"delta-mind/{m}" for m in _CODEX]
    # named account without a grant -> denied
    for account, accounts in [("delta-mind", ["headwai"]), ("delta-mind", []), ("headwai", [])]:
        try:
            resolve_models(account, accounts)
            raise SystemExit(f"FAIL: {account} allowed with {accounts}")
        except ValueError:
            pass
    # legacy token (no accounts claim) -> rejected even for the default account
    for account in ("default", "delta-mind", "headwai"):
        try:
            resolve_models(account, None)
            raise SystemExit(f"FAIL: {account} allowed with None accounts")
        except ValueError:
            pass
    print("ddisa_auth.py: all policy checks passed")


# --- Reasoning-strip pre-call hook -------------------------------------------
# litellm routes a request carrying BOTH `tools` and `reasoning_effort` to the
# provider's /v1/responses endpoint; codex-proxy only implements
# /v1/chat/completions -> 404 "not found". codex-proxy ignores reasoning anyway,
# so strip reasoning_effort/reasoning here (before litellm picks the endpoint)
# to keep every request on /chat/completions. Guarded so the standalone policy
# self-test (no litellm installed) still imports.
try:
    from litellm.integrations.custom_logger import CustomLogger as _CL

    class _ReasoningStrip(_CL):
        async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
            if isinstance(data, dict):
                data.pop("reasoning_effort", None)
                data.pop("reasoning", None)
            return data

    proxy_handler_instance = _ReasoningStrip()
except Exception:
    proxy_handler_instance = None
