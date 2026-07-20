# Staging Worker operations

## Local three-Worker stack

Run the complete local stack from the repository root:

```sh
cp apps/operator-web/.dev.vars.example apps/operator-web/.dev.vars
pnpm dev:local
```

The command builds the canonical contracts and dashboard, then starts Core on port `8787`,
Identity on `8788`, and the public Operator Web Worker on `5173`. Wrangler resolves the
`incentives-api`, `incentives-identity-local`, and `incentives-operator-web-local` service names
through its local service registry. Open `http://localhost:5173`; Core and Identity are private
service dependencies rather than browser entrypoints.

## Staging

Staging commands deliberately do not use the placeholder values in the checked-in local
Wrangler files. They require real Cloudflare D1 identifiers and the real HTTPS Operator
host through the process environment, then generate a protected temporary Wrangler config.
The runner validates the selected app's installed Wrangler JavaScript entrypoint and launches it
with the current absolute Node executable, without a package-manager shell shim or PATH lookup.
It deletes the temporary config whether Wrangler succeeds or fails.

Copy `.env.staging.example` to the git-ignored `.env.staging` and replace every value. The
Product and Auth D1 UUIDs must be real, distinct Cloudflare resources. `STAGING_OPERATOR_ORIGIN`
and `STAGING_API_ORIGIN` must be distinct exact HTTPS origins on real hosts. The generated
Operator and Core configs each publish exactly that origin as one custom-domain route, while
Identity remains service-only. The passkey RP ID must exactly equal the Operator hostname, and
the recipient list must contain at least one real staging email address.

Load the values into the current shell without printing them:

```sh
set -a
. ./.env.staging
set +a
```

Then use the app-specific commands:

```sh
pnpm --filter @incentives/api dev:staging
pnpm --filter @incentives/api db:migrate:staging
pnpm --filter @incentives/api deploy:staging

pnpm --filter @incentives/identity dev:staging
pnpm --filter @incentives/identity db:migrate:staging
pnpm --filter @incentives/identity deploy:staging

pnpm --filter @incentives/operator-web dev:staging
pnpm --filter @incentives/operator-web deploy:staging
```

Identity staging development additionally requires `AUTH_SECRET`, `RESEND_API_KEY`, and
`RESEND_FROM` in the launching environment. The runner writes them to a separate mode-`0600`
`.dev.vars` beside its temporary Identity config because Wrangler development does not expose
deployed Worker secrets. It removes both temporary files on success or failure and does not
forward those values through the Wrangler child environment. Product staging development and
both apps' migrate/deploy commands do not require these local application secrets.

Operator Web staging development similarly requires `OPERATOR_SELECTION_SECRET`. The runner
writes it only to the protected temporary `.dev.vars`, removes it in `finally`, and strips it
from the Wrangler child environment. Configure the deployed Worker secret separately before
deploying Operator Web.

Set Worker secrets such as `AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, and
`OPERATOR_SELECTION_SECRET` with Wrangler's
secret management before deployment. The staging runner neither writes those secrets into the
temporary TOML config nor forwards application secrets to its Wrangler child process. Cloudflare
authentication variables remain available so Wrangler can access the account.
