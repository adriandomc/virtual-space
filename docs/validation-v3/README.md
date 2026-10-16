# Version 3 validation

Recorded on 2026-10-16. These checks use isolated accounts, temporary databases and test volumes. They do not modify the production service.

The final Node suite completed **453 tests: 451 passed, two Windows symlink tests skipped, zero failures**. This includes current schema, persistence/cache, authorization, geometry, navigation, project packages, offline synchronization, localization and dependency-guard checks.

## Browser coverage

| Environment | Result |
| --- | --- |
| Playwright Chromium on Windows, SwiftShader WebGL2 | All 31 current cases passed across a complete 30-case run and focused reruns after fixes, plus the new mobile onboarding case. This is an aggregate result, not a claim that one final 31-case Chromium run was executed. |
| Playwright WebKit on Windows | Full run in progress; update this row from its actual result. |
| Installed Chrome with its normal graphics backend | Hardware run pending; software adapters are explicitly skipped. |
| Physical Android / iPhone / iPad | Pending. Desktop engines and touch emulation do not establish installation, storage retention, thermal behavior or performance on a physical device. |

Browser retries are disabled. Focused reruns followed identified fixes: offline recovery controls obstructed by a status overlay, stale surface selection, a first drag affected by layout changes, orbit wheel rendering, and public help attempting a release check while offline. Network-delay fixtures block service workers only for the account-switch race; PWA tests run with service workers enabled.

The construction cases cover four optional setup steps preserving edits, independent wall/floor/slab finishes, additive walls and rooms, holes and undo, empty/copied levels and the 12-level cap, five stair forms, four roof templates and atomic free-form edits, mobile graphics controls, and plan gestures. Actual mouse-look and WASD input climb and descend straight and spiral stairs. Shared-draft disconnection and a real logout/account switch are exercised through the UI.

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
| 1 | 938 ms | 674 ms | 530 ms | 1 / 1 | 36 / 35 |
| 4 | 1,270 ms | 686 ms | 507 ms | 4 / 4 | 63 / 46 |
| 12 | 1,368 ms | 1,000 ms | 524 ms | 12 / 12 | 135 / 118 |

Each fixture retained one canvas and one resident level. Texture counts stayed level or decreased. Timings include automation, UI scheduling, persistence and assertion overhead. `frameMs` is sampled CPU render work, including diagnostic collection; it is not GPU execution time or an FPS measurement. SwiftShader demonstrates functional fallback and bounded allocations, not hardware performance.

The hardware fixture uses four wardrobes and one light per level, realistic materials, 20 level selections, and 20 measured Enter walkthrough → W → S → Exit cycles per building size, after a warmup. Its artifact records the actual device, rendering backend, fresh allocation counters, CPU samples and limited animation-frame cadence samples. There are no FPS thresholds or guarantees for other devices. Record the hardware result here when the run completes.

## Container, backup and reset

[Restore evidence](container-restore.json) records an isolated Node 24 Linux container restoring a current-schema project with four levels, a stair, a GLB model and four reference images. The recovered comparison covers nine tables, 21 rows and 223,624 BLOB bytes. Restoration then revokes the one restored session; the resulting 20-row digest is expected to differ while the BLOB byte total remains unchanged.

[Reset evidence](container-reset.json) records a separate isolated test volume reset to schema version 3, zero accounts/designs/levels/images/models, and SQLite integrity `ok`. These artifacts include required slab-underside finishes. They precede the final backend-cache image rebuild; the release operator should record that final image verification separately rather than treating these files as a published commit attestation.

Normal startup never invokes the destructive reset. Backup restoration and test reset use the documented operations commands in the repository README, with the service stopped and the exact isolated data directory selected.

## Visual references

The illustrated guide uses actual application captures in [`public/help/es`](../../public/help/es) and [`public/help/en`](../../public/help/en), six native JPEGs per locale at 1280 × 800. Additional native captures show [mobile onboarding](mobile-onboarding.jpg) and the [desktop editor](desktop-editor.jpg). Mobile layout was also checked at 390 × 844; automated bounds assert visible setup geometry, collapsed advanced stairs and touch targets of at least 44 CSS pixels. These images and bounds checks complement interaction tests; they do not replace physical-device checks.
