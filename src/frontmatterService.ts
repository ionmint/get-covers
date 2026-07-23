import { App, Notice, TFile } from "obsidian";

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
	 * @throws re-throws after notifying the user, so callers may handle failure.
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
			console.error("Cover Search: failed to write frontmatter", error);
			new Notice("Cover Search: failed to update the note's frontmatter.");
			throw error;
		}
	}

	/**
	 * Read the current value of the `propertyName` frontmatter property, if any.
	 * Returns `undefined` when the property is absent or not a string.
	 */
	async getCover(
		file: TFile,
		propertyName: string,
	): Promise<string | undefined> {
		try {
			let result: string | undefined;
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const raw: unknown = frontmatter[propertyName];
				result = typeof raw === "string" ? raw : undefined;
			});
			return result;
		} catch (error) {
			console.error("Cover Search: failed to read frontmatter", error);
			return undefined;
		}
	}
}
