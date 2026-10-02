import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/youtube";
import { createYouTubeMetadataRepairHandler } from "@/lib/youtube-metadata-api";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const POST = createYouTubeMetadataRepairHandler({ database: prisma, getAccessToken: async (signal) => (await getAuthContext(signal)).accessToken });
