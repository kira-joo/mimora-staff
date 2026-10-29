# Self-hosted fonts

These files replace `next/font/google` so a production build never fetches from
fonts.googleapis.com / fonts.gstatic.com. They are loaded through
`next/font/local` (which keeps Next's automatic fallback metric adjustment).
Fetched 2026-10-22 from IBM's official npm packages (below).

**License:** both families are SIL Open Font License 1.1. IBM's own copy of the
license, with IBM's copyright and the "Plex" Reserved Font Name, is
`IBM-Plex-LICENSE.txt`; `OFL.txt` is the plain license text. Both must stay with
these files. The fonts may be bundled and redistributed with software but not
sold on their own; Modified Versions must not use a Reserved Font Name.

**IBM Plex files are UNMODIFIED** (2026-10-22). IBM Plex carries the Reserved
Font Name "Plex", and a subset is a Modified Version that may not use it. So the
Plex files here are IBM's own release files, byte-for-byte, from the official
npm packages (`npm pack @ibm/plex-sans@1.1.0`,
`@ibm/plex-mono@2.5.0` → `package/fonts/complete/woff2/`), under IBM's own file
names, with IBM's license as `IBM-Plex-LICENSE.txt`. They are larger than a
subset would be — the price of not modifying them.

| Family | Version | Source | Copyright (font `name` table) | Files |
|---|---|---|---|---|
| IBM Plex Sans | 3.005 (npm `@ibm/plex-sans@1.1.0`) | https://www.npmjs.com/package/@ibm/plex-sans (upstream https://github.com/IBM/plex) | Copyright 2018 IBM Corp. All rights reserved. | `ibm-plex-sans/IBMPlexSans-{Regular,Medium,SemiBold}.woff2` — IBM's unmodified complete files |
| IBM Plex Mono | 2.005 (npm `@ibm/plex-mono@2.5.0`) | https://www.npmjs.com/package/@ibm/plex-mono (upstream https://github.com/IBM/plex) | Copyright 2017 IBM Corp. All rights reserved. | `ibm-plex-mono/IBMPlexMono-{Regular,Medium}.woff2` — IBM's unmodified complete files |

Declared in `src/app/layout.tsx`. Weights, CSS variable names and `display` are
unchanged from the former `next/font/google` setup. To add or update a font:
take IBM's release file unmodified (or, for a non-RFN family, document any
subsetting here), add a row, and keep the license files current.
