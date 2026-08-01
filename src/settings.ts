import {
	App,
	DropdownComponent,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import {
	CATEGORIES,
	Category,
	CoverSearchSettings,
	Destination,
	SearchMode,
	TypeMapping,
} from "./types";
import { fetchSerpApiUsage } from "./googleImageProvider";

/** Default Type → Category mapping table seeded on first run / reset. */
export const DEFAULT_TYPE_MAPPINGS: TypeMapping[] = [
	{ type: "Book", category: "Books" },
	{ type: "Movie", category: "Movies" },
	{ type: "TV Show", category: "TV Shows" },
	{ type: "Series", category: "TV Shows" },
	{ type: "Anime", category: "Anime" },
	{ type: "Manga", category: "Manga" },
	{ type: "Game", category: "Games" },
];

/** Upper bound for a per-provider "Default results" value (matches the modal cap). */
export const MAX_PROVIDER_RESULTS = 50;

/** Default settings, merged with persisted data on load. */
export const DEFAULT_SETTINGS: CoverSearchSettings = {
	apiKeys: {},
	providerResultLimits: {},
	downloadFolder: "Assets/Covers/",
	destinationProperty: "cover",
	typeProperty: "Type",
	maxResults: 6,
	requestTimeout: 10000,
	defaultSearchMode: "database",
	defaultDestination: "download",
	typeMappings: DEFAULT_TYPE_MAPPINGS.map((m) => ({ ...m })),
};

/**
 * Minimal contract the settings tab needs from the plugin, so that
 * `settings.ts` does not import the concrete plugin class (avoids a cycle).
 * The concrete `CoverSearchPlugin` in `main.ts` satisfies this.
 */
export interface CoverSearchPluginContract extends Plugin {
	settings: CoverSearchSettings;
	saveSettings(): Promise<void>;
}

/**
 * Merge persisted data (possibly partial / from an older version) onto the
 * defaults so every field is always present and well-typed.
 */
export function mergeSettings(loaded: unknown): CoverSearchSettings {
	const base: CoverSearchSettings = {
		...DEFAULT_SETTINGS,
		apiKeys: { ...DEFAULT_SETTINGS.apiKeys },
		providerResultLimits: { ...DEFAULT_SETTINGS.providerResultLimits },
		typeMappings: DEFAULT_SETTINGS.typeMappings.map((m) => ({ ...m })),
	};

	if (loaded === null || typeof loaded !== "object") {
		return base;
	}

	const data = loaded as Partial<Record<keyof CoverSearchSettings, unknown>>;

	if (data.apiKeys && typeof data.apiKeys === "object") {
		const merged: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			data.apiKeys as Record<string, unknown>,
		)) {
			if (typeof value === "string") {
				merged[key] = value;
			}
		}
		base.apiKeys = merged;
	}
	if (
		data.providerResultLimits &&
		typeof data.providerResultLimits === "object"
	) {
		const merged: Record<string, number> = {};
		for (const [key, value] of Object.entries(
			data.providerResultLimits as Record<string, unknown>,
		)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				const n = Math.floor(value);
				if (n >= 1) {
					merged[key] = Math.min(n, MAX_PROVIDER_RESULTS);
				}
			}
		}
		base.providerResultLimits = merged;
	}
	if (typeof data.downloadFolder === "string") {
		base.downloadFolder = data.downloadFolder;
	}
	if (typeof data.destinationProperty === "string") {
		base.destinationProperty = data.destinationProperty;
	}
	if (typeof data.typeProperty === "string") {
		base.typeProperty = data.typeProperty;
	}
	if (typeof data.maxResults === "number" && Number.isFinite(data.maxResults)) {
		base.maxResults = Math.max(1, Math.floor(data.maxResults));
	}
	if (
		typeof data.requestTimeout === "number" &&
		Number.isFinite(data.requestTimeout)
	) {
		base.requestTimeout = Math.max(1000, Math.floor(data.requestTimeout));
	}
	if (isSearchMode(data.defaultSearchMode)) {
		base.defaultSearchMode = data.defaultSearchMode;
	}
	if (isDestination(data.defaultDestination)) {
		base.defaultDestination = data.defaultDestination;
	}
	if (Array.isArray(data.typeMappings)) {
		base.typeMappings = sanitizeMappings(data.typeMappings);
	}

	return base;
}

