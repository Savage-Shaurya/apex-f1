/**
 * Any /api path without its own handler: a small JSON 404 for API clients and
 * monitors instead of the full HTML not-found page. Real routes always win
 * over this catch-all.
 */

function notFound(): Response {
  return Response.json({ ok: false, error: 'not found' }, { status: 404, headers: { 'cache-control': 'public, max-age=300', 'x-robots-tag': 'noindex' } });
}

export async function GET() { return notFound(); }
export async function POST() { return notFound(); }
export async function PUT() { return notFound(); }
export async function PATCH() { return notFound(); }
export async function DELETE() { return notFound(); }
