import fs from 'fs';
import path from 'path';
import { Resend } from 'resend';
import { DIRS, readJson, writeJson, moveFile, listIds, sleep, ensureDirs } from './utils.js';

let resendClient = null;

function getResend() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Load all approved emails ready to send
 */
export function getApprovedEmails() {
  ensureDirs();
  const ids = listIds('approved');
  
  return ids.map(id => {
    const filepath = path.join(DIRS.approved, `${id}.json`);
    return readJson(filepath);
  }).filter(Boolean);
}

/**
 * Send a single email via Resend
 */
export async function sendEmail(email, options = {}) {
  const { dryRun = false, fromEmail, fromName } = options;
  
  if (!email.pi_email) {
    throw new Error('No recipient email address');
  }
  
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      to: email.pi_email,
      subject: email.subject
    };
  }
  
  const resend = getResend();
  
  const result = await resend.emails.send({
    from,
    to: email.pi_email,
    subject: email.subject,
    text: email.body
  });
  
  if (result.error) {
    throw new Error(result.error.message);
  }
  
  return {
    success: true,
    resendId: result.data?.id,
    to: email.pi_email,
    subject: email.subject
  };
}

/**
 * Process a sent email - update record and move to sent folder
 */
export function markAsSent(email, resendId) {
  const updatedEmail = {
    ...email,
    sent_at: new Date().toISOString(),
    resend_id: resendId
  };
  
  // Write the updated record to sent folder
  const sentPath = path.join(DIRS.sent, `${email.award_id}.json`);
  writeJson(sentPath, updatedEmail);
  
  // Remove from approved folder
  const approvedPath = path.join(DIRS.approved, `${email.award_id}.json`);
  if (fs.existsSync(approvedPath)) {
    fs.unlinkSync(approvedPath);
  }
  
  return updatedEmail;
}

/**
 * Send all approved emails with rate limiting
 */
export async function sendApprovedEmails(options = {}) {
  const { 
    limit = 10, 
    delay = 60, 
    dryRun = false, 
    fromEmail,
    fromName,
    onProgress 
  } = options;
  
  if (!dryRun && !process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not set in environment');
  }
  
  if (!fromEmail && !dryRun) {
    throw new Error('fromEmail is required');
  }
  
  const emails = getApprovedEmails();
  const toSend = emails.slice(0, limit);
  
  const results = {
    sent: [],
    errors: [],
    dryRun
  };
  
  for (let i = 0; i < toSend.length; i++) {
    const email = toSend[i];
    
    if (onProgress) {
      onProgress({ 
        current: i + 1, 
        total: toSend.length, 
        awardId: email.award_id,
        recipient: email.pi_email 
      });
    }
    
    try {
      const result = await sendEmail(email, { dryRun, fromEmail, fromName });
      
      if (!dryRun) {
        markAsSent(email, result.resendId);
      }
      
      results.sent.push({
        awardId: email.award_id,
        recipient: email.pi_email,
        subject: email.subject,
        resendId: result.resendId
      });
      
      // Rate limiting - wait between sends (unless last one or dry run)
      if (!dryRun && i < toSend.length - 1 && delay > 0) {
        await sleep(delay * 1000);
      }
    } catch (err) {
      results.errors.push({
        awardId: email.award_id,
        recipient: email.pi_email,
        error: err.message
      });
    }
  }
  
  return results;
}

/**
 * Get sending statistics
 */
export function getSendStats() {
  return {
    approved: listIds('approved').length,
    sent: listIds('sent').length
  };
}

