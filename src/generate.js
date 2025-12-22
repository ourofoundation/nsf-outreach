import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { DIRS, writeJson, ensureDirs } from './utils.js';
import { extractPIInfo, hasValidContact } from './awards.js';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Load the email template
 */
function loadTemplate() {
  const templatePath = path.join(DIRS.templates, 'cold-email.txt');
  if (!fs.existsSync(templatePath)) {
    return getDefaultTemplate();
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Default template if none exists
 */
function getDefaultTemplate() {
  return `Subject: [Something specific about their research] + a tool that might help

Hi Professor [LastName],

I came across your NSF project on [specific topic from their abstract].

[1-2 sentences showing you actually read their abstract - mention a specific method, finding, or goal]

I'm building Ouro, a platform where researchers can share and discover computational workflows, datasets, and tools. Given your work on [specific aspect], I thought it might be relevant.

Would you be open to a quick call to see if it could be useful for your group?

Best,
[Your name]`;
}

/**
 * Build the generation prompt for Claude
 */
function buildPrompt(award, template) {
  const pi = extractPIInfo(award);
  
  return `Generate a cold outreach email for this NSF-funded professor. The goal is to introduce them to Ouro, a platform for sharing computational workflows and datasets.

Award Details:
- Title: ${award.title}
- PI: ${pi.piName}
- Institution: ${pi.institution}
- Abstract: ${award.abstractText || 'No abstract available'}

Use this template as a guide for tone and structure, but make it highly specific to their research:
---
${template}
---

Requirements:
1. Return JSON with "subject" and "body" fields only
2. Keep the body under 100 words
3. Pull ONE specific detail from their abstract to show genuine familiarity with their work
4. The subject should reference something specific about their research
5. Keep it casual and genuine - avoid sounding like a mass email
6. Sign off with just "Best," and no name (we'll add that)

Example output format:
{
  "subject": "Your thermoelectrics screening work + a tool that might help",
  "body": "Hi Professor Smith,\\n\\nI came across your NSF project on high-throughput screening of thermoelectric materials...\\n\\nBest,"
}`;
}

/**
 * Generate an email draft for a single award
 */
export async function generateEmail(award) {
  if (!hasValidContact(award)) {
    throw new Error('Award does not have valid PI email');
  }
  
  const template = loadTemplate();
  const prompt = buildPrompt(award, template);
  const pi = extractPIInfo(award);
  
  const anthropic = getClient();
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });
  
  // Extract the text content
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No text response from Claude');
  }
  
  // Parse the JSON response
  let emailData;
  try {
    // Try to extract JSON from the response (Claude sometimes wraps it in markdown)
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    emailData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse Claude response: ${err.message}`);
  }
  
  if (!emailData.subject || !emailData.body) {
    throw new Error('Response missing subject or body');
  }
  
  // Build the full email record
  const awardId = award.awardNumber || award._id;
  
  return {
    award_id: awardId,
    pi_name: pi.piName,
    pi_email: pi.piEmail,
    institution: pi.institution,
    award_title: award.title,
    subject: emailData.subject,
    body: emailData.body,
    generated_at: new Date().toISOString(),
    sent_at: null,
    resend_id: null
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
    errors: []
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

