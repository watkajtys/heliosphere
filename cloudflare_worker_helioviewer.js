/**
 * Helioviewer API Proxy Worker
 * Purpose-built proxy for api.helioviewer.org with caching and validation
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // Only handle takeScreenshot endpoint
        if (!url.pathname.includes('takeScreenshot')) {
            return new Response('Only /takeScreenshot endpoint is supported', { 
                status: 404,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
        
        // Validate required parameters
        const params = url.searchParams;
        const requiredParams = ['date', 'layers', 'imageScale', 'width', 'height'];
        
        for (const param of requiredParams) {
            if (!params.has(param)) {
                return new Response(`Missing required parameter: ${param}`, { 
                    status: 400,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
        }
        
        // Validate parameter values
        const width = parseInt(params.get('width'));
        const height = parseInt(params.get('height'));
        
        if (isNaN(width) || width < 1 || width > 4096 || 
            isNaN(height) || height < 1 || height > 4096) {
            return new Response('Invalid width or height parameters', { 
                status: 400,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
        
        // Build Helioviewer API URL
        const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?${params.toString()}`;
        
        // Create cache key from parameters
        const cacheKey = new Request(apiUrl, request);
        const cache = caches.default;
        
        // Check cache first
        let response = await cache.match(cacheKey);
        
        if (!response) {
            // Fetch from Helioviewer API
            try {
                response = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Heliosphere/1.0 (CloudflareWorker)',
                    }
                });
                
                // Only cache successful image responses
                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('image')) {
                        // Clone response for caching
                        const responseToCache = response.clone();
                        
                        // Create new response with cache headers
                        response = new Response(responseToCache.body, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: {
                                ...Object.fromEntries(response.headers.entries()),
                                'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
                                'X-Cache-Status': 'MISS',
                                'Access-Control-Allow-Origin': '*',
                            }
                        });
                        
                        // Store in cache
                        ctx.waitUntil(cache.put(cacheKey, response.clone()));
                    }
                } else {
                    // Don't cache error responses
                    return new Response(`Helioviewer API error: ${response.status} ${response.statusText}`, {
                        status: response.status,
                        headers: {
                            'Content-Type': 'text/plain',
                            'X-Cache-Status': 'BYPASS',
                        }
                    });
                }
            } catch (error) {
                return new Response(`Proxy error: ${error.message}`, {
                    status: 500,
                    headers: {
                        'Content-Type': 'text/plain',
                        'X-Cache-Status': 'ERROR',
                    }
                });
            }
        } else {
            // Add cache hit header
            response = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    ...Object.fromEntries(response.headers.entries()),
                    'X-Cache-Status': 'HIT',
                    'Access-Control-Allow-Origin': '*',
                }
            });
        }
        
        return response;
    }
};