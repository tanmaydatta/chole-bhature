# Staging Worker operations

Staging commands deliberately do not use the placeholder values in the checked-in local
Wrangler files. They require real Cloudflare D1 identifiers and the real HTTPS Operator
host through the process environment, then generate a protected temporary Wrangler config.
The runner validates the selected app's installed Wrangler JavaScript entrypoint and launches it
with the current absolute Node executable, without a package-manager shell shim or PATH lookup.
It deletes the temporary config whether Wrangler succeeds or fails.

Copy `.env.staging.example` to the git-ignored `.env.staging` and replace every value. The
Product and Auth D1 UUIDs must be real, distinct Cloudflare resources. The passkey RP ID must
exactly equal the hostname in the HTTPS Operator origin, and the recipient list must contain
at least one real staging email address.

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
```

Identity staging development additionally requires `AUTH_SECRET`, `RESEND_API_KEY`, and
`RESEND_FROM` in the launching environment. The runner writes them to a separate mode-`0600`
`.dev.vars` beside its temporary Identity config because Wrangler development does not expose
deployed Worker secrets. It removes both temporary files on success or failure and does not
forward those values through the Wrangler child environment. Product staging development and
both apps' migrate/deploy commands do not require these local application secrets.

Set Worker secrets such as `AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM` with Wrangler's
secret management before deployment. The staging runner neither writes those secrets into the
temporary TOML config nor forwards application secrets to its Wrangler child process. Cloudflare
authentication variables remain available so Wrangler can access the account.
