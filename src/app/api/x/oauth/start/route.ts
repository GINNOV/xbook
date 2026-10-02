import { oauthStart } from "@/lib/oauth-flow";

export async function GET(request: Request) {
  return oauthStart("x", request);
}
