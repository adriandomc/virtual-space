# Working on 3D Space

## Required documentation and localization review

**Whenever a change affects application behavior, workflows, controls, permissions, persistence, offline use, or visible UI, review the help documentation and update it as needed in the same change.** This applies to features, fixes, removals and renamed controls; documentation maintenance is part of completing the work.

1. Read the affected sections of `src/Help.tsx` and both `src/locales/es/help.json` and `src/locales/en/help.json` before changing behavior.
2. Update the getting-started steps and detailed instructions so they match the actual application. Check desktop and touch controls, owner/editor/reader access, online/offline behavior and recovery paths where relevant.
3. Update both Spanish and English help catalogs together. Help must switch with the selected app language, including headings, paragraphs, captions, search text and image alternative text.
4. When visible controls or illustrated steps change, replace the relevant real application screenshots in `public/help/es/` and `public/help/en/`. Use isolated sample accounts and designs. Never capture real credentials, personal content or private infrastructure. Keep image references, localized captions and alt text correct.
5. Check that `/help` and its screenshots remain usable on mobile and in a prepared offline production build. If a change does not require help edits, state the reason in the change description.
6. Update `README.md` when developer setup, configuration, storage, commands, architecture or operating procedures change. Keep the README in English and focused on contributors and self-hosting.

All new user-facing strings belong in the shared localization system through `src/i18n.ts` and the matching Spanish/English catalogs under `src/locales/`. Include validation messages, server responses displayed in the UI, accessibility labels, dynamic statuses and empty states. Translate complete messages with named interpolation. Do not translate persisted enum values, identifiers, usernames or user-authored content. Keep both locale catalogs in parity and allow adding another locale without spreading language checks across components.

## Implementation and verification

- Use the current `Room.version: 2` contract and shared validation. Changes must reach all affected creators, renderers, import/export, server, collaboration, offline records and fixtures. Do not interpret missing required fields as old defaults or restore retired formats.
- Keep existing ownership checks, authentication/rate limits, origin checks, upload validation and protections against data loss. Document relevant permission and recovery behavior honestly.
- Preserve durable local work and account isolation. Do not clear pending drafts, binary assets or another account's storage to hide a synchronization problem.
- Use existing patterns and dependencies before adding an abstraction. Add focused regression coverage for nontrivial behavior and run affected tests plus the build. Changes to offline caching, routing or synchronization also need production-build browser checks.
- Do not use real production accounts or data for tests and screenshots. Never run reset, account cancellation, service closure or restore against shared storage without explicit authorization and confirmed targets. Deployment must preserve the existing `/data` volume.
- Report what was verified and any untested device-specific behavior. Desktop emulation does not prove installation, touch input or storage retention on physical Android/iOS hardware.

## Useful commands

```sh
npm run dev:server
npm run dev
npm test
npm run build
npm run test:e2e
npm run test:e2e:webkit
```

Use Node.js 24. Keep runtime dependencies in the existing single Dockerfile deployment, serving the client and API on port 8080 with persistent `/data`. See the README for backup verification and guarded operator commands.
