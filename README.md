# IndiaTempMail — GitHub Pages + Cloudflare

This starter contains a static website, Cloudflare Worker API, D1 schema, and cleanup schedule. It is a working code base, but it must be configured with your own domain and Cloudflare account before it can receive real email.

## What is included
- Generate a random temporary address on your domain.
- Private inbox token in the URL.
- Auto-refresh inbox every 10 seconds.
- View message body and attempt to detect common OTP formats.
- D1 storage with configurable inbox/message expiration.
- Basic per-IP inbox creation limit and scheduled cleanup.
- GitHub Pages frontend.

## Important
GitHub Pages only hosts the frontend. It cannot receive mail or run server-side code. The Cloudflare Worker and Email Routing configuration are required. Some services block disposable domains; OTP delivery is not guaranteed. Do not use temporary inboxes for banking, account recovery, or sensitive personal data. Anyone with the private inbox URL can read its messages.

## 1. Put the frontend on GitHub
1. Create a public repository named `india-tempmail`.
2. Upload `index.html` to the repository root.
3. Keep the placeholder Worker URL for now.
4. In **Settings → Pages**, select **Deploy from a branch**, branch `main`, folder `/(root)`, then save.

## 2. Create Cloudflare D1
Install Node.js on a computer if possible. In a terminal:

```bash
npm install -g wrangler
wrangler login
wrangler d1 create india-tempmail-db
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Change `MAIL_DOMAIN` to a domain you own and have added to Cloudflare. Do not use someone else's domain.

Initialize the remote database:

```bash
wrangler d1 execute india-tempmail-db --remote --file=./schema.sql
```

## 3. Deploy the Worker
From this folder, run:

```bash
wrangler deploy
```

Open `https://YOUR-WORKER.workers.dev/api/health`. Expected response:

```json
{"ok":true,"service":"IndiaTempMail API"}
```

Copy the actual Worker URL. Edit `index.html`, replace `https://REPLACE-WITH-YOUR-WORKER.workers.dev` in `API_BASE`, then commit and push the changed file to GitHub.

## 4. Configure incoming email
1. The domain must be added to Cloudflare and use Cloudflare authoritative DNS/nameservers.
2. In the Cloudflare dashboard, open **Email Routing** for the domain and complete **Onboard domain**. Allow Cloudflare to configure the required MX and TXT records.
3. Create an Email Routing rule that routes all addresses on the domain (catch-all) to your deployed Worker. The exact UI labels may vary; select the Worker as the destination/action, not a personal mailbox.
4. Do not use conflicting MX records from another mail provider on the same receiving domain.
5. Generate an address on your website and send a test message from another mailbox.

The Worker only accepts mail addressed to active inboxes stored in D1. Random addresses are not permanent mailboxes.

## 5. Test
Create an inbox by opening the website and pressing **Generate new address**. API endpoint:

```bash
curl -X POST https://YOUR-WORKER.workers.dev/api/new \
 -H "Content-Type: application/json" -d '{}'
```

Keep the returned token private. Inbox API:

```text
GET https://YOUR-WORKER.workers.dev/api/inbox/TOKEN
```

## Limitations and production notes
- This is a lightweight MIME parser, not a complete standards-compliant email parser. Complex multipart/encoded messages may display imperfectly and OTP detection may miss some formats.
- The basic IP limit can be bypassed by distributed clients. Before public launch, add stronger abuse prevention and monitoring.
- CORS is permissive for simple GitHub Pages integration. Consider restricting it to your actual site origin for production.
- Cloudflare plan quotas and Email Routing availability/policies can change; verify the current dashboard limits.
- `INBOX_TTL_HOURS` and `MESSAGE_TTL_HOURS` are clamped to 1–24 hours.
- Do not commit API keys or account credentials to GitHub.
