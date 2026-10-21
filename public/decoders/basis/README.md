# Local Basis Universal transcoder

`basis_transcoder.js` and `basis_transcoder.wasm` are copied unchanged from the pinned Three.js 0.180.0 package, `examples/jsm/libs/basis/`, by `scripts/copy-texture-transcoder.mjs` during `npm ci`. They are served from this directory and included in the complete offline application generation. No CDN is used.

The decoder is provided by [Basis Universal](https://github.com/BinomialLLC/basis_universal) under the Apache License 2.0; see [LICENSE](LICENSE). The included license text comes from the upstream `v1_60_snapshot_final` release. Three.js distributes these transcoder artifacts with its KTX2Loader integration.

Changing Three.js requires reviewing the loader/decoder combination and updating the explicit version check in the copy script. Regression tests compare both checked-in decoder files byte-for-byte with the installed Three.js package. The application runs at most one texture worker on coarse-pointer devices and two on desktop, and submits transcodes through the shared heavy-graphics-job budget.
