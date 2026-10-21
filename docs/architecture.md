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

Each viewer has one WebGPU/WebGL renderer, sun and environment, with independently reconciled level resources. Geometry, appearance, transforms, navigation and lighting have separate invalidation scopes. Rendering stops submitting frames at rest; hidden or workshop-covered viewers pause. Device preferences apply to drawing-buffer resolution immediately. Backend recovery replaces GPU resources while retaining the project, camera and React drafts. Detailed diagnostics are enabled only by `?profile=1` or an explicit diagnostics build; normal rendering does not traverse the scene to publish profiling attributes.

`sceneItemDragging.ts` owns temporary furniture, light and opening transforms. Pointer movement does not publish a project each frame. It coalesces account-scoped recovery checkpoints at 500 ms intervals, with one write in flight; release validates and commits through the existing project session. Cancellation restores the accepted scene and clears the checkpoint in order. Remote changes to the selected entity or its construction scope cancel the gesture; unrelated edits remain intact. `useProject.ts` clears checkpoints only after the corresponding final edit is durable, using generations to reject late acknowledgements.

Model access lives in `client/models/modelRepository.ts`; it returns domain metadata and binary access through the existing offline services. `features/viewer/customModel.ts` owns GLTF templates, instances, materials and GPU cache cleanup. Successful deletion emits invalidation toward renderers; the repository never imports a renderer. Group metadata is validated in `domain/models/modelMetadata.ts` independently of the workshop.

Display instances share immutable template geometry and own their mutable materials; the workshop copies geometry before editing. Template leases prevent one viewer from disposing another viewer's buffers. Cache eviction accounts for decoded buffers, textures and acceleration trees, and removes unused entries rather than active resources. Compatible catalog pieces have grouped display representations; original editable pieces and model identities remain separate from this optimization. `scenePickingAcceleration.ts` leases BVH trees per geometry, accepts only unchanged worker results and retains native raycasting until a tree is ready. It does not mutate source indices or globally enable first-hit picking, because painting and visibility filters may require later intersections.

`shared/graphicsJobs.ts` provides one admission budget per browser application context for texture transcoding, BVH construction and model booleans: one heavy job on coarse-pointer devices, two otherwise, with a bounded cancellable queue. Workers own their transferred derivative buffers, never the live model's buffers. `architecturalTextureLoader.ts` owns local Basis/KTX2 transcoding and shared texture lifetime across live backends. Acquire its renderer lease after initialization and release it before final shared-texture cleanup. Uploaded GLB formats and authored PNG/JPEG data are unchanged.

The workshop records sparse transform, material and vertex before-images for local changes, preserving untouched geometry and exact authored attributes. Topology-changing operations retain complete snapshots. `workshopHistory.ts` owns and disposes both forms, coalesces compatible field edits and trims distant entries against its step/byte budgets; the nearest recoverable state is retained even if it alone exceeds the byte target. Workshop scheduling uses demand frames and the same device graphics preferences, without publishing editor documents until the model is applied.

`features/editor/useProject.ts` adapts project services to React state and UI actions. `client/projects/projectSession.ts` owns online/offline sessions, permission state, cross-tab locks and network subscriptions. `projectSketch.ts` owns displayed object URLs and versioned asynchronous sketch caching. `projectRecovery.ts` owns account-scoped rejected drafts and durable persistence. Every asynchronous callback is tied to its session lifetime; unmounting or changing account must not publish stale state or discard durable work.

The existing offline repository, preparation, synchronization and package modules share one durable queue. The existing command service remains the sole authority for canonical project/Yjs transactions, revisions, access and receipts. No alternate persistence path was introduced by the layout change.

PWA updates retain their request intent and freeze ID. A manual action overlapping automatic staging runs its own guards after that attempt settles; a rejected request releases only its own freeze, even if a cancellation arrives later through another channel. Other tabs and unfinished drafts remain protected.

## Adding or changing a feature

Keep UI and interaction code in its owning feature. Put rules shared with persistence/import/server in domain modules, browser I/O in client modules and Node I/O in server modules. Extract cohesive responsibilities when they make ownership clearer; do not introduce generic controllers, contexts or barrel files just to hide import paths.

Behavior changes must reach both editor and onboarding when relevant, along with desktop/touch, Spanish/English, offline and permissions. Review illustrated help in the same change. A pure internal refactor retains the existing help and screenshots when controls and steps are unchanged; document that decision in the change description.

## Build and deployment

`index.html` loads `src/app/main.tsx`. Browser output remains `dist/`; server output preserves source subdirectories under `server-dist/`, with entry points at `server-dist/server/{server,maintenance,operations}.js`. npm scripts, Docker and E2E fixtures use these paths. The boolean worker remains relative to its workshop client; backup verification resolves the compiled maintenance module through `import.meta.url`.

The single Dockerfile still serves port 8080 and persists `/data`. This refactor does not migrate, reset or invalidate accounts, documents, sessions, offline records or prepared storage. Normal PWA generation checks stage and activate the new asset paths safely.

See [Graphics performance](graphics-performance.md) for profiling methodology, bounded caches, measured fixture comparisons and remaining hardware checks.
