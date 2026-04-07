"""JWT validation and Cognito OIDC token helpers."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx
from jose import JWTError, jwk, jwt

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JWKS cache (module-level, thread-safe)
# ---------------------------------------------------------------------------
_jwks_cache: dict[str, Any] = {}
_jwks_lock = threading.Lock()
_JWKS_TTL_SECONDS = 3600  # re-fetch keys every hour


def _jwks_url(settings: Settings) -> str:
    """Derive the Cognito JWKS URL from pool config."""
    return (
        f"https://cognito-idp.{settings.AWS_REGION}.amazonaws.com/"
        f"{settings.COGNITO_USER_POOL_ID}/.well-known/jwks.json"
    )


def _get_jwks(settings: Settings, *, force_refresh: bool = False) -> dict[str, Any]:
    """Return cached JWKS keys, refreshing if stale or forced."""
    global _jwks_cache  # noqa: PLW0603

    if not force_refresh:
        with _jwks_lock:
            if (
                _jwks_cache.get("keys")
                and time.time() - _jwks_cache.get("fetched_at", 0) < _JWKS_TTL_SECONDS
            ):
                return _jwks_cache

    url = _jwks_url(settings)
    resp = httpx.get(url, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    with _jwks_lock:
        _jwks_cache = {"keys": data["keys"], "fetched_at": time.time()}
    return _jwks_cache


def _find_key(jwks: dict[str, Any], kid: str) -> dict[str, Any] | None:
    """Find a key by kid in the JWKS keyset."""
    for k in jwks["keys"]:
        if k["kid"] == kid:
            return k
    return None


def validate_token(
    token: str,
    settings: Settings | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    """Validate a Cognito-issued JWT and return its claims.

    If the token's ``kid`` is not found in the cached JWKS, the cache is
    refreshed once before rejecting the token.

    Pass *access_token* when validating an ID token that contains an
    ``at_hash`` claim so that ``python-jose`` can verify the hash.

    Raises ``JWTError`` when the token is invalid or expired.
    """
    if settings is None:
        settings = get_settings()

    jwks = _get_jwks(settings)
    headers = jwt.get_unverified_headers(token)
    kid = headers.get("kid")

    key_data = _find_key(jwks, kid)

    # Unknown kid — force a single cache refresh and retry
    if key_data is None:
        jwks = _get_jwks(settings, force_refresh=True)
        key_data = _find_key(jwks, kid)

    if key_data is None:
        raise JWTError("Public key not found in JWKS")

    public_key = jwk.construct(key_data)

    issuer = (
        f"https://cognito-idp.{settings.AWS_REGION}.amazonaws.com/{settings.COGNITO_USER_POOL_ID}"
    )

    claims = jwt.decode(
        token,
        public_key.to_dict(),
        algorithms=["RS256"],
        audience=settings.COGNITO_CLIENT_ID,
        issuer=issuer,
        access_token=access_token,
    )
    return claims


# ---------------------------------------------------------------------------
# OIDC token exchange helpers
# ---------------------------------------------------------------------------


class TokenExchangeError(Exception):
    """Raised when a Cognito token endpoint request fails."""


async def exchange_code_for_tokens(
    code: str,
    code_verifier: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Exchange an authorization code for tokens at the Cognito token endpoint.

    Returns a dict with ``access_token``, ``id_token``, ``refresh_token``,
    and ``expires_in``.

    Raises ``TokenExchangeError`` if the response is not 200.
    """
    if settings is None:
        settings = get_settings()

    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": settings.COGNITO_REDIRECT_URI,
        "client_id": settings.COGNITO_CLIENT_ID,
    }
    if settings.COGNITO_CLIENT_SECRET:
        data["client_secret"] = settings.COGNITO_CLIENT_SECRET

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.cognito_token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )

    if resp.status_code != 200:
        logger.error("Token exchange failed with status %s", resp.status_code)
        raise TokenExchangeError(f"Token exchange failed with status {resp.status_code}")

    return resp.json()


async def refresh_tokens(
    refresh_token: str,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Refresh tokens using the Cognito OIDC token endpoint.

    Returns a dict with ``access_token``, ``id_token``, and ``expires_in``.

    Raises ``TokenExchangeError`` if the response is not 200.
    """
    if settings is None:
        settings = get_settings()

    data: dict[str, str] = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": settings.COGNITO_CLIENT_ID,
    }
    if settings.COGNITO_CLIENT_SECRET:
        data["client_secret"] = settings.COGNITO_CLIENT_SECRET

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.cognito_token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )

    if resp.status_code != 200:
        logger.error("Token refresh failed with status %s", resp.status_code)
        raise TokenExchangeError(f"Token refresh failed with status {resp.status_code}")

    return resp.json()


def parse_id_token_claims(
    id_token: str,
    settings: Settings | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    """Validate an ID token and extract user profile claims.

    Returns a dict with ``id`` (from ``sub``), ``email``, and ``name``
    (or ``None`` if the name claim is absent).
    """
    claims = validate_token(id_token, settings, access_token=access_token)
    return {
        "id": claims["sub"],
        "email": claims["email"],
        "name": claims.get("name"),
    }
