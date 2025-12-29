import fs from "fs";
import path from "path";

// Base directories
export const DIRS = {
  awards: "awards",
  drafts: "drafts",
  approved: "approved",
  sent: "sent",
  skipped: "skipped",
  staging: "staging",
  templates: "templates",
};

/**
 * Ensure all required directories exist
 */
export function ensureDirs() {
  Object.values(DIRS).forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * List all IDs in a status folder (drafts, approved, sent, skipped)
 */
export function listIds(folder) {
  const dir = DIRS[folder] || folder;
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

/**
 * Read a JSON file
 */
export function readJson(filepath) {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

/**
 * Write a JSON file
 */
export function writeJson(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

/**
 * Move a file from one folder to another
 */
export function moveFile(filename, fromFolder, toFolder) {
  const fromPath = path.join(DIRS[fromFolder] || fromFolder, filename);
  const toPath = path.join(DIRS[toFolder] || toFolder, filename);

  ensureDirs();
  fs.renameSync(fromPath, toPath);
}

/**
 * Get the path to an email file in a status folder
 */
export function getEmailPath(awardId, folder) {
  return path.join(DIRS[folder] || folder, `${awardId}.json`);
}

/**
 * Check if a string contains any of the given keywords (case-insensitive)
 */
export function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  if (!text) return false;

  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a date for display
 */
export function formatDate(date) {
  return new Date(date).toLocaleString();
}
