# Graphics performance

The rendering changes retain Three.js 0.180.0, TSL and `WebGPURenderer`, including its WebGL2 fallback. WebAssembly is used by the bundled Basis texture transcoder; it is not a replacement renderer. Project v3, API routes, uploaded GLB formats, authentication, collaboration and durable offline queues are unchanged. There is no storage reset, analytics or external rendering service.

## Implementation

| Area | Current behavior |
| --- | --- |
| Scene updates | Levels and entities reconcile independently. Material colors retain geometry; transforms retain model buffers; opening commits rebuild affected walls. Navigation and lighting have separate signatures. |
| Pointer interaction | Furniture, lights and opening frames preview through temporary transforms. Valid recovery checkpoints coalesce at 500 ms intervals with one write in flight. Release performs full validation and the normal authoritative commit. |
| Rendering | Idle orbit and walkthrough views stop submitting frames. Hidden and workshop-covered viewers pause. Dirty state resumes rendering for interaction, transitions, assets or document changes. |
| Automatic quality | Starts with a 60 FPS target and device-specific quality; sustained movement can reduce unpinned settings and use 30 FPS. Dwell times prevent rapid oscillation. Idle time does not raise quality, and explicit user settings remain fixed. |
| Recovery | Context/device loss recreates graphics resources, preserves the document and camera, and keeps unfinished work under the existing save guards. Repeated loss can fall back to WebGL2. |
| Draw submission | Compatible catalog pieces use grouped render geometry. Editable source pieces and picking identities remain available. |
| Imported models | Immutable display geometry is template-owned and shared between instances. The workshop gets editable copies. Templates deduplicate loads and evict unused entries by estimated bytes. |
| Picking | BVH construction runs in workers on copied derivative buffers. Stale results are discarded. Native picking remains available during preparation or after worker failure. Original triangle indices and visibility/paint filtering remain intact. |
| Textures | Bundled photographic maps use KTX2/Basis mip chains and a local JS/WASM decoder, with original-image fallback. Source resolution limits are respected. Prepared offline assets include both paths. Uploaded images are not converted to a new project format. |
| Workshop | Demand rendering, worker booleans and sparse undo records reduce repeated work. Structural edits still keep full snapshots; vertex records preserve authored normals and tangents. |

The frame of a moving opening previews immediately; its wall-hole geometry currently changes on release. Checkpoints are recoverable local drafts, not intermediate collaboration updates. A pending write or failed commit must never be discarded merely to make a renderer restart succeed.

The shared heavy-job admission budget allows one active job on coarse-pointer devices and two on desktop, per application context, with at most 64 waiting admissions. BVH preparation also bounds its own queue. The model-template cache targets 32 MiB on coarse-pointer devices or 64 MiB otherwise and can retain live resources above that target. Derived roof geometry is bounded to 8 MiB and 64 entries. Workshop history targets 20 entries and 64 MiB, retaining the nearest state when one operation alone exceeds that target. These are estimates and ownership policies, not hard limits on total browser or GPU memory.

