# Design Document

## Overview

The AgriTech Platform is a full-stack web application structured as a monorepo. It consists of a React.js single-page application (frontend) and a Python FastAPI backend API. The frontend serves both as a public marketing landing page and an authenticated dashboard for farm monitoring. The backend provides RESTful APIs for authentication, farm data, and simulation content. AWS-managed services handle database, storage, and infrastructure concerns.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   Client Browser                 │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Landing Page │  │ Auth UI  │  │ Dashboard  │  │
│  └──────┬──────┘  └────┬─────┘  └─────┬──────┘  │
│         └───────────────┼──────────────┘         │
│                    React SPA                      │
│              (TanStack Query + shadcn/ui)         │
└────────────────────┬────────────────────────────┘
                     │ HTTPS / REST
┌────────────────────┴────────────────────────────┐
│                 FastAPI Backend                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Auth API │  │ Farm API │  │ Simulation API│  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
└───────┼──────────────┼────────────────┼──────────┘
        │              │                │
┌───────┴──────┐ ┌─────┴─────┐  ┌──────┴───────┐
│  AWS Cognito │ │ Amazon RDS│  │  Amazon S3   │
│  (Auth)      │ │ (Postgres)│  │ (Media/Sims) │
└──────────────┘ └───────────┘  └──────────────┘
```

### Monorepo Structure

```
/
├── docs/                          # Project documentation
├── packages/
│   ├── frontend/                  # React SPA
│   │   ├── src/
│   │   │   ├── components/        # Shared UI components
│   │   │   ├── features/          # Feature modules (landing, auth, dashboard)
│   │   │   ├── hooks/             # Custom React hooks
│   │   │   ├── lib/               # Utilities, API client, config
│   │   │   ├── types/             # TypeScript type definitions
│   │   │   └── App.tsx            # Root component with routing
│   │   ├── public/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── backend/
│       ├── app/
│       │   ├── api/               # Route handlers
│       │   ├── core/              # Config, security, dependencies
│       │   ├── models/            # SQLAlchemy / Pydantic models
│       │   ├── services/          # Business logic layer
│       │   └── main.py            # FastAPI app entry point
│       ├── tests/
│       ├── requirements.txt
│       └── pyproject.toml
├── .husky/                        # Pre-commit hooks
├── package.json                   # Root workspace config
└── .github/                       # CI/CD workflows
```

## Components

### 1. Landing Page Module

Handles the public-facing marketing page with sectioned layout and smooth-scroll navigation.

**Key Components:**
- `LandingPage` — Page container rendering all sections in order
- `NavigationBar` — Sticky top nav with scroll-to-section links and login button
- `HeroSection`, `PricingSection`, `TeamSection`, `AboutSection`, `ContactSection` — Individual content sections
- `MediaPlaceholder` — Reusable placeholder component with alt text and aspect ratio preservation

**Behavior:**
- Navigation links use anchor-based smooth scrolling (`scrollIntoView({ behavior: 'smooth' })`)
- Login button routes to `/login` via React Router
- MediaPlaceholder accepts `alt`, `width`, and `aspectRatio` props and renders a styled box

### 2. Authentication Module

Manages user authentication with multiple methods and MFA.

**Key Components:**
- `LoginPage` — Renders login form with password, OAuth, and passwordless options
- `MfaChallenge` — MFA verification step after primary auth
- `AuthProvider` — React context providing auth state and methods
- `ProtectedRoute` — Route wrapper that redirects unauthenticated users

**Backend:**
- AWS Cognito handles user pools, OAuth federation, and MFA
- FastAPI auth endpoints act as a thin proxy to Cognito APIs
- JWT tokens stored in httpOnly cookies (no localStorage for tokens)
- Session expiry detected via token refresh failure → redirect to login

**MFA Lock Logic:**
- Backend tracks consecutive MFA failures per user session
- After 3 consecutive failures, the account is locked via Cognito admin API
- User receives a notification (email) with unlock instructions

### 3. Dashboard Module

Authenticated area for farm monitoring and analytics.

**Key Components:**
- `DashboardLayout` — Layout shell with sidebar navigation
- `MetricsOverview` — Summary cards for key farm metrics (temperature, humidity, pest alerts)
- `SensorDataWidget` — Real-time sensor data display with charts
- `AlertsWidget` — Active alerts and notifications
- `AnalyticsWidget` — Historical data and trend analysis

**Data Fetching:**
- TanStack Query with `refetchInterval` for polling (configurable, default 30s)
- Query keys scoped per farm/sensor for granular cache invalidation
- Error boundaries with retry UI on fetch failure

### 4. Simulation Viewer Module

Lightweight rendering of simulation content (NVIDIA Isaac Sim outputs).

**Key Components:**
- `SimulationViewer` — Lazy-loaded component (`React.lazy`) for simulation display
- Renders pre-recorded simulation videos or image sequences from S3
- Uses `<Suspense>` with a loading spinner fallback
- Error boundary catches load failures and shows retry option

**Performance Strategy:**
- Lazy loading via dynamic import to avoid bundling simulation code in initial load
- Media streamed from S3 via signed URLs
- No client-side heavy rendering — simulations are pre-rendered server-side

### 5. Backend API Layer

FastAPI application providing RESTful endpoints.

**Key Modules:**
- `app/api/auth.py` — Auth endpoints (login, logout, MFA verify, token refresh)
- `app/api/farms.py` — Farm data CRUD and sensor readings
- `app/api/simulations.py` — Simulation content metadata and signed URL generation
- `app/core/config.py` — Settings via Pydantic BaseSettings (env vars, no hardcoded secrets)
- `app/core/deps.py` — Dependency injection (DB sessions, auth verification, service instances)
- `app/core/security.py` — JWT validation, Cognito integration

**Request Handling:**
- Pydantic models for request/response validation (automatic 422 on invalid payloads)
- Global exception handler returns structured JSON errors: `{ "detail": string, "code": string }`
- CORS configured for frontend origin only

### 6. Infrastructure

**AWS Services:**
- Amazon Cognito — User authentication, OAuth, MFA
- Amazon RDS (PostgreSQL) — Farm data, sensor readings, user preferences
- Amazon S3 — Media assets, simulation content, static files
- AWS CloudFront — CDN for frontend static assets and S3 media

**Configuration:**
- All secrets via environment variables (AWS Secrets Manager in production)
- Infrastructure defined as code (AWS CDK or CloudFormation in `/docs/infra/`)

## Correctness Properties

### Property 1: Navigation Bar Links Match Page Sections

Every link in the NavigationBar must correspond to an existing section on the LandingPage. If a section is added or removed, the nav links must stay in sync.

- **Test Type:** Example
- **Covers:** Requirement 1 (AC 1.1, 1.2)
- **Verification:** Render LandingPage, extract all nav link hrefs and all section IDs, assert they match exactly.

### Property 2: Media Placeholder Alt Text Presence

Every MediaPlaceholder component must render with non-empty alt text for accessibility.

- **Test Type:** Property
- **Covers:** Requirement 2 (AC 2.2)
- **Verification:** For any MediaPlaceholder rendered with a given alt prop, the output DOM element contains that alt text.

### Property 3: Authentication Flow State Machine

The auth flow must follow a valid state progression: Unauthenticated → Primary Auth → MFA Challenge → Authenticated. No state can be skipped.

- **Test Type:** Property
- **Covers:** Requirement 3 (AC 3.1–3.4)
- **Verification:** Simulate auth flows and verify state transitions follow the defined order. No transition from Unauthenticated directly to Authenticated.

### Property 4: MFA Lockout After Three Failures

After exactly 3 consecutive failed MFA attempts, the account must be locked. Fewer than 3 failures must not lock. A successful attempt resets the counter.

- **Test Type:** Edge Case
- **Covers:** Requirement 3 (AC 3.5)
- **Verification:** Simulate sequences of MFA attempts (pass/fail combinations) and verify lock state matches expected outcome.

### Property 5: Session Expiry Redirect

When a user's session token expires or becomes invalid, the application must redirect to the login page without exposing authenticated content.

- **Test Type:** Example
- **Covers:** Requirement 3 (AC 3.6)
- **Verification:** Set an expired token, attempt to access a protected route, verify redirect to `/login`.

### Property 6: Dashboard Data Polling Freshness

While the Dashboard is mounted, data queries must refetch at the configured polling interval.

- **Test Type:** Property
- **Covers:** Requirement 4 (AC 4.3)
- **Verification:** Mount Dashboard, advance timers by N intervals, verify fetch count equals N+1 (initial + refetches).

### Property 7: Dashboard Error Recovery

When the backend returns an error for a dashboard data request, the UI must show an error state with a functional retry mechanism.

- **Test Type:** Edge Case
- **Covers:** Requirement 4 (AC 4.4)
- **Verification:** Mock API failure, verify error message renders, click retry, verify new request is made.

### Property 8: Simulation Viewer Lazy Loading

The SimulationViewer bundle must not be included in the initial page load. It must only load when the user navigates to a simulation view.

- **Test Type:** Example
- **Covers:** Requirement 5 (AC 5.4)
- **Verification:** Analyze bundle output or verify dynamic import is used for SimulationViewer component.

### Property 9: API Request Validation

All FastAPI endpoints must reject invalid request payloads with a 422 status code and a structured error response.

- **Test Type:** Property
- **Covers:** Requirement 8 (AC 8.3)
- **Verification:** For any endpoint, send payloads with missing required fields, wrong types, or out-of-range values. Verify 422 response with detail array.

### Property 10: API Error Response Structure

All backend error responses must follow a consistent JSON structure with `detail` and `code` fields.

- **Test Type:** Edge Case
- **Covers:** Requirement 8 (AC 8.4)
- **Verification:** Trigger various error conditions (404, 500, validation errors) and verify response body matches `{ "detail": string, "code": string }` schema.
