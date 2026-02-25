import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const variable = searchParams.get("variable") || "temperature_2m";

  if (!lat || !lon || !startDate || !endDate) {
    return NextResponse.json(
      { error: "Missing required params: lat, lon, start_date, end_date" },
      { status: 400 }
    );
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("hourly", variable);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("timezone", "auto");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json(
        { error: `Open-Meteo error: ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch forecast: ${err}` },
      { status: 500 }
    );
  }
}