function isSearchMode(value: unknown): value is SearchMode {
	return value === "database" || value === "google";
}

function isDestination(value: unknown): value is Destination {
	return value === "download" || value === "url";
}

function isCategory(value: unknown): value is Category {
	return (
		typeof value === "string" &&
		(CATEGORIES as readonly string[]).includes(value)
	);
}

/** Keep only well-formed mapping rows from arbitrary persisted data. */
function sanitizeMappings(raw: unknown[]): TypeMapping[] {
	const result: TypeMapping[] = [];
	for (const entry of raw) {
		if (entry === null || typeof entry !== "object") {
			continue;
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.type === "string" && isCategory(record.category)) {
			result.push({ type: record.type, category: record.category });
		}
	}
	return result;
}

/** One provider row in the API-keys section. */
interface ProviderRow {
	/** Provider id — the key into `apiKeys` and `providerResultLimits`. */
	id: string;
	/** Display name (usually "<Provider> (<categories>)"). */
	name: string;
	/** One-line description shown under the name. */
	desc: string;
	/** Whether this provider needs an API key field. */
	keyMode: "required" | "none";
	/** Placeholder for the key field (only used when keyMode === "required"). */
	placeholder: string;
}

/** Settings tab UI. */
export class CoverSearchSettingTab extends PluginSettingTab {
	private readonly plugin: CoverSearchPluginContract;

