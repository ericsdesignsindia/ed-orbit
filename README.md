# ed-orbit

SEO App

<<<<<<< HEAD
# LocalPilot / SEO Command Center / Signal

A single-user agency workspace with a local mode and a private Vercel mode. **LocalPilot** is the home screen for programmatic local service pages, localized copy, schema health, Google Business Profile sync, and lead tracking. **Signal** remains available at `/social` for client rosters, social profile records, content planning, review queues, notes, manual metrics, and CSV exports. **SEO Command Center** is available at `/seo` for authorized crawls, findings, organic reporting, schedules, and durable storage.

## Start

Use **Node.js 22.13+ (Node 24 recommended)**. Earlier Node versions do not provide the required built-in SQLite API. Node may display an experimental SQLite warning.

```sh
npm install
npm run build
npm start
```

Open **http://127.0.0.1:3000** for LocalPilot, **http://127.0.0.1:3000/social** for Signal, and **http://127.0.0.1:3000/seo** for SEO Command Center. For development use `npm run dev`. Stop the running server before rebuilding in the same directory. The local server binds to `127.0.0.1` and stores data in SQLite.

The Vercel deployment at **https://seo-command-center-six.vercel.app/** uses Neon Postgres for its workspaces. It currently uses the existing password gate until Clerk Organizations is configured in Vercel. `DATABASE_URL` is supplied by the connected Neon integration. Hosted Google reporting additionally needs its OAuth and encryption environment variables. See the hosted setup notes below.

Clerk Organizations is implemented as the multi-user sign-in provider. SEO, Signal, and LocalPilot hosted records, recovery snapshots, and Google/Meta credential vaults are organization-scoped; OAuth state and browser sessions are also scoped to the active organization. The Clerk sign-in and organization switcher remain disabled until you add the Clerk keys in Vercel. Keep `CLERK_ORG_STORAGE_READY=0` until those keys are present and, if you want the existing hosted data assigned to your first organization, set `CLERK_LEGACY_OWNER_ORG_ID` to that organization’s Clerk ID. Set both readiness switches to `1` only after this configuration is complete. Existing integrations may need to be reconnected after the switch.

## LocalPilot local service directory (`/`)

LocalPilot is a focused workspace for freelance marketers and service businesses that need a faster path from local search intent to a qualified lead.

- Generate localized service-and-location landing pages from one reusable cluster brief.
- Preview page copy, conversion CTAs, schema coverage, and click tracking before review.
- Monitor page inventory, organic visibility, calls, WhatsApp messages, and form leads in one place.
- Keep Google Business Profile fields and location coverage synced with a visible health score.

LocalPilot starts with an empty workspace and saves business profile, service, location, page, lead, content, and tracking records in `.data/localpilot.sqlite` locally or the hosted Neon workspace when `VERCEL=1`. Generated pages remain drafts until explicitly published. Published pages are available at `/local/preview?slug=...`, inject the generated Schema.org graph, track page views and contact clicks, and write form enquiries back to the lead inbox. The existing Signal and SEO workspaces retain their separate persistence and integration boundaries.

The profile check records the current Google Business Profile connection fields locally. A live GBP OAuth sync requires Google Business Profile API credentials and location selection; the UI does not claim an external sync when those credentials are not configured.

## Signal social media workspace (`/social`)

Signal is designed for a digital marketing company managing more than five clients.

- Add, edit, archive, and reactivate clients.
- Save handles and public profile URLs for Instagram, Facebook, LinkedIn, YouTube, TikTok, X, and Pinterest.
- Create and edit drafts, request review, approve into a scheduled planning queue, and record live post URLs after publishing.
- Use the weekly calendar in **Asia/Kolkata**. Scheduled records are plans; they do not auto-publish without platform OAuth/API integrations.
- Record daily reach, engagements, and follower totals per client and channel. Analytics makes the data source and reporting window explicit and does not invent missing platform values.
- Save client notes, resolve follow-ups, export content plans and metric reports as CSV, and download/restore a validated JSON workspace backup.
- Build personalized email campaigns from a client brief, preview them for a representative contact, edit each draft, and export the sequence as text for your sending platform.
- Workspaces start empty. Any leftover starter records are removed on startup while non-example records are preserved.

