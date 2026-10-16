# PDF Tools

A plain, light-default website with four local tools: **Images to PDF**, **Compress PDF**, **Merge PDFs**, and **Organize Pages**. React, TypeScript, Vite, pdf-lib, PDF.js, and browser canvas; no backend or account system.

## Tool capabilities

| Tool | Behavior |
| --- | --- |
| Images to PDF | Choose JPEG, PNG, or WebP images. Reorder by dragging or Earlier / Later; remove unwanted images. Export one centered image per page, using image dimensions at 96 dpi (default), A4, or Letter, without cropping. Browser decoding applies orientation; PNG alpha is retained. WebP becomes PNG; JPEG is re-encoded at 98% quality. |
| Compress PDF | **Preserve text** is the default: compact serialization and object streams, without rasterization. This does not downsample images, optimize fonts, deduplicate content, or guarantee smaller files. Alternatively, explicitly acknowledge the losses before image-based JPEG compression. |
| Merge PDFs | Choose at least two PDFs. Check names, page counts, and order, then merge every page. A failed input rejects the entire new selection; no silently partial merge. Page sizes and rotations are preserved. |
| Organize Pages | Choose one PDF. Select individual/multiple/all pages, rotate left/right, delete, or reorder by dragging or Earlier / Later. Existing rotation is retained and edits are cumulative. At least one page must remain. Undo retains the last 20 edits; Reset restores the original, with discard confirmation. File replacement also confirms when edits would be lost. |

All four tools offer local file selection or drag and drop, progress and error messages, cancellation, explicit downloads, and a **Clear files** action. The responsive interface supports keyboard navigation and button-based reordering as an alternative to dragging. Files, previews, and results stay in browser memory: no document uploads, cloud storage, accounts, or autosaving.

Choose **Download PDF** to save a result. Creating an output does not download or autosave it. If compression is not smaller, the interface reports **No size reduction achieved**, shows the candidate size/change, and recommends downloading the exact original bytes instead.

Image-based compression offers smaller (72 dpi / JPEG 55%), balanced (108 dpi / JPEG 72%, default), and sharper (144 dpi / JPEG 85%) presets. Pages render sequentially; an 8-megapixel / 8,192-pixel-side cap may lower actual resolution. Visible page dimensions and orientation remain, but **selectable text, search, links, forms, accessibility structure, and vector detail are lost**. This is not OCR.

All editing or rewriting can invalidate digital signatures. Rebuilding/copying pages does not guarantee retention of interactive forms, bookmarks, attachments, annotations, internal destinations, or advanced PDF features. Keep original files and review the result in a trusted reader before relying on it. Encrypted/password-protected PDFs are rejected; there is no password entry or encryption bypass.

## Run locally

Use Node.js 22.13 or later and npm:

```powershell
npm ci
npm run dev
```

Open the local address printed by Vite. `dev` intentionally builds and serves the production website rather than using Vite's hot-reloading development server: hot reload and injected development styles conflict with the strict production CSP. Re-run after editing.

To build separately and serve the output:

```powershell
npm run build
npm run preview
```

## Privacy boundary

- Selected files, filenames, decoded images, previews, edits, and generated PDFs remain in browser memory. There are no upload endpoints, document-processing services, remote fonts, runtime CDNs, analytics, error-reporting services, autosaving, or service worker.
- No document data or filenames are written to localStorage, sessionStorage, IndexedDB, Cache Storage, URLs, browser history, or application logs.
- PDF writing runs in disposable workers. PDF rendering uses a local PDF.js worker. Both worker programs and the CMaps, standard fonts, and decoding WebAssembly are bundled into the initial JavaScript; they do not fetch document-related resources. The larger initial bundle is intentional, not a lazy network dependency.
- The static CSP uses `connect-src 'none'`, disallows remote scripts and resources, and permits only the local/blob workers, blob/data images and fonts, and WebAssembly compilation needed for rendering. No JavaScript eval or inline application scripts/styles are enabled.
- **Clear files** cancels current work, unmounts the tool, drops its inputs/outputs/history, destroys active PDF tasks, releases canvases, terminates writing workers, and revokes download object URLs. Changing tools clears the old tool after confirmation. Reload/tab closure also loses in-memory work.
- Saving a document requires clicking Download. No app can promise forensic memory erasure or control browser internals, extensions, OS swap, or the user's download folder. A user-selected cloud-synced download folder is outside this application's control.

