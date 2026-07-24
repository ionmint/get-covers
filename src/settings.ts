import {
	App,
	DropdownComponent,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import {
	CATEGORIES,
	Category,
	CoverSearchSettings,
	Destination,
	SearchMode,
	TypeMapping,
} from "./types";

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

/** Default settings, merged with persisted data on load. */
export const DEFAULT_SETTINGS: CoverSearchSettings = {
	apiKeys: {},
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

		new Setting(containerEl).setName("Get Covers").setHeading();

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
	 * Provider API keys, grouped together. Only providers that need credentials
	 * get a field: Google Books' key is optional (quota only), TMDb and
	 * SteamGridDB require one, and AniList needs none (so it has no field).
	 */
	private renderApiKeys(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Provider API keys").setHeading();
		containerEl.createEl("p", {
			text:
				"Stored locally with this vault and never committed. AniList " +
				"(Anime & Manga) needs no key.",
			cls: "setting-item-description",
		});

		this.addApiKeyField(containerEl, {
			name: "Google Books API key (optional)",
			desc:
				"Optional. Raises the Google Books request quota. Basic cover " +
				"search (Books) works without a key.",
			keyId: "googleBooks",
			placeholder: "Leave empty to use the free quota",
		});

		this.addApiKeyField(containerEl, {
			name: "TMDb API key (required for Movies & TV Shows)",
			desc:
				"The Movie Database (TMDb) v3 API key. Required to search covers " +
				"for the Movies and TV Shows categories.",
			keyId: "tmdb",
			placeholder: "TMDb v3 API key",
		});

		this.addApiKeyField(containerEl, {
			name: "SteamGridDB API key (required for Games)",
			desc:
				"SteamGridDB API key. Required to search covers for the Games " +
				"category.",
			keyId: "steamgriddb",
			placeholder: "SteamGridDB API key",
		});

		this.addApiKeyField(containerEl, {
			name: "SerpAPI key (required for Google Images)",
			desc:
				"SerpAPI key. Required for Google Images mode — used both when you " +
				"pick Mode: Google Images and when a note's Type has no mapped " +
				"provider and falls back to it.",
			keyId: "serpapi",
			placeholder: "SerpAPI key",
		});

		containerEl.createEl("p", {
			text:
				"This product uses the TMDb API but is not endorsed or certified by " +
				"TMDb. Image licensing is your responsibility — search results " +
				"(especially from Google Images) may be copyrighted.",
			cls: "setting-item-description",
		});
	}

	/**
	 * Render one password-masked API-key field bound to `apiKeys[keyId]`. Writing
	 * a blank value deletes the key rather than storing an empty string.
	 */
	private addApiKeyField(
		containerEl: HTMLElement,
		opts: { name: string; desc: string; keyId: string; placeholder: string },
	): void {
		new Setting(containerEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(opts.placeholder)
					.setValue(this.plugin.settings.apiKeys[opts.keyId] ?? "")
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed.length > 0) {
							this.plugin.settings.apiKeys[opts.keyId] = trimmed;
						} else {
							delete this.plugin.settings.apiKeys[opts.keyId];
						}
						await this.plugin.saveSettings();
					});
			});
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
