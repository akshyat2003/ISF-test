import { getFastifyServerlessApp } from "@sj/api/serverless";

async function handler(request: Request) {
  try {
    const app = await getFastifyServerlessApp();
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    const method = request.method as any;

    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headers[k] = v;
    });

    const body = ["GET", "HEAD"].includes(method) ? undefined : await request.text();

    const response = await app.inject({
      method,
      url: path,
      headers,
      payload: body || undefined,
    });

    const resHeaders = new Headers();
    Object.entries(response.headers).forEach(([k, v]) => {
      if (v !== undefined) {
        if (Array.isArray(v)) {
          v.forEach((item) => resHeaders.append(k, item));
        } else {
          resHeaders.set(k, String(v));
        }
      }
    });

    return new Response(response.body, {
      status: response.statusCode,
      headers: resHeaders,
    });
  } catch (err) {
    console.error("[API ROUTE ERROR]", err);
    return new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        code: "internal_error",
        detail: (err as Error).message || "Internal server error occurred.",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
