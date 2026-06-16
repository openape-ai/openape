"""LiteLLM custom_auth hook for the llms.openape.ai gateway.

Accepts two kinds of bearer credential:
  1. The LiteLLM master_key  -> admin/full access (the migration safety net; the
     16 live agents keep using this until they're switched to DDISA tokens).
  2. A DDISA-exchanged HS256 token (aud=iss=llms.openape.ai, typ=cli) minted by
     the exchange front-end from an agent's IdP token. Validated here against the
     SAME shared SESSION_SECRET (no DB, no JWKS) -> per-agent identity (sub).

HS256 is verified with the stdlib only (hmac/hashlib) so there is no third-party
JWT dependency to rely on inside the stock LiteLLM image.
"""

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Request
from litellm.proxy._types import UserAPIKeyAuth

_SECRET = os.environ["SESSION_SECRET"].encode("utf-8")
_MASTER = os.environ.get("LITELLM_MASTER_KEY", "")
_AUD = "llms.openape.ai"
_ISS = "llms.openape.ai"
# Per-agent policy. Static for now (no DB); M3 can route per owner/account.
_ALLOWED_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"]


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


async def user_api_key_auth(request: Request, api_key: str) -> UserAPIKeyAuth:
    token = api_key.replace("Bearer ", "").strip()
    if _MASTER and hmac.compare_digest(token, _MASTER):
        return UserAPIKeyAuth(api_key=token)  # admin / master
    claims = _verify_hs256(token)  # raises on any failure -> 401
    return UserAPIKeyAuth(
        api_key=token,
        user_id=claims["sub"],
        user_email=claims.get("email"),
        models=_ALLOWED_MODELS,
    )
