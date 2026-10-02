import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { connectionFailure, modelEndpointSchema } from "@/lib/connection-diagnostics";
export const dynamic = "force-dynamic";
const schema = z.object({ baseUrl: modelEndpointSchema, apiKey: z.string().optional().nullable() });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid model request." }, { status: 400 });
  try {
    const client = new OpenAI({ apiKey: parsed.data.apiKey?.trim() || "lm-studio", baseURL: parsed.data.baseUrl.replace(/\/+$/, ""), timeout: 5000, maxRetries: 0 });
    const response = await client.models.list({ signal: request.signal });
    return NextResponse.json({ ok: true, models: response.data.map((model) => model.id) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: connectionFailure(error, parsed.data.baseUrl) }, { status: 400 });
  }
}
