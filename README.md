# NeeDoh Tracker MVP

Free, mobile-first PWA starter for a shared NeeDoh collector group.

## Included
- Installable PWA for iOS/Android/desktop
- Master NeeDoh checklist
- Owned / Wanted / Priority status
- Daniel's current owned items preloaded
- Polar Glow Penguin + Advent Calendar marked Priority
- Shared-stock-feed UI with demo records
- Cloudflare Worker starter for real inventory checks

## Run locally
Use any static server in this folder, for example:

python -m http.server 8000

Then open http://localhost:8000

## Free deployment
- Frontend: Vercel or Cloudflare Pages
- Backend/checker: Cloudflare Workers
- Shared profiles/database: Supabase Free

## Important
The demo stock feed is intentionally sample data.
Real inventory monitoring must use retailer-specific public/approved endpoints or otherwise permitted access patterns.
