import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { DIRS, writeJson, ensureDirs } from "./utils.js";
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

  return `Generate a cold outreach email for this NSF-funded professor. The goal is to introduce them to Ouro.

Award Details:
- Title: ${award.title}
- PI: ${pi.piName}
- Institution: ${pi.institution}
- Abstract: ${award.abstractText || "No abstract available"}

---

ANGLE: ${styleGuide.angle}

TONE: ${styleGuide.tone}

SUBJECT LINE STYLE: ${styleGuide.subject_line_style}

SIGN-OFF STYLE: ${styleGuide.sign_off_style}

---

Include this Ouro description naturally in the email:
"${styleGuide.ouro_description}"

End with this call to action (you can adjust slightly to fit the flow):
"${styleGuide.call_to_action}"

---

Requirements:
1. Keep the body under 100 words
2. Reference their research casually, like a friend would - NOT like you're quoting their abstract
   - BAD: "deploying GNSS receiver arrays across Antarctica to track ionospheric space weather"
   - GOOD: "deploying GNSS arrays across Antarctica"
   - BAD: "coordinating multi-constellation, multi-frequency data that's typically scattered"
   - GOOD: "making sense of scattered GNSS data"
3. Use simple, everyday language - strip out jargon and overly technical phrasing
4. The subject should be short and casual, not a mini-abstract
5. Avoid stacking multiple specific details - one casual reference to their work is enough
6. Write naturally - this should feel like a real email, not a template

Use the create_email tool to return the email.`;
}

/**
 * Generate an email draft for a single award
 */
export async function generateEmail(award) {
  if (!hasValidContact(award)) {
    throw new Error("Award does not have valid PI email");
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

  // Build the full email record
  const awardId = award.awardNumber || award._id;
  const awardAmount = award.awd_amount || award.tot_intn_awd_amt || null;

  return {
    award_id: awardId,
    pi_name: pi.piName,
    pi_email: pi.piEmail,
    institution: pi.institution,
    award_title: award.title,
    award_amount: awardAmount,
    subject: emailData.subject,
    body: emailData.body,
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
  const { limit = 10, onProgress } = options;
  const results = {
    generated: [],
    errors: [],
  };

  const toProcess = awards.slice(0, limit);

  for (let i = 0; i < toProcess.length; i++) {
    const award = toProcess[i];
    const awardId = award.awardNumber || award._id;

    if (onProgress) {
      onProgress({ current: i + 1, total: toProcess.length, awardId });
    }

    try {
      const email = await generateEmail(award);
      const filepath = saveDraft(email);
      results.generated.push({ awardId, filepath });
    } catch (err) {
      results.errors.push({ awardId, error: err.message });
    }
  }

  return results;
}
