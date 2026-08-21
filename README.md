# NeeDoh Tracker — Supabase Connected

## Before uploading index.html

1. In Supabase go to Authentication > Providers / Sign In methods.
2. Enable Anonymous Sign-Ins.
3. Open SQL Editor and run `supabase-policies.sql`.
4. Replace your GitHub `index.html`, `manifest.json`, and `sw.js` with these files.
5. Vercel will redeploy automatically.

This build uses only the Supabase publishable key in the browser. Never put a Supabase secret/service-role key in the frontend.
