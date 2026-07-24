import { copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import process from "process";

/*
 * Copies the three files Obsidian actually loads — main.js, manifest.json and
 * styles.css — into a plugin folder, so styles.css can never lag behind a build
 * again (the root cause of the mobile layout "fixes not taking effect").
 *
 * Usage:
 *   COVER_SEARCH_PLUGIN_DIR="<vault>/.obsidian/plugins/get-covers" npm run deploy
 *
 * On Windows PowerShell:
 *   $env:COVER_SEARCH_PLUGIN_DIR="C:\path\to\vault\.obsidian\plugins\get-covers"; npm run deploy
 */

const target = process.env.COVER_SEARCH_PLUGIN_DIR;

if (!target) {
	console.error(
		"deploy: set COVER_SEARCH_PLUGIN_DIR to your vault's " +
			".obsidian/plugins/get-covers folder first.",
	);
	process.exit(1);
}

const files = ["main.js", "manifest.json", "styles.css"];

for (const file of files) {
	if (!existsSync(file)) {
		console.error(`deploy: ${file} is missing — run "npm run build" first.`);
		process.exit(1);
	}
}

await mkdir(target, { recursive: true });

for (const file of files) {
	await copyFile(file, path.join(target, file));
	console.log(`deploy: copied ${file} -> ${path.join(target, file)}`);
}

console.log("deploy: done. Fully restart Obsidian (mobile caches styles.css).");