	constructor(app: App, plugin: CoverSearchPluginContract) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Download folder")
			.setDesc("Vault-relative folder where downloaded covers are stored.")
			.addText((text) =>
				text
					.setPlaceholder("Assets/Covers/")
					.setValue(this.plugin.settings.downloadFolder)
					.onChange(async (value) => {
						this.plugin.settings.downloadFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Destination property")
			.setDesc("Frontmatter property the selected cover is written to.")
			.addText((text) =>
				text
					.setPlaceholder("cover")
					.setValue(this.plugin.settings.destinationProperty)
					.onChange(async (value) => {
						this.plugin.settings.destinationProperty = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Type property")
			.setDesc("Frontmatter property read to determine the note's Type.")
			.addText((text) =>
				text
					.setPlaceholder("Type")
					.setValue(this.plugin.settings.typeProperty)
					.onChange(async (value) => {
						this.plugin.settings.typeProperty = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max results")
			.setDesc("Maximum number of cover results to display.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setValue(String(this.plugin.settings.maxResults))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed >= 1) {
							this.plugin.settings.maxResults = parsed;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Request timeout (ms)")
			.setDesc("Network request timeout in milliseconds.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1000";
				text
					.setValue(String(this.plugin.settings.requestTimeout))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed >= 1000) {
							this.plugin.settings.requestTimeout = parsed;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Default search mode")
			.setDesc("Mode the search modal opens with.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("database", "Database")
					.addOption("google", "Google Images")
					.setValue(this.plugin.settings.defaultSearchMode)
					.onChange(async (value) => {
						if (isSearchMode(value)) {
							this.plugin.settings.defaultSearchMode = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Default destination")
			.setDesc("Destination the search modal opens with.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("download", "Download")
					.addOption("url", "URL")
					.setValue(this.plugin.settings.defaultDestination)
					.onChange(async (value) => {
						if (isDestination(value)) {
							this.plugin.settings.defaultDestination = value;
							await this.plugin.saveSettings();
						}
					});
			});

		this.renderApiKeys(containerEl);

		this.renderTypeMappings(containerEl);
	}

	/**
	 * Provider API keys and per-provider defaults. Each provider gets one row; a
	 * key field appears only for providers that need one (Open Library and AniList
	 * need none). Every row also has a "Default results" box that overrides the
	 * global Max results for that provider, and SerpAPI shows its live remaining
	 * monthly calls.
	 */
	private renderApiKeys(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Provider API keys").setHeading();
		containerEl.createEl("p", {
			text:
				"Stored locally with this vault and never committed. Open Library " +
				"(Books) and AniList (Anime & Manga) need no key. Each provider can " +
				"also set a default number of results that overrides Max results.",
			cls: "setting-item-description",
		});

		const rows: ProviderRow[] = [
			{
				id: "openLibrary",
				name: "Open Library (Books)",
				desc: "Covers for the Books category. No API key required.",
				keyMode: "none",
				placeholder: "",
			},
			{
				id: "anilist",
				name: "AniList (Anime & Manga)",
				desc: "Covers for the Anime and Manga categories. No API key required.",
				keyMode: "none",
				placeholder: "",
			},
			{
				id: "tmdb",
				name: "TMDb (Movies & TV Shows)",
				desc:
					"The Movie Database (TMDb) v3 API key. Required for the Movies " +
					"and TV Shows categories.",
				keyMode: "required",
				placeholder: "TMDb v3 API key",
			},
			{
				id: "steamgriddb",
				name: "SteamGridDB (Games)",
				desc: "SteamGridDB API key. Required for the Games category.",
				keyMode: "required",
				placeholder: "SteamGridDB API key",
			},
			{
				id: "serpapi",
				name: "SerpAPI (Google Images)",
				desc:
					"Required for Google Images mode and the automatic fallback when " +
					"a note's Type has no mapped provider.",
				keyMode: "required",
				placeholder: "SerpAPI key",
			},
		];

		for (const row of rows) {
			this.renderProviderRow(containerEl, row);
		}

		containerEl.createEl("p", {
			text:
				"This product uses the TMDb API but is not endorsed or certified by " +
				"TMDb. Image licensing is your responsibility — search results " +
				"(especially from Google Images) may be copyrighted.",
			cls: "setting-item-description",
		});
	}

	/**
	 * Render one provider row: an optional password key field (blank clears it), a
	 * "Default results" number box bound to `providerResultLimits[id]` (blank =
	 * use the global Max results), and — for SerpAPI only — a live usage readout.
	 */
	private renderProviderRow(containerEl: HTMLElement, row: ProviderRow): void {
		const setting = new Setting(containerEl).setName(row.name).setDesc(row.desc);

		if (row.keyMode === "required") {
			setting.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(row.placeholder)
					.setValue(this.plugin.settings.apiKeys[row.id] ?? "")
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed.length > 0) {
							this.plugin.settings.apiKeys[row.id] = trimmed;
						} else {
							delete this.plugin.settings.apiKeys[row.id];
						}
						await this.plugin.saveSettings();
					});
			});
		}

		// Per-provider default result count. Blank = fall back to global Max results.
		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "1";
			text.inputEl.max = String(MAX_PROVIDER_RESULTS);
			text.inputEl.addClass("get-covers-provider-results");
			text.inputEl.title = "Default results (overrides Max results)";
			text.inputEl.setAttribute("aria-label", `${row.name} default results`);
			const current = this.plugin.settings.providerResultLimits[row.id];
			text
				.setPlaceholder(String(this.plugin.settings.maxResults))
				.setValue(current !== undefined ? String(current) : "")
				.onChange(async (value) => {
					const raw = value.trim();
					if (raw.length === 0) {
						delete this.plugin.settings.providerResultLimits[row.id];
						await this.plugin.saveSettings();
						return;
					}
					const parsed = Number.parseInt(raw, 10);
					if (
						Number.isInteger(parsed) &&
						parsed >= 1 &&
						parsed <= MAX_PROVIDER_RESULTS
					) {
						this.plugin.settings.providerResultLimits[row.id] = parsed;
						await this.plugin.saveSettings();
					}
				});
		});

		if (row.id === "serpapi") {
			this.renderSerpApiUsage(setting);
		}
	}

	/**
	 * SerpAPI-only: a live "remaining monthly calls" readout, fetched from the free
	 * account endpoint. Auto-loads once when the settings page opens, and a Refresh
	 * button re-fetches on demand. The account lookup does not consume search quota.
	 */
	private renderSerpApiUsage(setting: Setting): void {
		// Let the control column wrap so this line can sit under the key input,
		// rather than after the whole row.
		setting.settingEl.addClass("get-covers-serpapi-row");
		const usageWrap = setting.controlEl.createDiv({
			cls: "get-covers-serpapi-usage",
		});
		const textEl = usageWrap.createSpan({
			cls: "get-covers-serpapi-usage-text setting-item-description",
		});
		const refreshBtn = usageWrap.createEl("button", {
			cls: "get-covers-serpapi-refresh",
		});
		refreshBtn.type = "button";
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.setAttribute("aria-label", "Refresh SerpAPI usage");
		refreshBtn.title = "Refresh SerpAPI usage";

		const refresh = (): void => {
			const key = this.plugin.settings.apiKeys.serpapi?.trim();
			if (!key) {
				textEl.setText("Add a SerpAPI key to see remaining calls.");
				return;
			}
			textEl.setText("Checking SerpAPI usage…");
			void fetchSerpApiUsage(key).then(
				(usage) => {
					textEl.setText(
						`Used ${usage.thisMonthUsage} of ${usage.searchesPerMonth} ` +
							`this month · ${usage.searchesLeft} left`,
					);
				},
				(error: unknown) => {
					const message =
						error instanceof Error ? error.message : String(error);
					textEl.setText(`Couldn't fetch SerpAPI usage: ${message}`);
				},
			);
		};

		refreshBtn.addEventListener("click", () => refresh());

		// Auto-load once when the settings page opens.
		refresh();
	}

	private renderTypeMappings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Type → Category mapping").setHeading();
		containerEl.createEl("p", {
			text:
				"Map your note Type values to a fixed category. Matching is " +
				"case-insensitive and trimmed.",
			cls: "setting-item-description",
		});

		const listEl = containerEl.createDiv({ cls: "get-covers-mapping-list" });

		this.plugin.settings.typeMappings.forEach((mapping, index) => {
			const rowSetting = new Setting(listEl);
			rowSetting.addText((text) =>
				text
					.setPlaceholder("Type value (e.g. Book)")
					.setValue(mapping.type)
					.onChange(async (value) => {
						this.plugin.settings.typeMappings[index].type = value;
						await this.plugin.saveSettings();
					}),
			);
			rowSetting.addDropdown((dropdown: DropdownComponent) => {
				for (const category of CATEGORIES) {
					dropdown.addOption(category, category);
				}
				dropdown
					.setValue(mapping.category)
					.onChange(async (value) => {
						if (isCategory(value)) {
							this.plugin.settings.typeMappings[index].category = value;
							await this.plugin.saveSettings();
						}
					});
			});
			rowSetting.addExtraButton((button) =>
				button
					.setIcon("trash")
					.setTooltip("Delete mapping")
					.onClick(async () => {
						this.plugin.settings.typeMappings.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		});

		new Setting(containerEl)
			.addButton((button) =>
				button
					.setButtonText("Add mapping")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.typeMappings.push({
							type: "",
							category: CATEGORIES[0],
						});
						await this.plugin.saveSettings();
						this.display();
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Reset to default")
					.onClick(async () => {
						this.plugin.settings.typeMappings = DEFAULT_TYPE_MAPPINGS.map(
							(m) => ({ ...m }),
						);
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}
}
