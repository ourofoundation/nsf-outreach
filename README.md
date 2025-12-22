# NSF Outreach CLI

A Node.js CLI tool for generating and sending personalized cold emails to NSF-funded researchers. Uses Claude to create tailored outreach based on each PI's research abstract, and Resend for delivery.

## How It Works

1. **Drop NSF award JSON files** into `awards/2024/`, `awards/2025/`, etc.
2. **Scan** to see what's available and filter by keywords
3. **Generate** drafts using Claude (personalized to each PI's research)
4. **Review** drafts manually — edit, approve, or skip
5. **Send** approved emails via Resend with rate limiting

## Setup

```bash
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
FROM_EMAIL=you@yourdomain.com
FROM_NAME=Your Name
```

## Commands

### Scan Awards

See what awards are available and how many match your criteria:

```bash
# Scan all years
node src/index.js scan

# Scan specific year with keyword filter
node src/index.js scan --year=2025 --keywords="computational,materials,machine learning"
```

### Generate Drafts

Create personalized email drafts using Claude:

```bash
# Generate 10 drafts for 2025 awards
node src/index.js generate --year=2025 --limit=10

# Filter by keywords
node src/index.js generate --year=2025 --keywords="DFT,simulation" --limit=20
```

Drafts are saved as JSON files in `drafts/`.

### Review Workflow

1. Open files in `drafts/` and review/edit the `subject` and `body` fields
2. Move approved emails to `approved/`
3. Move ones you want to skip to `skipped/`

### Check Status

See your pipeline at a glance:

```bash
node src/index.js status
```

Output:
```
📬 Pipeline Status

   Drafts:    15 emails awaiting review
   Approved:  5 emails ready to send
   Sent:      42 emails delivered
   Skipped:   3 emails skipped

   Progress: 65% (42/65 processed)
```

### Send Emails

```bash
# Preview what would send (no actual emails sent)
node src/index.js send --dry-run

# Send up to 10 emails with 2-minute delay between each
node src/index.js send --limit=10 --delay=120

# Override sender info
node src/index.js send --from="me@domain.com" --from-name="My Name"
```

### Preview a Draft

```bash
node src/index.js preview 2301234
node src/index.js preview 2301234 --folder=sent
```

## Folder Structure

```
nsf-outreach/
├── awards/           # NSF JSON files organized by year
│   ├── 2024/
│   └── 2025/
├── drafts/           # Generated emails awaiting review
├── approved/         # Reviewed and ready to send
├── sent/             # Successfully delivered
├── skipped/          # Manually marked to skip
└── templates/
    └── cold-email.txt  # Email template (customize this!)
```

## Email File Format

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

## Customizing the Template

Edit `templates/cold-email.txt` to change the style and structure of generated emails. Claude uses this as a guide but personalizes each email based on the PI's actual research abstract.

## Getting NSF Award Data

NSF provides award data via their API. You can download JSON files for specific programs or search criteria from [nsf.gov/awardsearch](https://www.nsf.gov/awardsearch/).

## Tips

- **Start small**: Generate 5-10 drafts, review them carefully, then scale up
- **Use keywords**: Filter to researchers most relevant to your product
- **Rate limit**: Use `--delay=120` or higher to avoid spam flags
- **Personalize**: Edit drafts before approving — Claude gets you 80% there
- **Track responses**: Keep notes on which emails get replies to refine your approach

