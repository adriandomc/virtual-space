# 3D Space

[3D Space](https://3d.adriandomc.com) is a free browser application for designing rooms and previewing wall colors, floor finishes, furniture and lighting. Draw a floor plan, place doors and windows, build custom furniture, and walk through the resulting 3D space on desktop or touch devices.

The application is self-hosted: accounts use a username and password, and designs are stored on your server. Public viewing links, embeddable viewers and invited reader/editor access are optional. Private designs can be prepared for offline editing as an installable PWA.

For illustrated end-user instructions, open **Information → Help and getting started** in the app, or visit [`/help`](https://3d.adriandomc.com/help). Help text and screenshots follow the selected application language.

## Features

- Polygonal floor plans, reference images, dimensions and angle/grid snapping.
- Selectable objects with drag handles, numeric properties and placement warnings.
- Beds, wardrobes, vanities and nightstands; doors, windows and configurable lights.
- Wall and ceiling colors, hexadecimal color input, floor finishes and furniture materials.
- Standard, Realistic and Hyperrealistic rendering, with WebGPU and WebGL support.
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

Browser coverage includes preparation, startup without a server, local models and reference images, forced-offline network isolation, durable drafts and synchronization. Browser automation does not replace installation and storage-retention checks on physical Android and iOS devices.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
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
| `src/main.tsx`, `src/routes.ts` | Application bootstrap and public/account routes. |
| `src/AccountApp.tsx`, `src/Onboarding.tsx`, `src/App.tsx` | Authentication, library, optional setup and room editor. |
| `src/RoomScene.tsx`, `src/materials.ts`, `src/postProcessing.ts` | Three.js scene, TSL materials and rendering effects. |
| `src/PlanEditor.tsx`, `src/model.ts`, `src/types.ts` | Floor-plan editing, shared room validation and current data contract. |
| `src/ModelWorkshop.tsx`, `src/workshop*.ts` | Model construction, booleans, alignment, grouping and history. |
| `src/offline*.ts`, `src/appOffline.ts`, `vite.config.ts` | IndexedDB persistence, asset preparation, sync and generated service worker. |
| `src/server.ts`, `src/auth.ts`, `src/collaborationServer.ts` | HTTP API, account/session protection, access control and Yjs transport. |
| `src/databaseSchema.ts`, `src/backups.ts`, `src/operations.ts` | Atomic database initialization, backups and operator-only maintenance. |
| `src/i18n.ts`, `src/locales/` | Shared translation entry point and language catalogs. |
| `src/Help.tsx`, `public/help/{es,en}/` | Localized tutorial and real application screenshots. |
| `src/*.test.ts`, `e2e/` | Unit/integration and production-browser regression tests. |
| `public/materials/`, `public/environments/` | Bundled visual assets and provenance documents. |

## Data and synchronization

The only room contract is **`Room.version: 2`**. New designs receive explicit defaults at creation. Validation is shared across server requests, editor operations, imports, collaboration and offline storage. Every visible furniture item is persisted in the room; there is no implicit decoration layer.

Import and export use the self-contained **`3d-space-project` version 2** package: the room, reference image and all referenced GLBs. Imports validate the complete package before applying a local transaction and assign independent model identifiers. Old project formats are rejected rather than guessed or converted.

The server stores accounts, designs, reference images, models, memberships, collaboration state, sessions and security counters in `DATA_DIR/accounts.sqlite`. Initialization is atomic and schema-versioned. An unknown or partial schema stops startup without changing existing data; deployments do not automatically delete or convert it.

Private projects use durable account-scoped IndexedDB records and a pending queue. Preparation verifies all dependencies before marking content available. Explicit offline mode suppresses data requests, uploads, notifications and collaboration even when the network is available. Leaving offline mode checks the account, current permissions and revisions before syncing all pending projects and models. Conflicts preserve local work for recovery rather than silently overwriting server changes. Shared projects require independent personal copies for offline editing.

The production service worker caches the app, localized help and bundled visual assets. IndexedDB stores editable records separately from binary assets. Installation and storage persistence remain browser-controlled; exports are the user's independent backup. Local work does not count as server account activity until authenticated synchronization occurs.

## Authentication, privacy and limits

- Usernames are normalized to lowercase and require 3–32 ASCII letters, digits or underscores. Passwords require 8–128 characters and confirmation at registration. No email or password-recovery service is used.
- Passwords use scrypt with a random salt. Stored session tokens are hashed. Production cookies are `__Host-`, `Secure`, `HttpOnly` and `SameSite=Lax`; mutations validate the request origin.
- Session tokens expire within 30 days and are revoked at logout. A persistent cookie is used only when the optional remember-session checkbox is selected.
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
  node server-dist/maintenance.js restore \
  "/data/backups/${BACKUP_FILE}" /recovery/restored /data/erasures.json
```

The command verifies backup age and integrity, restores into the new destination, applies current erasures and inactivity expiry, and revokes restored sessions. Review its JSON result and test the restored directory in isolation before changing the production `/data` mount. Restart only one instance and verify accounts, designs, assets and maintenance. Keep the restored current ledger with the database. A restore cannot recover unsynced work or changes made after the backup.

## Retention and operator actions

Accounts are retained for at least **three calendar months** after their last successful authenticated server activity, calculated in UTC with end-of-month handling. Failed logins, public views and offline-only work do not renew this period. Expired owners' projects and assets are removed, including shared designs they own. Contributions already copied into another owner's design remain there.

Destructive operator tools require the app to be stopped, the confirmed image and data volume, explicit command confirmations, and a one-shot offline container. They reject unsafe paths, active SQLite recovery files, symbolic links and unexpected files rather than forcing deletion.

- Account cancellation: `node server-dist/operations.js cancel-account /data USERNAME --confirm=USERNAME`. Verify the request and account ownership first; use the same normalized username twice.
- Permanent service closure: `node server-dist/operations.js close-service /data --confirm=erase-all`. This erases recognized service data and backups. Disable automatic deployments and remove the application afterwards so it cannot recreate an empty service.

These operations do not erase copies outside the selected service directory, files downloaded by others, infrastructure logs or external disks. Review such storage separately. Do not use destructive tools for routine deployments or schema troubleshooting.

## Localization and documentation contributions

Localization uses **i18next** and **react-i18next**. Use **`src/i18n.ts`** as the application translation entry point and **`src/locales/es/` / `src/locales/en/`** for centralized catalogs. Translate complete messages with named interpolation, including errors, accessibility labels, dynamic feedback and help. Keep locale catalogs in parity. Avoid translating user-authored project names or persisted identifiers. The language choice belongs to application settings and is also available in the landing-page header.

To add a language, create the matching catalogs under `src/locales/<code>/`, register its code and native display name in `src/translations.ts`, and add its catalogs to `translationCatalogs` there. Supply localized help screenshots under `public/help/<code>/` and cover the new locale with the catalog-parity checks. Components use `t()` and `useLocale()` rather than per-language branches.

**Every change that affects app behavior or UI must review and update the help documentation in the same change.** Update both help catalogs, actual localized screenshots in `public/help/{es,en}/` when visible steps change, and relevant tests. The help must match button names, permission rules, mobile controls and offline/recovery behavior. Capture only isolated sample data, without real credentials or private content. See [`AGENTS.md`](AGENTS.md).

For new features, inspect all creators, renderers, validators, persistence paths and fixtures affected by the data contract. Keep trust-boundary validation and data-loss protection. Add targeted regression tests for new nontrivial behavior; run the relevant tests and the build. Do not reset shared data, loosen security controls or introduce compatibility layers as a substitute for a consistent current contract.

Bundled PBR textures and environment assets are CC0; their sources are recorded in [`public/materials/README.md`](public/materials/README.md) and [`public/environments/README.md`](public/environments/README.md). Review those files when replacing or redistributing assets.
