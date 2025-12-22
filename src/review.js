import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { DIRS, readJson, listIds, moveFile, ensureDirs } from "./utils.js";

/**
 * Display a single email
 */
function displayEmail(email, index, total, folder) {
  console.clear();
  console.log(
    chalk.bold(`\n📧 Review Mode - ${folder}`) +
      chalk.dim(` [${index + 1}/${total}]\n`)
  );
  console.log(chalk.dim("─".repeat(70)));
  console.log(`${chalk.cyan("To:")} ${email.pi_name} <${email.pi_email}>`);
  console.log(`${chalk.cyan("Institution:")} ${email.institution}`);
  console.log(`${chalk.cyan("Subject:")} ${email.subject}`);
  console.log(chalk.dim("─".repeat(70)));
  console.log();
  console.log(email.body);
  console.log();
  console.log(chalk.dim("─".repeat(70)));
  const amountStr = email.award_amount
    ? `$${email.award_amount.toLocaleString()}`
    : "N/A";
  console.log(
    `${chalk.dim("Award:")} ${email.award_id} - ${email.award_title}`
  );
  console.log(`${chalk.dim("Amount:")} ${amountStr}`);

  if (email.variants) {
    console.log(
      `${chalk.dim("Variants:")} template=${email.variants.template}, desc=${
        email.variants.ouro_description
      }, cta=${email.variants.call_to_action}`
    );
  }

  console.log();
  console.log(chalk.dim("─".repeat(70)));
  console.log();
  console.log(
    chalk.dim("  ←/→ or j/k") +
      "  Navigate    " +
      chalk.green("a") +
      " Approve    " +
      chalk.red("s") +
      " Skip    " +
      chalk.yellow("e") +
      " Edit    " +
      chalk.dim("q") +
      " Quit"
  );
  console.log();
}

/**
 * Interactive review session
 */
export async function startReview(folder = "drafts") {
  ensureDirs();

  const ids = listIds(folder);

  if (ids.length === 0) {
    console.log(chalk.yellow(`\n📭 No emails in ${folder}/\n`));
    return;
  }

  // Load all emails
  const emails = ids
    .map((id) => {
      const filepath = path.join(DIRS[folder] || folder, `${id}.json`);
      return { id, email: readJson(filepath), filepath };
    })
    .filter((e) => e.email);

  if (emails.length === 0) {
    console.log(chalk.yellow(`\n📭 No valid emails found in ${folder}/\n`));
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
    if (emails.length === 0) {
      console.clear();
      console.log(chalk.green("\n✅ All emails reviewed!\n"));
      running = false;
      return false;
    }
    if (currentIndex >= emails.length) {
      currentIndex = emails.length - 1;
    }
    if (currentIndex < 0) {
      currentIndex = 0;
    }
    displayEmail(
      emails[currentIndex].email,
      currentIndex,
      emails.length,
      folder
    );
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
        console.log(chalk.dim("\n👋 Exiting review mode\n"));
        cleanup();
        process.stdin.removeListener("keypress", handleKeypress);
        resolve();
        return;
      }

      if (key.name === "right" || key.name === "l" || str === "l") {
        currentIndex = Math.min(currentIndex + 1, emails.length - 1);
        refresh();
      }

      if (key.name === "left" || key.name === "h" || str === "h") {
        currentIndex = Math.max(currentIndex - 1, 0);
        refresh();
      }

      if (str === "j" || key.name === "down") {
        currentIndex = Math.min(currentIndex + 1, emails.length - 1);
        refresh();
      }

      if (str === "k" || key.name === "up") {
        currentIndex = Math.max(currentIndex - 1, 0);
        refresh();
      }

      // Approve - move to approved/
      if (str === "a" && folder === "drafts") {
        const current = emails[currentIndex];
        try {
          moveFile(`${current.id}.json`, "drafts", "approved");
          emails.splice(currentIndex, 1);
          console.log(chalk.green(`\n✅ Approved ${current.id}`));
          await new Promise((r) => setTimeout(r, 300));
          if (!refresh()) {
            cleanup();
            process.stdin.removeListener("keypress", handleKeypress);
            resolve();
          }
        } catch (err) {
          console.log(chalk.red(`\n❌ Error: ${err.message}`));
        }
      }

      // Skip - move to skipped/
      if (str === "s" && folder === "drafts") {
        const current = emails[currentIndex];
        try {
          moveFile(`${current.id}.json`, "drafts", "skipped");
          emails.splice(currentIndex, 1);
          console.log(chalk.yellow(`\n⏭️  Skipped ${current.id}`));
          await new Promise((r) => setTimeout(r, 300));
          if (!refresh()) {
            cleanup();
            process.stdin.removeListener("keypress", handleKeypress);
            resolve();
          }
        } catch (err) {
          console.log(chalk.red(`\n❌ Error: ${err.message}`));
        }
      }

      // Edit - open in editor
      if (str === "e") {
        const current = emails[currentIndex];
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        console.log(chalk.dim(`\nOpening ${current.filepath} in editor...`));
        console.log(chalk.dim("Press any key when done editing to refresh.\n"));

        const editor = process.env.EDITOR || "vim";
        try {
          execSync(`${editor} "${current.filepath}"`, { stdio: "inherit" });
        } catch {
          console.log(chalk.yellow(`Open manually: ${current.filepath}`));
        }

        // Wait for a keypress to continue
        await new Promise((r) => {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.once("keypress", () => {
            // Reload the email
            emails[currentIndex].email = readJson(current.filepath);
            refresh();
            r();
          });
        });
      }
    };

    process.stdin.on("keypress", handleKeypress);
  });
}
