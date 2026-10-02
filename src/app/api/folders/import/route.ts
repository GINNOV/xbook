import { importOperationPost } from "@/lib/import-job-api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) { return importOperationPost(request, true); }
