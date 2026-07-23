import { App, Modal, Notice, Platform } from "obsidian";
import {
	CoverProvider,
	CoverResult,
	CoverSearchSettings,
	Destination,
	GalleryTheme,
	SearchMode,
} from "./types";

/**
 * Phase 1 mock provider: returns a fixed set of fake results so the Modal and
 * grid can be built and visually tested without any network access.
 *
 * Implements the shared `CoverProvider` interface so real providers can drop in
 * later without changing the Modal.
 */
class MockCoverProvider implements CoverProvider {
	readonly id = "mock";

	constructor(private readonly count: number) {}

	async search(_query: string): Promise<CoverResult[]> {
		const results: CoverResult[] = [];
		// Use a per-search seed so Refresh returns a fresh-looking set.
		const seedBase = Date.now() % 100000;
		for (let i = 0; i < this.count; i++) {
			const seed = seedBase + i;
			results.push({
				id: `mock-${seed}`,
				// Deterministic `/seed/` endpoint: the thumbnail and the full image
				// are the SAME photo at two resolutions, so the saved cover matches
				// the clicked thumbnail. (The `?random=` endpoint returns a different
				// random photo per request, which mismatched thumbnail vs full.)
				thumbnailUrl: `https://picsum.photos/seed/${seed}/200/300`,
				fullUrl: `https://picsum.photos/seed/${seed}/400/600`,
				width: 400,
				height: 600,
				sourceLabel: "Mock",
			});
		}
		return results;
	}
}

/** Callback invoked when the user picks a cover. */
export type OnSelectCover = (result: CoverResult) => void;

function isSearchMode(value: string): value is SearchMode {
	return value === "database" || value === "google";
}

function isDestination(value: string): value is Destination {
	return value === "download" || value === "url";
}

/**
 * The cover search Modal: a toolbar plus a responsive, touch-friendly image grid.
 */
export class CoverSearchModal extends Modal {
	/**
	 * The single source of the default Suffix token. It is also the only place
	 * the word "cover" appears in query building — everything else derives the
	 * suffix from the live Suffix input, never a hardcoded literal.
	 */
	private static readonly DEFAULT_SUFFIX = "cover";

	private readonly settings: CoverSearchSettings;
	private readonly onSelect: OnSelectCover;
	private readonly provider: CoverProvider;

	/** The Search field's starting text: just the note title, nothing else. */
	private readonly initialQuery: string;
	/**
	 * The note's Type value, kept SEPARATE from the query. It is used only for
	 * category/provider routing (Phase 2+) and is never concatenated into the
	 * text sent to a provider's search call.
	 */
	private readonly noteType: string;

	/** Per-search selections, seeded from the saved defaults; never persisted back. */
	private mode: SearchMode;
	private destination: Destination;

	private gridEl: HTMLElement | null = null;
	private loadingEl: HTMLElement | null = null;
	private queryPreviewEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private suffixInputEl: HTMLInputElement | null = null;
	/** The Refresh toolbar field, kept so it can be relocated on mobile. */
	private refreshFieldEl: HTMLElement | null = null;

	/** Guards against overlapping searches racing to render. */
	private searchToken = 0;

	constructor(
		app: App,
		initialQuery: string,
		noteType: string,
		settings: CoverSearchSettings,
		onSelect: OnSelectCover,
	) {
		super(app);
		this.settings = settings;
		this.onSelect = onSelect;
		this.initialQuery = initialQuery;
		this.noteType = noteType;
		this.mode = settings.defaultSearchMode;
		this.destination = settings.defaultDestination;
		this.provider = new MockCoverProvider(Math.max(1, settings.maxResults));
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass("cover-search-modal");
		// Responsive sizing lives on the modal container so only the grid scrolls.
		modalEl.addClass("cover-search-modal-el");
		// Drive mobile layout off Obsidian's real mobile signal, not just a width
		// media query — the class carries enough specificity to beat core rules.
		if (Platform.isMobile) {
			contentEl.addClass("cover-search-mobile");
			modalEl.addClass("cover-search-mobile");
		}
		this.applyTheme(contentEl, this.settings.galleryTheme);

		// On mobile, both corner controls share ONE header row. This container is
		// created first (top of the column); the native close button and the
		// Refresh field are moved into it below. Desktop never creates it, so the
		// desktop DOM is untouched.
		const mobileHeader = Platform.isMobile
			? contentEl.createDiv({ cls: "cover-search-mobile-header" })
			: null;

		this.buildToolbar(contentEl);

		if (mobileHeader) {
			// Pull Obsidian's close button (normally chrome on modalEl) and the
			// Refresh field (normally a toolbar control) into the shared row, in
			// left→right order: X first, Refresh second. Moving the elements keeps
			// their existing event listeners intact.
			const closeButton = this.modalEl.querySelector(".modal-close-button");
			if (closeButton instanceof HTMLElement) {
				mobileHeader.appendChild(closeButton);
			}
			if (this.refreshFieldEl) {
				mobileHeader.appendChild(this.refreshFieldEl);
			}
		}

		// Shows the exact query string sent to the provider on each search, so a
		// live Suffix edit is verifiable even though the mock ignores the query.
		this.queryPreviewEl = contentEl.createDiv({
			cls: "cover-search-query-preview",
		});

		this.loadingEl = contentEl.createDiv({ cls: "cover-search-loading" });
		this.loadingEl.setText("Loading…");
		this.loadingEl.hide();

		this.gridEl = contentEl.createDiv({ cls: "cover-search-grid" });

		// NOTE: deliberately do NOT auto-focus any input — doing so pops the
		// on-screen keyboard on mobile. Focus happens only on explicit user tap.

		void this.runSearch();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass("cover-search-modal-el", "cover-search-mobile");
	}

