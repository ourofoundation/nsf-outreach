import fs from "fs";
import path from "path";
import { glob } from "glob";
import { DIRS, listIds, readJson, matchesKeywords } from "./utils.js";

/**
 * Get all available years in the awards folder
 */
export function getAvailableYears() {
  const awardsDir = DIRS.awards;
  if (!fs.existsSync(awardsDir)) return [];

  return fs
    .readdirSync(awardsDir)
    .filter((f) => {
      const fullPath = path.join(awardsDir, f);
      return fs.statSync(fullPath).isDirectory() && /^\d{4}$/.test(f);
    })
    .sort();
}

/**
 * List all award IDs for a given year
 */
export function listAwardIds(year) {
  const yearDir = path.join(DIRS.awards, String(year));
  if (!fs.existsSync(yearDir)) return [];

  return fs
    .readdirSync(yearDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

/**
 * Load a single award by ID and year
 */
export function loadAward(awardId, year) {
  const filepath = path.join(DIRS.awards, String(year), `${awardId}.json`);
  return readJson(filepath);
}

/**
 * Load all awards for a year, optionally filtered by keywords
 */
export function loadAwards(year, keywords = []) {
  const ids = listAwardIds(year);
  const awards = [];

  for (const id of ids) {
    const award = loadAward(id, year);
    if (!award) continue;

    // Normalize field names for easier access
    award.title = award.awd_titl_txt || award.title || "";
    award.abstractText =
      award.awd_abstract_narration || award.abstractText || "";
    award.awardNumber = award.awd_id || award.awardNumber || id;

    // Check keyword match in title and abstract
    const searchText = `${award.title} ${award.abstractText}`;
    if (matchesKeywords(searchText, keywords)) {
      awards.push({ ...award, _id: id, _year: year });
    }
  }

  return awards;
}

/**
 * Get awards that haven't been processed yet
 */
export function getUnprocessedAwards(year, keywords = []) {
  const awards = loadAwards(year, keywords);

  // Collect all processed IDs from all status folders
  const processed = new Set([
    ...listIds("drafts"),
    ...listIds("approved"),
    ...listIds("sent"),
    ...listIds("skipped"),
  ]);

  return awards.filter((award) => {
    const id = award.awardNumber || award._id;
    return !processed.has(id);
  });
}

/**
 * Extract PI info from award data
 * NSF JSON structure uses nested pi array and inst object
 */
export function extractPIInfo(award) {
  // Get the principal investigator from the pi array
  const piData =
    award.pi?.find((p) => p.pi_role === "Principal Investigator") ||
    award.pi?.[0] ||
    {};

  const piFirstName = piData.pi_first_name || award.piFirstName || "";
  const piLastName = piData.pi_last_name || award.piLastName || "";
  const piEmail = piData.pi_email_addr || award.piEmail || null;
  const institution = award.inst?.inst_name || award.awardeeName || "";

  return {
    piFirstName,
    piLastName,
    piName: piData.pi_full_name || `${piFirstName} ${piLastName}`.trim(),
    piEmail,
    institution,
  };
}

/**
 * Check if an award has valid contact info
 */
export function hasValidContact(award) {
  const { piEmail } = extractPIInfo(award);
  return piEmail && piEmail.includes("@");
}

/**
 * Load all awards from staging folder
 */
export function loadStagingAwards() {
  const stagingDir = DIRS.staging;
  if (!fs.existsSync(stagingDir)) return [];

  const ids = listIds("staging");
  const awards = [];

  for (const id of ids) {
    const filepath = path.join(stagingDir, `${id}.json`);
    const award = readJson(filepath);
    if (!award) continue;

    // Normalize field names for easier access
    award.title = award.awd_titl_txt || award.title || "";
    award.abstractText =
      award.awd_abstract_narration || award.abstractText || "";
    award.awardNumber = award.awd_id || award.awardNumber || id;
    award._id = id;

    awards.push(award);
  }

  return awards;
}

/**
 * Get scan statistics for awards
 */
export function getScanStats(year, keywords = []) {
  const allAwards = loadAwards(year, keywords);
  const unprocessed = getUnprocessedAwards(year, keywords);

  const withEmail = allAwards.filter(hasValidContact);
  const withoutEmail = allAwards.filter((a) => !hasValidContact(a));

  const unprocessedWithEmail = unprocessed.filter(hasValidContact);

  return {
    total: allAwards.length,
    withEmail: withEmail.length,
    withoutEmail: withoutEmail.length,
    unprocessed: unprocessed.length,
    unprocessedWithEmail: unprocessedWithEmail.length,
    readyToGenerate: unprocessedWithEmail.length,
  };
}
