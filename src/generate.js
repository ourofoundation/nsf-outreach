import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { DIRS, writeJson, ensureDirs, listIds } from "./utils.js";
import { extractPIInfo, hasValidContact } from "./awards.js";

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Load all variants from variants.json
 */
function loadAllVariants() {
  const variantsPath = path.join(DIRS.templates, "variants.json");
  if (!fs.existsSync(variantsPath)) {
    throw new Error("variants.json not found");
  }
  return JSON.parse(fs.readFileSync(variantsPath, "utf-8"));
}

/**
 * Randomly select one item from an array
 */
function randomSelect(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Shuffle an array using Fisher-Yates algorithm
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Filter out disabled variants (where enabled === false)
 * Items without an "enabled" field are treated as enabled
 */
function filterEnabled(items) {
  return items.filter((item) => item.enabled !== false);
}

/**
 * Select variants for all three dimensions
 */
function selectVariants() {
  const all = loadAllVariants();
  const enabledTemplates = filterEnabled(all.templates);
  const enabledOuroDescriptions = filterEnabled(all.ouro_descriptions);
  const enabledCallToActions = filterEnabled(all.call_to_actions);

  if (enabledTemplates.length === 0) {
    throw new Error("No enabled templates available");
  }
  if (enabledOuroDescriptions.length === 0) {
    throw new Error("No enabled ouro_descriptions available");
  }
  if (enabledCallToActions.length === 0) {
    throw new Error("No enabled call_to_actions available");
  }

  return {
    template: randomSelect(enabledTemplates),
    ouro_description: randomSelect(enabledOuroDescriptions),
    call_to_action: randomSelect(enabledCallToActions),
  };
}

/**
 * Build the style guidance from selected variants
 */
function buildStyleGuide(variants) {
  const t = variants.template;
  return {
    angle: t.angle,
    tone: t.tone,
    subject_line_style: t.subject_line_style,
    sign_off_style: t.sign_off_style,
    ouro_description: variants.ouro_description.content,
    call_to_action: variants.call_to_action.content,
  };
}

/**
 * Tool definition for structured email output
 */
const EMAIL_TOOL = {
  name: "create_email",
  description: "Create a cold outreach email for an NSF-funded researcher",
  input_schema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description:
          "Email subject line - should match the specified style and reference their research",
      },
      body: {
        type: "string",
        description:
          "Email body text - keep under 100 words, use the specified sign-off style",
      },
    },
    required: ["subject", "body"],
  },
};

/**
 * Build the generation prompt for Claude
 */
function buildPrompt(award, styleGuide) {
  const pi = extractPIInfo(award);

  // Extract just the first sentence or two from abstract for context
  const abstractSnippet = award.abstractText
    ? award.abstractText
    : // .split(".").slice(0, 2).join(".") + "."
      "";

  return `Write a short cold email to an NSF-funded researcher.

Who they are:
- Name: ${pi.piName}
- Award title: ${award.title}
- Context: ${abstractSnippet}

FIRST, figure out their pain points (don't include this analysis in the email):
- What type of computational work is this? (ML/AI, simulations, pipelines, data analysis, etc.)
- What's probably hard to share or reproduce? Examples:
  - ML/AI: model weights, training reproducibility, environment setup
  - Simulations: large outputs, cluster-specific code, parameter sweeps
  - Pipelines: dependency hell, "works on my machine", version drift
  - Data-heavy: files too big for supplements, preprocessing scripts
  - Multi-site collab: keeping code in sync, different compute environments
- Pick the most likely pain point for THIS researcher

What Ouro does (put in your own words, don't copy verbatim):
${styleGuide.ouro_description}

Angle: ${styleGuide.angle}
Tone: ${styleGuide.tone}

CRITICAL - Language rules:
- Write like you're texting a colleague
- Reference their PAIN POINT, not their research topic
- BAD: "your reactive transport models linking viral dynamics to biogeochemical cycling"
- GOOD: "simulation code that only runs on your cluster" or "outputs too big for supplementary materials"
- NO phrases like "addresses a real challenge", "important work", "I'm reaching out because"
- NEVER say "I've been following your work" or "fascinating stuff"
- Short sentences. Contractions.

Structure:
1. Hook: Their likely pain point or a shared frustration (specific to their type of work)
2. Ouro: What it is and why you built it (one sentence)
3. Soft ask + holiday note

Keep it under 100 words. Subject line: ${styleGuide.subject_line_style}
Sign off with: ${styleGuide.sign_off_style}

Use the create_email tool.`;
}

