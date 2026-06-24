export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({
        ok: true,
        mode: 'public-landing',
        privateApiEnabled: false
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json(
        {
          ok: false,
          error: 'Private dashboard APIs are disabled on the public landing domain.'
        },
        { status: 404 }
      );
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-cache, no-store, must-revalidate');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
