import { Menu, Notice, Plugin, TFile } from "obsidian";
import { CoverSearchSettings, CoverSearchResult } from "./types";
import {
	CoverSearchPluginContract,
	CoverSearchSettingTab,
	mergeSettings,
} from "./settings";
import { FrontmatterService } from "./frontmatterService";
import { CoverSearchModal } from "./modal";
import { sanitizeFilename } from "./utils";

export default class CoverSearchPlugin
	extends Plugin
	implements CoverSearchPluginContract
{
	settings!: CoverSearchSettings;
	private frontmatter!: FrontmatterService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.frontmatter = new FrontmatterService(this.app);

		this.addSettingTab(new CoverSearchSettingTab(this.app, this));

		this.addCommand({
			id: "cover-search-open",
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
			new Notice("Cover Search: open a note first.");
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
			(result: CoverSearchResult) => {
				void this.assignCover(file, result);
			},
		);
		modal.open();
	}

	private readType(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const raw: unknown = cache?.frontmatter?.[this.settings.typeProperty];
		return typeof raw === "string" ? raw.trim() : "";
	}

	private async assignCover(
		file: TFile,
		result: CoverSearchResult,
	): Promise<void> {
		try {
			await this.frontmatter.setCover(
				file,
				this.settings.destinationProperty,
				result.fullResUrl,
			);
			new Notice("Cover Search: cover assigned.");
		} catch (error) {
			// FrontmatterService already notified the user; log for diagnostics.
			console.error("Cover Search: failed to assign cover", error);
		}
	}
}
