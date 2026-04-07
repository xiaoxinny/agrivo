"""Authentication endpoints — OIDC Authorization Code Flow with Cognito."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.core.deps import get_current_user, get_settings
from app.core.security import (
    TokenExchangeError,
    exchange_code_for_tokens,
    parse_id_token_claims,
    refresh_tokens,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------


class CallbackRequest(BaseModel):
    """POST /api/auth/callback request body."""

    code: str
    code_verifier: str


class UserProfile(BaseModel):
    """User profile extracted from Cognito ID token."""

    id: str
    email: str
    name: str | None = None


class AuthResponse(BaseModel):
    """Response containing user profile after successful auth."""

    user: UserProfile


class LogoutResponse(BaseModel):
    """Response from logout endpoint."""

    logout_url: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

_COOKIE_SETTINGS: dict = {
    "httponly": True,
    "secure": True,
    "samesite": "lax",
}

ACCESS_TOKEN_COOKIE = "access_token"
REFRESH_TOKEN_COOKIE = "refresh_token"

# JWTs are three base64url-encoded segments separated by dots — no whitespace
# or control characters.  Validating before writing to a cookie header prevents
# injection if an upstream response were unexpectedly malformed.
_JWT_RE = re.compile(r"^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*$")

# Cognito refresh tokens are opaque strings (not JWTs) — allow
# alphanumeric, hyphens, underscores, dots, and plus signs.
_OPAQUE_TOKEN_RE = re.compile(r"^[A-Za-z0-9\-_\.+/=]+$")


def _safe_token(value: str, name: str) -> str:
    """Raise ValueError if *value* contains unsafe characters."""
    if _JWT_RE.match(value) or _OPAQUE_TOKEN_RE.match(value):
        return value
    raise ValueError(f"Unexpected format for {name}")


def _set_auth_cookies(response: Response, tokens: dict) -> None:
    """Set httpOnly auth cookies on the response."""
    max_age = tokens.get("expires_in", 3600)

    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=_safe_token(tokens["access_token"], ACCESS_TOKEN_COOKIE),
        max_age=max_age,
        **_COOKIE_SETTINGS,
    )
    if tokens.get("refresh_token"):
        response.set_cookie(
            key=REFRESH_TOKEN_COOKIE,
            value=_safe_token(tokens["refresh_token"], REFRESH_TOKEN_COOKIE),
            max_age=2592000,  # 30 days
            **_COOKIE_SETTINGS,
        )


def _clear_auth_cookies(response: Response) -> None:
    """Remove auth cookies."""
    response.delete_cookie(key=ACCESS_TOKEN_COOKIE, **_COOKIE_SETTINGS)
    response.delete_cookie(key=REFRESH_TOKEN_COOKIE, **_COOKIE_SETTINGS)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/callback", response_model=AuthResponse)
async def callback(body: CallbackRequest, response: Response) -> AuthResponse:
    """Exchange an authorization code for tokens and set auth cookies.

    Accepts the authorization code and PKCE code_verifier from the frontend,
    exchanges them at the Cognito token endpoint, validates the ID token,
    sets httpOnly cookies, and returns the user profile.
    """
    try:
        tokens = await exchange_code_for_tokens(body.code, body.code_verifier)
    except TokenExchangeError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        logger.exception("Cognito token endpoint unreachable")
        raise HTTPException(
            status_code=502,
            detail="Authentication service unavailable",
        ) from exc

    try:
        profile = parse_id_token_claims(tokens["id_token"], access_token=tokens["access_token"])
    except Exception as exc:
        logger.exception("ID token validation failed")
        raise HTTPException(status_code=401, detail="Invalid ID token") from exc

    _set_auth_cookies(response, tokens)

    return AuthResponse(
        user=UserProfile(
            id=profile["id"],
            email=profile["email"],
            name=profile.get("name"),
        )
    )


@router.post("/token/refresh", response_model=AuthResponse)
async def token_refresh(request: Request, response: Response) -> AuthResponse:
    """Refresh the access token using the refresh token cookie."""
    refresh_tok = request.cookies.get(REFRESH_TOKEN_COOKIE)
    if not refresh_tok:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        new_tokens = await refresh_tokens(refresh_tok)
    except (TokenExchangeError, httpx.HTTPError) as exc:
        logger.exception("Token refresh failed")
        raise HTTPException(status_code=401, detail="Token refresh failed") from exc

    # Parse the new ID token to get user profile
    try:
        profile = parse_id_token_claims(new_tokens["id_token"], access_token=new_tokens["access_token"])
    except Exception as exc:
        logger.exception("ID token validation failed after refresh")
        raise HTTPException(status_code=401, detail="Token refresh failed") from exc

    # Update the access token cookie
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=_safe_token(new_tokens["access_token"], ACCESS_TOKEN_COOKIE),
        max_age=new_tokens.get("expires_in", 3600),
        **_COOKIE_SETTINGS,
    )

    return AuthResponse(
        user=UserProfile(
            id=profile["id"],
            email=profile["email"],
            name=profile.get("name"),
        )
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(response: Response, settings=Depends(get_settings)) -> LogoutResponse:
    """Clear authentication cookies and return the Cognito logout URL."""
    _clear_auth_cookies(response)

    logout_url = (
        f"https://{settings.COGNITO_DOMAIN}/logout"
        f"?client_id={settings.COGNITO_CLIENT_ID}"
        f"&logout_uri={settings.FRONTEND_URL}"
    )

    return LogoutResponse(logout_url=logout_url)


@router.get("/me", response_model=AuthResponse)
async def me(claims: dict[str, Any] = Depends(get_current_user)) -> AuthResponse:
    """Return the current user's profile from the JWT claims."""
    return AuthResponse(
        user=UserProfile(
            id=claims["sub"],
            email=claims["email"],
            name=claims.get("name"),
        )
    )