GitHub Pages serves the website and may log website/asset requests. Local document processing is **not anonymous browsing**. An internet connection loads the website; after the initial assets finish loading, all four tools work without remote services. There is no installable/PWA or guaranteed offline-reload support.

## Practical limits

These are conservative application guardrails, not a guarantee that every input below them will work on every device:

| Resource | Limit |
| --- | --- |
| File size | 30 MB per file; 60 MB total input/normalized image data |
| File count | 60 images or PDFs; compression/organization accept one PDF |
| PDF pages | 200 per input and in combined output |
| Image dimensions | 16 megapixels and 16,000 pixels per side; image headers checked before native decoding |
| Total normalized image pixels | 80 megapixels for Images to PDF |
| Embedded PDF image objects | Same 16-megapixel / 16,000-pixel limits |
| PDF page dimensions | Positive finite dimensions, at most 14,400 points per side |
| Rendered page | 8 megapixels and 8,192 pixels per side; thumbnail canvases are lazy and rendered one at a time |
| Rasterization accumulation | 60 MB of encoded JPEG images |
| Generated output | 120 MB |

Tests exercise guard rejection, sequential rendering, cancellation, repeated selection, and cleanup with synthetic documents. Arbitrarily complex PDFs can still exhaust memory or take a long time even below these limits, especially on mobile devices. Cancel and try fewer pages, smaller source images, or lower image-based quality. Header guards and worker termination are not a full sandbox or a universal decompression-bomb defense. Unsupported/corrupt files are reported rather than silently omitted. PDF.js color handling and browser font/rendering differences can affect fidelity; this is not a prepress or archival validation tool.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npx playwright install chromium firefox webkit
npm run test:browser
```

Browser tests build the production website and mount it at `/modifymypdf/`. They exercise all four tools in Chromium, Firefox, and WebKit with synthetic fixtures only. After initial page load, HTTP(S) requests are intercepted and forbidden. Tests check CSP violations, storage/URLs, download gates, text/link retention, page order/dimensions/rotation, EXIF orientation, PNG transparency, compression outcomes, previews, cancellation, discard protection, empty-output prevention, keyboard tabs, reload, and narrow layouts. Playwright WebKit is an engine check, not a claim of testing Safari on an Apple device; Chromium does not separately certify Edge.

Synthetic PDFs/images are generated in test memory. Do not add personal documents or publish test outputs/traces as CI artifacts.

## GitHub Pages

The included `.github/workflows/deploy.yml` checks pull requests and main-branch pushes. Main-branch builds upload **only `dist`** using the official Pages artifact action; a separate minimal-permission job deploys it. Repository write permission and document uploads are not required. Dependency installation and testing run before deployment.

**Publishing has not been performed by this implementation.** To publish when ready:

1. Push/merge the code to `main`.
2. In the repository's **Settings > Pages**, select **GitHub Actions** as the source. Confirm your account plan and repository visibility support Pages; hosting does not make the website private.
3. Run the workflow or push to `main`, then check its deployment URL, normally `https://naginder.github.io/modifymypdf/`.
4. Smoke-test all four operations on the actual published URL with synthetic files.

Vite uses relative asset URLs (`base: './'`), so the same build supports a project subpath or account-root site without route fallbacks. There are no client-side routes or custom domain requirements. A strict CSP is included in the HTML since Pages does not provide application-controlled response headers.

The build also includes `third-party-licenses.txt` alongside the website, with library and bundled rendering-asset license notices.
