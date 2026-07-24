import { App, TFile } from "obsidian";

/**
 * Wraps all frontmatter mutations for the plugin.
 *
 * Per project rules, frontmatter is read/written EXCLUSIVELY through
 * `app.fileManager.processFrontMatter()`.
 */
export class FrontmatterService {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Write `value` into the `propertyName` frontmatter property of `file`.
	 * Overwrites the property if it already exists, creates it otherwise.
	 *
	 * @throws Error with a user-facing message on failure. Messaging is left to the
	 *         caller (the Modal) so the whole save flow shows a single Notice.
	 */
	async setCover(
		file: TFile,
		propertyName: string,
		value: string,
	): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[propertyName] = value;
			});
		} catch (error) {
			console.error("Get Covers: failed to write frontmatter", error);
			throw new Error("Couldn't update the note's frontmatter.");
		}
	}
}
