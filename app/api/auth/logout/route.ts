import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/spotify";

export async function GET(request: Request) {
  await clearTokens();
  return NextResponse.redirect(new URL("/", request.url));
}
