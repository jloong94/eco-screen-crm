# Eco Screen CRM V2

Mobile production CRM for Eco Screen quotation, orders, production, installation and warranty workflow.

## Run

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Social Lead Miner (TikTok, Facebook and RedNote)

Boss and Admin users can open **Social Lead Miner** from the existing CRM navigation. The module supports lawful TikTok, Facebook and Xiaohongshu/RedNote comment CSV import, intent scoring, duplicate prevention, platform/search filters, CSV export, suggested English/Chinese/Malay outreach, and the existing manual contact queue.

The default free workflow is intentionally simple: select a platform, paste the public post/video URL, paste comments in `@username: comment` format, and choose **Start Analysis**. CSV import and keyword controls are kept under **Advanced Settings**. Pasted comments are analysed locally through the same scoring and duplicate pipeline; they are not sent back to the social platform.

Direct TikTok comment access is deliberately disabled in this static frontend until an approved server-side provider is available. The module never returns mock comments, bypasses TikTok protections, or sends messages automatically. Download the CSV template from the module; `contact_eligibility` must be `not_eligible`, `direct_brand_interaction`, or `user_consented`.

The data layer uses a provider registry in `src/socialProviders.js`, so Instagram and YouTube adapters can be added later without changing scoring, storage or queue behavior. Approved connectors can be activated with `VITE_TIKTOK_SCAN_ENDPOINT`, `VITE_FACEBOOK_SCAN_ENDPOINT`, or `VITE_REDNOTE_SCAN_ENDPOINT`. These variables are only public same-origin route URLs; platform credentials must remain on the connector server and must never use a `VITE_` prefix. Without a connector, the UI returns a real configuration error and never supplies mock comments. Facebook access must use authorized Meta Page/content access. RedNote direct scanning remains disabled until an approved comment data source is available; lawful CSV import remains available.

## Build

```bash
npm run build
npm run preview
```

## Vercel

Set the Vercel project Root Directory to:

```text
eco-screen-crm-v2
```

Vercel should use:

```text
Build Command: npm run build
Output Directory: dist
```

The production app label is:

```text
Eco Screen CRM V2 - Mobile Production
```

## Supabase Cloud Sync

LocalStorage remains the fallback. Cloud sync turns on only when these Vercel Environment Variables are set:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Run this SQL in Supabase SQL Editor before enabling cloud sync:

```text
supabase-crm-v2-sync.sql
```

The current cloud sync stores shared CRM collections in `eco_screen_v2_collections`.
