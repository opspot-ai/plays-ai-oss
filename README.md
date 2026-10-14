# Plays AI source snapshot

An experimental as-is snapshot of the existing Plays web app and its approved CLI/runtime source components.

## Contents

- The web app uses Next.js 15, React 19, and TypeScript. It contains the storefront pages, API routes, generated catalog input, and Supabase migrations.
- `components/plays-cli` contains the existing CLI package source.
- `components/plays-runtime` contains the existing runtime package source and schemas.

## Prerequisites and local configuration

The web app uses pnpm and the checked-in `pnpm-lock.yaml`. The root package does not declare a Node.js version. The two component manifests require Node.js 22 or newer and use npm lockfiles.

Copy `.env.example` to `.env.local` for local configuration. It keeps fulfillment disabled and contains unmistakable placeholders for service URLs, credentials, and storage settings. Replace placeholders only in a private local environment. The CLI/runtime `PLAYS_API_URL` default is local loopback.

## Commands in the manifests

From the repository root:

```sh
pnpm install
pnpm dev
```

From either component directory:

```sh
npm install
npm run build
```

The runtime component also declares `npm test`. These commands are documented from package metadata and were not run for this snapshot.

## Limits

The generated runtime release locator and digest are placeholders. Runtime JSON Schema identifiers use reserved `example.com` placeholders. The generated build denylist contains synthetic placeholders; it does not retain the original private names or assignments and does not provide a complete privacy scan of private source data. The CLI test sources are omitted because they refer to a fixture outside the approved source set.

Existing bugs, outdated dependencies, and unfinished features are accepted. Checkout, payment, account, license, download, Supabase, CLI install, and runtime behavior are unverified. No build, dependency installation, migration, test, demo, product service, or deployment was run in this batch.

## License and attribution

The web app and runtime component use the owner-approved MIT license in [LICENSE](LICENSE). `components/plays-cli` retains its Apache-2.0 [component license](components/plays-cli/LICENSE). The runtime reference-loop fixture retains its Apache-2.0 notice.
