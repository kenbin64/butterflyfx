// worker.js
// butterflyfx.us: the site's pages (from ./public), plus one route, POST /api/contact, the contact form.
//
// The form emails Ken without his address appearing anywhere on the site or in this repository: the two
// addresses are secrets (npx wrangler secret put CONTACT_TO, and CONTACT_BACKUP). Each message goes to both,
// so if one inbox fails the other still gets it. It is sent from playbutterflyfx.com, the domain on Ken's
// Cloudflare account that is set up to send email. A robot that fills the hidden field is told it worked
// and nothing is sent. Nothing is stored.

import { EmailMessage } from 'cloudflare:email';

const FROM = 'contact@playbutterflyfx.com';
const LIMITS = { name: 100, email: 200, subject: 150, message: 5000 };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();          // no header injection through a field

// The checks, kept as a plain function so they can be tested without Cloudflare.
export function checkContact(f) {
  const name = oneLine(f.name), email = oneLine(f.email), subject = oneLine(f.subject), message = String(f.message || '').trim();
  if (oneLine(f.website)) return { spam: true };                               // the hidden field people never see
  if (!name) return { error: 'Please add your name.' };
  if (!message || message.length < 10) return { error: 'Please write a little more in the message.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address does not look right. Check it, or leave it empty.' };
  const lengths = { name: name.length, email: email.length, subject: subject.length, message: message.length };
  for (const k of Object.keys(LIMITS)) if (lengths[k] > LIMITS[k]) return { error: `The ${k} is too long (at most ${LIMITS[k]} characters).` };
  return { entry: { name, email, subject: subject || 'Message from butterflyfx.us', message } };
}

function mime(entry, to) {
  const lines = [
    `From: butterflyfx.us contact form <${FROM}>`, `To: ${to}`,
    `Subject: [butterflyfx.us] ${entry.subject}`,
    ...(entry.email ? [`Reply-To: ${entry.name} <${entry.email}>`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit',
    `Message-ID: <${crypto.randomUUID()}@playbutterflyfx.com>`, `Date: ${new Date().toUTCString()}`, '',
    `From: ${entry.name}${entry.email ? ` <${entry.email}>` : ' (no email given)'}`, '', entry.message, '',
    '-- Sent from the contact form on butterflyfx.us',
  ];
  return lines.join('\r\n');
}

async function contact(request, env) {
  let form;
  try { form = await request.json(); } catch { return json(400, { error: 'The form could not be read. Please try again.' }); }
  const r = checkContact(form || {});
  if (r.spam) return json(200, { ok: true });
  if (r.error) return json(400, { error: r.error });
  const to = [env.CONTACT_TO, env.CONTACT_BACKUP].filter(Boolean);
  if (!env.MAIL || !to.length) return json(503, { error: 'The form is not set up yet. Please try again later, or use LinkedIn.' });
  let sent = 0;
  for (const address of to) {
    try { await env.MAIL.send(new EmailMessage(FROM, address, mime(r.entry, address))); sent++; }
    catch (e) { console.log('contact email not sent to one address:', e && e.message); }
  }
  return sent ? json(200, { ok: true }) : json(502, { error: 'The message could not be sent just now. Please try again in a few minutes, or use LinkedIn.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json(405, { error: 'Send the form with POST.' });
      return contact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
