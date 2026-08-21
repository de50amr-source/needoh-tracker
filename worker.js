export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "needoh-stock-worker" });
    }
    if (url.pathname === "/api/stock") {
      // TODO: connect approved retailer data sources here.
      // Return normalized records:
      // [{name, retailer, price, location, mode, url, verified_at}]
      return Response.json([]);
    }
    return new Response("NeeDoh stock worker", {status: 200});
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkRetailers(env));
  }
};

async function checkRetailers(env) {
  // Intentionally empty starter.
  // Add retailer-specific modules that use permitted/public data sources.
  // Save normalized results to Supabase or another free DB.
}