Signal data is stored in `.data/signal.sqlite` and is separate from the `.data/orbit.sqlite` SEO workspace when running locally. On Vercel, Signal and SEO records persist in separate Neon tables, scoped by organization when Clerk is enabled. On the first hosted visit, an existing browser snapshot is migrated into Neon; example records are filtered during migration and the user's own records are retained. Until Clerk is configured, hosted workspaces continue to use the existing single-user password gate.

### Platform integration boundary

The current Signal flow manages planning and manual reporting locally. It does not claim live social platform connections, automatic publishing, comment synchronization, client logins, or multi-user permissions. Add those provider integrations only after configuring the required platform OAuth apps, scopes, token storage, and publishing/error-reconciliation rules.

## Main workflows

### Website management and migration

- Add a full URL; its hostname, `www`, scheme, and starting path are preserved.
- Rename, archive/unarchive, or explicitly delete a website. Archiving pauses its schedules. Pending jobs must finish before archive/delete.
- On first loading an empty server workspace, the UI offers automatic import of the previous `orbit.live-workspace.v1` browser data. Websites, compatible bindings, audit findings, and completed/failed run receipts migrate together.
- The original browser copy is **never removed or overwritten**. Invalid imports roll back and offer downloading the original for recovery. Use the same browser and localhost address used previously for this migration.
- The new workspace supports up to 500 sites; admission and reading enforce the same limit. Historical retention is per website rather than allowing one site's activity to displace another's.

### Real SEO crawls

1. Select your website and a budget of 25, 50, or 100 pages.
2. Approve a crawl only for a website you own or are authorized to assess.
3. The server queues the work and continues even if the browser tab closes.
4. Review prioritized findings and their page-specific evidence.

The crawler checks robots policy before fetching pages, discovers sitemaps from robots.txt, inspects static HTML, and detects metadata issues, noindex directives, image alt omissions, viewport/HTTPS issues, duplicate titles/descriptions, observed redirect chains, fetched broken internal links, and supported canonical conflicts.

Requests are sequential and throttled. Limits include 100 pages maximum, 120 seconds total, bounded requests and sitemap recursion, public-only DNS, pinned connections, bounded redirects, 1 MiB response bodies, and same-origin link discovery. Missing robots.txt permits crawling; unavailable/restricted robots policy fails closed. Common same-site apex/www robots redirects are supported; unrelated hosts are refused.

**Coverage is deliberately limited:** no JavaScript rendering, gzip sitemap expansion, arbitrary external crawling, query-string discovery, backlinks, or independent rank tracking. Unfetched URLs have unknown status. The severity-weighted score is a diagnostic heuristic—not a Google ranking or performance score. No inspected HTML means the assessment is unavailable, not a measured zero.

Issue lifecycle distinguishes **new**, **ongoing**, **resolved**, and **not rechecked**. A partial crawl must not declare an unvisited page fixed; cross-page issues need sufficient comparison coverage.

### Google Search Console and GA4

The application supports separate read-only authorization for GSC, GA4, or both. After consent, available properties load automatically. Confirm the matching properties for each website; GSC suggestions are not automatically applied. Property linking neither verifies website ownership nor installs tracking.

Reports include clicks, impressions, CTR, impression-weighted position, daily values, queries, pages, prior-period comparisons, low-CTR screening, and potential content-decline findings. GA4 reports filter the **Organic Search** channel and include users, sessions, page views, and key events.

Reports use 7/30/90-day periods ending three UTC calendar dates ago. GSC uses Pacific reporting dates and GA4 its property timezone; the two sources need not reconcile. Query/page tables are bounded to 1,000 top rows per period. Omitted rows are shown as **Not returned**, not assumed to have zero traffic; those rows do not generate fabricated decline percentages. Recommendations are screening heuristics, not guaranteed improvements.

Successful reports persist across reloads. Errors and partial sources are disclosed. Temporary token-refresh failures preserve authorization for retry instead of deleting it. Revoked credentials require reconnection.

### Scheduled workflows

