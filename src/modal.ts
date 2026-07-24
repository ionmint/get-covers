import { App, Modal, Notice, Platform } from "obsidian";
import {
	CoverProvider,
	CoverSearchResult,
	CoverSearchSettings,
	Destination,
	GalleryTheme,
	SearchMode,
} from "./types";
import { resolveDatabaseProvider } from "./databaseResolver";
import { GoogleImageProvider } from "./googleImageProvider";
import {
	ProviderError,
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
} from "./errors";

/** Callback invoked when the user picks a cover. */
export type OnSelectCover = (result: CoverSearchResult) => void;

/** Settings `apiKeys` key under which the SerpAPI (Google Images) key is stored. */
const SERPAPI_KEY = "serpapi";

function isSearchMode(value: string): value is SearchMode {
	return value === "database" || value === "google";
}

function isDestination(value: string): value is Destination {
	return value === "download" || value === "url";
}

/** Preset result-count choices offered by the in-modal count popover. */
const COUNT_PRESETS: readonly number[] = [2, 4, 8];

/**
 * Upper bound accepted for a custom result count. Matches the practical ceiling
 * the providers honor (AniList caps a page at 50; Google Books clamps its own to
 * 40), so a larger value is rejected outright rather than silently clamped.
 */
const MAX_RESULTS_CAP = 50;

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
	/** The Mode dropdown, kept so automatic fallback can sync its value to this.mode. */
	private modeSelectEl: HTMLSelectElement | null = null;
	/** The Refresh toolbar field, kept so it can be relocated on mobile. */
	private refreshFieldEl: HTMLElement | null = null;

	/** Guards against overlapping searches racing to render. */
	private searchToken = 0;

	/**
	 * Session-local override of `settings.maxResults`, set via the in-modal count
	 * popover. `null` means "use the settings default". Never persisted, and reset
	 * to `null` on every new Modal open (a fresh instance starts here).
	 */
	private resultCountOverride: number | null = null;

	/** The clickable "N results ▾" segment in the status line, and its popover parts. */
	private countControlEl: HTMLElement | null = null;
	private countTriggerEl: HTMLElement | null = null;
	private countPopoverEl: HTMLElement | null = null;
	private countCustomInputEl: HTMLInputElement | null = null;
	private countErrorEl: HTMLElement | null = null;

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
		// live Suffix edit is verifiable before the request goes out.
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
		// Tear down the count popover first so its document-level dismiss listeners
		// never outlive the modal.
		this.closeCountPopover();
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
		this.modeSelectEl = modeSelect;
		modeSelect.addEventListener("change", () => {
			if (isSearchMode(modeSelect.value)) {
				// setMode keeps the dropdown value + Suffix enabled-state in sync with
				// this.mode; runSearch then recomputes the query variant for the NEW
				// mode from the live Search field (dbQuery vs imageQuery).
				this.setMode(modeSelect.value); // per-search only; not persisted
				void this.runSearch();
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
	 * The single entry point for EVERY Mode change — the dropdown's own change
	 * event AND the automatic Database→Google-Images fallback both go through here.
	 * It keeps three things in lockstep with `this.mode` on every path: the field's
	 * value, the dropdown's displayed value, and the Suffix input's enabled state
	 * (Suffix is editable only in Google Images mode). Callers re-run the search.
	 */
	private setMode(mode: SearchMode): void {
		this.mode = mode;
		if (this.modeSelectEl && this.modeSelectEl.value !== mode) {
			this.modeSelectEl.value = mode;
		}
		this.updateSuffixState();
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
	 * Suffix (if non-empty), each separated by a single space. Used ONLY in Google
	 * Images mode — so Type is folded into the query in that mode alone (a Type
	 * word like "Game"/"Movie" genuinely biases a generic image search), while the
	 * Database query never includes it. This is also the one query variant that
	 * carries the Suffix. Recomputed fresh from the live inputs on every use, never
	 * cached from an earlier Mode.
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
		// The status line is about to be rebuilt, orphaning the old count control —
		// close any open popover (and drop its listeners) before wiping it.
		this.closeCountPopover();
		this.queryPreviewEl.empty();
		this.queryPreviewEl.appendText("Searching: ");
		this.queryPreviewEl.createEl("code", { text: query });
		// Type is shown here as routing context ONLY — it is deliberately not part
		// of the query above.
		const routing = this.noteType.length > 0 ? this.noteType : "none";
		this.queryPreviewEl.appendText(
			`  ·  Mode: ${this.mode}  ·  Type: ${routing}  ·  `,
		);
		this.renderCountTrigger(this.queryPreviewEl);
	}

	/**
	 * Effective result count for the current search: the session override when one
	 * is active, otherwise the settings default (floored to at least 1). This is
	 * the single value that reaches a provider's `search()` — providers never read
	 * `settings.maxResults` directly.
	 */
	private getEffectiveMaxResults(): number {
		if (this.resultCountOverride !== null) {
			return this.resultCountOverride;
		}
		return Math.max(1, this.settings.maxResults);
	}

	/**
	 * Render the trailing "N results ▾" segment of the status line as a clickable
	 * control that opens the count popover. Rebuilt on every status-line refresh so
	 * the number always reflects the effective count.
	 */
	private renderCountTrigger(parent: HTMLElement): void {
		// A positioned inline wrapper so the popover can anchor to the trigger
		// regardless of where the wrapping status line places it.
		const control = parent.createSpan({ cls: "cover-search-count-control" });
		this.countControlEl = control;

		const count = this.getEffectiveMaxResults();
		const trigger = control.createEl("button", {
			cls: "cover-search-count-trigger",
			text: `${count} ${count === 1 ? "result" : "results"} ▾`,
		});
		trigger.type = "button";
		trigger.setAttribute("aria-haspopup", "true");
		trigger.setAttribute("aria-expanded", "false");
		trigger.addEventListener("click", (evt: MouseEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.toggleCountPopover();
		});
		this.countTriggerEl = trigger;
	}

	private toggleCountPopover(): void {
		if (this.countPopoverEl) {
			this.closeCountPopover();
		} else {
			this.openCountPopover();
		}
	}

	/** Build and show the count popover: presets + a validated Custom row. */
	private openCountPopover(): void {
		if (!this.countControlEl || !this.countTriggerEl) {
			return;
		}
		this.closeCountPopover(); // safety: never stack two popovers

		const popover = this.countControlEl.createDiv({
			cls: "cover-search-count-popover",
		});
		popover.setAttribute("role", "menu");
		this.countPopoverEl = popover;
		this.countTriggerEl.setAttribute("aria-expanded", "true");

		const current = this.getEffectiveMaxResults();

		let firstOption: HTMLElement | null = null;
		for (const preset of COUNT_PRESETS) {
			const option = popover.createEl("button", {
				cls: "cover-search-count-option",
				text: String(preset),
			});
			option.type = "button";
			option.setAttribute("role", "menuitemradio");
			const isCurrent = preset === current;
			option.setAttribute("aria-checked", isCurrent ? "true" : "false");
			if (isCurrent) {
				option.addClass("is-selected");
			}
			option.addEventListener("click", () => this.commitCount(preset));
			if (firstOption === null) {
				firstOption = option;
			}
		}

		// Custom row: a number input committing on Enter or blur.
		const customRow = popover.createDiv({ cls: "cover-search-count-custom" });
		customRow.createSpan({
			cls: "cover-search-count-custom-label",
			text: "Custom",
		});
		const input = customRow.createEl("input", {
			cls: "cover-search-count-input",
			type: "number",
		});
		input.min = "1";
		input.max = String(MAX_RESULTS_CAP);
		input.step = "1";
		input.value = String(current);
		this.countCustomInputEl = input;

		const errorEl = popover.createDiv({ cls: "cover-search-count-error" });
		errorEl.hide();
		this.countErrorEl = errorEl;

		input.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.commitCustomCount();
			}
		});
		// Typing clears a previous validation error so the field feels responsive.
		input.addEventListener("input", () => this.clearCountError());
		// Commit on blur too — but deferred and identity-checked, so a competing
		// click (a preset, or an outside-click that dismisses) settles first and
		// this becomes a no-op rather than committing a stale value.
		input.addEventListener("blur", () => {
			const el = input;
			window.setTimeout(() => {
				if (this.countCustomInputEl === el) {
					this.commitCustomCount();
				}
			}, 0);
		});

		this.attachCountDismissHandlers();

		// Land focus inside the popover for keyboard users (a button, so no mobile
		// keyboard pops up — matching the modal's no-autofocus-input policy).
		firstOption?.focus();
	}

	/** Remove the popover and its dismiss listeners; safe to call when already closed. */
	private closeCountPopover(): void {
		// Always detach listeners (no-op if never attached) so none can leak.
		document.removeEventListener("pointerdown", this.handleCountOutsidePointer, true);
		document.removeEventListener("keydown", this.handleCountKeydown, true);
		if (this.countPopoverEl) {
			this.countPopoverEl.remove();
			this.countPopoverEl = null;
		}
		this.countCustomInputEl = null;
		this.countErrorEl = null;
		this.countTriggerEl?.setAttribute("aria-expanded", "false");
	}

	private attachCountDismissHandlers(): void {
		// Capture phase so we see the event before in-modal handlers; the opening
		// click's own pointerdown already fired, so this won't self-close.
		document.addEventListener("pointerdown", this.handleCountOutsidePointer, true);
		document.addEventListener("keydown", this.handleCountKeydown, true);
	}

	/** Close the popover when a pointer press lands outside its control. */
	private readonly handleCountOutsidePointer = (evt: PointerEvent): void => {
		if (
			this.countControlEl &&
			evt.target instanceof Node &&
			this.countControlEl.contains(evt.target)
		) {
			return; // press inside the control (trigger, option, input) — keep open
		}
		this.closeCountPopover();
	};

	/** Escape closes the popover (and keeps the modal open) and restores focus. */
	private readonly handleCountKeydown = (evt: KeyboardEvent): void => {
		if (evt.key === "Escape") {
			evt.preventDefault();
			evt.stopPropagation();
			this.closeCountPopover();
			this.countTriggerEl?.focus();
		}
	};

	/** Apply a validated count, close the popover, and re-run the current search. */
	private commitCount(value: number): void {
		this.resultCountOverride = value;
		this.closeCountPopover();
		// runSearch bumps searchToken and reads getEffectiveMaxResults() fresh, so a
		// slower in-flight request for the old count can't overwrite these results.
		void this.runSearch();
	}

	/** Validate the Custom input and commit it, or show an inline error and stay open. */
	private commitCustomCount(): void {
		if (!this.countCustomInputEl) {
			return;
		}
		const raw = this.countCustomInputEl.value.trim();
		const parsed = Number(raw);
		if (
			raw.length === 0 ||
			!Number.isInteger(parsed) ||
			parsed <= 0 ||
			parsed > MAX_RESULTS_CAP
		) {
			this.showCountError(
				`Enter a whole number from 1 to ${MAX_RESULTS_CAP}.`,
			);
			return;
		}
		this.commitCount(parsed);
	}

	private showCountError(message: string): void {
		if (!this.countErrorEl) {
			return;
		}
		this.countErrorEl.setText(message);
		this.countErrorEl.show();
		this.countCustomInputEl?.addClass("has-error");
		this.countCustomInputEl?.focus();
	}

	private clearCountError(): void {
		this.countErrorEl?.hide();
		this.countCustomInputEl?.removeClass("has-error");
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

		// Resolve the provider FIRST: in Database mode this may auto-switch Mode to
		// Google Images (fallback), which changes WHICH query variant applies. Only
		// after resolution do we compute the query, so it always matches the FINAL
		// mode — never a variant left over from before the switch.
		const provider = this.resolveProviderForCurrentMode();

		// Recompute for the (possibly just-changed) mode and show it.
		const query = this.getEffectiveQuery();
		this.updateQueryPreview(query);

		if (provider === null) {
			// resolveProviderForCurrentMode already rendered an explanation.
			this.setLoading(false);
			return;
		}
		if (query.length === 0) {
			this.setLoading(false);
			this.renderEmptyState("Type something to search for a cover.");
			return;
		}

		this.setLoading(true);
		this.gridEl.empty();
		try {
			// Only thumbnails are fetched here; the full-resolution URL is not
			// requested until the user selects a result (see handleSelect). The
			// count is the session override when set, else the settings default.
			const results = await provider.search(query, {
				maxResults: this.getEffectiveMaxResults(),
				timeoutMs: this.settings.requestTimeout,
			});
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
			const message = this.messageForError(error);
			new Notice(`Cover Search: ${message}`);
			this.renderEmptyState(message);
		} finally {
			if (token === this.searchToken) {
				this.setLoading(false);
			}
		}
	}

	/**
	 * Choose the provider for the current Mode.
	 *
	 * - Google Images mode → the SerpAPI provider (or null + message if no key).
	 * - Database mode → the Type→Category routing. If that yields no usable
	 *   provider (unmapped Type, or a key-requiring provider with no key), this
	 *   AUTOMATICALLY switches the UI to Google Images — updating the dropdown and
	 *   enabling Suffix via setMode — shows a Notice explaining why, and resolves
	 *   the image provider instead.
	 *
	 * Returns null when nothing can run, after rendering an explanation into the
	 * grid. Note: after a fallback, `this.mode` is "google", so the caller must
	 * recompute the query variant (it does).
	 */
	private resolveProviderForCurrentMode(): CoverProvider | null {
		if (this.mode === "google") {
			return this.resolveGoogleImageProvider();
		}

		const resolution = resolveDatabaseProvider(
			this.noteType,
			this.settings.typeMappings,
			{ apiKeys: this.settings.apiKeys },
		);
		if (resolution.kind === "provider") {
			return resolution.provider;
		}

		// Automatic fallback: no usable Database provider for this note. Explain why,
		// flip the UI to Google Images (setMode also enables the Suffix input), and
		// resolve the image provider instead.
		new Notice(`Cover Search: ${resolution.reason} Falling back to Google Images.`);
		this.setMode("google");
		return this.resolveGoogleImageProvider();
	}

	/**
	 * Build the SerpAPI-backed Google Images provider from settings, or render an
	 * explanation and return null when no SerpAPI key is configured.
	 */
	private resolveGoogleImageProvider(): CoverProvider | null {
		const apiKey = this.settings.apiKeys[SERPAPI_KEY]?.trim();
		if (!apiKey) {
			this.renderEmptyState(
				"Google Images needs a SerpAPI key — add one in the plugin " +
					"settings (Provider API keys → SerpAPI).",
			);
			return null;
		}
		return new GoogleImageProvider(apiKey);
	}

	/**
	 * Map a thrown error to a distinct, user-facing message. Every one of these
	 * states keeps the toolbar's Refresh button as its retry action.
	 */
	private messageForError(error: unknown): string {
		if (error instanceof RateLimitError) {
			return "Rate limited — check your API key or try again shortly.";
		}
		if (error instanceof ServiceUnavailableError) {
			return "The service is temporarily unavailable. Try again in a moment.";
		}
		if (error instanceof TimeoutError) {
			return "Request timed out.";
		}
		if (error instanceof ProviderError) {
			return error.status !== undefined
				? `Provider error (${error.status}).`
				: "Provider error.";
		}
		return "Something went wrong. Try again.";
	}

	private renderResults(results: CoverSearchResult[]): void {
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

	private renderThumbnail(parent: HTMLElement, result: CoverSearchResult): void {
		// Fresh per-cell closure: this handler is bound to THIS exact result object.
		const selected: CoverSearchResult = result;

		// A <div> with the button role — NOT a <button>. A <button> establishes an
		// internal content box that breaks the poster ratio of its descendants;
		// a div is a normal grid/block participant, with keyboard handling added
		// for accessibility parity.
		const cell = parent.createDiv({ cls: "cover-search-cell" });
		cell.setAttribute("role", "button");
		cell.tabIndex = 0;
		cell.setAttribute("aria-label", selected.sourceLabel || "Select cover");

		const frame = cell.createDiv({ cls: "cover-search-frame" });
		const img = frame.createEl("img", { cls: "cover-search-thumb" });
		img.src = selected.thumbnailUrl;
		img.alt = selected.sourceLabel || "Cover";
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

	private handleSelect(result: CoverSearchResult): void {
		try {
			this.onSelect(result);
		} finally {
			this.close();
		}
	}
}
