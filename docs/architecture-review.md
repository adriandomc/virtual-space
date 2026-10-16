# Architecture and resource review

Reviewed on 2026-10-16 against the working tree for the PWA and interaction update. This records the changes and remaining limits found in this review; it is not a claim that the application has no other defects.

## Backend changes verified

| Finding | Implemented protection |
| --- | --- |
| Unbounded concurrent model/sketch request buffers | Before reading, reserve the maximum body size. Allow two binary uploads per process and one per uploading account; eight project JSON bodies per process and two per account. Both classes share a 40 MiB reservation budget. Reject overload with `429` and `Retry-After: 5`; release reservations after completion, parsing failure, permission failure or client abort. |
| No cumulative limit on owned project content | Transactional defaults of 50 designs and 500 MiB per owner. Count canonical project JSON, sketch bytes and model bytes once; charge guest edits to the design owner. Preserve the existing 100-model/100-MiB model limit. `ACCOUNT_MAX_DESIGNS` and `ACCOUNT_MAX_BYTES` configure the cumulative limits. |
| A failed quota check could leave partial writes or receipts | Check the persisted delta in the same transaction as canonical JSON, Yjs state and confirmation receipts. Tests verify rollback and lost-confirmation retries. Already over-limit accounts can still read, export, delete and perform changes that reduce their stored content. |
| Different GLB boundaries online and offline | One Uint8Array validator supplies server and offline metadata. It preserves the existing graph, instance, material, triangle, texture, transform and external-resource restrictions before decoding. Offline metadata no longer needs to instantiate a Three.js scene. |
| Image signatures did not constrain decoded memory | Shared PNG/JPEG/WebP header inspection before preview or persistence: 10 MiB compressed, 8192 pixels per axis, and 16,777,216 pixels overall. GLB textures retain their stricter 4096-pixel axis limit. Reject inconsistent WebP canvas/bitstream dimensions and animated WebP sketches. |
| Persistence authority lived in the WebSocket transport | HTTP and WebSocket use the project command service for authorization, references, canonical/Yjs transactions, quota checks and durable receipts. Publication remains after commit. |
| Automated valid/no-op mutations could accumulate receipts outside the content quota | Default rolling budget of 100,000 new receipts per design owner over 30 days, configurable through `ACCOUNT_MAX_RECEIPTS`. Check inside the canonical transaction before writing a receipt; reject with `429` and retry guidance. Preserve existing retries, erasure and storage-reducing edits. |
| Backup hashing and isolated restoration blocked HTTP processing | Run verification in a worker opening only the immutable snapshot. Keep serialized snapshot publication, schema/integrity/reference checks, restore comparison, erasure provenance and session revocation. Source and compiled worker entry points are verified. |
| Static requests repeated synchronous reads, hashes and compression | Build hashes/gzip variants once. Production responses stream prepared files asynchronously. HTML, manifests and service workers remain revalidated; hashed assets remain immutable. Only the exact raw `/embed` route relaxes framing protection; encoded aliases and trailing slashes do not. |

The database schema remains v3. No account, project, sketch, model, session or production storage was reset by this work.

## Measurements and regression checks

Measurements below are local Windows/Node.js 24 checks, not production capacity guarantees. Worker startup increases total verification time while keeping the main thread available.

| Scenario | Observed result |
| --- | --- |
| Verify and restore a snapshot with a 16 MiB binary, otherwise idle | Synchronous verification blocked the main thread for 76–77 ms. Worker verification took about 190–201 ms overall; the measured main-loop maximum interval gap was 16–17 ms. |
| Same snapshot check during the complete test suite | Synchronous blocking was 221 ms. Worker elapsed time was 518 ms; the measured main-loop maximum interval gap was 18 ms. |
| Twelve parallel downloads of an approximately 3 MB prepared JavaScript asset, otherwise idle | Concurrent session API response: 7 ms. Download p95: 85 ms. |
| Same static test during the complete suite | Concurrent session API response: 14 ms. Download p95: 151 ms. |

Focused coverage includes slow/aborted binary and JSON requests, early quota rejection, unchanged prior images after failed replacement, owner/guest isolation, receipt retries, invalid images and GLBs, scoped twelve-level updates, restoration after erasures, static conditional requests, frame protections and worker failures. The full Windows suite completed with **495 tests: 493 passed, 2 skipped, 0 failed**. The two skipped cases require Unix-style symbolic-link support; Linux container checks are reported separately.

## Receipt-budget behavior and remaining physical-storage limit

The 500 MiB account quota intentionally covers user content, not duplicated Yjs state or mutation receipts. Receipts retain successful operation identities for 30 days so a lost confirmation cannot duplicate a previously committed mutation.

Before this change, a client could submit repeated valid small Yjs operations with new operation IDs without growing canonical content. The existing WebSocket account limit of 1200 messages/minute alone allowed a theoretical `1200 × 60 × 24 × 30 = 51,840,000` attempts per 30 days, not a measured successful throughput.

The implemented default permits **100,000 new confirmed receipts per design owner within the existing 30-day window**. The check includes guest operations against that owner's designs and is transactional with canonical JSON, Yjs state and the receipt. No-op mutations consume the allowance. A rejected mutation rolls back its state, revisions and receipt together. Existing receipt retries bypass the new-operation budget and still acknowledge the original result; no valid receipt is evicted early. HTTP supplies `Retry-After`, and WebSocket errors carry the same retry interval. The application preserves the rejected work for recovery. Operators can configure `ACCOUNT_MAX_RECEIPTS` without changing schema v3.

Read/export/delete remain available. Edits that actually reduce the owner's stored content are also allowed above the operation budget, and retain their own durable receipts. **This exception means 100,000 is an admission budget for non-reducing writes, not an absolute physical receipt-count or disk-space ceiling.** An attacker with previously allocated reducible content could create additional reduction receipts. Avoid claiming that either this budget or the 500 MiB content quota bounds the complete SQLite file.

Operators should monitor aggregate database/receipt growth and available disk space alongside the existing backup status. This is an infrastructure check, not client analytics or telemetry. Further hard disk bounds would require a separately designed recovery-preserving policy for reducing operations; simply deleting receipts would break idempotency. Multi-instance deployments against one SQLite volume remain unsupported.
