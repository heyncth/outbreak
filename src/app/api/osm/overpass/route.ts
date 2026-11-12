import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { query, endpoint } = (await req.json()) as { query: string; endpoint?: string };
  const url = endpoint ?? "https://overpass-api.de/api/interpreter";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return NextResponse.json({ error: res.statusText }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
