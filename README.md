Note: Every line except this one was written by the AI. Enjoy.

---
## Showcase

<p align="center"><em>Mode: Google Images - Destination: URL - Results: 8 </em></p>
<p align="center">
  <img width="80%" height="auto" alt="image" src="https://github.com/user-attachments/assets/1404ad94-e95f-4693-8d2b-ce3c1026c991" />
</p>

<p align="center"><em>Mode: Database - Destination: Download - Results: 6 </em></p>
<p align="center">
  <img width="80%" height="auto" alt="image" src="https://github.com/user-attachments/assets/1541f169-460f-45f8-a8e0-2d12a7e84e29" />
</p>


<details>
<summary><strong> Settings </strong></summary>
<br />
<p align="center">
  <img width="80%" height="auto" alt="Screenshot 2026-07-25 131336" src="https://github.com/user-attachments/assets/dbfeb656-2be5-467b-bdd8-946461020d95" />
  <img width="80%" height="auto" alt="Screenshot 2026-07-25 131352" src="https://github.com/user-attachments/assets/e5dbb269-28c4-4c88-b13d-55e53fa05684" />
</p>
</details>

---

## Get Covers

A minimal and simple [Obsidian](https://obsidian.md) plugin that searches for a cover image for the note you're currently viewing and writes it to the note's `cover` frontmatter property. Works on **desktop, Android, and iOS** from a single codebase.

## Usage

1. Open the note you want a cover for.
2. Trigger a search via any of: the **ribbon** image icon, the command palette → **“Search Cover”**, or right-clicking a note → **“Search Cover”**.
3. The modal opens pre-filled with the note's title. Adjust **Search**, **Suffix** (Google Images only), **Mode**, **Destination**, and the result **count**, then tap **Refresh** to re-run.
4. Tap a result. The cover is downloaded (or its URL is stored) and written to the note's configured frontmatter property; the modal closes only after the write succeeds. If anything fails, an error notice appears and the modal stays open so you don't lose your search.

## Features

- **Two search modes**
  - **Database** — structured lookup by title. The note's `Type` routes it to the right category and provider.
  - **Google Images** — a generic image search (via SerpAPI) that also folds in the note's `Type` and a customizable **Suffix** (default: `cover`).
- **Automatic fallback** — if a note's `Type` isn't mapped to a category, or a required API key is missing, the modal automatically switches to Google Images and tells you why.
- **Two destinations for the chosen cover**
  - **Download** — save the full-resolution image into your vault (default folder `Assets/Covers/`) and write that path to frontmatter.
  - **URL** — write the remote full-resolution URL directly to frontmatter (no download).
- **Touch-friendly image grid** — a responsive gallery of fixed-size poster-ratio results with a dedicated mobile layout.
- **In-modal result count** — click the “N results ▾” chip in the status line to change how many results this search returns (2 / 4 / 8 / custom), without touching settings.
- **Frontmatter-safe** — covers are written with Obsidian's own `processFrontMatter` API, so your other properties are preserved.

## Getting API keys

All keys are stored locally in your vault's `.obsidian/plugins/get-covers/data.json` and are never committed or sent anywhere except to the respective service. Enter them in **Settings → Get Covers → Provider API keys**.

### Google Books — *optional*

Basic Books search works with **no key**. Add one only if you hit rate limits:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. **APIs & Services → Library → Books API → Enable.**
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Copy the key into the “Google Books API key (optional)” field.

Free.

### TMDb (Movies & TV Shows) — *required for those categories*

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** (`https://www.themoviedb.org/settings/api`).
3. Request an API key (choose “Developer”); accept the terms and fill in the short form.
4. Copy the **“API Key (v3 auth)”** value into the “TMDb API key” field.

Free. _This product uses the TMDb API but is not endorsed or certified by TMDb._

### AniList (Anime & Manga) — *no key needed*

AniList's public GraphQL API needs no key for search. There's intentionally no field for it in settings.

### SteamGridDB (Games) — *required*

1. Sign in at [steamgriddb.com](https://www.steamgriddb.com/) (you can use your Steam account).
2. Open your profile **Preferences → API** (`https://www.steamgriddb.com/profile/preferences/api`).
3. Click **Generate API Key** and copy it into the “SteamGridDB API key” field.

Free.

### SerpAPI (Google Images) — *required for Google Images mode & fallback*

1. Sign up at [serpapi.com](https://serpapi.com/users/sign_up).
2. Open your [dashboard](https://serpapi.com/manage-api-key) and copy **“Your Private API Key”**.
3. Paste it into the “SerpAPI key” field.

Free tier: ~100 searches/month at time of writing. Google publishes no official image API, so this plugin uses SerpAPI (an API, not scraping) to keep the feature reliable and mobile-safe.

## Settings reference

Open **Settings → Get Covers**.

| Setting | Default | Description |
| --- | --- | --- |
| Download folder | `Assets/Covers/` | Vault-relative folder where downloaded covers are stored. |
| Destination property | `cover` | Frontmatter property the chosen cover is written to. |
| Type property | `Type` | Frontmatter property read to determine a note's Type. |
| Max results | `6` | Default number of results requested/shown (overridable per-search in the modal). |
| Request timeout (ms) | `10000` | Total network time budget per search, including retries. |
| Default search mode | `database` | Mode the modal opens with (`database` or `google`). |
| Default destination | `download` | Destination the modal opens with (`download` or `url`). |
| **Provider API keys** | — | See [API keys](#getting-api-keys) below. |
| Type → Category mapping | (see below) | Maps your `Type` values to the six built-in categories. |

**Default Type → Category mappings:** `Book → Books`, `Movie → Movies`, `TV Show → TV Shows`, `Series → TV Shows`, `Anime → Anime`, `Manga → Manga`, `Game → Games`. Matching is case-insensitive and trimmed.

**Which provider serves which category:**

| Category | Provider | API key |
| --- | --- | --- |
| Books | Google Books | Optional (higher quota) |
| Movies, TV Shows | TMDb | **Required** |
| Anime, Manga | AniList | None |
| Games | SteamGridDB | **Required** |
| Google Images (fallback / manual) | SerpAPI | **Required** |

---

## Architecture

The plugin is a small pipeline: **entry → modal → resolver → provider → save**.

```
main.ts                Plugin entry. Registers the command / ribbon / file-menu
                       action, reads the note's title (sanitized) and Type, opens
                       the modal, and orchestrates saving the picked cover.
  │
  ▼
modal.ts               The search UI: toolbar (Search, Suffix, Mode, Destination,
                       Refresh), a status line with the results-count popover, and
                       the image grid. Owns the "search generation" stale-response
                       guard and the per-session result-count override.
  │  (Database mode)
  ▼
databaseResolver.ts    Maps the note's Type → Category (via user mappings) →
                       a concrete provider instance. If the Type is unmapped or a
                       required key is missing, returns a "fall back to Google
                       Images" result with a reason.
  │
  ▼
providers/*            One class per backend, each implementing CoverProvider.
googleImageProvider.ts Google Images (SerpAPI) lives at the src root because it is
                       the fallback, not a database category.
  │  built on
  ▼
providers/providerHttp.ts   Shared HTTP plumbing: `requestOnce` (one requestUrl
                            call → typed errors), `retryOptions` (the shared
                            transient-retry policy), and JSON type-guards.
utils.ts               `withRetry` / `withTimeout` (generic, provider-agnostic)
                       and `sanitizeFilename`.
errors.ts              Typed error hierarchy: RateLimitError (429),
                       ServiceUnavailableError (503), TimeoutError, ProviderError.
  │  (on select)
  ▼
downloadService.ts     Downloads the full-res image via requestUrl, determines the
                       extension (Content-Type, then magic-byte sniffing), ensures
                       the folder, and writes the file with the Vault API.
frontmatterService.ts  Writes the cover value into frontmatter via processFrontMatter.
```

Key ideas:

- **Every network call goes through Obsidian's `requestUrl()`** — never the global `fetch` — so it works identically on desktop and mobile.
- **Providers never touch settings or the DOM.** They receive a plain query plus `{ maxResults, timeoutMs }` and return `CoverSearchResult[]`. The modal and resolver own all UI and configuration.
- **Errors are typed, never silent.** Any non-2xx HTTP status becomes a specific error class; the modal maps each to a distinct message. Individual malformed result entries are skipped (graceful “no results”), but whole-request failures always surface.
- **Stale responses are discarded.** `requestUrl()` has no cancel API, so the modal uses a monotonic “search generation” counter: each search (and modal close) increments it; a resolving request whose captured generation no longer matches is dropped silently.

## Adding a new provider

Every backend implements one small interface (`src/types.ts`):

```ts
export interface CoverProvider {
  readonly id: string;
  search(query: string, opts: CoverSearchOptions): Promise<CoverSearchResult[]>;
}

export interface CoverSearchOptions {
  maxResults: number; // upper bound on results to return
  timeoutMs: number;  // total time budget for the whole search
}

export interface CoverSearchResult {
  thumbnailUrl: string; // small image shown in the grid (the only image fetched while browsing)
  fullResUrl: string;   // best full-resolution image (fetched only when the user selects)
  sourceLabel: string;  // human-readable label (used as alt / aria text)
}
```

To add, say, an OpenLibrary provider:

1. **Create `src/providers/openLibraryProvider.ts`** implementing `CoverProvider`. Reuse the shared plumbing so you don't re-implement retries, status handling, or JSON validation:

   ```ts
   import { RequestUrlParam } from "obsidian";
   import { CoverProvider, CoverSearchOptions, CoverSearchResult } from "../types";
   import { withRetry } from "../utils";
   import { asArray, asRecord, asString, requestOnce, retryOptions } from "./providerHttp";

   export class OpenLibraryProvider implements CoverProvider {
     readonly id = "openLibrary";

     async search(query: string, opts: CoverSearchOptions): Promise<CoverSearchResult[]> {
       const trimmed = query.trim();
       if (trimmed.length === 0) return [];

       const param: RequestUrlParam = { url: buildUrl(trimmed), method: "GET" };
       // requestOnce forces `throw: false` and maps 429/503/other → typed errors;
       // withRetry retries only the transient ones within opts.timeoutMs.
       const response = await withRetry(() => requestOnce(param), retryOptions(opts.timeoutMs));

       const json: unknown = response.json; // launder Obsidian's `any` to `unknown`
       return parse(json, opts.maxResults); // validate shape with asRecord/asString/asArray
     }
   }
   ```

   - Get the request through `requestOnce` (do **not** call `requestUrl` directly — you'd lose the typed-error mapping).
   - Never let `any` escape: assign `response.json` to `unknown` and validate with the `asRecord` / `asString` / `asNumber` / `asArray` guards.
   - Honor `opts.maxResults` (stop once you've collected that many) and skip entries with no usable image.
   - If the backend needs credentials, take them as constructor arguments — providers don't read settings themselves.

2. **Wire it into `src/databaseResolver.ts`.** In `resolveProviderForCategory`, return your provider for the relevant `Category`. If it needs a key, use the `requireKey` helper so a missing key falls back to Google Images with a clear reason:

   ```ts
   case "Books":
     return { ok: true, provider: new OpenLibraryProvider() };
   // or, for a key-requiring provider:
   //   return requireKey(context, "openLibrary", "OpenLibrary", (key) => new OpenLibraryProvider(key));
   ```

3. **If it needs an API key**, add a field in `src/settings.ts` `renderApiKeys()` (using the `addApiKeyField` helper) with a `keyId` that matches what the resolver reads from `context.apiKeys`.

4. **For a brand-new category** (not one of the existing six), also add it to the `Category` union and `CATEGORIES` array in `src/types.ts`, and add a default row to `DEFAULT_TYPE_MAPPINGS` in `src/settings.ts`. The `switch` in `resolveProviderForCategory` is exhaustiveness-checked, so the compiler will point you at the spot that needs handling.

That's it — the modal calls `provider.search()` automatically once the resolver returns your provider; no modal changes are needed.


## Building

Requirements: [Node.js](https://nodejs.org) 18+ and npm.

```bash
npm install        # install dependencies
npm run dev        # watch build (rebuilds main.js on change)
npm run build      # strict type-check (tsc --noEmit) + production bundle
npm run typecheck  # tsc --noEmit only
```

`npm run build` runs the TypeScript compiler in strict mode (no emit) and then bundles `src/main.ts` into `main.js` with esbuild. The build fails on any type error or unused symbol.

### Deploying to a test vault

A helper script copies `main.js`, `manifest.json`, and `styles.css` together into a plugin folder (so `styles.css` never lags behind a build):

```bash
# macOS / Linux
COVER_SEARCH_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/get-covers" npm run deploy

# Windows (PowerShell)
$env:COVER_SEARCH_PLUGIN_DIR="C:\path\to\vault\.obsidian\plugins\get-covers"; npm run deploy
```

Or build and deploy in one step: `npm run build:deploy`.

### Project layout

```
src/
  main.ts                    Plugin entry: commands, ribbon, menu, cover assignment
  modal.ts                   Search modal, image grid, results-count popover, stale guard
  settings.ts                Defaults, defensive settings merge, settings tab UI
  databaseResolver.ts        Type → Category → provider routing (+ Google Images fallback)
  types.ts                   Shared types & interfaces (no runtime logic)
  utils.ts                   withRetry / withTimeout, sanitizeFilename
  errors.ts                  Typed provider error hierarchy
  downloadService.ts         Downloads a cover into the vault (Vault API only)
  frontmatterService.ts      Writes the cover via processFrontMatter
  googleImageProvider.ts     Google Images provider (SerpAPI) — the fallback backend
  providers/
    providerHttp.ts          Shared HTTP: requestOnce, retryOptions, JSON type-guards
    googleBooksProvider.ts   Books
    tmdbProvider.ts          Movies + TV Shows
    anilistProvider.ts       Anime + Manga
    steamgriddbProvider.ts   Games
scripts/
  deploy.mjs                 Copies main.js + manifest.json + styles.css into a vault
styles.css                   Modal & grid styles (desktop + mobile)
esbuild.config.mjs           Bundler config
```

### Design constraints

The plugin is written to work identically across Obsidian Desktop, Android, and iOS. To stay portable it deliberately avoids Node-only APIs:

- Network requests use Obsidian's `requestUrl()` — never the global `fetch`.
- Vault writes use the Vault binary APIs (`createBinary` / `modifyBinary`) — no Node `fs`, `path`, or `Buffer`.
- Frontmatter is edited only through `app.fileManager.processFrontMatter()`.
- UI is vanilla DOM + Obsidian primitives (`Modal`, `Setting`, components) — no UI framework.
- TypeScript runs in strict mode with **no `any`** anywhere (Obsidian's `response.json` is laundered to `unknown` and validated).

> **Security note:** `data.json` holds your plugin settings, including any API keys you configure. It is git-ignored and must never be committed.

## Credits & attribution

- **This product uses the TMDb API but is not endorsed or certified by TMDb.** (Displayed as required by TMDb's terms of use.)
- Cover images and metadata are provided by [Google Books](https://books.google.com), [TMDb](https://www.themoviedb.org), [AniList](https://anilist.co), [SteamGridDB](https://www.steamgriddb.com), and — in Google Images mode — [SerpAPI](https://serpapi.com). All trademarks, cover art, and images belong to their respective owners.
- **Image licensing is your responsibility.** Search results, especially from Google Images, may be copyrighted. Make sure you have the right to download and use a cover before saving it into your vault.

## License

MIT
