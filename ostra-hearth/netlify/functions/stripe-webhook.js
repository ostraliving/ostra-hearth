// ══════════════════════════════════════════════════════════════════════════════
// Ostra Hearth — Stripe Webhook Handler
// File: netlify/functions/stripe-webhook.js
//
// WHAT THIS DOES:
// Stripe calls this function automatically when a subscription is created,
// updated, deleted or when a payment fails. It then:
//   1. Verifies the request is genuinely from Stripe (signature check)
//   2. Updates is_premium in your Supabase profiles table
//   3. Tags the user in Mailchimp (free or premium tag)
//
// SETUP:
// 1. Copy this file to netlify/functions/stripe-webhook.js in your project
// 2. Set these environment variables in Netlify Dashboard → Site Settings → Env Variables:
//      STRIPE_SECRET_KEY          (Stripe Dashboard → Developers → API Keys → Secret key)
//      STRIPE_WEBHOOK_SECRET      (Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret)
//      SUPABASE_URL               (Supabase Dashboard → Settings → API → Project URL)
//      SUPABASE_SERVICE_KEY       (Supabase Dashboard → Settings → API → service_role key)
//      MAILCHIMP_API_KEY          (Mailchimp → Account → Extras → API Keys)
//      MAILCHIMP_LIST_ID          (Mailchimp → Audience → Settings → Audience name and defaults → Audience ID)
//      MAILCHIMP_SERVER_PREFIX    (the letters before .api.mailchimp.com in your API key, e.g. "us14")
// 3. Deploy to Netlify
// 4. In Stripe Dashboard → Developers → Webhooks → Add endpoint:
//      URL: https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook
//      Events to listen for:
//        • customer.subscription.created
//        • customer.subscription.updated
//        • customer.subscription.deleted
//        • invoice.payment_failed
// ══════════════════════════════════════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── SUPABASE HELPER ──────────────────────────────────────────────────────────
async function supabaseUpdate(userId, fields) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(fields)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase update failed: ${res.status} ${text}`);
  }
  return true;
}

// Look up Supabase user ID from their email address
async function supabaseGetUserByEmail(email) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`;
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0]?.id || null;
}

// ── MAILCHIMP HELPER ─────────────────────────────────────────────────────────
// Adds or removes tags on a Mailchimp contact
// Tags used: 'hearth-free', 'hearth-premium'
async function mailchimpSetTag(email, tagName, active) {
  const server   = process.env.MAILCHIMP_SERVER_PREFIX; // e.g. "us14"
  const listId   = process.env.MAILCHIMP_LIST_ID;
  const apiKey   = process.env.MAILCHIMP_API_KEY;

  // Mailchimp member hash = MD5 of lowercase email
  const crypto   = require('crypto');
  const hash     = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  const url      = `https://${server}.api.mailchimp.com/3.0/lists/${listId}/members/${hash}/tags`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tags: [
        { name: 'hearth-premium', status: active ? 'active' : 'inactive' },
        { name: 'hearth-free',    status: active ? 'inactive' : 'active'  }
      ]
    })
  });

  // 204 = success (no body), 404 = contact not yet in Mailchimp — both are OK
  return res.status === 204 || res.status === 404;
}

// Add a new contact to Mailchimp if they don't exist yet
async function mailchimpUpsertContact(email, isPremium) {
  const server = process.env.MAILCHIMP_SERVER_PREFIX;
  const listId = process.env.MAILCHIMP_LIST_ID;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const crypto = require('crypto');
  const hash   = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  const url    = `https://${server}.api.mailchimp.com/3.0/lists/${listId}/members/${hash}`;

  await fetch(url, {
    method: 'PUT', // PUT = create or update
    headers: {
      'Authorization': `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      tags: isPremium ? ['hearth-premium'] : ['hearth-free']
    })
  });
}

// ── MAIN WEBHOOK HANDLER ─────────────────────────────────────────────────────
exports.handler = async (event) => {

  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify the webhook came from Stripe — never skip this
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log(`Processing Stripe event: ${stripeEvent.type}`);

  try {

    // ── SUBSCRIPTION CREATED OR UPDATED ─────────────────────────────────────
    if (
      stripeEvent.type === 'customer.subscription.created' ||
      stripeEvent.type === 'customer.subscription.updated'
    ) {
      const subscription = stripeEvent.data.object;
      const isPremium    = subscription.status === 'active' || subscription.status === 'trialing';
      const periodEnd    = new Date(subscription.current_period_end * 1000).toISOString();
      const planNickname = subscription.items?.data?.[0]?.price?.nickname || 'premium';

      // Get customer email from Stripe
      const customer = await stripe.customers.retrieve(subscription.customer);
      const email    = customer.email;

      if (!email) {
        console.error('No email found on Stripe customer');
        return { statusCode: 200, body: 'No email — skipped' };
      }

      // Find the Supabase user
      const userId = await supabaseGetUserByEmail(email);
      if (userId) {
        await supabaseUpdate(userId, {
          is_premium:       isPremium,
          subscription_end: isPremium ? periodEnd : null,
          plan:             isPremium ? planNickname : null,
          stripe_customer_id: subscription.customer
        });
        console.log(`✓ Supabase updated for ${email} — premium: ${isPremium}`);
      } else {
        console.warn(`No Supabase user found for email: ${email}`);
      }

      // Update Mailchimp
      await mailchimpUpsertContact(email, isPremium);
      await mailchimpSetTag(email, 'hearth-premium', isPremium);
      console.log(`✓ Mailchimp updated for ${email}`);
    }

    // ── SUBSCRIPTION CANCELLED / DELETED ────────────────────────────────────
    else if (stripeEvent.type === 'customer.subscription.deleted') {
      const subscription = stripeEvent.data.object;
      const customer     = await stripe.customers.retrieve(subscription.customer);
      const email        = customer.email;

      if (email) {
        const userId = await supabaseGetUserByEmail(email);
        if (userId) {
          await supabaseUpdate(userId, {
            is_premium:       false,
            subscription_end: null,
            plan:             null
          });
          console.log(`✓ Supabase: premium removed for ${email}`);
        }
        await mailchimpSetTag(email, 'hearth-premium', false);
        console.log(`✓ Mailchimp: moved to free tag for ${email}`);
      }
    }

    // ── PAYMENT FAILED ───────────────────────────────────────────────────────
    // Stripe will retry automatically — we just log it here.
    // You can expand this to send a dunning email via Mailchimp if needed.
    else if (stripeEvent.type === 'invoice.payment_failed') {
      const invoice  = stripeEvent.data.object;
      const customer = await stripe.customers.retrieve(invoice.customer);
      console.warn(`Payment failed for customer: ${customer.email}`);
      // Optional: tag them in Mailchimp as 'payment-failed' to trigger a dunning sequence
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: `Server Error: ${err.message}` };
  }
};
