import { Menu, Notice, Plugin, TFile } from "obsidian";
import { CoverSearchSettings, CoverSearchResult, Destination } from "./types";
import {
	CoverSearchPluginContract,
	CoverSearchSettingTab,
	mergeSettings,
} from "./settings";
import { FrontmatterService } from "./frontmatterService";
import { DownloadService } from "./downloadService";
import { CoverSearchModal } from "./modal";
import { sanitizeFilename } from "./utils";

export default class CoverSearchPlugin
	extends Plugin
	implements CoverSearchPluginContract
{
	settings!: CoverSearchSettings;
	private frontmatter!: FrontmatterService;
	private downloads!: DownloadService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.frontmatter = new FrontmatterService(this.app);
		this.downloads = new DownloadService(this.app);

		this.addSettingTab(new CoverSearchSettingTab(this.app, this));

		this.addCommand({
			id: "open",
			name: "Search Cover",
			callback: () => this.openForActiveFile(),
		});

		this.addRibbonIcon("image", "Search Cover", () => {
			this.openForActiveFile();
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) =>
						item
							.setTitle("Search Cover")
							.setIcon("image")
							.onClick(() => this.openForFile(file)),
					);
				}
			}),
		);
	}

	async loadSettings(): Promise<void> {
		const loaded: unknown = await this.loadData();
		this.settings = mergeSettings(loaded);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openForActiveFile(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("Get Covers: open a note first.");
			return;
		}
		this.openForFile(file);
	}

	private openForFile(file: TFile): void {
		// Prefill the Search field with just the sanitized title. Type is read
		// separately and passed as its own parameter for category routing — it is
		// never folded into the query string.
		const title = sanitizeFilename(file.basename);
		const noteType = this.readType(file);
		const modal = new CoverSearchModal(
			this.app,
			title,
			noteType,
			this.settings,
			// Returns a promise that rejects on failure; the Modal awaits it and only
			// closes on success, keeping itself open (with a Notice) if this throws.
			(result: CoverSearchResult, destination: Destination) =>
				this.assignCover(file, result, destination),
		);
		modal.open();
	}

	private readType(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const raw: unknown = cache?.frontmatter?.[this.settings.typeProperty];
		return typeof raw === "string" ? raw.trim() : "";
	}

	/**
	 * Apply the chosen cover to `file`. Any failure REJECTS (with a user-facing
	 * message) so the Modal can surface it and stay open — this method deliberately
	 * does not swallow errors or close anything.
	 *
	 * - Download → fetch the full-res image into the vault, then write that
	 *   vault-relative path into the frontmatter property.
	 * - URL → write the full-res URL straight into the property (no download; never
	 *   the thumbnail URL).
	 */
	private async assignCover(
		file: TFile,
		result: CoverSearchResult,
		destination: Destination,
	): Promise<void> {
		const value =
			destination === "download"
				? await this.downloads.download(
						result.fullResUrl,
						file.basename,
						this.settings.downloadFolder,
				  )
				: result.fullResUrl;

		await this.frontmatter.setCover(
			file,
			this.settings.destinationProperty,
			value,
		);

		new Notice(
			destination === "download"
				? "Get Covers: cover downloaded and assigned."
				: "Get Covers: cover URL assigned.",
		);
	}
}
