# Eco Screen CRM V2

Mobile production CRM for Eco Screen quotation, orders, production, installation and warranty workflow.

## Run

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

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
