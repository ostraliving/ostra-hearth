// ══════════════════════════════════════════════════════════════════════════════
// Ostra Hearth — Welcome Email Sender
// File: netlify/functions/send-welcome.js
//
// Sends a personalized welcome email via Resend based on family profile:
//   - Adults only (no kids, no babies)
//   - Family with children (no babies)
//   - Family with baby (BLW focus)
//
// ENV VARS NEEDED IN NETLIFY:
//   RESEND_API_KEY = re_PdBks9zF_Hdi1o5hFgDmAEbkgux8iWF8t
// ══════════════════════════════════════════════════════════════════════════════

// ── SHARED ELEMENTS ──────────────────────────────────────────────────────────
const HEADER = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td style="background-color:#3D4F3A;border-radius:16px 16px 0 0;padding:44px 52px 40px;text-align:center;">
      <div style="margin-bottom:22px;">
        <svg width="44" height="52" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="32" y1="58" x2="32" y2="14" stroke="#B5BBA8" stroke-width="0.75" stroke-linecap="round"/>
          <path d="M32 42 C32 42 20 38 18 28 C18 28 30 30 32 42Z" fill="none" stroke="#B5BBA8" stroke-width="0.75"/>
          <path d="M32 30 C32 30 22 24 22 15 C22 15 32 20 32 30Z" fill="none" stroke="#B5BBA8" stroke-width="0.75"/>
          <path d="M32 48 C32 48 44 44 46 34 C46 34 34 36 32 48Z" fill="#B5BBA8" fill-opacity="0.3" stroke="#B5BBA8" stroke-width="0.75"/>
          <path d="M32 36 C32 36 42 30 42 21 C42 21 32 26 32 36Z" fill="#B5BBA8" fill-opacity="0.2" stroke="#B5BBA8" stroke-width="0.75"/>
          <ellipse cx="32" cy="12" rx="2.5" ry="4" fill="none" stroke="#B5BBA8" stroke-width="0.75"/>
        </svg>
      </div>
      <p style="font-size:8px;letter-spacing:4px;text-transform:uppercase;color:#B5BBA8;margin:0 0 12px;">Ostra Hearth</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#FAFAF8;margin:0;line-height:1.2;">Welcome to Hearth</h1>
    </td>
  </tr>`;

const FOOTER = `
  <tr>
    <td style="background-color:#EAE4DA;border-radius:0 0 16px 16px;padding:24px 52px;text-align:center;">
      <p style="font-family:Georgia,serif;font-size:14px;color:#3D4F3A;margin:0 0 6px;">Ostra Living</p>
      <p style="font-size:10px;letter-spacing:1px;color:#B5BBA8;margin:0 0 14px;font-style:italic;">a healthier week starts at home</p>
      <p style="font-size:11px;color:#B5BBA8;margin:0;">
        <a href="https://hearth.ostraliving.com" style="color:#7D8F76;text-decoration:none;">hearth.ostraliving.com</a>
        &nbsp;&middot;&nbsp;
        <a href="https://ostraliving.com" style="color:#B5BBA8;text-decoration:none;">ostraliving.com</a>
        &nbsp;&middot;&nbsp;
        <a href="https://ostraliving.com/journal" style="color:#B5BBA8;text-decoration:none;">journal</a>
      </p>
    </td>
  </tr>
</table>`;

const DIVIDER = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border-top:1px solid #E2DCD4;"></td></tr></table>`;

const CTA = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;"><tr><td align="center"><a href="https://hearth.ostraliving.com" style="display:inline-block;background-color:#3D4F3A;color:#FAFAF8;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 40px;border-radius:8px;">Open Hearth</a></td></tr></table>`;

const SIGNATURE = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E2DCD4;padding-top:24px;"></td></tr></table>
  <p style="font-size:13px;color:#7D8F76;line-height:1.8;margin:0;font-style:italic;font-family:Georgia,serif;">Hearth is built by one person, for families like yours. I hope it earns a place in your week.</p>
  <p style="font-size:13px;color:#4A5A49;line-height:1.8;margin:16px 0 0;">Emilie<br><span style="color:#B5BBA8;font-size:12px;">Founder, Ostra Living</span></p>`;

const PREMIUM = `
  ${DIVIDER}
  <p style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#7D8F76;margin:0 0 14px;">When you are ready to go further</p>
  <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 16px;">Premium unlocks the full Hearth experience — the 7-day meal planner, grocery sync, the complete recipe library with new seasonal drops each month, and the full allergen tracker.</p>
  <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 28px;">$4.99 a month. Or $49.99 a year — less than a single trip to the farmers market.</p>`;

