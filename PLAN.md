## NSF Outreach CLI - Implementation Plan

### Overview

A Node.js CLI tool that reads NSF award JSON files from local folders, generates personalized cold emails using Claude, and uses a folder-based system for tracking status. Human reviews/edits drafts as plain text files before sending.

### Folder Structure

```
nsf-outreach/
├── package.json
├── src/
│   ├── index.js                 # CLI entry point
│   ├── awards.js                # Load/parse award JSONs
│   ├── generate.js              # Claude email generation
│   ├── send.js                  # Resend integration
│   └── utils.js                 # Helpers
├── templates/
│   └── cold-email.txt           # Email template
├── awards/                      # NSF data (you populate this)
│   ├── 2023/
│   │   ├── 2301234.json
│   │   ├── 2301235.json
│   │   └── ...
│   ├── 2024/
│   └── 2025/
├── drafts/                      # Generated emails awaiting review
│   ├── 2301234.json
│   └── ...
├── approved/                    # Reviewed and ready to send
├── sent/                        # Successfully sent
├── skipped/                     # Manually marked to skip
└── .env                         # API keys
```

### Email File Format

Each email is a JSON file named by award ID:

```json
{
  "award_id": "2301234",
  "pi_name": "Jane Smith",
  "pi_email": "jsmith@university.edu",
  "institution": "University of Whatever",
  "award_title": "Computational Discovery of Novel Thermoelectrics",
  "subject": "Your thermoelectrics screening work + a tool that might help",
  "body": "Hi Professor Smith,\n\nI came across your NSF project...",
  "generated_at": "2025-01-15T10:30:00Z",
  "sent_at": null,
  "resend_id": null
}
```

### CLI Commands

```
nsf-outreach scan                 Scan awards/ folders, show stats
    --year=2024                   Only scan specific year
    --keywords="DFT,machine learning"  Filter by abstract keywords

nsf-outreach generate             Generate drafts for new awards
    --year=2024                   Which year to process
    --limit=10                    Max to generate
    --keywords="computational"    Filter awards

nsf-outreach status               Show counts in each folder

nsf-outreach send                 Send all emails in approved/
    --limit=10                    Max to send
    --delay=60                    Seconds between sends
    --dry-run                     Show what would send without sending
```

### Workflow

1. Drop NSF JSON files into `awards/2024/`, `awards/2025/`, etc.

2. `scan --year=2024 --keywords="computational materials"` — see what's available

3. `generate --year=2024 --limit=10` — creates files in `drafts/`

4. **You manually review `drafts/`:**
   - Edit any file to tweak the email
   - Move to `approved/` when ready
   - Move to `skipped/` to ignore

5. `send --limit=5 --delay=120` — sends everything in `approved/`, moves to `sent/`

6. `status` — see the pipeline

### Key Implementation Details

**Scanning for new awards**

```javascript
// Only generate for awards that don't already have a file in drafts/, approved/, sent/, or skipped/
function getUnprocessedAwards(year) {
  const awardIds = listAwardIds(year);
  const processed = new Set([
    ...listIds('drafts'),
    ...listIds('approved'),
    ...listIds('sent'),
    ...listIds('skipped')
  ]);
  return awardIds.filter(id => !processed.has(id));
}
```

**Generation prompt**

```javascript
const prompt = `Generate a cold outreach email for this NSF-funded professor.

Award title: ${award.title}
PI: ${award.piFirstName} ${award.piLastName}
Institution: ${award.awardeeName}
Abstract: ${award.abstractText}

Use this template as a guide, but make it specific to their research:
---
${template}
---

Return JSON with "subject" and "body" fields only. Keep under 100 words.
Pull one specific detail from their abstract to show you actually read it.`;
```

**Send safety**

- Reads from `approved/` only
- Moves file to `sent/` only after Resend confirms
- Updates the JSON with `sent_at` and `resend_id`
- If send fails, file stays in `approved/` with error logged

**Skipping awards without email**

Some NSF records don't have PI email. Flag these during scan so you don't waste generation calls.

### Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@anthropic-ai/sdk": "^0.24.0",
    "resend": "^3.2.0",
    "dotenv": "^16.4.0",
    "glob": "^10.3.0"
  }
}
```
