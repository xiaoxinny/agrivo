# Deploying AgriTech Platform on Coolify

Coolify is a self-hosted PaaS that deploys applications from Git repositories using Docker. This guide covers deploying the AgriTech Platform monorepo as a Docker Compose stack on Coolify.

## Architecture

This is a single-page application (SPA). The frontend is a static React bundle served by nginx — all routing happens client-side via React Router. The backend is a standalone FastAPI REST API that the SPA calls over HTTPS. There is no server-side rendering.

PostgreSQL runs locally on the same Coolify server, managed by Coolify's built-in database support. Authentication uses the OIDC Authorization Code Flow via the Cognito Hosted UI. S3 stores simulation media.

```
Browser (SPA)  ──redirect──▶  Cognito Hosted UI
    │                              │
    │◀──── redirect with code ─────┘
    │
    └──── POST /api/auth/callback ──▶  FastAPI (Gunicorn + Uvicorn)
                                            │
                                  ┌─────────┼──────────┐
                                  ▼         ▼          ▼
                             Cognito    PostgreSQL     S3
                          /oauth2/token  (Coolify)   (AWS)
```

| Service      | Image         | Port | Description                              |
| ------------ | ------------- | ---- | ---------------------------------------- |
| `frontend`   | nginx:1.27    | 80   | Serves the built React SPA               |
| `backend`    | python:3.12   | 8000 | FastAPI served via Gunicorn + Uvicorn     |
| `postgresql` | postgres:16   | 5432 | Managed by Coolify (not in compose file)  |

## Prerequisites

- A Coolify instance (v4+) with a connected server
- A Git repository (GitHub, GitLab, or Gitea) containing this project
- An AWS account with access to Cognito and S3
- (Optional) AWS CLI installed and configured locally

---

## Part 1: AWS Service Setup

Complete these steps before deploying to Coolify. Each step includes both AWS Console (GUI) and CLI instructions. All resources target `ap-southeast-1` (Singapore).

### 1.1 Create a Cognito User Pool

Cognito handles all authentication: password login, OAuth, passwordless, and MFA.

#### Console (GUI)

