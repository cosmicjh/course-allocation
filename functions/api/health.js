
export async function onRequestGet({ env }) {
  const result = await env.DB
    .prepare("SELECT 1 AS ok")
    .first();

  return Response.json({
    ok: result?.ok === 1
  });
}
