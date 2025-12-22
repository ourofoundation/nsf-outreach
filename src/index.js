#!/usr/bin/env node

import path from "path";
import { config } from "dotenv";
import { Command } from "commander";
import chalk from "chalk";
import { ensureDirs, listIds, readJson, DIRS } from "./utils.js";
import {
  getAvailableYears,
  loadAwards,
  getUnprocessedAwards,
  getScanStats,
  hasValidContact,
} from "./awards.js";
import { generateEmails } from "./generate.js";
import { sendApprovedEmails, getApprovedEmails } from "./send.js";
import { startReview } from "./review.js";

// Load environment variables
config();

const program = new Command();

program
  .name("nsf-outreach")
  .description("CLI tool for NSF researcher outreach")
  .version("1.0.0");

// ============ SCAN COMMAND ============
program
  .command("scan")
  .description("Scan awards folders and show statistics")
  .option("-y, --year <year>", "Specific year to scan")
  .option("-k, --keywords <keywords>", "Filter by keywords (comma-separated)")
  .action(async (options) => {
    ensureDirs();

    const years = options.year ? [options.year] : getAvailableYears();
    const keywords = options.keywords
      ? options.keywords.split(",").map((k) => k.trim())
      : [];

    if (years.length === 0) {
      console.log(chalk.yellow("\nNo award folders found."));
      console.log(
        `Create folders like ${chalk.cyan(
          "awards/2024/"
        )} and add NSF JSON files.\n`
      );
      return;
    }

    console.log(chalk.bold("\n📊 NSF Awards Scan\n"));

    if (keywords.length > 0) {
      console.log(chalk.dim(`Filtering by keywords: ${keywords.join(", ")}\n`));
    }

    let totalStats = {
      total: 0,
      withEmail: 0,
      unprocessed: 0,
      readyToGenerate: 0,
    };

    for (const year of years) {
      const stats = getScanStats(year, keywords);
      totalStats.total += stats.total;
      totalStats.withEmail += stats.withEmail;
      totalStats.unprocessed += stats.unprocessed;
      totalStats.readyToGenerate += stats.readyToGenerate;

      console.log(chalk.cyan(`📁 ${year}`));
      console.log(`   Total awards: ${chalk.white(stats.total)}`);
      console.log(
        `   With email: ${chalk.green(
          stats.withEmail
        )} | Without: ${chalk.yellow(stats.withoutEmail)}`
      );
      console.log(`   Unprocessed: ${chalk.blue(stats.unprocessed)}`);
      console.log(
        `   Ready to generate: ${chalk.green(stats.readyToGenerate)}\n`
      );
    }

    if (years.length > 1) {
      console.log(chalk.bold("📈 Totals"));
      console.log(`   Total awards: ${chalk.white(totalStats.total)}`);
      console.log(`   With email: ${chalk.green(totalStats.withEmail)}`);
      console.log(
        `   Ready to generate: ${chalk.green(totalStats.readyToGenerate)}\n`
      );
    }
  });

// ============ GENERATE COMMAND ============
program
  .command("generate")
  .description("Generate email drafts for unprocessed awards")
  .option("-y, --year <year>", "Year to process", "2024")
  .option("-l, --limit <number>", "Maximum emails to generate", "10")
  .option("-k, --keywords <keywords>", "Filter by keywords (comma-separated)")
  .action(async (options) => {
    ensureDirs();

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.red("\n❌ ANTHROPIC_API_KEY not set in .env file\n"));
      return;
    }

    const year = options.year;
    const limit = parseInt(options.limit, 10);
    const keywords = options.keywords
      ? options.keywords.split(",").map((k) => k.trim())
      : [];

    console.log(chalk.bold(`\n✉️  Generating emails for ${year}\n`));

    const awards = getUnprocessedAwards(year, keywords).filter(hasValidContact);

    if (awards.length === 0) {
      console.log(
        chalk.yellow("No unprocessed awards with valid email found.")
      );
      console.log(
        chalk.dim("Run `nsf-outreach scan` to see available awards.\n")
      );
      return;
    }

    console.log(
      `Found ${chalk.cyan(awards.length)} unprocessed awards with email`
    );
    console.log(`Generating up to ${chalk.cyan(limit)} drafts...\n`);

    const results = await generateEmails(awards, {
      limit,
      onProgress: ({ current, total, awardId }) => {
        console.log(
          chalk.dim(`[${current}/${total}]`) +
            ` Generating for ${chalk.cyan(awardId)}...`
        );
      },
    });

    console.log();

    if (results.generated.length > 0) {
      console.log(
        chalk.green(`✅ Generated ${results.generated.length} drafts`)
      );
      console.log(chalk.dim(`   Saved to ${DIRS.drafts}/\n`));
    }

    if (results.errors.length > 0) {
      console.log(chalk.red(`❌ ${results.errors.length} errors:`));
      results.errors.forEach(({ awardId, error }) => {
        console.log(chalk.dim(`   ${awardId}: ${error}`));
      });
      console.log();
    }

    console.log(
      chalk.dim(
        "Next: Review drafts in drafts/ folder, then move approved ones to approved/\n"
      )
    );
  });

