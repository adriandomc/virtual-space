# Version 3 validation

Recorded on 2026-10-16. These checks use isolated accounts, temporary databases and test volumes. They do not modify the production service.

The multilevel release Node suite completed **456 tests: 454 passed, two Windows symlink tests skipped, zero failures**. This includes current schema, persistence/cache, authorization, geometry, navigation, project packages, offline synchronization, localization and dependency-guard checks. The final codec regressions verify concurrent roof/stair finishes through two authenticated live clients, persistence after server restart, and rejection of raw arrays replacing ID-based Yjs collections. The later PWA recovery checks are recorded separately below.

## Browser coverage

| Environment | Result |
| --- | --- |
| Playwright Chromium on Windows, SwiftShader WebGL2 | Full run on `043123e`: **31 passed, zero failures or skips**, 3.5 minutes; the final collaboration/roof/offline changes also passed focused checks. |
| Playwright WebKit on Windows | Full 32-case run on `668feaa`: **30 passed, one failed, one skipped**, 4.9 minutes. The initial-editor readiness failure then passed a focused rerun: **one passed**, 9.6 seconds. The skipped case requires Chromium's CDP touch injection. |
| Installed Chrome 155.0.8059.84, AMD Radeon 8060S, WebGPU | **One hardware stress test passed**, zero failures or skips, 1.5 minutes. All 1/4/12-level scenarios completed 20 level selections and 20 actual walkthrough cycles. |
| Physical Android / iPhone / iPad | Pending. Desktop engines and touch emulation do not establish installation, storage retention, thermal behavior or performance on a physical device. |

The original 31-case browser runs used application commit `043123e`. Commit `deadd9c` subsequently corrected the ID-based collaboration representation for roof and stair finishes without changing the interface or geometry. Its production build passed **10 focused cases, five Chromium and five WebKit, in 2.2 minutes**, covering concurrent roof/stair finishes, roof editing, independent slab finishes, forced offline preparation and offline model synchronization. The earlier WebKit offline-readiness failure did not reproduce in that focused rerun or in the final full run; the original 15-second assertion and all zero-request checks remained enabled. The final `668feaa` build adds strict collection-type validation; all applicable construction cases and all five offline cases passed together in its full WebKit run.

Browser retries are disabled. Focused reruns followed identified fixes: offline recovery controls obstructed by a status overlay, stale surface selection, a first drag affected by layout changes, orbit wheel rendering, and public help attempting a release check while offline. Network-delay fixtures block service workers only for the account-switch race; PWA tests run with service workers enabled.

The final WebKit failure occurred after English mobile setup: its trace recorded about 15 seconds without a frame during WebGL initialization, followed by the correct editor in the final DOM. Only that fixture's first WebKit editor-readiness assertion now allows 45 seconds; Chromium and every subsequent functional assertion retain their normal timeouts. The focused rerun completed in 8.9 seconds, additionally checking positive renderer draw calls. No application behavior changed for this calibration, and the full-run failure remains reported above.

The construction cases cover four optional setup steps preserving edits, independent wall/floor/slab finishes, additive walls and rooms, holes and undo, empty/copied levels and the 12-level cap, five stair forms, four roof templates and atomic free-form edits, mobile graphics controls, and plan gestures. Actual mouse-look and WASD input climb and descend straight and spiral stairs. Shared-draft disconnection and a real logout/account switch are exercised through the UI. A separate final collaboration regression holds outgoing WebSocket updates from two real tabs until both finish edits have been made, then releases them together and checks that different roofs and stairs retain both colors after reload.

The five offline cases cover preparation of unopened designs and model/image dependencies, no data requests in forced offline mode, cold offline reload of locally created designs and edited GLB models, synchronization of all pending work, independent shared-design copies, and logout protection. Help text and all twelve locale-specific JPEGs are also opened without a server connection.

## Repeat the checks

```sh
npm run build
npx playwright test --project=chromium
npx playwright test --project=webkit
npx playwright test --project=gpu
npm test
```

The Playwright setup starts its own server on `127.0.0.1:5188`, uses a temporary data directory and removes it on teardown. Keep that port free. The `gpu` project launches installed Chrome without the software-renderer flags used by the Chromium regression project.

## Rendering and interaction measurements

[Software renderer measurements](chromium-software-renderer.json) record a standard-quality rectangular building with 1, 4 or 12 levels, one nightstand and one light on the ground floor. No imported model is used in this fixture. The test changes a wall color, drags furniture directly from a wall selection, confirms both through the server, and makes 20 active-level selections. Renderer samples are taken after the last operation with a fresh timestamp and the expected active level.

| Levels | Load to ready | Paint to saved | First drag to saved | Architecture builds before / after | GPU geometries before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 923 ms | 658 ms | 514 ms | 1 / 1 | 36 / 35 |
| 4 | 1,182 ms | 494 ms | 531 ms | 4 / 4 | 63 / 46 |
| 12 | 1,375 ms | 1,008 ms | 526 ms | 12 / 12 | 135 / 118 |

Each fixture retained one canvas and one resident level. Texture counts stayed level or decreased. Timings include automation, UI scheduling, persistence and assertion overhead. `frameMs` is sampled CPU render work, including diagnostic collection; it is not GPU execution time or an FPS measurement. SwiftShader demonstrates functional fallback and bounded allocations, not hardware performance.