Create daily or weekly **SEO crawl**, **Google report**, or **traffic-drop check** schedules. Set a local time and IANA timezone (default Asia/Kolkata), optional notification email, and relevant crawl/report settings. Traffic checks default to a 30% drop threshold and at least 100 previous-period clicks.

The local server runner checks roughly every 15 seconds, runs one job at a time, persists state before execution, retries identified transient failures up to three attempts, and recovers interrupted work on restart. Missed occurrences produce one catch-up job, not a burst of all missed runs. DST gaps/folds are handled by the scheduling tests.

On Vercel, the app server processes manually started jobs and a daily cron checks for scheduled work. Vercel Hobby cron timing can vary by up to 59 minutes, and schedules more frequent than daily cannot be guaranteed on that plan. Set `CRON_SECRET` in Production before scheduled work can run. Scheduled jobs and their receipts persist in Neon. The browser must stay open only while viewing; hosted work continues on Vercel.

In-app notifications are always supported. Email is optional and requires SMTP configuration; receipts distinguish accepted, failed, and unconfigured delivery. SMTP acceptance does not guarantee delivery to the recipient's inbox. Email failure does not rerun the crawl or report.

### PageSpeed

Integrations includes mobile/desktop Google PageSpeed requests. Lighthouse lab scores/metrics are separated from available CrUX field measurements, including whether field data is URL- or origin-scoped. Missing data, errors, and quota limits never become invented scores. An optional `PAGESPEED_API_KEY` can be configured.

### WordPress preview, approval, and rollback

Configure one public HTTPS WordPress origin and a dedicated account's application password. In Integrations, enter an existing post/page ID and exact proposed title/excerpt. Generate a preview, review before/after values, and explicitly approve applying it.

- Only native title/excerpt fields are modified. Pages without excerpt support can receive title-only updates when excerpt is left empty.
- Publication status and body content are not intentionally changed. **Yoast/Rank Math SEO metadata is not edited.** Native excerpts are not a general substitute for meta descriptions.
- Receipts are durable. Before writing or rolling back, SEO Command Center checks current raw fields, modification marker, and status against the saved snapshot.
- Writes require both a matching response and an independent follow-up read before being reported verified.
- An ambiguous write becomes **uncertain**, is never automatically repeated, and requires read-only reconciliation. It blocks further writes to that resource until reconciled.
- WordPress REST does not offer atomic compare-and-swap for this operation. Another editor can race between the check and write; visible mismatches are detected afterward. Avoid simultaneous external editing while approving a change.

No WordPress change is published just by configuring the integration or running an SEO audit.

## Private configuration

Use `.env.example` as the template for a private `.env.local`. Never commit, attach, or paste secrets into chat or reports. The existing configured Google values must be retained when adding optional settings.

### Google setup

1. Enable Google Search Console API, Google Analytics Admin API, and Google Analytics Data API in your Google Cloud project.
2. Configure the OAuth consent screen and add your account as a test user while the application is in testing mode. Google verification and refresh-token lifetime policies apply.
3. Create a **Web application** OAuth client. Register `http://localhost:3000/api/google/callback` for local use. To enable hosted reporting, also register exactly `https://seo-command-center-six.vercel.app/api/google/callback`.
4. For local use, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL=http://localhost:3000`, and a random 64-hex-character `TOKEN_ENCRYPTION_KEY`. For Vercel, add the same OAuth client values and a stable `TOKEN_ENCRYPTION_KEY` to the Vercel Production environment, and set `APP_BASE_URL=https://seo-command-center-six.vercel.app`.
5. Alternatively, on a fresh configuration use `node scripts/configure-google.mjs "FULL_PATH_TO_DOWNLOADED_JSON"`. This validates the Web client and callback, creates `.env.local` exclusively, and generates a private encryption key without logging its value. It refuses to overwrite an existing `.env.local`.
6. Restart the server, connect Google in Integrations, then confirm website properties and load a report.

Google refresh credentials are encrypted with AES-256-GCM in an HttpOnly cookie and a private server vault used for scheduled reports. On Vercel the encrypted vault is stored in Neon. Browser endpoints still authenticate the cookie; the server vault is not anonymous API access. Local sessions have a 30-day maximum and Google may revoke them sooner. Keep the encryption key stable. Disconnect clears the local cookie and vault; revoke the Google grant separately in your Google Account if desired.

