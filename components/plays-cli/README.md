# Plays CLI source component

This directory contains the existing `@plays-ai/cli` package source. Its manifest requires Node.js 22 or newer and declares `npm run build` as the TypeScript build command. The package is not published or installed by this snapshot.

```sh
npm install
npm run build
```

The source defaults `PLAYS_API_URL` to `http://localhost:4720`; set a different value only for a service you control. CLI tests are omitted because their source refers to a fixture outside the approved component set. Build and runtime behavior were not verified in this sanitation batch.

This component retains its Apache-2.0 license in [LICENSE](LICENSE).
