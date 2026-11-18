export function onRequest() {
  return Response.json({ ok: false, code: 'COURSE_MOVED' }, {
    status: 410,
    headers: { 'X-Course-Allocation-Frozen': '1', 'Cache-Control': 'no-store' }
  });
}
