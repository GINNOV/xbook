import { oauthCallback } from "@/lib/oauth-flow";

export async function GET(request: Request) {
  return oauthCallback("yt", request);
}
