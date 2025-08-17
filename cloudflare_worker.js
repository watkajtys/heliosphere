// Cloudflare Worker to proxy Helioviewer API requests
// Deploy this to Cloudflare Workers for free

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
    // Get the URL from query parameter
    const url = new URL(request.url)
    const targetUrl = url.searchParams.get('url')
    
    if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 })
    }
    
    try {
        // Make the request to Helioviewer
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Heliosphere/1.0'
            }
        })
        
        // Return the response with CORS headers
        return new Response(response.body, {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=3600'
            }
        })
    } catch (error) {
        return new Response(`Proxy error: ${error.message}`, { status: 500 })
    }
}