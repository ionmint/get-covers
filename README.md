# Cover Search

An [Obsidian](https://obsidian.md) plugin that searches for a cover image for the note you're currently viewing and writes it to the note's `cover` frontmatter property. Works on **desktop, Android, and iOS** from a single codebase.

> **Status: work in progress.** The full UI, settings, and cover-assignment flow are implemented and working. Search currently runs against a built-in **mock provider** that returns placeholder images, so the whole experience can be used and tested end to end. Real search backends (Google Books, TMDb, SteamGridDB, AniList, Google Images) are on the roadmap below.

## Features

- **Find a cover for the current note** from the command palette, the ribbon icon, or the file context menu ("Search Cover").
- **Touch-friendly image grid** — a responsive gallery of poster-ratio results, with a dedicated mobile layout.
- **Two search modes**
  - **Database** — structured lookup by title (the note's `Type` routes it to the right category).
  - **Google Images** — a generic image search that also folds in the note's `Type` and a customizable **Suffix** (default: `cover`).
- **Two destinations for the chosen cover**
  - **Download** — save the image into your vault (default folder `Assets/Covers/`) and reference it.
  - **URL** — store the remote image URL directly in frontmatter.
- **Type → Category mapping** — map your own frontmatter `Type` values (e.g. `Book`, `Movie`, `Series`) to the built-in categories: **Books, Movies, TV Shows, Anime, Manga, Games**.
- **Frontmatter-safe** — covers are written with Obsidian's own `processFrontMatter` API, so your other properties are preserved.

## Installation

This plugin isn't in the community plugins list yet. To install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from a release (or build them yourself — see below).
2. Copy all three files into your vault at:
   ```
   <your-vault>/.obsidian/plugins/cover-search/
   ```
3. In Obsidian, open **Settings → Community plugins**, enable **Cover Search**, and reload if prompted.

> On mobile, Obsidian caches `styles.css` — after updating the files, **fully restart the app** so layout changes take effect.

## Usage

1. Open the note you want a cover for.
2. Trigger a search via any of:
   - the **ribbon** image icon,
   - the command palette → **"Search Cover"**,
   - right-clicking a note → **"Search Cover"**.
3. The modal opens pre-filled with the note's title. Adjust the **Search** text, **Suffix**, **Mode**, and **Destination** as needed, then tap **Refresh** to re-run.
4. Tap a result. The cover is assigned to the note's configured frontmatter property and the modal closes.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Download folder | `Assets/Covers/` | Vault-relative folder for downloaded covers. |
| Cover property | `cover` | Frontmatter property the chosen cover is written to. |
| Type property | `Type` | Frontmatter property read to determine a note's Type. |
| Max results | `6` | Number of results requested/shown. |
| Request timeout | `10000` ms | Network request timeout. |
| Gallery theme | `auto` | Modal gallery theme: `light`, `dark`, or `auto`. |
| Default search mode | `database` | Mode the modal opens with. |
| Default destination | `download` | Destination the modal opens with. |
| Type → Category mappings | (see below) | Maps your `Type` values to categories. |

Default Type → Category mappings: `Book → Books`, `Movie → Movies`, `TV Show → TV Shows`, `Series → TV Shows`, `Anime → Anime`, `Manga → Manga`, `Game → Games`. Matching is case-insensitive and trimmed.

## Development

Requirements: [Node.js](https://nodejs.org) 18+ and npm.

```bash
npm install        # install dependencies
npm run dev        # watch build (rebuilds main.js on change)
npm run build      # type-check (strict) + production build
npm run typecheck  # tsc --noEmit only
```

### Deploying to a test vault

A helper script copies `main.js`, `manifest.json`, and `styles.css` together into a plugin folder (so `styles.css` never lags behind a build):

```bash
# macOS / Linux
COVER_SEARCH_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/cover-search" npm run deploy

# Windows (PowerShell)
$env:COVER_SEARCH_PLUGIN_DIR="C:\path\to\vault\.obsidian\plugins\cover-search"; npm run deploy
```

Or build and deploy in one step: `npm run build:deploy`.

### Project layout

```
src/
  main.ts                # plugin entry: commands, ribbon, menu, cover assignment
  modal.ts               # search modal + responsive image grid
  settings.ts            # defaults, settings tab, defensive settings merge
  frontmatterService.ts  # reads/writes the cover via processFrontMatter
  types.ts               # shared types & interfaces (no runtime logic)
  utils.ts               # filename sanitizing, debounce
scripts/
  deploy.mjs             # copies main.js + manifest.json + styles.css to a vault
styles.css               # modal & grid styles (desktop + mobile)
```

### Design constraints

The plugin is written to work identically across Obsidian Desktop, Android, and iOS. To keep it portable, it deliberately avoids Node-only APIs:

- Network requests use Obsidian's `requestUrl()` — never the global `fetch`.
- Vault writes use the vault/adapter binary APIs — no Node `fs`.
- Frontmatter is edited only through `app.fileManager.processFrontMatter()`.
- UI is vanilla DOM + Obsidian primitives (`Modal`, `Setting`, components) — no UI framework.
- TypeScript runs in strict mode with no `any`.

> **Note:** `data.json` holds your plugin settings, including any API keys you configure. It is git-ignored and must never be committed.

## Roadmap

- [x] Modal UI, settings, frontmatter assignment (mock provider)
- [ ] Real providers: Google Books, TMDb, SteamGridDB, AniList
- [ ] Google Images provider
- [ ] Download service (save covers into the vault)
- [ ] Category routing wired to real providers

## License

MIT
