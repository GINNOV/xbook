import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { createOAuthUrl } from "@/lib/oauth-flow";
import { requestPublicOrigin } from "@/lib/oauth-redirect";

const draftSchema = z.object({ ytClientId: z.string().nullable().optional(), ytClientSecret: z.string().nullable().optional(), ytRedirectUri: z.string().nullable().optional() });

export async function POST(request: Request) {
  try {
    const draft = draftSchema.parse(await request.json());
    const settings = await getSettings();
    // A generated URL must use the same saved configuration as its callback.
    for (const key of ["ytClientId", "ytClientSecret", "ytRedirectUri"] as const) {
      if (draft[key] !== undefined && (draft[key]?.trim() || null) !== (settings[key] ?? null)) {
        return NextResponse.json({ ok: false, error: "Save YouTube OAuth configuration before generating its sign-in URL." }, { status: 400 });
      }
    }
    const url = await createOAuthUrl("yt", requestPublicOrigin(request), settings);
    return NextResponse.json({ ok: true, url: url.toString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof z.ZodError ? "Invalid OAuth configuration." : error instanceof Error ? error.message : "Failed to generate URL." }, { status: 400 });
  }
}