/**
 * Check if an award has already been processed (draft, approved, sent, or skipped)
 */
function isAlreadyProcessed(awardId) {
  const processed = new Set([
    ...listIds("drafts"),
    ...listIds("approved"),
    ...listIds("sent"),
    ...listIds("skipped"),
  ]);
  return processed.has(awardId);
}

/**
 * Extract first name from full name
 */
function getFirstName(fullName) {
  if (!fullName) return "";
  return fullName.split(" ")[0];
}

/**
 * Generate an email draft for a single award
 */
export async function generateEmail(award, options = {}) {
  if (!hasValidContact(award)) {
    throw new Error("Award does not have valid PI email");
  }

  const awardId = award.awardNumber || award._id;
  if (isAlreadyProcessed(awardId)) {
    throw new Error(
      `Award ${awardId} has already been processed (draft, approved, sent, or skipped)`
    );
  }

  const variants = selectVariants();
  const styleGuide = buildStyleGuide(variants);
  const prompt = buildPrompt(award, styleGuide);
  const pi = extractPIInfo(award);

  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8000,
    thinking: {
      type: "enabled",
      budget_tokens: 4000,
    },
    tools: [EMAIL_TOOL],
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  // Extract the tool use response (skip thinking blocks)
  const toolUse = response.content.find(
    (c) => c.type === "tool_use" && c.name === "create_email"
  );
  if (!toolUse) {
    throw new Error("No tool use response from Claude");
  }

  const emailData = toolUse.input;

  if (!emailData.subject || !emailData.body) {
    throw new Error("Response missing subject or body");
  }

  // Append signature with name, role and website
  const senderName = options.senderName || process.env.FROM_NAME || "";
  const firstName = getFirstName(senderName);

  // Ensure closing has a comma if it's a common sign-off word
  let body = emailData.body.trim();
  const commonClosings = ["Best", "Cheers", "Thanks", "Regards", "Sincerely"];
  const lines = body.split("\n");
  const lastLine = lines[lines.length - 1].trim();
  const lastWord = lastLine
    .split(/[\s,]+/)
    .filter(Boolean)
    .pop();

  // If the last line ends with a closing word but no comma, add one
  if (commonClosings.includes(lastWord) && !lastLine.endsWith(",")) {
    lines[lines.length - 1] = lastLine + ",";
    body = lines.join("\n");
  }

  const signature = firstName
    ? `\n\n${senderName}\nhttps://ouro.foundation`
    : `\n\nBuilding Ouro\nhttps://ouro.foundation`;
  const bodyWithSignature = `${body}${signature}`;

  // Build the full email record
  const awardAmount = award.awd_amount || award.tot_intn_awd_amt || null;

  return {
    award_id: awardId,
    pi_name: pi.piName,
    pi_email: pi.piEmail,
    institution: pi.institution,
    award_title: award.title,
    award_amount: awardAmount,
    subject: emailData.subject,
    body: bodyWithSignature,
    variants: {
      template_id: variants.template.id,
      template_name: variants.template.name,
      ouro_description_id: variants.ouro_description.id,
      call_to_action_id: variants.call_to_action.id,
    },
    generated_at: new Date().toISOString(),
    sent_at: null,
    resend_id: null,
  };
}

/**
 * Save a generated email to the drafts folder
 */
export function saveDraft(email) {
  ensureDirs();
  const filepath = path.join(DIRS.drafts, `${email.award_id}.json`);
  writeJson(filepath, email);
  return filepath;
}

/**
 * Generate emails for multiple awards
 */
export async function generateEmails(awards, options = {}) {
  const { limit = 10, onProgress, senderName } = options;
  const results = {
    generated: [],
    errors: [],
  };

  // Shuffle awards to randomize processing order
  const shuffled = shuffleArray(awards);
  const toProcess = shuffled.slice(0, limit);

  for (let i = 0; i < toProcess.length; i++) {
    const award = toProcess[i];
    const awardId = award.awardNumber || award._id;

    if (onProgress) {
      onProgress({ current: i + 1, total: toProcess.length, awardId });
    }

    try {
      const email = await generateEmail(award, { senderName });
      const filepath = saveDraft(email);
      results.generated.push({ awardId, filepath });
    } catch (err) {
      results.errors.push({ awardId, error: err.message });
    }
  }

  return results;
}
