# Network-only image supplemental adoption manifest

This supplemental manifest records the checked preview-image slice after the
review fixes. The historical `composed-adoption-manifest.md` remains unchanged:
it is the D125/D126 record of what was composed at that time, and must not be
rewritten to retroactively claim these new files or later review fixes.

## Source mapping

| Candidate source | Live adoption target | Candidate SHA-256 | Live SHA-256 |
|---|---|---|---|
| `src/lib/attached-image-target.ts` | `apps/web/src/lib/attached-image-target.ts` (new) | `3ca72250abe220c0dbeacfffd011de75d033cf4c5f647703247d8513bc199ba8` | not present before adoption |
| `src/lib/network-attached-images.ts` | `apps/web/src/lib/network-attached-images.ts` (new) | `b37644637441650fa11d96ac5a130c12fe57c5fa78f024f4f807e500bbb7deb0` | not present before adoption |
| `src/lib/attached-images.ts` | `apps/web/src/lib/attached-images.ts` (existing) | `faf09006ced38829248f6aa1bb31e8ca4805999bdfc41f89c5d252bd3c4a1d9e` | `33baf35a43dc031ab4f68aec7200aac9d2cc4b2f1ee8e562c399cad3e77f3387` |
| `src/lib/preview-images.ts` | `apps/web/src/lib/preview-images.ts` (existing) | `21199af259c33d94fa5a732bba16b68249ba8a94aa64d49a405a8ac7e267c5f5` | `1d6e276dd9e72d182dd8768b3b64ac225b14758aeff5182649c6dc55a1937c83` |

## Tests and validation

Browser tests and validation records are separate from the source mapping:

- `apps/web/tests/browser/network-only-preview-image.spec.ts`
- `apps/web/tests/browser/offline-image-lifetime.spec.ts`
- `network-only-image-decisions.md`
- `network-only-image-validation.md`
