import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { DIRS, readJson, writeJson, ensureDirs } from "./utils.js";
import { loadAwards, extractPIInfo, hasValidContact } from "./awards.js";

/**
 * Display a single award
 */
function displayAward(award, index, total, year) {
  console.clear();
  console.log(
    chalk.bold(`\n🔍 Explore Mode - ${year}`) +
      chalk.dim(` [${index + 1}/${total}]\n`)
  );
  console.log(chalk.dim("─".repeat(70)));

  const awardId = award.awd_id || award.awardNumber || award._id || "?";
  const title = award.awd_titl_txt || award.title || "No title";
  const amount = award.awd_amount || award.tot_intn_awd_amt || null;

  console.log(`${chalk.cyan("Award ID:")} ${awardId}`);
  console.log(`${chalk.cyan("Title:")} ${title}`);
  if (amount) {
    console.log(`${chalk.cyan("Amount:")} $${amount.toLocaleString()}`);
  }

  // PI Information
  const piInfo = extractPIInfo(award);
  console.log(chalk.dim("─".repeat(70)));
  console.log(`${chalk.cyan("PI:")} ${piInfo.piName || "N/A"}`);
  console.log(`${chalk.cyan("Email:")} ${piInfo.piEmail || chalk.dim("N/A")}`);
  console.log(`${chalk.cyan("Institution:")} ${piInfo.institution || "N/A"}`);

  // Abstract preview
  const abstract = award.awd_abstract_narration || award.abstractText || "";
  if (abstract) {
    console.log(chalk.dim("─".repeat(70)));
    console.log(chalk.cyan("Abstract:"));
    // Show first 500 chars of abstract
    const preview =
      abstract.length > 500
        ? abstract.substring(0, 500) + chalk.dim("...")
        : abstract;
    console.log(preview);
  }

  // Additional info
  if (award.awd_eff_date || award.awd_exp_date) {
    console.log(chalk.dim("─".repeat(70)));
    if (award.awd_eff_date) {
      console.log(`${chalk.dim("Start:")} ${award.awd_eff_date}`);
    }
    if (award.awd_exp_date) {
      console.log(`${chalk.dim("End:")} ${award.awd_exp_date}`);
    }
  }

  // Show if already in staging
  const stagingPath = path.join(DIRS.staging, `${awardId}.json`);
  const inStaging = fs.existsSync(stagingPath);
  if (inStaging) {
    console.log(chalk.dim("─".repeat(70)));
    console.log(chalk.green("✓ Already in staging"));
  }

  console.log();
  console.log(chalk.dim("─".repeat(70)));
  console.log();
  console.log(
    chalk.dim("  ←/→ or j/k") +
      "  Navigate    " +
      chalk.green("s") +
      "  Save to staging    " +
      chalk.yellow("e") +
      "  Edit    " +
      chalk.dim("q") +
      "  Quit"
  );
  console.log();
}

/**
 * Interactive explore session for raw awards
 */
export async function startExplore(year = "2025", keywords = []) {
  ensureDirs();

  // Load awards
  const awards = loadAwards(year, keywords);

  if (awards.length === 0) {
    console.log(
      chalk.yellow(
        `\n📭 No awards found for ${year}${
          keywords.length > 0 ? ` with keywords: ${keywords.join(", ")}` : ""
        }\n`
      )
    );
    return;
  }

  let currentIndex = 0;
  let running = true;

  // Set up raw mode for keyboard input
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const refresh = () => {
    if (awards.length === 0) {
      console.clear();
      console.log(chalk.green("\n✅ All awards explored!\n"));
      running = false;
      return false;
    }
    if (currentIndex >= awards.length) {
      currentIndex = awards.length - 1;
    }
    if (currentIndex < 0) {
      currentIndex = 0;
    }
    displayAward(awards[currentIndex], currentIndex, awards.length, year);
    return true;
  };

  refresh();

  const cleanup = () => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };

  return new Promise((resolve) => {
    const handleKeypress = async (str, key) => {
      if (!running) return;

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        running = false;
        console.clear();
        console.log(chalk.dim("\n👋 Exiting explore mode\n"));
        cleanup();
        process.stdin.removeListener("keypress", handleKeypress);
        resolve();
        return;
      }

      if (key.name === "right" || key.name === "l" || str === "l") {
        currentIndex = Math.min(currentIndex + 1, awards.length - 1);
        refresh();
      }

      if (key.name === "left" || key.name === "h" || str === "h") {
        currentIndex = Math.max(currentIndex - 1, 0);
        refresh();
      }

      if (str === "j" || key.name === "down") {
        currentIndex = Math.min(currentIndex + 1, awards.length - 1);
        refresh();
      }

      if (str === "k" || key.name === "up") {
        currentIndex = Math.max(currentIndex - 1, 0);
        refresh();
      }

      // Save to staging
      if (str === "s") {
        const current = awards[currentIndex];
        const awardId = current.awd_id || current.awardNumber || current._id;

        if (!awardId) {
          console.log(chalk.red(`\n❌ Cannot save: Award ID not found`));
          await new Promise((r) => setTimeout(r, 1000));
          refresh();
          return;
        }

        try {
          const stagingPath = path.join(DIRS.staging, `${awardId}.json`);

          // Add metadata about when it was staged
          const awardToSave = {
            ...current,
            _staged_at: new Date().toISOString(),
            _staged_from_year: year,
          };

          writeJson(stagingPath, awardToSave);
          console.log(chalk.green(`\n✅ Saved ${awardId} to staging`));
          await new Promise((r) => setTimeout(r, 500));
          refresh();
        } catch (err) {
          console.log(chalk.red(`\n❌ Error: ${err.message}`));
          await new Promise((r) => setTimeout(r, 1000));
          refresh();
        }
      }

      // Edit - open in editor
      if (str === "e") {
        const current = awards[currentIndex];
        const awardId = current.awd_id || current.awardNumber || current._id;
        const yearDir = path.join(DIRS.awards, String(year));
        const filepath = path.join(yearDir, `${awardId}.json`);

        if (!fs.existsSync(filepath)) {
          console.log(chalk.red(`\n❌ Award file not found: ${filepath}`));
          await new Promise((r) => setTimeout(r, 1000));
          refresh();
          return;
        }

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        console.log(chalk.dim(`\nOpening ${filepath} in editor...`));
        console.log(chalk.dim("Press any key when done editing to refresh.\n"));

        const editor = process.env.EDITOR || "vim";
        try {
          execSync(`${editor} "${filepath}"`, { stdio: "inherit" });
        } catch {
          console.log(chalk.yellow(`Open manually: ${filepath}`));
        }

        // Wait for a keypress to continue
        await new Promise((r) => {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.once("keypress", () => {
            // Reload the award
            const reloaded = readJson(filepath);
            if (reloaded) {
              // Normalize field names
              reloaded.title = reloaded.awd_titl_txt || reloaded.title || "";
              reloaded.abstractText =
                reloaded.awd_abstract_narration || reloaded.abstractText || "";
              reloaded.awardNumber =
                reloaded.awd_id || reloaded.awardNumber || awardId;
              reloaded._id = awardId;
              reloaded._year = year;
              awards[currentIndex] = reloaded;
            }
            refresh();
            r();
          });
        });
      }
    };

    process.stdin.on("keypress", handleKeypress);
  });
}
