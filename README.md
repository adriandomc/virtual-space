# 3D Space

[3D Space](https://3d.adriandomc.com) is a free browser application for designing buildings with up to 12 levels and previewing wall colors, floors, roofs, furniture and lighting. Add rooms and walls to a floor plan, connect stories with stairs, build custom furniture, and walk continuously through the resulting 3D space on desktop or touch devices.

The application is self-hosted: accounts use a username and password, and designs are stored on your server. Public viewing links, embeddable viewers and invited reader/editor access are optional. Private designs can be prepared for offline editing as an installable PWA.

For illustrated end-user instructions, open **Information → Help and getting started** in the app, or visit [`/help`](https://3d.adriandomc.com/help). Help text and screenshots follow the selected application language.

## Features

- Additive room and wall construction with stable junctions, wall splitting, per-level reference images, dimensions and angle/grid snapping.
- Up to 12 levels, separate wall-face and slab-underside finishes, real slab openings and atomic construction undo/redo.
- Straight, landing, L, U and spiral stairs with connected walkthrough surfaces, editable upper-floor openings and optional railings.
- Flat, shed, gable and rectangular hip roofs, plus free vertex/triangle editing of closed roof solids. Roof undersides define the interior ceiling and walkthrough headroom.
- Optional setup steps: Sketch → Roof → Colors → Furniture. Skipping preserves existing work.
- Selectable objects with drag handles, numeric properties and placement warnings.
- Beds, wardrobes, vanities and nightstands; doors, windows and configurable lights.
- Wall and ceiling colors, hexadecimal color input, floor finishes and furniture materials.
- Standard, Realistic and Hyperrealistic rendering, with WebGPU and WebGL support.
- Full/cutaway/hidden walls, roof visibility and active/lower/all-level views.
- Device-local automatic/manual graphics preferences for shadows, textures, render scale, geometry detail, distance, contact shadows and frame-rate limits.
- Walkthrough navigation with keyboard or a touch joystick, interactive doors and light switches.
- A model workshop with primitives, furniture parts, transforms, boolean operations, vertex/face editing, alignment, groups and undo/redo.
- Validated, self-contained GLB uploads and independent copies between designs.
- Yjs collaboration, invitations, reader/editor roles, public links and iframe embedding.
- Durable offline drafts, asset preparation, explicit offline mode, conflict recovery and complete project exports.
- Spanish and English localization, a language selector, and illustrated help in both languages.

Rendering is an interactive approximation. It is not ray tracing, a photometric simulation, an automatic floor-plan recognizer or a calibrated paint sample. Sunlight uses editable time and orientation, without geographic or astronomical calculations.

## Requirements

- **Node.js 24** and npm. The server uses Node's built-in HTTP and SQLite modules.
- A current browser with WebGL; WebGPU is used where available. HTTPS or localhost is required for PWA capabilities and WebGPU.
- Docker for container deployment. No separate database server or authentication service is required.

## Local development

Install dependencies and start the API:

```sh
npm ci
npm run dev:server
```

In a second terminal in the same directory:

```sh
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. Vite proxies `/api` requests and WebSocket traffic to `http://127.0.0.1:8080`. Development data is stored in `data/accounts.sqlite`, excluded from Git. Use a separate `DATA_DIR` for isolated experiments.

Three.js is pinned to `0.180.0`. Its common texture path assumes that `VideoFrame` exists, which prevents rendering in browsers without WebCodecs. The checked, idempotent `scripts/patch-three.mjs` postinstall script backports the [upstream r184 feature guards](https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/Textures.js) to the source and exported build copies. Both Docker stages apply it through `npm ci`; do not skip install scripts. When upgrading to r184 or later, verify the guards in the replacement release, remove this patch and its postinstall hook, and run the WebKit/WebGL and Chromium/WebGPU rendering tests. The patch does not add a global shim or change the renderer's materials.

To run the production build locally:

```sh
npm run build
npm start
```

The Node server serves both the client and API on port **8080**. `dist/` contains client assets and `server-dist/` contains the compiled server. Use a production build to test the service worker: Vite development mode deliberately does not register it.

## Tests

```sh
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:webkit
```

`npm test` runs the TypeScript unit and integration tests. `build` checks TypeScript and builds both applications. Playwright rebuilds the app, starts an isolated production server at `127.0.0.1:5188` and uses a temporary database; it does not use development or production data. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome channel. Failure screenshots and traces are written to `test-results/`.

CI uses Node.js 24 on Linux, runs unit/integration tests, the production build, Chromium/WebKit flows and a Docker build. Each run retains isolated browser screenshots and failure traces as `browser-test-results` artifacts for seven days. Real-GPU checks remain separate from software-rendered CI.

The [architecture and resource review](docs/architecture-review.md) records the verified changes, measurements and remaining operating limits.

Browser coverage includes color previews and cancellation, plan item positions after release, transient menu dismissal, guarded automatic updates, preparation, startup without a server, local models and reference images, forced-offline network isolation, durable drafts and synchronization. Browser automation does not replace installation and storage-retention checks on physical Android and iOS devices.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACCOUNT_MAX_DESIGNS` | `50` | Maximum owned designs per account; positive integer. |
| `ACCOUNT_MAX_BYTES` | `524288000` | Account content quota in bytes (500 MiB), including canonical documents, sketches and owned models. |
| `ACCOUNT_MAX_RECEIPTS` | `100000` | New confirmed operations per design owner within the existing 30-day receipt window. Existing retries and storage-reducing edits remain allowed. |
| `PORT` | `8080` | Internal HTTP port. |
| `DATA_DIR` | `./data`; `/data` in Docker | Writable persistent storage directory. |
| `NODE_ENV` | Set to `production` in Docker | Enables secure production session cookies. |
| `APP_ORIGIN` | Derived from the request and trusted proxy | Public origin, for example `https://3d.example.com`, without a path. Set it explicitly in production. |
| `TRUSTED_PROXIES` | Loopback and usual private IPv4 Docker networks | Comma-separated IPs/CIDRs allowed to provide forwarded visitor addresses and protocol. Restrict to your actual proxy network. |

Do not expose the internal port directly to the internet behind a reverse proxy or trust arbitrary forwarded headers. Configure HTTPS and preserve WebSocket upgrades and long-lived SSE connections. With a CDN, verify its address handling and trust chain at both layers.

## Docker and Coolify

Deployment uses the repository's **Dockerfile**. It builds the client and server, runs as the unprivileged `node` user and exposes port **8080**. Persist **`/data`** across deployments. For a host bind mount, the directory must be writable by UID 1000.

Local HTTP-only Docker test:

```sh
docker build -t virtual-space .
docker run --rm -p 8080:8080 -e NODE_ENV=development -v virtual-space-data:/data virtual-space
```

Use `NODE_ENV=production` and HTTPS on your public deployment. In Coolify:

1. Connect the GitHub repository and the `main` branch.
2. Select the Dockerfile build pack, base directory `/` and Dockerfile location `/Dockerfile`.
3. Expose internal port `8080` and configure the HTTPS domain.
4. Add persistent storage with destination `/data`.
5. Set `APP_ORIGIN`, verify `TRUSTED_PROXIES`, deploy, and check container health and maintenance status.

Run **one application instance per data directory**. Sharing the same SQLite storage between independent server instances is not supported. The service deploys at the domain root.

## Project layout

| Location | Responsibility |
| --- | --- |
| `src/app/` | Bootstrap, route selection and application recovery. Shared route definitions are in `src/shared/routes.ts`. |
| `src/features/accounts/`, `editor/`, `onboarding/`, `landing/`, `embed/` | Screens and local orchestration. Editor and setup share construction and viewer features. |
| `src/features/construction/` | Additive drawing, levels, stairs, roofs and construction history. |
| `src/features/viewer/` | Three.js runtime, level/project reconciliation, camera, environment, selection, resources, materials and model instances. `RoomScene.tsx` binds them to React and input. |
| `src/features/workshop/`, `models/` | Model construction, booleans, alignment, grouping, history, catalog and library controls. |
| `src/features/settings/`, `collaboration/`, `help/`, `legal/` | Device settings, sharing/notifications, localized help and legal screens. |
| `src/domain/project/` | Canonical v3 document, validation, atomic construction operations, geometry, protocol and internal level projections. |
| `src/domain/models/`, `collaboration/`, `policies/` | Shared asset contracts and byte validators, global model budgets, Yjs document helpers and service policies. |
| `src/client/api/`, `models/`, `projects/` | Account requests, model access, project sessions, versioned sketches, durable rejected drafts and project packages. |
| `src/client/offline/` | IndexedDB records/binaries, identity/mode, preparation and one durable synchronization queue. `offlineService.ts` exposes application operations. |
| `src/client/pwa/`, `graphics/` | Cross-tab safe updates, service-worker generations, activity guards and device-local graphics preferences. |
| `src/server/` | Node entry points and grouped HTTP, authentication, project commands, collaboration, models, quotas, SQLite and maintenance. |
| `src/shared/ui/`, `i18n/` | Shared controls, draft fields, transient previews, translations and language catalogs. |
| `src/**/*.test.ts`, `tests/`, `e2e/` | Colocated unit tests, cross-area integration tests/shared fixtures and production-browser regressions. |
| `public/materials/`, `public/environments/` | Bundled visual assets and provenance documents. |

See [Architecture](docs/architecture.md) for dependency rules, lifecycle ownership and where to put new features. `npm run check` checks those rules and separately type-checks browser code, build tools and tests. `npm run build:server` compiles the Node-only dependency graph. `npm test` discovers nested colocated tests and cross-area tests; it does not rely on files being directly in `src/`.

## Data and synchronization

The only persisted contract is **`ProjectDocument.version: 3`**, validated by `src/domain/project/projectDocument.ts`. It contains stable IDs for levels, shared plan points, walls and both wall finishes, surfaces and holes, wall-anchored openings, furniture, lights, stairs and roofs. Floor slabs have independent top and underside finishes; changing a lower ceiling does not recolor the floor above it. Level elevations derive from preceding level heights. A `Room` is a disposable internal projection of one level, including explicit interior wall segments; it is never persisted, exported or accepted by the API as a project. Defaults are created explicitly, and every visible furniture item belongs to stored project data.

Structural commands validate the complete candidate before committing. A failed split, invalid roof solid or incompatible hole preserves the previous document. Construction history includes generated openings and all affected levels in one undo step. Stairs use connected support surfaces for continuous movement; navigation never selects a different story or spiral turn solely from X/Z coordinates. Floors and roof undersides used for rendering also define the actual openings and headroom.

Import/export uses a ZIP-based **`.3dspace`** file with MIME `application/vnd.3dspace+zip`. Its `manifest.json` declares `format: '3d-space-project'`, `version: 3`, the project, up to 12 per-level sketches and the GLB files. Paths, expanded sizes, signatures, ownership references and global model budgets are validated before an atomic local import. The archive is limited to 225 MB, its manifest to 4 MB, individual models to 20 MB and individual sketches to 10 MB. No partial import or implicit format conversion is performed.

The server stores accounts and service metadata in `DATA_DIR/accounts.sqlite`. The current SQLite schema version is **3**. `rooms` holds project metadata; `project_levels` stores normalized level documents and collaboration state; `project_sketches` holds each level reference image and version; `mutation_receipts` records idempotent structural confirmations. Models, memberships, sessions and security counters are stored in the same database. Initialization is atomic. An incompatible or partial database stops startup without changing its data.

Confirmed documents use a revision-checked cache bounded to 32 projects and 16 MiB of encoded data. Ordinary edits read, encode and write the changed scopes without loading other levels' documents or collaboration BLOBs. Cache publication follows the database commit; rollback preserves the last confirmed state, and committed deletions invalidate cached content.

Global document limits apply across the whole building, rather than multiplying by the number of levels: 64 furniture items, 24 lights, 96 wall openings, 1,536 plan points, 1,536 walls, 192 surfaces and 96 slab openings with at most 2,048 hole vertices. Per-instance custom-model part overrides are capped at 2,048 across all levels before expensive geometry validation. Custom models have additional project-wide budgets for rendered instances, triangles, texture pixels and bytes. See `PROJECT_LIMITS` and `src/domain/models/modelBudget.ts` before changing limits.

Private projects use durable account-scoped IndexedDB records and a pending queue. Preparation verifies all dependencies before marking content available. Explicit offline mode suppresses data requests, uploads, notifications and collaboration even when the network is available. Leaving offline mode checks the account, current permissions and revisions before syncing all pending projects and models. Conflicts preserve local work for recovery rather than silently overwriting server changes. Shared projects require independent personal copies for offline editing.

The service worker keeps application generations consistent. A fresh, untouched opening can update automatically only after local identity/mode initialization and checks for all pending projects, sketches, uninserted models and recovery records. Work in any other editor tab blocks automatic activation. User interaction during downloads turns the update into a dismissible notice. Returning from the background never resets the interaction guard. Manual **Update now** checks every editor tab, flushes valid edits, confirms durable local storage and freezes mutations until activation. Incomplete fields/IME, color previews, drawings and workshop drafts must be finished or cancelled; durable unsynchronized changes do not require a network sync. Embedded read-only viewers do not participate in save handshakes. Settings exposes the same guarded update action.

A prepared application stages the new generation's full visual assets before installation can succeed; failed downloads retain the previous complete generation. Older caches remain while open or unidentified clients may still use them, and previous immutable chunks remain readable during controller changes. Forced offline startup reuses the existing registration without an explicit registration/update check. Do not clear site storage as an update mechanism.

The production service worker caches the app, localized help and bundled visual assets. Graphics preferences and the selected language stay in browser storage and are not sent as analytics or copied into another device profile. IndexedDB stores editable records separately from binary assets. Installation and storage persistence remain browser-controlled; exports are the user's independent backup. Local work does not count as server account activity until authenticated synchronization occurs.

Forced offline mode makes no application-initiated worker registration/update checks or account-data requests. The browser can still perform its own worker check during navigation, as described in the [service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle); the application does not request activation while forced offline. Browser tests distinguish these browser-owned checks from application calls.

## API boundaries

- `GET/POST /api/rooms` lists or creates designs. Creation accepts `{ id, project }`, with matching identifiers.
- `GET /api/rooms/:id` returns a permission-checked canonical snapshot, revisions and per-level sketch states. `?public=1` explicitly requests the public read-only view.
- `PUT /api/rooms/:id` accepts `{ project, revision, operationId }`. The operation ID must be a fresh UUID for a new mutation; retry the identical request and ID after a lost confirmation. Stale revisions and reused IDs with different content are rejected.
- `/api/rooms/:id/levels/:levelId/sketch` reads, uploads or removes that level reference image. Writes require `X-Sketch-Request-Id`, `X-Sketch-Version` and `X-Room-Revision`; the mutation ID makes retries idempotent.
- Yjs ordinary updates are scoped to project metadata and individual levels. Structural changes use revision checks and complete validated transactions. Origin checks and reader/editor/owner permissions remain server-side.

Do not persist internal level projections or send an unversioned partial project to any boundary. Public pages remain `/`, `/help`, `/privacy` and `/terms`; `/login`, `/designs`, `/editor?room=…` and `/embed?room=…` serve their dedicated views.

## Authentication, privacy and limits

- Usernames are normalized to lowercase and require 3–32 ASCII letters, digits or underscores. Passwords require 8–128 characters and confirmation at registration. No email or password-recovery service is used.
- Passwords use scrypt with a random salt. Stored session tokens are hashed. Production cookies are `__Host-`, `Secure`, `HttpOnly` and `SameSite=Lax`; mutations validate the request origin.
- Session tokens expire within 30 days and are revoked at logout. A persistent cookie is used only when the optional remember-session checkbox is selected.
- Account defaults allow 50 designs and 500 MiB of active content, including the existing 100-model/100-MiB model library limit. Quotas are checked inside the same transaction as the write; retries are not double-charged. Over-quota accounts retain read, export, delete and storage-reducing operations. Restores never truncate data to fit a quota.
- New confirmed operations have a separate default budget of 100,000 receipts per owner across their designs in 30 days. No-op writes count. Previously confirmed retries remain idempotent, and content-reducing edits keep their receipts even above the budget. Exhaustion returns 429 with retry guidance; clients retain the rejected draft. Receipt retention is unchanged and the content quota does not count duplicated Yjs state or receipts. See [the architecture review](docs/architecture-review.md) for the reduction exception and measured limits.
- Large upload admission allows two binary bodies per process, one per account; project JSON bodies allow eight per process and two per account. Both share a 40-MiB raw-body reservation; GLB validation is serialized. Overload returns HTTP 429 with Retry-After without dropping durable local work.
- Sketch headers are validated before decoding: PNG/JPEG/WebP, at most 10 MiB compressed, 8192 pixels per axis and 16,777,216 total pixels. GLB/metadata validation is shared between server and offline import.
- Static hashes and gzip representations are generated by `scripts/build-static-assets.mjs`; production serves them asynchronously, preserving no-cache HTML/service-worker responses. Backup verification runs in a worker and retains erasure/revocation checks before publication.
- Persistent request limits cover login, registration, project creation and uploads. Login has per-username/IP and per-IP limits with progressive temporary blocking; IPv6 addresses are grouped by `/64`. Password derivation concurrency is limited.
- Static GLBs are checked for file structure, geometry, node/triangle budgets, transforms, texture memory and ownership. External resources, animations and unsupported extensions/compression are rejected. A file is limited to 20 MB; additional per-design and per-owner budgets apply.
- Account access, model access, invited roles and public links are checked server-side. Only `/embed` permits cross-origin framing. Reader interactions do not persist room edits.
- The app contains no advertising, analytics or tracking services. `/privacy` and `/terms` remain publicly accessible through Information. Registration retains a terms-acceptance checkbox and link.

Hosted-service policies are shown in the application. If self-hosting, review and adapt the responsible party, contact details, hosting location, retention, backups and actual infrastructure logging before publishing. Do not promise that no data is stored: accounts, user-created content and security data are necessary to provide this service.

## Backups and restoration

At startup and hourly, maintenance removes expired accounts and backups and creates a consistent SQLite backup when no valid backup exists from the last 24 hours. Every published backup is integrity-checked and restored to a separate temporary database; schemas, rows and BLOBs are compared. Backups are retained for seven days until the next maintenance pass. Downtime delays scheduled work until startup.

Backups are stored in `DATA_DIR/backups` on the same storage as the database. They do not protect against total server or disk loss. `maintenance-status.json` records the last result; monitor it, container errors and free disk space. Linux data directories use mode `0700`; databases and operational files use `0600`.

Inside the application container, request or verify a backup using its actual filename:

```sh
npm run maintenance -- backup /data
npm run maintenance -- verify /data/backups/ACTUAL_BACKUP.sqlite
```

`DATA_DIR/erasures.json` is the current deletion and revocation ledger. **Keep its latest version.** Restoration applies it to avoid reviving deleted accounts, designs, reference images and revoked access. Never replace it with an older or empty ledger. The ledger is pruned only after the relevant recovery window and expired backups are gone.

To restore, first stop the app and verify that no process is using SQLite. Do not delete `-wal`, `-shm` or `-journal` files to force an operation. Confirm the exact deployed image, actual data mount and a new recovery parent directory writable by UID 1000. The final restore destination must not exist. Use a one-shot container with networking disabled, not another server instance:

```sh
APP_IMAGE='CONFIRMED_DEPLOYED_IMAGE'
DATA_VOLUME='CONFIRMED_DATA_VOLUME'
RECOVERY_PARENT='/ABSOLUTE_EXISTING_RECOVERY_DIRECTORY'
BACKUP_FILE='ACTUAL_BACKUP.sqlite'

docker run --rm --network none \
  --mount "type=volume,source=${DATA_VOLUME},target=/data,readonly" \
  --mount "type=bind,source=${RECOVERY_PARENT},target=/recovery" \
  "$APP_IMAGE" \
  node server-dist/server/maintenance.js restore \
  "/data/backups/${BACKUP_FILE}" /recovery/restored /data/erasures.json
```

The command verifies backup age and integrity, restores into the new destination, applies current erasures and inactivity expiry, and revokes restored sessions. Review its JSON result and test the restored directory in isolation before changing the production `/data` mount. Restart only one instance and verify accounts, designs, assets and maintenance. Keep the restored current ledger with the database. A restore cannot recover unsynced work or changes made after the backup.

## Retention and operator actions

Accounts are retained for at least **three calendar months** after their last successful authenticated server activity, calculated in UTC with end-of-month handling. Failed logins, public views and offline-only work do not renew this period. Expired owners' projects and assets are removed, including shared designs they own. Contributions already copied into another owner's design remain there.

Destructive operator tools require the app to be stopped, the confirmed image and data volume, explicit command confirmations, and a one-shot offline container. They reject unsafe paths, active SQLite recovery files, symbolic links and unexpected files rather than forcing deletion.

- Account cancellation: `node server-dist/server/operations.js cancel-account /data USERNAME --confirm=USERNAME`. Verify the request and account ownership first; use the same normalized username twice.
- One-time prelaunch test reset: `node server-dist/server/operations.js reset-prelaunch /data --confirm=reset-3d-space-test-data`. This explicitly removes recognized test accounts, designs, models and backups, then initializes the current empty schema. Stop the service and verify the exact test volume first. Never use this for a normal upgrade; incompatible database startup does not invoke it.
- Permanent service closure: `node server-dist/server/operations.js close-service /data --confirm=erase-all`. This erases recognized service data and backups. Disable automatic deployments and remove the application afterwards so it cannot recreate an empty service.

If SQLite recovery files remain after every process using the confirmed volume has stopped, do not delete them by hand. Use SQLite itself in an isolated maintenance container to checkpoint and close the database; switching that stopped database to `PRAGMA journal_mode=DELETE` lets SQLite safely retire its WAL and shared-memory files. A busy database must be investigated, never forced.

The explicit v3 reset writes `prelaunch-reset-v3.json`. Only this valid marker enables retirement of the two known prototype browser databases; unknown databases and the current v3 store are never cleared automatically. Deleted-level sketch rows keep empty version tombstones so restoring a backup cannot revive an erased image or erase a later replacement.

These operations do not erase copies outside the selected service directory, files downloaded by others, infrastructure logs or external disks. Review such storage separately. Do not use destructive tools for routine deployments or schema troubleshooting.

## Localization and documentation contributions

Localization uses **i18next** and **react-i18next**. Use **`src/shared/i18n/i18n.ts`** as the application translation entry point and **`src/shared/i18n/locales/es/` / `src/shared/i18n/locales/en/`** for centralized catalogs. Translate complete messages with named interpolation, including errors, accessibility labels, dynamic feedback and help. Keep locale catalogs in parity. Avoid translating user-authored project names or persisted identifiers. The language choice belongs to application settings and is also available in the landing-page header.

To add a language, create the matching catalogs under `src/shared/i18n/locales/<code>/`, register its code and native display name in `src/shared/i18n/translations.ts`, and add its catalogs to `translationCatalogs` there. Supply localized help screenshots under `public/help/<code>/` and cover the new locale with the catalog-parity checks. Components use `t()` and `useLocale()` rather than per-language branches.

**Every change that affects app behavior or UI must review and update the help documentation in the same change.** Update both help catalogs, actual localized screenshots in `public/help/{es,en}/` when visible steps change, and relevant tests. The help must match button names, permission rules, mobile controls and offline/recovery behavior. Capture only isolated sample data, without real credentials or private content. See [`AGENTS.md`](AGENTS.md).

For new features, inspect all creators, renderers, validators, persistence paths and fixtures affected by the data contract. Keep trust-boundary validation and data-loss protection. Add targeted regression tests for new nontrivial behavior; run the relevant tests and the build. Do not reset shared data, loosen security controls or introduce compatibility layers as a substitute for a consistent current contract.

Bundled PBR textures and environment assets are CC0; their sources are recorded in [`public/materials/README.md`](public/materials/README.md) and [`public/environments/README.md`](public/environments/README.md). Review those files when replacing or redistributing assets.


## Release validation

Run `npm test`, `npm run build` and the Chromium/WebKit browser suites before publishing a data-contract change. `npx playwright test --project=gpu` uses installed Chrome without software graphics overrides and explicitly skips when a hardware backend is unavailable. Test artifacts under `docs/validation-v3/` identify their environment; sampled CPU render work is not a frame-rate guarantee.

The v3 verification includes an isolated Docker build, registration, a four-level design with stairs, a GLB and separate sketches, a consistent backup and a restore with session revocation. The guarded reset was also exercised on an isolated test volume and checked for empty tables and SQLite integrity. Physical Android/iOS installation, touch and browser storage behavior require separate device testing.