### Optional SMTP

Set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` as required by your provider. Port 465 uses implicit TLS. Configure destinations in each schedule. These are server-only settings; nothing sends until you create/enable a schedule with an email destination or otherwise run that configured workflow.

### Optional WordPress

Set `WP_SITE_URL` to an HTTPS origin without a path, `WP_USERNAME` to a dedicated account, and `WP_APPLICATION_PASSWORD` to its WordPress application password. Do not use your normal login password. The account needs permission to edit the selected resource. Redirects are not followed with credentials; set the exact canonical WordPress origin. Installations hosted under a subdirectory are not supported by this origin-only adapter.

### Persistence and backup

Local private storage defaults to `.data/`, excluded from Git. `ORBIT_DATA_DIR` can point to a different private directory before starting the local server. On Vercel, the main SEO workspace, recovery snapshots, and encrypted Google token vault use the connected Neon database. WordPress approval and rollback receipts remain local-only; hosted WordPress publishing is disabled until those receipts have durable Neon storage.

| File | Purpose |
| --- | --- |
| `.data/orbit.sqlite` | Websites, crawl findings, Google reports, schedules, job receipts, notifications, recovery snapshots |
| `.data/google-session.enc` | Encrypted Google session for the local worker; never included in JSON exports |
| `.data/wordpress.sqlite` | Native-field publishing snapshots and rollback receipts |

Settings exports a **SEO workspace JSON backup** excluding credentials. Restore validates the full schema and saves a recovery snapshot in SQLite before replacing it. Restored schedules are paused and queued/running historical jobs are not replayed. Invalid data is rejected without resetting the existing workspace. Import is limited to 25 MB plus its request envelope.

JSON workspace backups do **not** include WordPress publishing receipts. To preserve those, stop the app and securely back up `.data/wordpress.sqlite` separately. For a complete local backup, stop the app and back up its private storage directory plus configuration to a private encrypted destination. Do not share that complete backup: it contains encrypted credentials and private configuration. SQLite WAL/SHM companion files must be kept with the database if backing up without a proper checkpoint; stopping first is recommended.

The database retains 30 crawls, 30 reports, 45 completed jobs, and 50 notifications per website; pending jobs are retained separately. Recovery snapshots are stored before workspace restores. This local snapshot-oriented SQLite design is intended for modest workloads, not a high-volume hosted service.

## Exports

- JSON website reports and SEO workspace backups.
- CSV query/page tables and filtered SEO findings, with spreadsheet formula-injection protection.
- **Print / Save PDF** opens your browser's print dialog with report styling. It is not an automatic email PDF generator.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run test:server
```

`npm test` runs offline tests for storage, migration, recovery, scheduling/DST, crawler policy and safety, Google token handling/reporting, cross-module report persistence, partial-crawl issue lifecycle, and WordPress approvals/rollback/uncertain-write handling.

`npm run test:server` starts an isolated production server on an ephemeral loopback port using temporary storage. It performs a real crawl of the public example.com demonstration domain, verifies durable job completion, backup/restore, restart persistence and request guards, then removes only its own temporary data. It needs a successful build and Internet access. It never uses the user's `.data` directory.

`npm run test:smoke` retains the older homepage endpoint smoke test against localhost:3000. It does not populate the user's new workspace.

Tests using mocked Google, SMTP, and WordPress responses are **not** proof of a live account connection, email delivery, or publication. Those require the appropriate account setup and explicit actions. No private credentials should appear in test output.

## Remaining boundaries

- The hosted workspace is single-user and password-gated; it does not provide team accounts, roles, or billing.
- No full JavaScript rendering, independent rank tracking, backlink database, or content-generation service.
- No automatic indexing promise or general Google “force index” action.
- WordPress support is bounded native-field editing with explicit approval—not unattended SEO-plugin publishing.
- Local scheduled work stops when the local server/computer is off; hosted schedules run through the Vercel daily cron and may be delayed on Hobby. Reconnecting expired Google authorization may require user consent.
=======
# ed-orbit
SEO App
>>>>>>> origin/main