function dot(text, sub) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>
    <td style="width:28px;vertical-align:top;"><div style="width:6px;height:6px;border-radius:50%;background:#7D8F76;margin-top:8px;"></div></td>
    <td><div style="font-size:13px;font-weight:400;color:#2A2E27;margin-bottom:3px;font-family:Georgia,serif;">${text}</div>
    <div style="font-size:12px;color:#7D8F76;line-height:1.6;">${sub}</div></td>
  </tr></table>`;
}

// ── CONTENT VARIANTS ─────────────────────────────────────────────────────────

function bodyAdultsOnly(name) {
  return `
  <tr>
    <td style="background-color:#FAFAF8;padding:44px 52px 36px;">
      <p style="font-size:15px;color:#2A2E27;line-height:1.8;margin:0 0 20px;font-family:Georgia,serif;font-style:italic;">A healthier week starts at home.</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 18px;">Welcome, ${name}. Hearth is built around one idea — that eating well at home should feel calm and considered, not complicated.</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 32px;">Your account is set up for adults. Here is what is waiting for you.</p>
      ${DIVIDER}
      <p style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#7D8F76;margin:0 0 18px;">Built around your week</p>
      ${dot('Wholefood recipes from great food traditions', 'Japanese, Mediterranean, Middle Eastern and more. Every recipe built around real nutritional principles, not trends.')}
      ${dot('Sunday batch cooking', 'Bone broth, hummus, seed crispbreads, brown rice. The larder recipes that make every weekday easier and more nourishing.')}
      ${dot('Adult lunches worth looking forward to', 'Mezze plates, onigiri, grain bowls, shakshuka. Real food, quickly assembled, worth eating at your desk.')}
      ${dot('A made-it log that becomes your recipe book', 'Rate every recipe as you cook it. Your Hearth builds into a personal collection — the meals that earned a place in your rotation.')}
      ${PREMIUM}
      ${CTA}
      ${SIGNATURE}
    </td>
  </tr>`;
}

function bodyFamily(name) {
  return `
  <tr>
    <td style="background-color:#FAFAF8;padding:44px 52px 36px;">
      <p style="font-size:15px;color:#2A2E27;line-height:1.8;margin:0 0 20px;font-family:Georgia,serif;font-style:italic;">A healthier week starts at home.</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 18px;">Welcome, ${name}. Hearth is built for the reality of feeding a family — where the same meal needs to work for a six-year-old and two adults, and Tuesday mornings are never as long as you need them to be.</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 32px;">Here is what we have built for your family.</p>
      ${DIVIDER}
      <p style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#7D8F76;margin:0 0 18px;">Built around your family</p>
      ${dot('Wholefood family dinners', 'Japanese, Mediterranean, Middle Eastern and more — 80+ recipes that work for the whole table. Portions adjust automatically to your family size.')}
      ${dot('Lunchboxes that children actually eat', 'Wholefood, nut-free, prep-ahead. From onigiri to hummus plates — simple enough for a Tuesday morning, nourishing enough to matter.')}
      ${dot('Sunday batch cooking', 'Bone broth, hummus, seed crispbreads, brown rice. The larder recipes that make the whole week easier.')}
      ${dot('A meal planner built for real life', '7-day planning across breakfast, lunch and dinner. One plan, one shopping list, one quieter week.')}
      ${PREMIUM}
      ${CTA}
      ${SIGNATURE}
    </td>
  </tr>`;
}

function bodyBaby(name, hasKids) {
  const openingLine = hasKids
    ? `Welcome, ${name}. Hearth is built for exactly where you are — navigating first foods, lunchboxes, family dinners, and the particular kind of Sunday prep that makes all of it feel more possible.`
    : `Welcome, ${name}. Hearth is built for exactly where you are — navigating first foods, family meals, and the particular kind of Sunday prep that makes the whole week feel more possible.`;
  const closingLine = hasKids
    ? `Everything in the app is shaped around your family — from your baby's first bites to your older child's lunchbox.`
    : `Everything in the app is shaped around your family — including your baby.`;
  return `
  <tr>
    <td style="background-color:#FAFAF8;padding:44px 52px 36px;">
      <p style="font-size:15px;color:#2A2E27;line-height:1.8;margin:0 0 20px;font-family:Georgia,serif;font-style:italic;">A healthier week starts at home.</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 18px;">${openingLine}</p>
      <p style="font-size:14px;color:#4A5A49;line-height:1.85;margin:0 0 32px;">${closingLine}</p>
      ${DIVIDER}
      <p style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#7D8F76;margin:0 0 18px;">Built around every member of your table</p>
      ${dot('Baby-led weaning, stage by stage', 'From 6 months through toddlerhood. Evidence-based food introductions, allergen tracking, and first finger foods designed for small hands.')}
      ${dot('The allergen tracker', 'Log every introduction. Record reactions. Follow your baby\'s journey with a clear record you can share with your pediatrician.')}
      ${dot('Wholefood family dinners', 'Japanese, Mediterranean, Middle Eastern and more — recipes that adapt for the whole table so you cook once, not twice.')}
      ${hasKids ? dot('Lunchboxes that children actually eat', 'Wholefood, nut-free, prep-ahead. From onigiri to hummus plates — simple enough for a Tuesday morning.') : ''}
      ${dot('Sunday batch cooking', 'Bone broth, hummus, seed crispbreads. The foundations that make every weekday meal faster and more nourishing — for all of you.')}
      ${PREMIUM}
      ${CTA}
      ${SIGNATURE}
    </td>
  </tr>`;
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, name, family;
  try {
    const body = JSON.parse(event.body);
    email  = body.email;
    name   = body.name  || 'there';
    family = body.family || { adults: 1, kids: 0, babies: 0 };
  } catch(e) {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  if (!email) return { statusCode: 400, body: 'Email required' };

  // Choose content based on family profile
  const hasBaby = (family.babies || 0) > 0;
  const hasKids = (family.kids   || 0) > 0;
  const bodyHtml = hasBaby ? bodyBaby(name, hasKids)
                 : hasKids ? bodyFamily(name)
                 : bodyAdultsOnly(name);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Welcome to Hearth</title></head>
<body style="margin:0;padding:0;background-color:#EDE8DF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:300;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EDE8DF;padding:48px 20px 64px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      ${HEADER}
      ${bodyHtml}
      ${FOOTER}
    </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Ostra Living <hello@ostraliving.com>',
        to:   [email],
        subject: 'Welcome to Hearth',
        html
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Resend error:', data);
      return { statusCode: 500, body: JSON.stringify({ error: data }) };
    }

    console.log(`✓ Welcome email sent to ${email} (${hasBaby ? 'baby' : hasKids ? 'family' : 'adults'} version)`);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': 'https://hearth.ostraliving.com' },
      body: JSON.stringify({ success: true })
    };

  } catch(e) {
    console.error('Send welcome error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
