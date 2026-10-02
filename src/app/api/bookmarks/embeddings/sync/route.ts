import { operationPost } from "@/lib/operation-api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) { return operationPost(request, "embedding"); }
