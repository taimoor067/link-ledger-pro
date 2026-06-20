// netlify/functions/fetch-page.js
//
// Server-side fetch proxy so the browser-based niche-detector.js can pull
// HTML from any external domain without hitting CORS restrictions.
//
// Call it like:
//   GET /.netlify/functions/fetch-page?url=https://benzinga.com
//
// Response:
//   { "html": "<!doctype html>...", "finalUrl": "https://benzinga.com/" }

exports.handler = async function (event) {
  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;

  // CORS headers so your frontend can call this from the browser
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing required query param: url" })
    };
  }

  // Basic safety checks
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid URL" })
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Only http/https URLs are allowed" })
    };
  }

  // Block obvious internal/private targets (basic SSRF guard)
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(hostname);
  if (blockedHosts.includes(hostname) || isPrivateIp) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Target host is not allowed" })
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Pretend to be a normal browser; some sites block bare server requests
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Upstream returned ${response.status}` })
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return {
        statusCode: 415,
        headers,
        body: JSON.stringify({ error: `Unsupported content-type: ${contentType}` })
      };
    }

    // Cap how much HTML we read to keep function execution fast/cheap
    const fullText = await response.text();
    const html = fullText.slice(0, 300000); // ~300KB cap

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        html,
        finalUrl: response.url || parsed.toString()
      })
    };
  } catch (err) {
    const isAbort = err.name === "AbortError";
    return {
      statusCode: isAbort ? 504 : 500,
      headers,
      body: JSON.stringify({
        error: isAbort ? "Request to target site timed out" : "Failed to fetch target site",
        detail: String(err.message || err)
      })
    };
  }
};