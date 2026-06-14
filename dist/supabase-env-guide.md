# Eco Screen CRM Supabase Environment Variables

Add these variables in Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://aipybobjyctpzmpfxvrk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_W15IbmPambSaNP8eEFNcUw_3x16p5xH
NEXT_PUBLIC_GOOGLE_CALENDAR_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
NEXT_PUBLIC_SITE_URL=https://your-crm.vercel.app
```

Where to add:

1. Vercel Dashboard
2. Eco Screen CRM Project
3. Settings
4. Environment Variables
5. Add the variables for Production, Preview, and Development
6. Redeploy

Supabase SQL files:

1. Run `supabase-setup.sql`
2. Run `supabase-business-migration.sql`
3. Run `secretary-payment-remarks-migration.sql`
4. Run `google-calendar-appointments-migration.sql`
5. Run `supabase-primary-database-migration.sql`

Authentication roles:

Roles are stored in `public.eco_screen_profiles.role`.

Supported roles:

- `admin`
- `secretary`
- `sales`
- `production`
- `installer`

Example SQL:

```sql
update public.eco_screen_profiles
set role = 'admin'
where email = 'boss@email.com';
```
