#!/usr/bin/env node
/**
 * setup-gmail-pubsub.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time setup for the two-way AI email auto-responder. This wires Gmail
 * (start@najahchemistja.com) → Google Cloud Pub/Sub → the handleEmailReply
 * Firebase Function, so every reply a lead sends lands in our handler.
 *
 * What this script does:
 *   1. Creates the Pub/Sub topic        : najah-chemist-gmail-replies
 *   2. Grants Gmail permission to publish to that topic
 *   3. Creates the push subscription     : najah-chemist-gmail-replies-sub
 *      (pointing at the handleEmailReply function URL, if PUSH_ENDPOINT is set)
 *   4. Calls Gmail users.watch() so Gmail starts publishing inbox changes
 *   5. Prints the manual steps you still need to do
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PREREQUISITES (manual — do these first):
 *
 *   A. Google Cloud project: najah-chemist (same project as Firebase).
 *
 *   B. Enable APIs in the Cloud Console for that project:
 *        - Cloud Pub/Sub API
 *        - Gmail API
 *
 *   C. A Google Cloud service account with roles:
 *        - roles/pubsub.admin  (to create topic + subscription + IAM binding)
 *      Download its JSON key and point to it:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/sa-key.json
 *      (On Windows PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\sa-key.json")
 *
 *   D. Gmail OAuth credentials for start@najahchemistja.com (used here for
 *      users.watch(), and at runtime by handleEmailReply to read messages).
 *      How to get them:
 *        1. Cloud Console → APIs & Services → Credentials →
 *           "Create Credentials" → OAuth client ID → type "Web application".
 *        2. Add redirect URI https://developers.google.com/oauthplayground
 *        3. Note the Client ID and Client Secret.
 *        4. Go to https://developers.google.com/oauthplayground
 *           - Click the gear (⚙) → "Use your own OAuth credentials" → paste ID + secret
 *           - In "Step 1" authorise scope:  https://www.googleapis.com/auth/gmail.modify
 *           - Sign in AS start@najahchemistja.com and allow
 *           - "Step 2" → "Exchange authorization code for tokens"
 *           - Copy the Refresh token.
 *        5. Export them for this script:
 *             export GMAIL_CLIENT_ID=...
 *             export GMAIL_CLIENT_SECRET=...
 *             export GMAIL_REFRESH_TOKEN=...
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENV VARS this script reads:
 *   GCLOUD_PROJECT            (default: najah-chemist)
 *   GMAIL_CLIENT_ID           (required)
 *   GMAIL_CLIENT_SECRET       (required)
 *   GMAIL_REFRESH_TOKEN       (required)
 *   GOOGLE_APPLICATION_CREDENTIALS  (required — service account JSON for Pub/Sub admin)
 *   PUSH_ENDPOINT             (optional — handleEmailReply URL; if set, a push
 *                              subscription is created automatically. Otherwise
 *                              create/point the subscription manually.)
 *   PUSH_AUTH_SA              (optional — service account email used for the push
 *                              subscription's OIDC token, recommended for security)
 *
 * RUN:
 *   npm install            # at repo root — installs @google-cloud/pubsub + googleapis
 *   node scripts/setup-gmail-pubsub.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { PubSub } = require('@google-cloud/pubsub');
const { google } = require('googleapis');

const PROJECT_ID       = process.env.GCLOUD_PROJECT || 'najah-chemist';
const TOPIC_NAME       = 'najah-chemist-gmail-replies';
const SUBSCRIPTION_NAME = 'najah-chemist-gmail-replies-sub';
const GMAIL_USER       = 'start@najahchemistja.com';
// Gmail's well-known publisher service account — it must have Publisher on the topic.
const GMAIL_PUBLISHER  = 'serviceAccount:gmail-api-push@system.gserviceaccount.com';

const PUSH_ENDPOINT = process.env.PUSH_ENDPOINT || '';
const PUSH_AUTH_SA  = process.env.PUSH_AUTH_SA  || '';

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`✗ Missing required env var: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

async function ensureTopic(pubsub) {
  const topic = pubsub.topic(TOPIC_NAME);
  const [exists] = await topic.exists();
  if (exists) {
    console.log(`✓ Topic already exists: ${TOPIC_NAME}`);
  } else {
    await pubsub.createTopic(TOPIC_NAME);
    console.log(`✓ Created topic: ${TOPIC_NAME}`);
  }
  return pubsub.topic(TOPIC_NAME);
}

// Grant gmail-api-push@system.gserviceaccount.com the Publisher role on the topic.
async function grantGmailPublish(topic) {
  const [policy] = await topic.iam.getPolicy();
  policy.bindings = policy.bindings || [];
  let binding = policy.bindings.find(b => b.role === 'roles/pubsub.publisher');
  if (!binding) {
    binding = { role: 'roles/pubsub.publisher', members: [] };
    policy.bindings.push(binding);
  }
  if (!binding.members.includes(GMAIL_PUBLISHER)) {
    binding.members.push(GMAIL_PUBLISHER);
    await topic.iam.setPolicy(policy);
    console.log(`✓ Granted Pub/Sub Publisher to Gmail (${GMAIL_PUBLISHER})`);
  } else {
    console.log('✓ Gmail already has Publisher on the topic');
  }
}

async function ensureSubscription(topic) {
  const sub = topic.subscription(SUBSCRIPTION_NAME);
  const [exists] = await sub.exists();
  if (exists) {
    console.log(`✓ Subscription already exists: ${SUBSCRIPTION_NAME}`);
    if (PUSH_ENDPOINT) {
      console.log(`  ↪ If the endpoint changed, update it in the Console or delete + re-run.`);
    }
    return;
  }

  if (!PUSH_ENDPOINT) {
    console.log(`• Skipping subscription creation — PUSH_ENDPOINT not set.`);
    console.log(`  Create it manually once you have the handleEmailReply URL (see steps below).`);
    return;
  }

  const options = {
    pushConfig: {
      pushEndpoint: PUSH_ENDPOINT,
      ...(PUSH_AUTH_SA ? { oidcToken: { serviceAccountEmail: PUSH_AUTH_SA } } : {})
    },
    ackDeadlineSeconds: 60
  };
  await topic.createSubscription(SUBSCRIPTION_NAME, options);
  console.log(`✓ Created push subscription: ${SUBSCRIPTION_NAME} → ${PUSH_ENDPOINT}`);
}

// Tell Gmail to publish inbox changes to our topic.
async function setupGmailWatch() {
  const oauth2 = new google.auth.OAuth2(
    requireEnv('GMAIL_CLIENT_ID'),
    requireEnv('GMAIL_CLIENT_SECRET')
  );
  oauth2.setCredentials({ refresh_token: requireEnv('GMAIL_REFRESH_TOKEN') });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: `projects/${PROJECT_ID}/topics/${TOPIC_NAME}`,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE'
    }
  });
  console.log(`✓ Gmail watch active on ${GMAIL_USER}`);
  console.log(`  historyId: ${res.data.historyId}`);
  console.log(`  expires:   ${new Date(Number(res.data.expiration)).toISOString()} (re-run watch within 7 days)`);
}

async function main() {
  console.log(`\n=== Gmail → Pub/Sub setup for project "${PROJECT_ID}" ===\n`);
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');

  const pubsub = new PubSub({ projectId: PROJECT_ID });

  const topic = await ensureTopic(pubsub);
  await grantGmailPublish(topic);
  await ensureSubscription(topic);
  await setupGmailWatch();

  console.log(`\n=== Setup complete. Remaining manual steps: ===`);
  console.log(`
1. Add the OAuth + Anthropic secrets to Firebase Secret Manager:
     firebase functions:secrets:set GMAIL_CLIENT_ID     --project ${PROJECT_ID}
     firebase functions:secrets:set GMAIL_CLIENT_SECRET --project ${PROJECT_ID}
     firebase functions:secrets:set GMAIL_REFRESH_TOKEN --project ${PROJECT_ID}
     firebase functions:secrets:set ANTHROPIC_API_KEY   --project ${PROJECT_ID}

2. Deploy the function (if not already deployed):
     firebase deploy --only functions:handleEmailReply --project ${PROJECT_ID}

3. Get the handleEmailReply HTTPS URL:
     firebase functions:list --project ${PROJECT_ID}
   (looks like https://handleemailreply-xxxxx-uc.a.run.app)

4. Register it as the Pub/Sub push endpoint:
     - If you set PUSH_ENDPOINT before running this script, it's already done.
     - Otherwise create the subscription now:
         gcloud pubsub subscriptions create ${SUBSCRIPTION_NAME} \\
           --topic=${TOPIC_NAME} \\
           --push-endpoint=<handleEmailReply URL> \\
           --push-auth-service-account=<your-service-account@${PROJECT_ID}.iam.gserviceaccount.com> \\
           --ack-deadline=60 --project=${PROJECT_ID}

5. Allow Pub/Sub to invoke the function (2nd-gen / Cloud Run):
     gcloud run services add-invoker-policy-binding handleemailreply \\
       --member="serviceAccount:<push-auth-service-account>" \\
       --region=us-central1 --project=${PROJECT_ID}
   (or grant roles/run.invoker on the service to that SA)

6. Gmail watch must be renewed within 7 days — re-run this script on a weekly
   schedule (cron / Cloud Scheduler) to keep the watch alive.
`);
}

main().catch(err => {
  console.error('\n✗ Setup failed:', err.message);
  process.exit(1);
});