// ============ STATUS COMMAND ============
program
  .command("status")
  .description("Show pipeline status")
  .action(() => {
    ensureDirs();

    const drafts = listIds("drafts").length;
    const approved = listIds("approved").length;
    const sent = listIds("sent").length;
    const skipped = listIds("skipped").length;

    console.log(chalk.bold("\n📬 Pipeline Status\n"));

    console.log(
      `   ${chalk.yellow("Drafts:")}    ${drafts} emails awaiting review`
    );
    console.log(
      `   ${chalk.blue("Approved:")}  ${approved} emails ready to send`
    );
    console.log(`   ${chalk.green("Sent:")}      ${sent} emails delivered`);
    console.log(`   ${chalk.dim("Skipped:")}   ${skipped} emails skipped`);
    console.log();

    const total = drafts + approved + sent + skipped;
    if (total > 0) {
      const progress = Math.round((sent / total) * 100);
      console.log(
        `   Progress: ${chalk.cyan(
          progress + "%"
        )} (${sent}/${total} processed)\n`
      );
    }

    if (drafts > 0) {
      console.log(
        chalk.dim(
          `Next: Review emails in ${DIRS.drafts}/ and move to ${DIRS.approved}/\n`
        )
      );
    } else if (approved > 0) {
      console.log(
        chalk.dim(`Next: Run 'nsf-outreach send' to deliver approved emails\n`)
      );
    }
  });

// ============ SEND COMMAND ============
program
  .command("send")
  .description("Send approved emails via Resend")
  .option("-l, --limit <number>", "Maximum emails to send", "10")
  .option("-d, --delay <seconds>", "Seconds between sends", "60")
  .option("--dry-run", "Preview without sending")
  .option("--from <email>", "From email address")
  .option("--from-name <name>", "From name")
  .action(async (options) => {
    ensureDirs();

    const dryRun = options.dryRun || false;
    const fromEmail = options.from || process.env.FROM_EMAIL;
    const fromName = options.fromName || process.env.FROM_NAME;
    const limit = parseInt(options.limit, 10);
    const delay = parseInt(options.delay, 10);

    if (!dryRun && !process.env.RESEND_API_KEY) {
      console.log(chalk.red("\n❌ RESEND_API_KEY not set in .env file\n"));
      return;
    }

    if (!dryRun && !fromEmail) {
      console.log(
        chalk.red(
          "\n❌ From email required. Use --from or set FROM_EMAIL in .env\n"
        )
      );
      return;
    }

    const approved = getApprovedEmails();

    if (approved.length === 0) {
      console.log(chalk.yellow("\n📭 No approved emails to send."));
      console.log(
        chalk.dim(`Move reviewed drafts to ${DIRS.approved}/ first.\n`)
      );
      return;
    }

    console.log(
      chalk.bold(`\n📤 Sending Emails${dryRun ? " (DRY RUN)" : ""}\n`)
    );
    console.log(`   Found ${chalk.cyan(approved.length)} approved emails`);
    console.log(
      `   Sending up to ${chalk.cyan(limit)} with ${chalk.cyan(
        delay + "s"
      )} delay\n`
    );

    if (dryRun) {
      console.log(chalk.yellow("🔍 Dry run - no emails will be sent\n"));
    }

    const results = await sendApprovedEmails({
      limit,
      delay,
      dryRun,
      fromEmail,
      fromName,
      onProgress: ({ current, total, awardId, recipient }) => {
        const status = dryRun ? "Would send to" : "Sending to";
        console.log(
          chalk.dim(`[${current}/${total}]`) +
            ` ${status} ${chalk.cyan(recipient)}`
        );
      },
    });

    console.log();

    if (results.sent.length > 0) {
      const verb = dryRun ? "Would send" : "Sent";
      console.log(chalk.green(`✅ ${verb} ${results.sent.length} emails`));
      if (!dryRun) {
        console.log(chalk.dim(`   Moved to ${DIRS.sent}/`));
      }
    }

    if (results.errors.length > 0) {
      console.log(chalk.red(`\n❌ ${results.errors.length} errors:`));
      results.errors.forEach(({ awardId, recipient, error }) => {
        console.log(chalk.dim(`   ${recipient}: ${error}`));
      });
    }

    console.log();
  });

// ============ PREVIEW COMMAND ============
program
  .command("preview")
  .description("Preview a draft email (or browse all interactively)")
  .argument("[award-id]", "Award ID to preview (omit for interactive mode)")
  .option("-f, --folder <folder>", "Folder to look in", "drafts")
  .action(async (awardId, options) => {
    const folder = options.folder;

    // Interactive mode if no award ID provided
    if (!awardId) {
      await startReview(folder);
      return;
    }

    const filepath = path.join(DIRS[folder] || folder, `${awardId}.json`);
    const email = readJson(filepath);

    if (!email) {
      console.log(chalk.red(`\n❌ Email not found: ${filepath}\n`));
      return;
    }

    console.log(chalk.bold("\n📧 Email Preview\n"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(`${chalk.cyan("To:")} ${email.pi_name} <${email.pi_email}>`);
    console.log(`${chalk.cyan("Institution:")} ${email.institution}`);
    console.log(`${chalk.cyan("Subject:")} ${email.subject}`);
    console.log(chalk.dim("─".repeat(60)));
    console.log(email.body);
    console.log(chalk.dim("─".repeat(60)));
    console.log(
      `${chalk.dim("Award:")} ${email.award_id} - ${email.award_title}`
    );
    console.log(`${chalk.dim("Generated:")} ${email.generated_at}`);
    if (email.variants) {
      console.log(
        `${chalk.dim("Variants:")} template=${email.variants.template}, desc=${
          email.variants.ouro_description
        }, cta=${email.variants.call_to_action}`
      );
    }
    if (email.sent_at) {
      console.log(`${chalk.dim("Sent:")} ${email.sent_at}`);
    }
    console.log();
  });

// ============ REVIEW COMMAND (alias for interactive preview) ============
program
  .command("review")
  .description("Interactively review and approve/skip drafts")
  .option("-f, --folder <folder>", "Folder to review", "drafts")
  .action(async (options) => {
    await startReview(options.folder);
  });

program.parse();