	private applyTheme(el: HTMLElement, theme: GalleryTheme): void {
		el.removeClass("cover-search-theme-light", "cover-search-theme-dark");
		if (theme === "light") {
			el.addClass("cover-search-theme-light");
		} else if (theme === "dark") {
			el.addClass("cover-search-theme-dark");
		}
		// "auto" adds no class and inherits the Obsidian theme.
	}

	/** Create one labeled toolbar field (label stacked above its control). */
	private createField(
		parent: HTMLElement,
		labelText: string,
		modifier: string,
	): HTMLElement {
		const field = parent.createDiv({
			cls: `cover-search-field cover-search-field-${modifier}`,
		});
		field.createEl("label", {
			cls: "cover-search-label",
			text: labelText,
		});
		return field;
	}

	private buildToolbar(parent: HTMLElement): void {
		const toolbar = parent.createDiv({ cls: "cover-search-toolbar" });

		// Search.
		const searchField = this.createField(toolbar, "Search", "search");
		const searchInput = searchField.createEl("input", {
			cls: "cover-search-input",
			type: "text",
		});
		searchInput.placeholder = "Search for a cover…";
		// Seed the Search box with just the note title. Type is NOT folded in
		// (it routes separately) and the Suffix is a separate field.
		searchInput.value = this.initialQuery;
		searchInput.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.runSearch();
			}
		});
		this.searchInputEl = searchInput;

		// Suffix.
		const suffixField = this.createField(toolbar, "Suffix", "suffix");
		const suffixInput = suffixField.createEl("input", {
			cls: "cover-search-input",
			type: "text",
		});
		suffixInput.placeholder = CoverSearchModal.DEFAULT_SUFFIX;
		suffixInput.value = CoverSearchModal.DEFAULT_SUFFIX;
		this.suffixInputEl = suffixInput;

		// Mode.
		const modeField = this.createField(toolbar, "Mode", "mode");
		const modeSelect = modeField.createEl("select", {
			cls: "cover-search-select dropdown",
		});
		modeSelect.createEl("option", { value: "database", text: "Database" });
		modeSelect.createEl("option", { value: "google", text: "Google Images" });
		modeSelect.value = this.mode;
		modeSelect.addEventListener("change", () => {
			if (isSearchMode(modeSelect.value)) {
				this.mode = modeSelect.value; // per-search only; not persisted
				// Suffix only applies to Google Images; gate it on the mode.
				this.updateSuffixState();
				// Keep the preview in sync without hitting the provider.
				this.updateQueryPreview(this.getEffectiveQuery());
			}
		});

		// Destination.
		const destField = this.createField(toolbar, "Destination", "destination");
		const destSelect = destField.createEl("select", {
			cls: "cover-search-select dropdown",
		});
		destSelect.createEl("option", { value: "download", text: "Download" });
		destSelect.createEl("option", { value: "url", text: "URL" });
		destSelect.value = this.destination;
		destSelect.addEventListener("change", () => {
			if (isDestination(destSelect.value)) {
				this.destination = destSelect.value; // per-search only; not persisted
			}
		});

		// Refresh (its own field so it aligns in the wrap flow).
		const refreshField = this.createField(toolbar, " ", "refresh");
		// Kept as a member so the mobile layout can relocate it into the header row.
		this.refreshFieldEl = refreshField;
		const refreshBtn = refreshField.createEl("button", {
			cls: "cover-search-refresh mod-cta",
			text: "Refresh",
		});
		refreshBtn.type = "button";
		refreshBtn.addEventListener("click", () => {
			void this.runSearch();
		});

		// Reflect the initial mode on the Suffix field's enabled state.
		this.updateSuffixState();
	}

	/**
	 * The Suffix field only applies to Google Images. Disable and grey it out in
	 * Database mode so it cannot be edited — and, by definition, it is never read
	 * into the Database query (see getDbQuery/getEffectiveQuery).
	 */
	private updateSuffixState(): void {
		if (!this.suffixInputEl) {
			return;
		}
		const enabled = this.mode === "google";
		this.suffixInputEl.disabled = !enabled;
		this.suffixInputEl.toggleClass("cover-search-input-disabled", !enabled);
	}

	/**
	 * The Database query: the Search field's raw contents, trimmed. Used whenever
	 * Mode = Database. It never includes Type (routes separately) or the Suffix.
	 */
	private getDbQuery(): string {
		return (this.searchInputEl?.value ?? "").trim();
	}

	/**
	 * The generic-image query: Search field contents + Type (if non-empty) +
	 * Suffix (if non-empty), each separated by a single space. Used whenever
	 * Mode = Google Images. Unlike structured providers, a Type word ("Book",
	 * "Movie", …) genuinely biases a generic image search. Recomputed fresh on
	 * every use from the live inputs, never cached from an earlier Mode.
	 */
	private getImageQuery(): string {
		const parts = [
			this.getDbQuery(),
			this.noteType.trim(),
			(this.suffixInputEl?.value ?? "").trim(),
		];
		return parts.filter((part) => part.length > 0).join(" ");
	}

	/**
	 * The query actually passed to the provider, chosen by the current Mode.
	 * Read from the LIVE inputs at call time, never a stale capture.
	 */
	private getEffectiveQuery(): string {
		return this.mode === "google" ? this.getImageQuery() : this.getDbQuery();
	}

	/** Render the query sent to the provider plus the separate routing context. */
	private updateQueryPreview(query: string): void {
		if (!this.queryPreviewEl) {
			return;
		}
		this.queryPreviewEl.empty();
		this.queryPreviewEl.appendText("Searching: ");
		this.queryPreviewEl.createEl("code", { text: query });
		// Type is shown here as routing context ONLY — it is deliberately not part
		// of the query above.
		const routing = this.noteType.length > 0 ? this.noteType : "none";
		this.queryPreviewEl.appendText(`  ·  Mode: ${this.mode}  ·  Type: ${routing}`);
	}

	private setLoading(loading: boolean): void {
		if (!this.loadingEl) {
			return;
		}
		if (loading) {
			this.loadingEl.show();
		} else {
			this.loadingEl.hide();
		}
	}

	private async runSearch(): Promise<void> {
		if (!this.gridEl) {
			return;
		}
		const token = ++this.searchToken;
		// Read the LIVE Search + Suffix inputs at this exact moment.
		const query = this.getEffectiveQuery();
		this.updateQueryPreview(query);
		this.setLoading(true);
		this.gridEl.empty();

		try {
			const results = await this.provider.search(query);
			// Ignore stale responses if another search started meanwhile.
			if (token !== this.searchToken) {
				return;
			}
			this.renderResults(results);
		} catch (error) {
			if (token !== this.searchToken) {
				return;
			}
			console.error("Cover Search: search failed", error);
			new Notice("Cover Search: search failed.");
			this.renderEmptyState("Something went wrong. Try again.");
		} finally {
			if (token === this.searchToken) {
				this.setLoading(false);
			}
		}
	}

	private renderResults(results: CoverResult[]): void {
		if (!this.gridEl) {
			return;
		}
		this.gridEl.empty();

		if (results.length === 0) {
			this.renderEmptyState("No covers found.");
			return;
		}

		for (const result of results) {
			this.renderThumbnail(this.gridEl, result);
		}
	}

	private renderThumbnail(parent: HTMLElement, result: CoverResult): void {
		// Fresh per-cell closure: this handler is bound to THIS exact result object.
		const selected: CoverResult = result;

		// A <div> with the button role — NOT a <button>. A <button> establishes an
		// internal content box that breaks the poster ratio of its descendants;
		// a div is a normal grid/block participant, with keyboard handling added
		// for accessibility parity.
		const cell = parent.createDiv({ cls: "cover-search-cell" });
		cell.setAttribute("role", "button");
		cell.tabIndex = 0;
		cell.setAttribute("aria-label", selected.sourceLabel ?? "Select cover");

		const frame = cell.createDiv({ cls: "cover-search-frame" });
		const img = frame.createEl("img", { cls: "cover-search-thumb" });
		img.src = selected.thumbnailUrl;
		img.alt = selected.sourceLabel ?? "Cover";
		img.loading = "lazy";

		cell.addEventListener("click", () => this.handleSelect(selected));
		cell.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.handleSelect(selected);
			}
		});
	}

	private renderEmptyState(message: string): void {
		if (!this.gridEl) {
			return;
		}
		this.gridEl.empty();
		this.gridEl.createDiv({ cls: "cover-search-empty", text: message });
	}

	private handleSelect(result: CoverResult): void {
		try {
			this.onSelect(result);
		} finally {
			this.close();
		}
	}
}
