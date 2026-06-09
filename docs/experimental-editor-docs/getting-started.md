# Experimental Slide Editor Getting Started

This document explains how to try the new slide-editor PPTX import path from
the custom template page.

The existing custom template import flow remains the default. The experimental
flow is enabled only when `USE_SLIDE_EDITOR_IMPORT` is explicitly set to a true
value.

## What This Feature Does

When the feature flag is enabled, the `Select a PPTX file` action on:

```txt
/custom-template
```

opens a font preparation dialog for the new slide editor import path instead of
starting the old custom-template font-check flow.

The dialog checks which PPTX fonts are available, lets you upload missing font
files, and asks the backend to prepare a font-ready PPTX plus slide preview
images. You can still continue if some fonts are missing, but those text
elements may render with browser fallback fonts.

The browser then calls:

```txt
POST /api/v2/templates
```

with the prepared PPTX URL, slide image URLs, and font URLs. The backend
response is converted into a slide-editor deck, staged in IndexedDB, and opened
at:

```txt
/slide-editor?templateImportId=active-template-import
```

Font URLs returned by the backend template response are staged with the deck
and loaded when the editor opens.

Each new upload replaces the previous staged import record, so repeated imports
do not accumulate old PPTX files or deck snapshots in IndexedDB.

## Enable With Docker

The Docker default is the old import flow:

```bash
docker compose up production
```

Enable the experimental import path by passing the flag at startup:

```bash
USE_SLIDE_EDITOR_IMPORT=true docker compose up --build production
```

For the development service:

```bash
USE_SLIDE_EDITOR_IMPORT=true docker compose up --build --force-recreate development
```

The bundled PPTX export converter is currently Linux x64, so
`docker-compose.yml` runs these services as `linux/amd64` by default. Override
`PRESENTON_DOCKER_PLATFORM` only if you have a matching converter for another
platform.

Accepted true values are:

```txt
1
true
yes
on
```

Any other value, including an unset value, keeps the old import flow.

## Enable In Local Next.js Development

From `servers/nextjs`, start the dev server with the flag:

```bash
USE_SLIDE_EDITOR_IMPORT=true npm run dev
```

You can also put the flag in `servers/nextjs/.env.local`:

```txt
USE_SLIDE_EDITOR_IMPORT=true
```

Restart the Next.js server after changing the flag.

## Verify The Flow

1. Start the app with `USE_SLIDE_EDITOR_IMPORT=true`.
2. Open `/custom-template`.
3. Click `Select a PPTX file`.
4. Choose a `.pptx` file under 100 MB.
5. Confirm the font preparation dialog opens.
6. Upload any missing fonts you want to preserve.
7. Click `Open in editor` or `Open anyway`.
8. Confirm the browser redirects to `/slide-editor?templateImportId=...`.
9. Confirm the imported deck appears in the slide editor.

With the flag disabled, the same upload action should stay on the original
custom-template flow and continue to `Check Fonts`.

## Troubleshooting

If the upload still uses the old flow, confirm the container received the flag:

```bash
docker compose exec production printenv USE_SLIDE_EDITOR_IMPORT
```

If you changed the flag after a container was already running, recreate the
container:

```bash
USE_SLIDE_EDITOR_IMPORT=true docker compose up --build --force-recreate production
```

If development still reports a `sharp` or native dependency load error after
switching platform, clear the named dependency volumes once:

```bash
docker compose down -v
USE_SLIDE_EDITOR_IMPORT=true docker compose up --build --force-recreate development
```

If `/slide-editor` opens but cannot find the import, upload the PPTX again from
the same browser tab. The staged file lives in browser IndexedDB, not on the
server.

If import quality looks incomplete, check the browser console. The experimental
import path currently logs PPTX import warnings instead of expanding the old
template-import feature surface.
