# Plays runtime source component

This directory contains the existing `@plays-ai/runtime` package source and `playbundle/v2` schemas. Its manifest requires Node.js 22 or newer and declares `npm run build` and `npm test` commands.

```sh
npm install
npm run build
npm test
```

The source defaults `PLAYS_API_URL` to `http://localhost:4720`; set a different value only for a service you control. Runtime release metadata in the web app uses explicit placeholders in this snapshot. Build, install, package, and runtime behavior were not verified in this sanitation batch.

Copyright (c) 2026 OpSpot. The owner-approved source snapshot is covered by the repository-root [MIT license](../../LICENSE). The reference-loop fixture retains its separate Apache-2.0 notice.
