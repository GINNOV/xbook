import { operationPost } from "@/lib/operation-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return operationPost(request, "enrich", true); }
