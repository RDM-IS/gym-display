export const onRequest: PagesFunction<{ HEALTH_API_KEY: string }> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const target =
    "https://inolj7bn99.execute-api.us-east-1.amazonaws.com/default/rdmis-crm-api/api" +
    path +
    url.search;

  const headers = new Headers(ctx.request.headers);
  headers.set("X-API-Key", ctx.env.HEALTH_API_KEY);
  headers.delete("host");

  const resp = await fetch(target, {
    method: ctx.request.method,
    headers,
    body: ["GET", "HEAD"].includes(ctx.request.method) ? undefined : ctx.request.body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: { "content-type": resp.headers.get("content-type") || "application/json" },
  });
};
