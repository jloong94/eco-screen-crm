# Eco Screen CRM V2

Mobile production CRM for Eco Screen quotation, orders, production, installation and warranty workflow.

## Run

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Social Lead Miner (TikTok MVP)

Boss and Admin users can open **Social Lead Miner** from the existing CRM navigation. The module supports lawful TikTok comment CSV import, intent scoring, duplicate prevention, search and filters, CSV export, suggested English/Chinese/Malay outreach, and a manual contact queue.

Direct TikTok comment access is deliberately disabled in this static frontend until an approved server-side provider is available. The module never returns mock comments, bypasses TikTok protections, or sends messages automatically. Download the CSV template from the module; `contact_eligibility` must be `not_eligible`, `direct_brand_interaction`, or `user_consented`.

The data layer uses a provider registry in `src/socialProviders.js`, so Facebook, Instagram and YouTube adapters can be registered later without changing scoring, storage or queue behavior. To activate an approved TikTok connector, set `VITE_TIKTOK_SCAN_ENDPOINT` to a same-origin server route. This variable is only the public route; TikTok/provider credentials must remain on that server and must never use a `VITE_` prefix.

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
