# Eco Screen CRM - Meta Ads Sync Setup

## Vercel Environment Variables

Add these in Vercel Project Settings -> Environment Variables:

```env
META_ACCESS_TOKEN=your_long_lived_meta_access_token
META_AD_ACCOUNT_ID=act_1234567890
META_API_VERSION=v21.0
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Notes

- `META_ACCESS_TOKEN` must never be placed in frontend code.
- `META_AD_ACCOUNT_ID` can include the `act_` prefix. If you enter only the number, the serverless function will add `act_` automatically.
- `META_API_VERSION` can be changed when Meta requires a newer API version.
- `SUPABASE_SERVICE_ROLE_KEY` is server-side only. Do not expose it in `NEXT_PUBLIC_` variables or inside `standalone-preview.html`.
- If the Meta token expires, the Sync button will show a failed message and old Facebook Ads data will remain unchanged.

## Meta Permissions Needed

The Meta access token should have access to the selected Ad Account and the following permissions:

- `ads_read`
- `read_insights`

For basic Phase 6B sync, the CRM reads ad insight data only. It does not edit campaigns or budgets.

## Supabase SQL

Run this file in Supabase SQL Editor before testing sync:

```text
outputs/phase-6b-facebook-ads-sync-migration.sql
```

## How Sync Works

1. Admin opens Facebook Ads Dashboard.
2. Admin selects Date From and Date To.
3. Admin clicks `Sync Meta Ads`.
4. CRM calls `/api/meta-ads-sync`.
5. Vercel Serverless Function reads Meta token from Vercel environment variables.
6. Function calls Meta Marketing API Insights.
7. Function upserts records into `facebook_ads_daily`.
8. CRM reloads synced rows from Supabase.

## Fallback

Manual Facebook Ads records remain in localStorage / CRM snapshot.

Dashboard display priority:

1. Synced Supabase `facebook_ads_daily` records
2. Manual Facebook Ads records if no synced data exists

Sync failure will not delete manual records or old synced records.
