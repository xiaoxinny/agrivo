# Implementation Plan: AgriTech Platform

## Overview

Build a full-stack AgriTech web application as a monorepo with a React/TypeScript frontend (Vite + shadcn/ui + TanStack Query) and a Python FastAPI backend. The frontend serves a public landing page and an authenticated dashboard. The backend provides RESTful APIs proxying AWS Cognito for auth, PostgreSQL for farm data, and S3 for simulation content.

## Tasks

- [x] 1. Set up monorepo structure and tooling
  - [x] 1.1 Initialize root workspace with package.json, .gitignore, and directory scaffold (`/docs`, `/packages/frontend`, `/packages/backend`)
    - Create root `package.json` with npm workspaces pointing to `packages/*`
    - Create `/docs/` directory with a placeholder README
    - Create `/packages/frontend/` and `/packages/backend/` directories
    - _Requirements: 6.1_

  - [x] 1.2 Set up pre-commit hooks with Husky and lint-staged
    - Install Husky and lint-staged in root
    - Configure `.husky/pre-commit` to run linting and formatting
    - Add lint-staged config for TypeScript (ESLint + Prettier) and Python (ruff)
    - _Requirements: 6.2_

  - [x] 1.3 Scaffold frontend project with Vite, React, and TypeScript
    - Initialize Vite project in `packages/frontend` with React-TS template
    - Install dependencies: react-router-dom, @tanstack/react-query, shadcn/ui
    - Create directory structure: `src/components/`, `src/features/`, `src/hooks/`, `src/lib/`, `src/types/`
    - Configure `tsconfig.json` and `vite.config.ts`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.4 Scaffold backend project with FastAPI and Pydantic
    - Create `packages/backend/` with `app/` directory structure: `api/`, `core/`, `models/`, `services/`
    - Create `app/main.py` with FastAPI app instance, CORS middleware, and global exception handler
    - Create `app/core/config.py` with Pydantic BaseSettings (no hardcoded secrets)
    - Create `app/core/deps.py` with dependency injection stubs
    - Create `requirements.txt` and `pyproject.toml`
    - _Requirements: 8.1, 6.3, 3.7_

- [x] 2. Checkpoint - Verify project scaffolding
  - Ensure all directories exist, frontend dev server starts, backend uvicorn starts
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement Landing Page
  - [x] 3.1 Create NavigationBar component with scroll-to-section links and login button
    - Implement sticky top nav with links for: Pricing, Team, About, Contact
    - Each link calls `scrollIntoView({ behavior: 'smooth' })` on the target section
    - Include a Login button that navigates to `/login` via React Router
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 3.2 Create MediaPlaceholder component
    - Accept `alt`, `width`, and `aspectRatio` props
    - Render a styled box preserving the given aspect ratio and dimensions
    - Display the alt text visually inside the placeholder
    - Ensure the rendered element includes the alt text for accessibility
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 3.3 Write property test for MediaPlaceholder alt text presence
    - **Property 2: Media Placeholder Alt Text Presence**
    - For any non-empty alt string, verify the rendered MediaPlaceholder contains that alt text in the DOM
    - **Validates: Requirement 2 (AC 2.2)**

  - [x] 3.4 Create landing page sections: HeroSection, PricingSection, TeamSection, AboutSection, ContactSection
    - Each section renders with a unique `id` attribute matching the nav link targets
    - Use MediaPlaceholder components where images/videos would appear
    - _Requirements: 1.1, 2.1_

  - [x] 3.5 Create LandingPage container that composes NavigationBar and all sections
    - Render NavigationBar at top, then all sections in order
    - Wire up React Router route for `/` to LandingPage
    - _Requirements: 1.1, 1.2_

  - [x]* 3.6 Write example test: Navigation bar links match page sections
    - **Property 1: Navigation Bar Links Match Page Sections**
    - Render LandingPage, extract all nav link hrefs and all section IDs, assert they match exactly
    - **Validates: Requirement 1 (AC 1.1, 1.2)**

- [x] 4. Implement Authentication Module
  - [x] 4.1 Create backend auth endpoints and Cognito integration
    - Implement `app/api/auth.py` with endpoints: POST `/auth/login`, POST `/auth/logout`, POST `/auth/mfa/verify`, POST `/auth/token/refresh`
    - Implement `app/core/security.py` with JWT validation and Cognito client wrapper
    - Store JWT in httpOnly cookies, not localStorage
    - Implement MFA failure counter: lock account after 3 consecutive failures via Cognito admin API
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x]* 4.2 Write edge case test for MFA lockout after three failures
    - **Property 4: MFA Lockout After Three Failures**
    - Simulate sequences of MFA pass/fail attempts, verify account locks after exactly 3 consecutive failures, and resets on success
    - **Validates: Requirement 3 (AC 3.5)**

  - [x] 4.3 Create frontend AuthProvider context and ProtectedRoute
    - Implement `AuthProvider` React context with auth state (unauthenticated, mfa_pending, authenticated)
    - Implement `ProtectedRoute` wrapper that redirects to `/login` if not authenticated
    - Handle session expiry: on token refresh failure, clear state and redirect to `/login`
    - _Requirements: 3.4, 3.6_

  - [x]* 4.4 Write property test for authentication flow state machine
    - **Property 3: Authentication Flow State Machine**
    - Verify state transitions follow: Unauthenticated → Primary Auth → MFA Challenge → Authenticated. No state can be skipped.
    - **Validates: Requirement 3 (AC 3.1–3.4)**

  - [x] 4.5 Create LoginPage with password, OAuth, and passwordless options
    - Render login form with email/password fields
    - Add OAuth login buttons (e.g., Google)
    - Add passwordless login option (magic link / OTP)
    - On successful primary auth, navigate to MFA challenge
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.6 Create MfaChallenge component
    - Render MFA code input form
    - On success, transition to authenticated state and redirect to Dashboard
    - On failure, show error and track attempt count
    - On 3rd failure, show account locked message
    - _Requirements: 3.4, 3.5_

  - [x]* 4.7 Write example test for session expiry redirect
    - **Property 5: Session Expiry Redirect**
    - Set an expired token, attempt to access a protected route, verify redirect to `/login`
    - **Validates: Requirement 3 (AC 3.6)**