[WebKit measurements](webkit-renderer.json) use the same interaction fixture. Architecture build counts remained 1, 4 and 12 across the corresponding 20-selection runs; GPU geometry counts ended at 35, 46 and 118, and each retained one canvas. These measurements do not establish performance on an iPhone or iPad.

The hardware fixture uses four wardrobes and one light per level, realistic materials, 20 level selections, and 20 measured Enter walkthrough → W → S → Exit cycles per building size, after a warmup. [Hardware measurements](hardware-renderer.json) and [device identification](gpu-device.json) record the final application revision `668feaa`, installed Chrome 155.0.8059.84 and the AMD Radeon 8060S adapter. The application used WebGPU. All three scenarios completed their actual keyboard movement cycles with one renderer and at most three resident levels.

| Levels | Architecture builds before / after | GPU geometries before / after | GPU textures before / after | Final sampled CPU render work |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1 / 1 | 68 / 68 | 8 / 8 | 1.5 ms |
| 4 | 4 / 4 | 95 / 95 | 8 / 8 | 1.7 ms |
| 12 | 12 / 12 | 167 / 167 | 8 / 8 | 1.8 ms |

The artifact also preserves fresh allocation counters, per-cycle measurements and limited animation-frame cadence samples. CPU render work is not GPU frame time, and browser animation callbacks do not establish sustained display FPS. These results have no FPS thresholds or guarantees for other devices. Physical Android/iOS installation, storage and thermal testing remain pending.

## Container, backup and reset

[Linux infrastructure checks](linux-infrastructure.json) record **21 passed, zero skipped** in the final `668feaa` Docker image, limited to one CPU and 512 MiB with networking disabled. These cover schema, backup and operator protections, including the symlink cases unavailable on Windows. No production volume was mounted.

[Restore evidence](container-restore.json) records an isolated Node 24 Linux container built from `deadd9c`, restoring a current-schema project with four levels, a stair, a GLB model and four reference images. The recovered comparison covers nine tables, 21 rows and 223,470 BLOB bytes. Restoration then revokes the one restored session; the resulting 20-row digest is expected to differ while the BLOB byte total remains unchanged. Integrity and foreign-key checks passed, and the restored roof/stair collaboration collections were checked explicitly.

[Reset evidence](container-reset.json) records a separate isolated test volume reset with that same image to schema version 3, zero accounts/designs/levels/images/models, and SQLite integrity `ok`. Both artifacts include required slab-underside finishes and the final backend cache and collaboration codec. Neither test mounts the production volume or constitutes a production deployment.

Normal startup never invokes the destructive reset. Backup restoration and test reset use the documented operations commands in the repository README, with the service stopped and the exact isolated data directory selected.

## Visual references

The illustrated guide uses actual application captures in [`public/help/es`](../../public/help/es) and [`public/help/en`](../../public/help/en), six native JPEGs per locale at 1280 × 800. Additional native captures show [mobile onboarding](mobile-onboarding.jpg) and the [desktop editor](desktop-editor.jpg). Mobile layout was also checked at 390 × 844; automated bounds assert visible setup geometry, collapsed advanced stairs and touch targets of at least 44 CSS pixels. These images and bounds checks complement interaction tests; they do not replace physical-device checks.

## PWA update recovery after release

Application revision `3e4976d` adds the visible guarded-update notice, its recovery-screen action and a clear rejection of retired v2 writes. The Node suite completed **462 tests: 460 passed, two Windows symlink tests skipped, zero failures**. TypeScript and the production build passed. The ES/EN offline-guide images were replaced with isolated application captures before the final build.

The final production artifact passed **six lifecycle cases: three Chromium and three WebKit**, in 37.0 seconds:

- An unfinished wall trace refuses activation and preserves its points. After cancelling the trace, the update reloads safely and later full library/editor navigations retain the new worker.
- A cached unusable setup module reaches the actual recovery screen; the update notice activates the replacement worker and opens the same saved design.
- Forced offline mode hides the notice and performs no API or worker checks after focus and Settings interaction. At 390 × 844, the notice remains within the viewport and its actions are at least 44 CSS pixels.

The fixture uses real workers and caches, two deployment identities and separately versioned immutable module URLs around one compiled current application. It does not emulate or convert retired project data. The server regression separately checks actual v2 write payloads, current-project preservation and unchanged authentication, origin and ownership boundaries.

Five production-source unit regressions additionally cover shared in-flight update requests without freezing during downloads, preserving other operations' update/mode freezes after a failed request, clearing transient waiting state after first activation, refusing updates in forced offline mode, and refusing the later activation handshake if forced mode was selected during a download.

Six existing regression cases also passed on that same final artifact: **three Chromium in 32.4 seconds and three WebKit in 46.5 seconds**. They cover the English mobile setup/editor/workshop flow, bilingual illustrated help and a cold offline reopen, and preparing 12 levels with model/reference dependencies before zero-request forced offline use. Both help cases explicitly check that fresh activation leaves no false update notice. Each engine uses a fresh temporary server/database so the combined upload fixtures do not exceed the application's unchanged per-IP upload budget.

```sh
npx playwright test e2e/pwaUpdate.spec.ts --project=chromium --project=webkit
```
