import {
	App,
	RequestUrlResponse,
	TFile,
	TFolder,
	normalizePath,
	requestUrl,
} from "obsidian";
import { sanitizeFilename } from "./utils";

/*
 * Downloads a chosen cover into the vault. Everything here uses ONLY Obsidian's
 * cross-platform APIs — `requestUrl` for the network and the `Vault` API for
 * files/folders — so it runs unmodified on desktop, Android and iOS. There is no
 * dependency on Node's `fs`, `path`, `Buffer`, or any other Node-only module;
 * paths are plain "/"-joined strings and bytes are handled as `ArrayBuffer` /
 * `Uint8Array`.
 */

/** Final fallback extension when neither the header nor the bytes identify a type. */
const DEFAULT_EXTENSION = "jpg";

export class DownloadService {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Download the image at `fullResUrl` into the settings download folder and
	 * return the resulting vault-relative path.
	 *
	 * @param fullResUrl  The full-resolution image URL (never a thumbnail).
	 * @param baseName    The note basename; sanitized into the saved file's name.
	 * @param folderSetting The configured download folder (e.g. "Assets/Covers/").
	 * @throws Error with a user-facing message on any failure (download, folder
	 *         creation, or write). Callers surface `error.message` to the user.
	 */
	async download(
		fullResUrl: string,
		baseName: string,
		folderSetting: string,
	): Promise<string> {
		const response = await this.fetchImage(fullResUrl);
		const bytes: ArrayBuffer = response.arrayBuffer;
		const extension = resolveExtension(response, bytes);

		const folder = normalizeFolder(folderSetting);
		await this.ensureFolder(folder);

		const fileName = `${sanitizeFilename(baseName)}.${extension}`;
		const path = folder.length > 0 ? `${folder}/${fileName}` : fileName;

		await this.writeBinary(path, bytes);
		return path;
	}

	/** GET the image bytes via requestUrl, mapping any failure to a clear message. */
	private async fetchImage(url: string): Promise<RequestUrlResponse> {
		try {
			return await requestUrl({ url, method: "GET" });
		} catch (error) {
			console.error("Get Covers: image download failed", error);
			throw new Error(
				"Couldn't download the image. Check your connection or try a " +
					"different result.",
			);
		}
	}

	/**
	 * Ensure `folderPath` exists. `createFolder` throws if the folder already
	 * exists, so we check first and also tolerate a lost create/exists race.
	 */
	private async ensureFolder(folderPath: string): Promise<void> {
		if (folderPath.length === 0) {
			return; // vault root — nothing to create
		}
		if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
			return;
		}
		try {
			await this.app.vault.createFolder(folderPath);
		} catch (error) {
			// Tolerate "already exists" (e.g. created concurrently); rethrow otherwise.
			if (
				this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder
			) {
				return;
			}
			console.error("Get Covers: failed to create download folder", error);
			throw new Error(`Couldn't create the download folder "${folderPath}".`);
		}
	}

	/** Write bytes to `path`, overwriting an existing file in place. */
	private async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		try {
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				// Overwrite the existing cover's bytes (e.g. re-downloading for the
				// same note) rather than creating a duplicate.
				await this.app.vault.modifyBinary(existing, data);
				return;
			}
			await this.app.vault.createBinary(path, data);
		} catch (error) {
			console.error("Get Covers: failed to write image to vault", error);
			throw new Error("Couldn't save the image into your vault.");
		}
	}
}

/** Normalize a folder setting to a clean vault-relative path (no leading/trailing "/"). */
function normalizeFolder(folderSetting: string): string {
	// Run the user-supplied path through Obsidian's own normalizer first — it
	// collapses duplicate and back-slashes and handles platform quirks
	// consistently — then strip any leading/trailing slash so it joins cleanly
	// with the filename (and an empty/root setting normalizes to "").
	const normalized = normalizePath(folderSetting.trim());
	return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Determine the file extension: prefer the `Content-Type` header, then sniff the
 * leading magic bytes (jpg/png/webp/gif), then fall back to jpg. If the header is
 * present and clearly NOT an image and the bytes are unrecognized, reject — that
 * link returned something other than an image (e.g. an HTML error page).
 */
function resolveExtension(
	response: RequestUrlResponse,
	bytes: ArrayBuffer,
): string {
	const contentType = readContentType(response);
	const fromHeader = extensionFromContentType(contentType);
	if (fromHeader) {
		return fromHeader;
	}
	const fromBytes = sniffExtension(bytes);
	if (fromBytes) {
		return fromBytes;
	}
	if (contentType && !contentType.toLowerCase().startsWith("image/")) {
		throw new Error("That link didn't return an image file.");
	}
	return DEFAULT_EXTENSION;
}

/** Read the Content-Type header case-insensitively. */
function readContentType(response: RequestUrlResponse): string | undefined {
	const headers = response.headers;
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === "content-type") {
			return headers[key];
		}
	}
	return undefined;
}

/** Map an image MIME type to a file extension, or null if unknown. */
function extensionFromContentType(contentType: string | undefined): string | null {
	if (!contentType) {
		return null;
	}
	const mime = contentType.split(";")[0].trim().toLowerCase();
	switch (mime) {
		case "image/jpeg":
		case "image/jpg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return null;
	}
}

/** Sniff common image formats from the leading magic bytes, or null if unknown. */
function sniffExtension(buffer: ArrayBuffer): string | null {
	const b = new Uint8Array(buffer);
	// JPEG: FF D8 FF
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
		return "jpg";
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		b.length >= 8 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47 &&
		b[4] === 0x0d &&
		b[5] === 0x0a &&
		b[6] === 0x1a &&
		b[7] === 0x0a
	) {
		return "png";
	}
	// WEBP: "RIFF"???? "WEBP"
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	) {
		return "webp";
	}
	// GIF: "GIF8"
	if (
		b.length >= 4 &&
		b[0] === 0x47 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x38
	) {
		return "gif";
	}
	return null;
}
