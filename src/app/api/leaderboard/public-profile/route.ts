import { NextResponse } from "next/server";

const TIMEOUT_MS = 8000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL("https://gamma-api.polymarket.com/public-profile");
    url.searchParams.set("address", address);

    const response = await fetch(url.toString(), { signal: controller.signal });
    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "Upstream request failed." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