Ownership rules and extension points are in [Architecture](architecture.md). Contributor setup, texture regeneration and decoder provenance are in the [README](../README.md#rendering-and-visual-assets).

## Measuring a change

Build production browser fixtures with `npm run build:e2e`. `npx playwright test --project=gpu` uses installed Chrome and skips a hardware test when the adapter cannot be identified or is a software renderer. Ordinary Chromium/WebKit functional tests remain separate; SwiftShader results are useful for correctness, not hardware performance claims.

Profiling is enabled by `?profile=1` or `VITE_SCENE_DIAGNOSTICS=true`. Diagnostic canvas attributes expose:

- `renderedFrames`: submitted main frames, excluding extra shadow and postprocessing render calls. It is not a count of display presentations.
- `cpuFrameMs`: measured CPU work for the viewer update and submission, excluding diagnostic scene traversal. `frameMs` is the narrower renderer-submission measurement.
- `cadenceMs`: elapsed time between consecutive submitted frames during activity. It is distinct from a `requestAnimationFrame` callback interval.
- `gpuFrameMs`: the asynchronously resolved WebGPU pass-set duration when timestamp queries are supported. `gpuTiming` identifies this as `webgpu-pass-set`; it sums the most recently recorded query for each render context, rather than measuring display latency. It is sampled periodically and may span multiple main frames. Missing timing stays null; CPU timing is not substituted. Three.js r180's WebGL resolver aggregates all frames since its previous resolution, so WebGL timing is disabled and reported as `unavailable`; its automatic decisions use CPU work and frame cadence.
- Effective graphics settings, camera pose, draw calls, rendered triangles, estimated scene resources and renderer-owned geometry/texture counts.
- A bounded distribution of the latest 4,096 diagnostic frames. Sorting and scene traversal occur only for opt-in diagnostic snapshots.

`space-profile-snapshot` requests one diagnostic frame; `space-profile-reset` clears the sample window without resetting the cumulative main-frame counter. These events are installed only during profiling. They must not drive continuous benchmark animation, because that would confuse forced redraws with user interaction.

### Functional and resource regressions

`e2e/graphics-performance.spec.ts` checks idle orbit/walk submission, keyboard wakeup, repeated light switches, immediate drawing-buffer scaling, geometry retention when painting and camera/document preservation after context loss. Unit tests cover adaptive settings, diagnostic bounds, transient transforms, checkpoint ordering and quota failures, shared-buffer ownership, worker cancellation and sparse history. Light shadow participation changes replace the analytic light binding without rebuilding fixture meshes; size changes preserve renderer-owned targets. Visibility caching invalidates on descendant changes, and independent ceiling fades must settle so the viewer can sleep.

`e2e/gpu.spec.ts` exercises the existing small Realistic fixture with four wardrobes per level, at 1, 4 and 12 levels. It performs twenty level changes and twenty walkthrough cycles, checking that resources stabilize. The comparisons below come from that fixture, not a fully visible dense building or a sustained FPS measurement.

Hardware for the recorded comparison: **AMD Radeon 8060S, Chrome 155.0.8059.85, Windows**.

| Measurement | Before | After |
| --- | ---: | ---: |
| Reported draw calls, small fixture | 67 | 23 |
| Renderer geometries, 1 level | 69 | 25 |
| Renderer geometries, 4 levels | 96 | 52 |
| Renderer geometries, 12 levels | 168 | 124 |

After twenty level changes and twenty walkthrough cycles, the final fixture still reports 25/52/124 geometries for 1/4/12 levels and eight textures in each case, matching the starting values. The draw-call reduction in this fixture is approximately 66%.

Lower draw calls and retained geometry counts demonstrate less work in this fixture; they do not establish a universal speedup, visual equivalence by themselves or phone frame rates. Compare equivalent viewport size, backend, style, device preferences and presentation mode before attributing differences to code.

### Sustained rendering

`e2e/graphics-performance.gpu.spec.ts` distributes 64 double-drawer vanities across 1, 4 or 12 levels and runs a 60-second active-level orbit in each of Standard, Realistic and Hyperrealistic. This produces nine scenarios. The number of visible active-level furniture items decreases as items are distributed across more levels; results must not be interpreted as equal visible loads or full-building rendering.

Each scenario records actual camera movement, per-second main-frame rates, effective automatic graphics settings, resolved target attainment, CPU/cadence distributions, optional GPU durations and resource counts. It rejects object dragging, stale samples, mostly stationary camera input and submissions below a conservative 10 FPS measurement floor. That floor is a test-validity check, not acceptance of the 30/60 FPS experience. Inspect target attainment and sustained latency separately. The saved project must remain unchanged. Console errors fail the run, renderer warnings are recorded, and JSON output is retained even on failure.

Recorded on October 21, 2026, using the hardware above, WebGPU, a 1280 × 720 viewport and device pixel ratio 1. All nine runs retained the automatic 60 FPS target, 100% render scale, high geometry/AO, 2048 shadow/texture settings and 160-unit draw distance. Texture settings are a ceiling; bundled source maps do not gain artificial resolution. There were no console errors or renderer warnings.

| Levels | Visible furniture | Style | Submitted FPS | CPU p95 / cadence p95 | Target-met windows |
| --- | ---: | --- | ---: | --- | ---: |
| 1 | 64 | Standard | 59.99 | 2.3 / 16.8 ms | 59/59 |
| 1 | 64 | Realistic | 59.95 | 3.8 / 16.8 ms | 58/59 |
| 1 | 64 | Hyperrealistic | 59.95 | 4.2 / 16.8 ms | 58/58 |
| 4 | 16 | Standard | 59.98 | 1.3 / 16.8 ms | 59/59 |
| 4 | 16 | Realistic | 59.94 | 1.8 / 16.8 ms | 59/59 |
| 4 | 16 | Hyperrealistic | 59.94 | 1.9 / 16.8 ms | 58/58 |
| 12 | 6 | Standard | 59.98 | 1.2 / 16.8 ms | 57/58 |
| 12 | 6 | Realistic | 59.94 | 1.4 / 16.8 ms | 57/58 |
| 12 | 6 | Hyperrealistic | 59.95 | 1.5 / 16.8 ms | 57/58 |

The test writes the per-window measurements, camera motion, effective settings and resource counts to `sustained-rendering.json` in its Playwright output directory. These are measured results for this device and active-level fixture, not a before/after FPS comparison or a guarantee for a fully visible twelve-level building.

### Verification record

- Unit/integration suite: 653 passed, two skipped, zero failures.
- Production browser build: architecture boundaries, TypeScript, static-asset hashes and server compilation passed.
- Chromium's full functional run initially passed 88 of 89 tests. The color-change geometry regression was fixed and its focused checks passed. The final graphics regression file, including the added light-switch case, passed all four tests.
- WebKit's full functional run initially passed 81 tests with seven platform skips and one stair-walk failure. The stale shadow binding behind that failure was fixed. Both stair-walk regressions, idle rendering, painting/resolution and context recovery passed on rerun; the added light-switch regression also passed. The full functional suites were not repeated after those final focused fixes.
- Hardware Chrome: all four GPU tests passed, including the nine sustained scenarios and KTX2 uploads/recovery on both WebGPU and WebGL2. Actual rendered material screenshots were inspected on both backends.

## Verification limits

Physical Android and iPhone/iPad installation, thermal behavior, touch input and storage retention remain pending. Desktop emulation cannot verify them. This hardware result does not represent all integrated GPUs or medium-range phones. GPU timestamps depend on browser/backend support, and profiling itself adds overhead.

Docker CLI is available in the current verification environment, but its daemon is not running. A container build/run has not been verified here. Deployment continues to use the existing single Dockerfile and `/data`; production data must be preserved.
