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
 * Select variants for all three dimensions
 */
function selectVariants() {
  const all = loadAllVariants();
  return {
    template: randomSelect(all.templates),
    ouro_description: randomSelect(all.ouro_descriptions),
    call_to_action: randomSelect(all.call_to_actions),
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

  return `Generate a cold outreach email for this NSF-funded researcher. Keep it natural and authentic.

Award Details:
- Title: ${award.title}
- PI: ${pi.piName}
- Institution: ${pi.institution}
- Abstract: ${award.abstractText || "No abstract available"}

Style:
- Angle: ${styleGuide.angle}
- Tone: ${styleGuide.tone}
- Subject line: ${styleGuide.subject_line_style}
- Sign-off: ${styleGuide.sign_off_style}

Include this Ouro description:
"${styleGuide.ouro_description}"

End with this call to action:
"${styleGuide.call_to_action}"

Guidelines:
- Keep body under 120 words
- Recognize their research area/position briefly - don't fake enthusiasm or claim things "caught your eye"
- Don't mention the institution name
- Don't use salesy phrases like "perfectly aligned", "incredible work", "seems like exactly what"
- Be straightforward: you're offering a service that might be useful to them
- Subject should be short and natural

Use the create_email tool to return the email.`;
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
    max_tokens: 400,
    tools: [EMAIL_TOOL],
    tool_choice: { type: "tool", name: "create_email" },
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  // Extract the tool use response
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.name !== "create_email") {
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
