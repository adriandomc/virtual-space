# Application architecture

3D Space is one application and one Node process, built from a single repository and Dockerfile. The directory boundaries separate execution environments and ownership, without adding services or changing the version-3 project format.

```text
src/
  app/              bootstrap and application recovery
  features/         screens and feature-specific UI/rendering
    accounts/       login and project library
    construction/   additive plans, levels, stairs and roofs
    editor/         editor orchestration and property panels
    embed/          read-only embedded viewer
    help/           localized illustrated help
    landing/        interactive public demos
    legal/          privacy and terms
    models/         catalog, library and model-part controls
    onboarding/     optional four-step setup
    settings/       offline, language and graphics controls
    collaboration/  invitations, sharing and notifications
    viewer/         Three.js runtime and scene resources
    workshop/       editable pieces, CSG, grouping and history
  domain/           project/model rules, contracts and policies
  client/           browser API, persistence, sessions and PWA
  server/           HTTP/WS, auth, SQLite, quotas and maintenance
  shared/           small utilities, routes, UI and localization
tests/
  fixtures/         current-project and database fixtures
  integration/      checks spanning several areas
e2e/                production-build browser flows
```

## Dependencies and checks

- Features can use browser services, domain rules and shared controls. The app chooses screens; browser infrastructure never imports them back.
- Domain modules contain contracts, commands, byte validation, budgets, geometry and confirmed collaboration-document helpers. They have no browser storage, DOM, React or Node dependencies. Three.js mathematical geometry helpers and Yjs are shared computation dependencies, not renderers or transports.
- Client modules own API calls, IndexedDB, local identity, offline synchronization, session lifetime, device preferences and service-worker coordination. They cannot import screens or server modules, including server-only types.
- Server modules use domain contracts and shared pure utilities. They cannot import browser services or UI. HTTP and WebSocket still invoke one project command authority, and publication follows a successful transaction.
- Shared browser controls can use client activity guards and domain types. They cannot import screens. Pure utilities remain independent of controls and localization.

`scripts/check-architecture.mjs` enforces these directions for static imports, type imports/re-exports and dynamic imports. It also rejects Node dependencies outside the server and browser globals in domain code. `npm run check` runs this guard, the browser TypeScript configuration without Node globals, the tooling configuration and the test configuration. The server is compiled separately without DOM globals. The checker has negative fixtures so type-only imports cannot bypass the boundary.

Tests live beside their implementation; integration tests and reusable fixtures have their own directory. Test discovery is recursive. Translation checks also scan the complete source tree, so adding a subdirectory does not silently exempt its interface from localization checks.

## Runtime ownership

`features/viewer/RoomScene.tsx` owns the React binding, renderer lifetime and user input. `sceneRuntime.ts` defines its internal types. Architecture reconciliation, level geometry, items, cameras, environment, presentation, selection and disposal are separate modules. They use one renderer and retain the same resource ownership; extracting a module must not duplicate scenes, GPU allocations or animation loops.

Model access lives in `client/models/modelRepository.ts`; it returns domain metadata and binary access through the existing offline services. `features/viewer/customModel.ts` owns GLTF templates, instances, materials and GPU cache cleanup. Successful deletion emits invalidation toward renderers; the repository never imports a renderer. Group metadata is validated in `domain/models/modelMetadata.ts` independently of the workshop.

`features/editor/useProject.ts` adapts project services to React state and UI actions. `client/projects/projectSession.ts` owns online/offline sessions, permission state, cross-tab locks and network subscriptions. `projectSketch.ts` owns displayed object URLs and versioned asynchronous sketch caching. `projectRecovery.ts` owns account-scoped rejected drafts and durable persistence. Every asynchronous callback is tied to its session lifetime; unmounting or changing account must not publish stale state or discard durable work.

The existing offline repository, preparation, synchronization and package modules share one durable queue. The existing command service remains the sole authority for canonical project/Yjs transactions, revisions, access and receipts. No alternate persistence path was introduced by the layout change.

PWA updates retain their request intent and freeze ID. A manual action overlapping automatic staging runs its own guards after that attempt settles; a rejected request releases only its own freeze, even if a cancellation arrives later through another channel. Other tabs and unfinished drafts remain protected.

## Adding or changing a feature

Keep UI and interaction code in its owning feature. Put rules shared with persistence/import/server in domain modules, browser I/O in client modules and Node I/O in server modules. Extract cohesive responsibilities when they make ownership clearer; do not introduce generic controllers, contexts or barrel files just to hide import paths.

Behavior changes must reach both editor and onboarding when relevant, along with desktop/touch, Spanish/English, offline and permissions. Review illustrated help in the same change. A pure internal refactor retains the existing help and screenshots when controls and steps are unchanged; document that decision in the change description.

## Build and deployment

`index.html` loads `src/app/main.tsx`. Browser output remains `dist/`; server output preserves source subdirectories under `server-dist/`, with entry points at `server-dist/server/{server,maintenance,operations}.js`. npm scripts, Docker and E2E fixtures use these paths. The boolean worker remains relative to its workshop client; backup verification resolves the compiled maintenance module through `import.meta.url`.

The single Dockerfile still serves port 8080 and persists `/data`. This refactor does not migrate, reset or invalidate accounts, documents, sessions, offline records or prepared storage. Normal PWA generation checks stage and activate the new asset paths safely.