1. Open the [Amazon Cognito console](https://console.aws.amazon.com/cognito/v2/idp/user-pools) and ensure the region is set to **Asia Pacific (Singapore) ap-southeast-1**
2. Click **Create user pool**
3. Under **Application type**, select **Traditional web application**
4. Name the application `agritech-web-client`
5. Under **Options for sign-in identifiers**, select **Email**
6. Under **Required attributes for sign-up**, keep **email** selected
7. For **Return URL**, enter `https://agritech.example.com/auth/callback` (your frontend domain — you can change this later)
8. Click **Create**
9. From the **User pool overview** page, note the **User pool ID** (e.g., `ap-southeast-1_AbCdEfGhI`) — this is your `COGNITO_USER_POOL_ID`
10. Go to **App clients** in the left sidebar, click your app client, and note the **Client ID** — this is your `COGNITO_CLIENT_ID`

Now enable MFA:

11. Go to **Sign-in** → **Multi-factor authentication**
12. Set MFA enforcement to **Optional**
13. Under MFA methods, enable **Authenticator apps (TOTP)**
14. Click **Save changes**

Configure password policy:

15. Go to **Sign-in** → **Password policy**
16. Set minimum length to **8**, require uppercase, lowercase, and numbers
17. Click **Save changes**

#### CLI

```bash
aws cognito-idp create-user-pool \
  --pool-name agritech-user-pool \
  --auto-verified-attributes email \
  --username-attributes email \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration Enabled=true \
  --password-policy MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false \
  --account-recovery-setting "RecoveryMechanisms=[{Priority=1,Name=verified_email}]" \
  --schema '[{"Name":"email","Required":true,"Mutable":true}]' \
  --region ap-southeast-1
```

Note the `UserPool.Id` from the output — this is your `COGNITO_USER_POOL_ID`.

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id <POOL_ID> \
  --client-name agritech-web-client \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
  --supported-identity-providers COGNITO \
  --prevent-user-existence-errors ENABLED \
  --region ap-southeast-1
```

Note the `UserPoolClient.ClientId` — this is your `COGNITO_CLIENT_ID`.

#### 1.1.1 Configure Cognito Hosted UI Domain

The Hosted UI requires a domain prefix. This is a separate domain from the Cognito issuer URL — Cognito has two different URL patterns:

- **Issuer URL**: `https://cognito-idp.{region}.amazonaws.com/{pool_id}` — used internally for JWT validation and OIDC discovery. You don't need to configure this; it's derived from `AWS_REGION` + `COGNITO_USER_POOL_ID`.
- **Hosted UI domain**: `https://{prefix}.auth.{region}.amazoncognito.com` — the actual login page where users authenticate, and where the `/oauth2/authorize`, `/oauth2/token`, and `/logout` endpoints live. This is what `COGNITO_DOMAIN` refers to, and you must create it explicitly.

> **Note:** If you've seen the Flask `authlib` example from AWS docs, the `authority` and `server_metadata_url` fields use the issuer URL, not the Hosted UI domain. Our app uses both: the issuer URL for token validation, and the Hosted UI domain for login redirects and token exchange.

##### Console (GUI)

1. Go to your user pool → **App integration** → **Domain**
2. Click **Actions** → **Create Cognito domain**
3. Enter a domain prefix (e.g., `agrivo`)
4. Click **Create**
5. Note the full domain: `agrivo.auth.ap-southeast-1.amazoncognito.com` — this is your `COGNITO_DOMAIN` (without `https://`)

##### CLI

```bash
aws cognito-idp create-user-pool-domain \
  --user-pool-id <POOL_ID> \
  --domain agrivo \
  --region ap-southeast-1
```

The full domain will be: `agrivo.auth.ap-southeast-1.amazoncognito.com`

You can verify it's working by visiting `https://agrivo.auth.ap-southeast-1.amazoncognito.com/.well-known/openid-configuration` in your browser — it should return a JSON document with the OIDC endpoints.

### 1.2 (Optional) Add Google OAuth Provider

#### Console (GUI)

1. First, create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - Create a new OAuth 2.0 Client ID (Web application type)
   - Add authorized redirect URI: `https://<your-cognito-domain>.auth.ap-southeast-1.amazoncognito.com/oauth2/idpresponse`
   - Note the **Client ID** and **Client Secret**

2. In the Cognito console, go to your user pool → **Sign-in** → **Federated identity providers**
3. Click **Add identity provider** → select **Google**
4. Enter the Google Client ID and Client Secret
5. For **Authorized scopes**, enter: `openid email profile`
6. Map attributes: Google `email` → Cognito `email`, Google `name` → Cognito `name`
7. Click **Add identity provider**

8. Go to **App clients** → select your client → **Edit hosted UI**
9. Under **Identity providers**, add **Google** alongside **Cognito**
10. Set **Callback URL** to `https://your-domain.com/auth/callback`
11. Set **Sign-out URL** to `https://your-domain.com`
12. Under **OAuth 2.0 grant types**, select **Authorization code grant**
13. Under **OpenID Connect scopes**, select `openid`, `email`, `profile`
14. Click **Save changes**

> **Note:** The callback URL must match the `COGNITO_REDIRECT_URI` environment variable exactly. The sign-out URL must match `FRONTEND_URL`. These settings apply to all identity providers (Cognito direct and Google). This configuration aligns with the patterns used in the Node.js (`openid-client`) and Python (`authlib`) Cognito integration examples.

#### CLI

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id <POOL_ID> \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{"client_id":"<GOOGLE_CLIENT_ID>","client_secret":"<GOOGLE_CLIENT_SECRET>","authorize_scopes":"openid email profile"}' \
  --attribute-mapping '{"email":"email","name":"name"}' \
  --region ap-southeast-1

aws cognito-idp update-user-pool-client \
  --user-pool-id <POOL_ID> \
  --client-id <CLIENT_ID> \
  --supported-identity-providers COGNITO Google \
  --callback-urls '["https://your-domain.com/auth/callback"]' \
  --logout-urls '["https://your-domain.com"]' \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --region ap-southeast-1
```

### 1.3 Create an S3 Bucket for Simulation Media

S3 is used to store simulation media files. The backend generates presigned URLs so the frontend can access them without making the bucket public.

**Cost note:** An empty S3 bucket costs nothing. S3 pricing is purely pay-for-what-you-use — you're only charged for stored objects (~$0.025/GB/month for S3 Standard in ap-southeast-1), requests, and data transfer. Creating the bucket now and leaving it empty until you need it is free.

#### Console (GUI)

1. Open the [Amazon S3 console](https://console.aws.amazon.com/s3/)
2. Click **Create bucket**
3. Configuration:
   - **Bucket name**: `agritech-simulations` (must be globally unique — append your account ID if needed)
   - **AWS Region**: Asia Pacific (Singapore) ap-southeast-1
4. **Block Public Access settings**: keep all four options checked (all public access blocked). Simulation media is served via presigned URLs, so public access is not needed.
5. **Bucket Versioning**: Enable
6. Leave other settings as defaults
7. Click **Create bucket**

#### CLI

```bash
aws s3api create-bucket \
  --bucket agritech-simulations \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1

aws s3api put-public-access-block \
  --bucket agritech-simulations \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning \
  --bucket agritech-simulations \
  --versioning-configuration Status=Enabled
```

### 1.4 Create an IAM User for the Backend

The backend needs programmatic access to S3 (presigned URLs for simulation media). Authentication is handled via the OIDC flow with Cognito's Hosted UI, so no Cognito admin API permissions are needed.

#### Console (GUI)

1. Open the [IAM console](https://console.aws.amazon.com/iam/) → **Users** → **Create user**
2. **User name**: `agritech-backend`
3. Do not enable console access (this is a service account)
4. Click **Next** → **Attach policies directly**
5. Click **Create policy** (opens a new tab):
   - Switch to the **JSON** editor and paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::agritech-simulations",
           "arn:aws:s3:::agritech-simulations/*"
         ]
       }
     ]
   }
   ```
   - Name the policy `agritech-backend-policy`
   - Click **Create policy**
6. Back in the user creation tab, refresh the policy list and attach `agritech-backend-policy`
7. Click **Create user**
8. Select the user → **Security credentials** → **Create access key**
9. Select **Application running outside AWS** as the use case
10. Note the **Access key ID** and **Secret access key** — you'll need these for Coolify

#### CLI

```bash
aws iam create-user --user-name agritech-backend

aws iam put-user-policy \
  --user-name agritech-backend \
  --policy-name agritech-backend-policy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::agritech-simulations",
          "arn:aws:s3:::agritech-simulations/*"
        ]
      }
    ]
  }'

aws iam create-access-key --user-name agritech-backend
```

### 1.5 Summary of Values to Collect

After completing Part 1, you should have:

| Value                    | Source                          | Example                                        |
| ------------------------ | ------------------------------- | ---------------------------------------------- |
| `COGNITO_USER_POOL_ID`   | Cognito → User pool ID         | `ap-southeast-1_AbCdEfGhI`                    |
| `COGNITO_CLIENT_ID`      | Cognito → App client           | `1abc2def3ghi4jkl5mno6pqr`                    |
| `COGNITO_DOMAIN`         | Cognito → App integration → Domain | `agritech.auth.ap-southeast-1.amazoncognito.com` |
| `COGNITO_REDIRECT_URI`   | Your frontend domain + path    | `https://agritech.example.com/auth/callback`   |
| `AWS_ACCESS_KEY_ID`      | IAM → Access key               | `AKIAIOSFODNN7EXAMPLE`                         |
| `AWS_SECRET_ACCESS_KEY`  | IAM → Secret key               | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`   |

The `DATABASE_URL` will come from Coolify in Part 2.

---

## Part 2: Coolify Deployment

### 2.1 Create a PostgreSQL Database

Coolify can provision and manage a PostgreSQL instance directly on your server — no external database service needed.

1. In your Coolify project, click **New** → **Database**
2. Select **PostgreSQL** (version 16 recommended)
3. Coolify will create the database container and show you the connection details
4. Note the **Internal URL** — this is your `DATABASE_URL` (e.g., `postgresql://postgres:generated-password@project-db-1:5432/postgres`)
5. (Optional) Set a custom database name, username, and password in the database settings before first deploy

The database runs on the same Docker network as your application services, so the backend connects via the internal hostname. No port exposure or firewall rules needed.

**Backups:** Coolify supports scheduled database backups. Go to your database resource → **Backups** to configure backup frequency and retention. You can back up to local storage or an S3-compatible destination.

### 2.2 Create a Docker Compose Resource

1. Go to your project → click **New** → **Docker Compose**
2. Select your Git source and repository
3. Set the branch (e.g., `main`)
4. Coolify will detect the `docker-compose.yml` at the root

### 2.3 Configure Environment Variables

In the Coolify resource settings, add these environment variables:

**Backend — Required:**

| Variable                | Example                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `SECRET_KEY`            | `a-long-random-string-at-least-32-chars`                         |
| `DATABASE_URL`          | `postgresql://postgres:password@project-db-1:5432/postgres`      |
| `COGNITO_USER_POOL_ID`  | `ap-southeast-1_AbCdEfGhI`                                      |
| `COGNITO_CLIENT_ID`     | `1abc2def3ghi4jkl5mno6pqr`                                      |
| `COGNITO_DOMAIN`        | `agritech.auth.ap-southeast-1.amazoncognito.com`                 |
| `COGNITO_REDIRECT_URI`  | `https://agritech.example.com/auth/callback`                     |
| `AWS_ACCESS_KEY_ID`     | `AKIAIOSFODNN7EXAMPLE`                                           |
| `AWS_SECRET_ACCESS_KEY` | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`                     |

**Backend — Optional:**

| Variable                | Default                    | Description                                    |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| `AWS_REGION`            | `ap-southeast-1`           | AWS region for Cognito/S3                      |
| `COGNITO_CLIENT_SECRET` | (empty)                    | Client secret if using a confidential client   |
| `FRONTEND_URL`          | `http://localhost:5173`    | Allowed CORS origin                            |
| `DEBUG`                 | `false`                    | Enables /docs and /redoc                       |

**Frontend — Build-time:**

| Variable                     | Example                                              |
| ---------------------------- | ---------------------------------------------------- |
| `VITE_API_URL`               | `https://api.agritech.example.com`                   |
| `VITE_COGNITO_DOMAIN`        | `agritech.auth.ap-southeast-1.amazoncognito.com`     |
| `VITE_COGNITO_CLIENT_ID`     | `1abc2def3ghi4jkl5mno6pqr`                          |
| `VITE_COGNITO_REDIRECT_URI`  | `https://agritech.example.com/auth/callback`         |

**Important:** `VITE_*` variables are build-time — they get baked into the frontend bundle during the Docker build. Set `FRONTEND_URL` to your actual frontend domain (e.g., `https://agritech.example.com`) and `VITE_API_URL` to your backend domain (e.g., `https://api.agritech.example.com`).

**Important:** For `DATABASE_URL`, use the internal URL from Coolify's database resource (step 2.1). The hostname is the internal Docker service name, not `localhost`.

### 2.4 Configure Domains

In Coolify, assign domains to each service. If using Cloudflare Tunnel with a wildcard DNS record (e.g., `*.yourdomain.com`), use single-level subdomains only — Cloudflare wildcards don't match multi-level subdomains like `api.app.yourdomain.com`.

- **frontend**: `app.yourdomain.com` → port 80
- **backend**: `app-api.yourdomain.com` → port 8000

Coolify auto-configures Traefik routing. If using Cloudflare Tunnel, Traefik receives HTTP traffic internally (Cloudflare terminates TLS), so configure domains with `http://` prefix in Coolify.

**Important:** The frontend container healthcheck uses `curl` (available in nginx:alpine). If the healthcheck fails, Traefik returns 404 for the domain.

### 2.5 Deploy

Click **Deploy** in Coolify. It will:
1. Clone the repository
2. Build both Docker images (multi-stage builds)
3. Start the services
4. Configure Traefik routing and SSL

The healthchecks ensure Coolify waits for services to be ready before routing traffic.

---

## File Structure

```
/
├── docker-compose.yml              # Coolify reads this
├── .env.example                    # Template for env vars
├── packages/
│   ├── frontend/
│   │   ├── Dockerfile              # Multi-stage: node build → nginx
│   │   └── nginx.conf              # SPA routing + caching + security headers
│   └── backend/
│       ├── Dockerfile              # Multi-stage: pip install → gunicorn
│       └── gunicorn.conf.py        # Production server config
└── docs/
    └── DEPLOYMENT.md               # This file
```

## Build Details

### Frontend Dockerfile

1. **Build stage**: Installs npm deps, runs `vite build` with `VITE_API_URL`, `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, and `VITE_COGNITO_REDIRECT_URI` baked in
2. **Production stage**: Copies built assets into nginx, serves with SPA fallback routing

### Backend Dockerfile

1. **Build stage**: Installs Python deps (including compiled ones like psycopg2)
2. **Production stage**: Copies installed packages + app code, runs Gunicorn with Uvicorn workers

### Gunicorn Config

- Workers: `2 * CPU cores + 1`
- Worker class: `uvicorn.workers.UvicornWorker` (ASGI)
- Timeout: 120s
- Runs as non-root `appuser`

## Updating

Push to your configured branch. Coolify auto-deploys on push if webhooks are configured, or you can manually trigger a redeploy from the Coolify dashboard.

## Troubleshooting

**Frontend shows blank page:**
Check that `VITE_API_URL` was set correctly at build time. Since it's baked into the bundle, you need to redeploy (not just restart) after changing it.

**Backend returns 500:**
Check that all required environment variables are set. View container logs in Coolify for details.

**CORS errors:**
Ensure `FRONTEND_URL` matches the exact origin of your frontend (including protocol and port if non-standard).

**Database connection refused:**
Make sure the Coolify PostgreSQL database is running and on the same Docker network as the backend. Use the internal hostname from Coolify's database resource — not `localhost` or an external IP. You can verify the connection by checking the database resource status in the Coolify dashboard.

**Cognito errors:**
Verify `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `COGNITO_DOMAIN` are correct. Ensure the Cognito app client has the correct callback and sign-out URLs configured.

**S3 presigned URL errors:**
Ensure the IAM user has `s3:GetObject` permission on the `agritech-simulations` bucket and that `AWS_REGION` matches the bucket's region.

**Redirect URI mismatch:**
Ensure `COGNITO_REDIRECT_URI` matches exactly what's configured in the Cognito app client callback URLs. The value must be identical — including protocol, domain, and path (e.g., `https://your-domain.com/auth/callback`).

**Cloudflare Tunnel 404:**
If using Cloudflare Tunnel with Coolify, ensure the container healthcheck passes. Traefik removes unhealthy containers from routing and returns 404. Check container logs and healthcheck status in Coolify.

**Cloudflare Tunnel SSL errors (ERR_SSL_VERSION_OR_CIPHER_MISMATCH):**
Cloudflare wildcard DNS (`*.yourdomain.com`) only matches single-level subdomains. `api.app.yourdomain.com` won't match — use `app-api.yourdomain.com` instead. Also ensure the Cloudflare SSL mode is set to "Full" (not "Full (strict)") since Traefik serves HTTP internally behind the tunnel.

**Mixed content errors:**
Ensure `VITE_API_URL` uses `https://` (not `http://`). The frontend is served over HTTPS via Cloudflare, so all API requests must also use HTTPS.

**Invalid grant on callback:**
The authorization code is single-use and expires in 5 minutes. Ensure the backend exchanges it promptly. If you see this error, the code may have already been used or expired.

**CORS error on token exchange:**
The token exchange happens server-side (backend to Cognito), not from the browser. If you see CORS errors, the frontend may be trying to call the Cognito token endpoint directly — verify the frontend sends the code to the backend's `/api/auth/callback` endpoint instead.