- [x] 5. Checkpoint - Verify landing page and auth flow
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Dashboard Module
  - [x] 6.1 Create backend farm data endpoints
    - Implement `app/api/farms.py` with endpoints: GET `/farms/overview`, GET `/farms/sensors`, GET `/farms/alerts`
    - Use Pydantic models for request/response validation
    - Require authenticated user (JWT dependency)
    - Return structured error responses on failure
    - _Requirements: 4.1, 4.2, 8.3, 8.4_

  - [x] 6.2 Create DashboardLayout with sidebar navigation
    - Implement layout shell with sidebar nav (Overview, Sensors, Alerts, Analytics, Simulations)
    - Wrap in ProtectedRoute so only authenticated users can access
    - _Requirements: 4.1_

  - [x] 6.3 Create MetricsOverview, SensorDataWidget, AlertsWidget, and AnalyticsWidget
    - MetricsOverview: summary cards for temperature, humidity, pest alerts
    - SensorDataWidget: chart display for real-time sensor data
    - AlertsWidget: list of active alerts
    - AnalyticsWidget: historical trend charts
    - Use TanStack Query with `refetchInterval` (default 30s) for polling
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 6.4 Write property test for dashboard data polling freshness
    - **Property 6: Dashboard Data Polling Freshness**
    - Mount Dashboard, advance timers by N intervals, verify fetch count equals N+1 (initial + refetches)
    - **Validates: Requirement 4 (AC 4.3)**

  - [x] 6.5 Implement error boundary with retry for dashboard data fetching
    - Show error message when API calls fail
    - Provide a retry button that re-triggers the failed query
    - _Requirements: 4.4_

  - [x]* 6.6 Write edge case test for dashboard error recovery
    - **Property 7: Dashboard Error Recovery**
    - Mock API failure, verify error message renders, click retry, verify new request is made
    - **Validates: Requirement 4 (AC 4.4)**

- [x] 7. Implement Simulation Viewer Module
  - [x] 7.1 Create backend simulation endpoints
    - Implement `app/api/simulations.py` with endpoint: GET `/simulations/{id}`
    - Return simulation metadata and generate S3 signed URLs for media content
    - _Requirements: 5.1_

  - [x] 7.2 Create SimulationViewer component with lazy loading
    - Use `React.lazy()` and dynamic import for the SimulationViewer component
    - Wrap in `<Suspense>` with a loading spinner fallback
    - Render simulation video/image content from signed S3 URLs
    - Implement error boundary with fallback message and retry button on load failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 7.3 Write example test for simulation viewer lazy loading
    - **Property 8: Simulation Viewer Lazy Loading**
    - Verify SimulationViewer uses dynamic import and is not included in the initial bundle
    - **Validates: Requirement 5 (AC 5.4)**

- [x] 8. Checkpoint - Verify dashboard and simulation viewer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Backend validation and error handling hardening
  - [x] 9.1 Implement global exception handler and structured error responses
    - Ensure all unhandled exceptions return `{ "detail": string, "code": string }` JSON
    - Ensure Pydantic validation errors return 422 with detail array
    - Configure CORS to allow only the frontend origin
    - _Requirements: 8.3, 8.4_

  - [x]* 9.2 Write property test for API request validation
    - **Property 9: API Request Validation**
    - For each endpoint, send payloads with missing required fields, wrong types, and out-of-range values. Verify 422 response with detail array.
    - **Validates: Requirement 8 (AC 8.3)**

  - [x]* 9.3 Write edge case test for API error response structure
    - **Property 10: API Error Response Structure**
    - Trigger 404, 500, and validation errors. Verify all responses match `{ "detail": string, "code": string }` schema.
    - **Validates: Requirement 8 (AC 8.4)**

- [x] 10. Responsive design and final wiring
  - [x] 10.1 Implement responsive design across all pages
    - Ensure Landing Page, Login, and Dashboard render correctly on desktop and mobile viewports
    - Use shadcn/ui responsive utilities and CSS media queries
    - _Requirements: 7.4_

  - [x] 10.2 Wire all routes together in App.tsx
    - `/` → LandingPage
    - `/login` → LoginPage
    - `/mfa` → MfaChallenge
    - `/dashboard/*` → DashboardLayout (protected)
    - `/dashboard/simulations/:id` → SimulationViewer (protected, lazy)
    - _Requirements: 1.4, 3.6, 4.1, 5.4_

  - [x] 10.3 Add code comments and documentation
    - Add JSDoc/TSDoc comments to all exported components and hooks
    - Add docstrings to all FastAPI endpoints and service functions
    - Update `/docs/` with architecture overview and setup instructions
    - _Requirements: 6.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Frontend uses TypeScript with React; backend uses Python with FastAPI
- Property tests validate universal correctness properties from the design document
- Unit/edge case tests validate specific scenarios and error conditions
