import OpenAI from "openai";
import { setTimeout as waitForRetry } from "node:timers/promises";
import { normalizeEmbeddingEndpoint, validateEmbeddingVector, type EmbeddingIdentity, type GeneratedEmbedding } from "./embedding-vector";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { logLlmRequest, logProcessingEvent } from "@/lib/processing";
import { formatEvidenceSection } from "@/lib/source-evidence";
import type { TranscriptCapture, TranscriptSection } from "@/lib/youtubeTranscript";

// --- Configuration & Schemas ---

const envSchema = z.object({
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
});

const cleanEnv = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const DEFAULT_SYSTEM_PROMPT = "Return only compact valid JSON. Do not include markdown, prose, explanations, or reasoning.";

function applyThinkingPreference(systemPrompt: string, thinkingEnabled?: boolean | null) {
  const withoutNoThink = systemPrompt
    .split("\n")
    .filter((line) => line.trim() !== "/no_think")
    .join("\n")
    .trim();

  if (thinkingEnabled) {
    return withoutNoThink || DEFAULT_SYSTEM_PROMPT;
  }

  return withoutNoThink.startsWith("/no_think")
    ? withoutNoThink
    : `/no_think\n${withoutNoThink || DEFAULT_SYSTEM_PROMPT}`;
}

const rawResponseSchema = z.object({
  summary: z.string().optional(),
  category: z.string().optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
});

export type Enrichment = {
  summary: string;
  category: string;
  tags?: string[];
  embedding?: number[];
  embeddingIdentity?: EmbeddingIdentity;
};

export type SummarizeInput = {
  text?: string;
  authorUsername?: string;
  externalUrls?: string[];
  sourceText?: string;
  mediaDescription?: string;
  folderName?: string;
  signal?: AbortSignal;
  processing?: {
    runId?: string | null;
    bookmarkId?: string | null;
  };
};

// --- Prompt Templates ---

const PROMPTS = {
  DEFAULT_ENRICHMENT: [
    "You are an expert research analyst and knowledge curator. Your goal is to transform social media bookmarks and video transcripts into a high-value personal knowledge base.",
    "",
    "OUTPUT FORMAT:",
    "Return ONLY a valid, compact JSON object. No markdown, no code fences, no preamble.",
    "{",
    "  \"summary\": \"string\",",
    "  \"category\": \"string\",",
    "  \"tags\": [\"string\"]",
    "}",
    "",
    "SUMMARY GUIDELINES (3-6 sentences):",
    "1. THE CONTEXT: Identify exactly what this is (e.g., \"A technical deep-dive video into...\", \"A tutorial on...\").",
    "2. THE CORE INSIGHT: Extract the primary 'nugget' of wisdom or the main argument. For videos, prioritize the unique value shared in the content.",
    "3. THE EVIDENCE/TRADEOFFS: Mention a specific example, statistic, or tradeoff discussed in the content/transcript.",
    "4. THE UTILITY: Explicitly state who this is for or how a builder/researcher can apply this information today.",
    "",
    "MEDIA CONTEXT:",
    "For X bookmarks, use the 'Media Description' to infer content if text is sparse.",
    "For YouTube videos, the provided transcript or description is your primary source. Synthesize the speaker's main points.",
    "",
    "CATEGORIZATION:",
    "Choose the most specific label: AI, Tech, Business, Design, Science, Finance, Health, Career, Productivity, News, Culture, Politics, Education, Entertainment, Music, Shopping, or Other.",
    "- Use 'AI' for LLMs, Machine Learning, or Automation.",
    "- Use 'Productivity' for workflows, mental frameworks, or life-hacks.",
    "- Use 'Design' for UI/UX, Architecture, or Aesthetics.",
    "",
    "TAGGING:",
    "Provide 3-5 high-signal, searchable keywords. Prefer specific entities (e.g., \"Next.js\", \"Stable Diffusion\") over generic ones (e.g., \"software\", \"images\").",
    "",
    "CONTEXTUAL INTELLIGENCE:",
    "- If a YouTube transcript or video description is provided, ignore standard intro/outros and 'like/subscribe' calls. Focus entirely on the information density.",
    "- Use the 'Folder' or 'Playlist' name to infer the user's intent for saving this item.",
    "- If the content is genuinely sparse, return an empty summary string and 'Other' category.",
    "",
    "TRANSLATION:",
    "If the source text or transcript is not in English, you MUST translate the core insights and summary into fluent, professional English. The final JSON values for summary, category, and tags MUST always be in English.",
    "",
    "REASONING MODEL INSTRUCTION:",
    "If you are a reasoning model, keep your internal thought process concise and focused entirely on extracting the JSON fields requested above.",
  ].join("\n"),

  TRANSLATION: (targetLanguage: string) => [
    `You are a professional translator. Translate the following text into ${targetLanguage}.`,
    "Maintain the original tone, formatting, and intent.",
    "If the text is already in the target language, return it exactly as is.",
    "Return ONLY the translated text. No preamble, no explanation, no code fences.",
  ].join("\n"),
};

// --- Core API Logic ---

export const llmConnectionSchema = z.object({
  model: z.string().trim().min(1),
  baseUrl: z.string().url(),
  maxTokens: z.number().int().positive(),
  contextWindow: z.number().int().positive(),
  responseLimit: z.number().int().nonnegative(),
  logLlmPayloads: z.boolean(),
  customPrompt: z.string().nullable(),
  systemPrompt: z.string(),
  thinking: z.boolean(),
});
export type LlmConnection = z.infer<typeof llmConnectionSchema>;

/** Effective settings are frozen per job. Authentication is resolved privately when executing. */
export async function captureLlmConnection(): Promise<LlmConnection> {
  const env = envSchema.parse({
    OPENAI_BASE_URL: cleanEnv(process.env.OPENAI_BASE_URL),
    OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: cleanEnv(process.env.OPENAI_MODEL),
  });
  const settings = await getSettings();
  const model = settings.llmModel ?? env.OPENAI_MODEL;
  if (!model) throw new Error("Missing LLM model. Set it in Settings or .env.local.");
  return llmConnectionSchema.parse({
    model,
    baseUrl: settings.llmBaseUrl ?? env.OPENAI_BASE_URL ?? "http://localhost:1234/v1",
    maxTokens: settings.llmMaxTokens ?? 2500,
    contextWindow: settings.llmContextWindow ?? 128000,
    responseLimit: settings.llmResponseLimit ?? 2000,
    logLlmPayloads: settings.logLlmPayloads ?? true,
    customPrompt: settings.llmPrompt ?? null,
    systemPrompt: applyThinkingPreference(settings.llmSystemPrompt ?? DEFAULT_SYSTEM_PROMPT, settings.llmThinkingEnabled),
    thinking: settings.llmThinkingEnabled ?? false,
  });
}

async function getLlmConfig(connection?: LlmConnection) {
  const snapshot = connection ? llmConnectionSchema.parse(connection) : await captureLlmConnection();
  const settings = await getSettings();
  const apiKey = settings.llmApiKey ?? cleanEnv(process.env.OPENAI_API_KEY) ?? "lm-studio";
  const client = new OpenAI({ apiKey, baseURL: snapshot.baseUrl, timeout: 300000, maxRetries: 0 });
  return { ...snapshot, client };
}

/** Separate OpenAI-compatible client for embeddings (often a different host/model than chat). */
export type EmbeddingConnection = { model: string; endpoint: string; apiKey?: string };

async function getEmbeddingConfig(connection?: EmbeddingConnection) {
  const env = envSchema.parse({
    OPENAI_BASE_URL: cleanEnv(process.env.OPENAI_BASE_URL),
    OPENAI_API_KEY: cleanEnv(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: cleanEnv(process.env.OPENAI_MODEL),
  });
  const settings = await getSettings();
  const chatBaseUrl = settings.llmBaseUrl ?? env.OPENAI_BASE_URL ?? "http://localhost:1234/v1";
  const baseUrl =
    cleanEnv(settings.llmEmbeddingBaseUrl ?? undefined) ??
    chatBaseUrl;
  const apiKey = settings.llmApiKey ?? env.OPENAI_API_KEY ?? "lm-studio";
  // Prefer dedicated embedding model; never fall back to a chat model id (usually unsupported).
  const model =
    cleanEnv(settings.llmEmbeddingModel ?? undefined) ??
    cleanEnv(process.env.OPENAI_EMBEDDING_MODEL) ??
    "text-embedding-3-small";

  const effective = connection ?? { model, endpoint: baseUrl, apiKey };
  const client = new OpenAI({
    apiKey: effective.apiKey ?? apiKey,
    baseURL: effective.endpoint,
    timeout: 60000,
    maxRetries: 0,
  });
  return { client, model: effective.model, baseUrl: normalizeEmbeddingEndpoint(effective.endpoint) };
}

export async function validateModelAvailability(signal?: AbortSignal) {
  return validateLlmConnection(signal);
}

export async function validateLlmConnection(signal?: AbortSignal, connection?: LlmConnection) {
  const config = await getLlmConfig(connection);
  try {
    const models = await config.client.models.list({ signal });
    const isLoaded = models.data.some((m) => m.id === config.model);
    if (!isLoaded) {
      throw new Error(`Model error: Model "${config.model}" is not currently available at ${config.baseUrl}. Please check your model server.`);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No models loaded")) {
      throw new Error("Model error: No models are currently loaded on the server. Please load a model before starting.");
    }
    throw error;
  }
}

async function callLlm(params: {
  prompt: string;
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
  processing?: { runId?: string | null; bookmarkId?: string | null };
  type?: string;
  connection?: LlmConnection;
}) {
  const { prompt, temperature, maxTokens, signal, processing, type = "enrichment" } = params;
  const config = await getLlmConfig(params.connection);

  await logProcessingEvent({
    runId: processing?.runId,
    bookmarkId: processing?.bookmarkId,
    type: "llm",
    status: "sent_to_llm",
    message: `Sent request to LLM for ${type}.`,
    metadata: { model: config.model, baseUrl: config.baseUrl },
  });

  const startedAt = Date.now();
  let content = "";
  try {
    const finalMaxTokens = maxTokens ?? (config.responseLimit > 0 ? config.responseLimit : undefined);

    const completion = await config.client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature,
      max_tokens: finalMaxTokens,
    }, { signal });

    content = completion.choices[0]?.message?.content ?? "";
    if (!content || !content.trim()) {
      throw new InvalidEnrichmentResponseError(`LLM returned an empty response for ${type}.`);
    }

    return { 
      content, 
      usage: completion.usage, 
      durationMs: Date.now() - startedAt, 
      config,
      prompt
    };
  } catch (error) {
    let message = error instanceof Error ? error.message : "Unknown LLM error";
    if (message.includes("No models loaded")) {
      message = "Model error: No models are currently loaded on the server. Please load your model first.";
    }
    await logLlmRequest({
      runId: processing?.runId,
      bookmarkId: processing?.bookmarkId,
      model: config.model,
      baseUrl: config.baseUrl,
      prompt,
      response: content,
      durationMs: Date.now() - startedAt,
      error: message,
      includePayloads: config.logLlmPayloads,
    });
    if (error instanceof InvalidEnrichmentResponseError) throw error;
    throw new Error(message);
  }
}

// --- Public Functions ---

function extractJson(content: string) {
  if (!content || !content.trim()) {
    throw new Error("Model returned an empty response instead of a JSON object.");
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace === -1) {
    throw new Error(`No starting '{' found in model response. Raw: "${content.slice(0, 100)}..."`);
  }

  if (lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(
      "Model response started a JSON object but never closed it. " +
      "This usually means the 'Limit response length' in Settings is too low for this model's thinking process. " +
      `Raw: "${content.slice(0, 100)}..."`
    );
  }

  const jsonBlock = content.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonBlock);
  } catch (e: any) {
    // If parsing still fails, it might be due to internal malformation
    throw new Error(`JSON structure is invalid: ${e.message}. Attempted to parse: "${jsonBlock.slice(0, 100)}..."`);
  }
}

class InvalidEnrichmentResponseError extends Error {}

export async function summarizeBookmark(input: {
  connection?: LlmConnection;
  embeddingConnection?: EmbeddingConnection;
  text?: string;
  authorUsername?: string;
  externalUrls?: string[];
  sourceText?: string;
  mediaDescription?: string;
  folderName?: string;
  signal?: AbortSignal;
  processing?: {
    runId?: string | null;
    bookmarkId?: string | null;
  };
}) {
  const config = await getLlmConfig(input.connection);

  // Use Context Window to slice input (approx 4 chars per token)
  const maxChars = config.contextWindow * 4;
  const textChars = Math.floor(maxChars * 0.4);
  const sourceChars = Math.floor(maxChars * 0.6);

  const promptBody = [
    `Text: ${(input.text ?? "").slice(0, textChars)}`,
    `Folder/Playlist: ${input.folderName ?? ""}`,
    `Author: ${input.authorUsername ?? ""}`,
    `Links: ${(input.externalUrls ?? []).join(", ")}`,
    `Media Description: ${input.mediaDescription ?? ""}`,
    `Linked content (excerpts): ${(input.sourceText ?? "").slice(0, sourceChars)}`,
  ].join("\n");

  const prompt = `${config.customPrompt ?? PROMPTS.DEFAULT_ENRICHMENT}\n\n${promptBody}`;

  const maxAttempts = 3;
  let attempt = 0;
  let lastError: any = null;
  let currentMaxTokens: number | undefined = undefined;
  let currentTemperature = 0.2;

  while (attempt < maxAttempts) {
    input.signal?.throwIfAborted();
    attempt++;
    try {
      if (input.signal?.aborted) {
        throw new Error("Operation aborted");
      }

      if (attempt > 1) {
        await logProcessingEvent({
          runId: input.processing?.runId,
          bookmarkId: input.processing?.bookmarkId,
          type: "system",
          status: "retrying",
          message: `Retrying enrichment (Attempt ${attempt}/${maxAttempts}) due to error: ${lastError?.message || "unknown error"}`,
        });
      }

      const result = await callLlm({
        prompt,
        temperature: currentTemperature,
        maxTokens: currentMaxTokens,
        signal: input.signal,
        processing: input.processing,
        type: "enrichment",
        connection: input.connection,
      });

      let parsed: any;
      try {
        parsed = extractJson(result.content);
      } catch (e: any) {
        throw new InvalidEnrichmentResponseError(`Failed to parse LLM response: ${e.message}. Raw: "${result.content.slice(0, 150)}..."`);
      }

      let enrichment: Enrichment;
      try { enrichment = normalizeEnrichment(parsed, input); }
      catch (error) { throw new InvalidEnrichmentResponseError(error instanceof Error ? error.message : "Invalid enrichment JSON fields"); }
      const generated = await generateEmbeddingResult(
        `${enrichment.summary}\n${enrichment.category}\n${(enrichment.tags || []).join(", ")}`,
        input.signal,
        input.embeddingConnection
      ).catch(() => undefined);
      enrichment.embedding = generated?.vector;
      enrichment.embeddingIdentity = generated?.identity;

      await logLlmRequest({
        runId: input.processing?.runId,
        bookmarkId: input.processing?.bookmarkId,
        model: result.config.model,
        baseUrl: result.config.baseUrl,
        prompt: result.prompt,
        response: result.content,
        parsed: enrichment,
        durationMs: result.durationMs,
        tokenUsage: result.usage,
        includePayloads: result.config.logLlmPayloads,
      });

      return enrichment;
    } catch (error: any) {
      lastError = error;

      // The durable worker owns transport retries. Only malformed model output
      // retries locally; cancellation and configuration errors return immediately.
      if (input.signal?.aborted || !(error instanceof InvalidEnrichmentResponseError)) throw error;
      currentTemperature = 0.1;
      currentMaxTokens = config.responseLimit > 0 ? Math.min(config.responseLimit, config.maxTokens) : config.maxTokens;

      if (attempt < maxAttempts) {
        const delay = attempt * 1500;
        await waitForRetry(delay, undefined, { signal: input.signal });
      }
    }
  }

  throw lastError || new Error("Failed to summarize bookmark after all attempts");
}

export async function translateText(input: {
  text: string;
  targetLanguage: string;
  signal?: AbortSignal;
  processing?: {
    runId?: string | null;
    bookmarkId?: string | null;
  };
}) {
  const prompt = `${PROMPTS.TRANSLATION(input.targetLanguage)}\n\nTEXT TO TRANSLATE:\n${input.text}`;

  const result = await callLlm({
    prompt,
    temperature: 0.1,
    signal: input.signal,
    processing: input.processing,
    type: "translation"
  });

  const translatedText = result.content.trim();

  await logLlmRequest({
    runId: input.processing?.runId,
    bookmarkId: input.processing?.bookmarkId,
    model: result.config.model,
    baseUrl: result.config.baseUrl,
    prompt: result.prompt,
    response: result.content,
    parsed: { translatedText },
    durationMs: result.durationMs,
    tokenUsage: result.usage,
    includePayloads: result.config.logLlmPayloads,
  });

  return translatedText;
}

export type LibraryAskCandidate = {
  id: string;
  source: string;
  tweetUrl: string;
  summary: string | null;
  text: string | null;
  category: string | null;
  authorUsername: string | null;
  similarity?: number;
  sourceEvidence?: TranscriptSection[];
  captureStatus?: TranscriptCapture["status"];
  captureReason?: string | null;
};

export type LibraryAskResult = {
  answer: string;
  citations: { id: string; reason: string }[];
};

/** Natural-language Q&A over retrieved library candidates (chat find path). */
export async function answerLibraryQuestion(input: {
  question: string;
  candidates: LibraryAskCandidate[];
  signal?: AbortSignal;
}): Promise<LibraryAskResult> {
  const catalog = input.candidates
    .map((c, i) => {
      const body = (c.summary || c.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
      return [
        `[${i + 1}] id=${c.id}`,
        `source=${c.source}`,
        c.authorUsername ? `author=${c.authorUsername}` : null,
        c.category ? `category=${c.category}` : null,
        c.tweetUrl ? `url=${c.tweetUrl}` : null,
        `content=${body || "(empty)"}`,
        c.captureStatus ? `transcript_capture=${c.captureStatus}${c.captureReason ? ` (${c.captureReason})` : ""}` : null,
        c.sourceEvidence?.length ? `selected_source_excerpts=\n${c.sourceEvidence.map(formatEvidenceSection).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");

  const prompt = [
    "You are a librarian for a personal bookmark library (X posts + YouTube saves).",
    "Answer the user's question using ONLY the candidate bookmarks below.",
    "If nothing relevant is present, say so clearly and suggest a better query.",
    "Prefer concise, practical answers. Cite bookmarks by id in citations.",
    "Source excerpts are evidence; bookmark summaries are generated previews. Prefer the excerpts for factual claims.",
    "Transcript excerpts are selected passages, not the whole video. Respect missing or partial capture and never claim uncaptured details are known.",
    "",
    "Return ONLY valid JSON (no markdown fences):",
    '{ "answer": "string", "citations": [ { "id": "bookmark-id", "reason": "why this item helps" } ] }',
    "Include at most 8 citations. Use only ids from the list.",
    "",
    `QUESTION:\n${input.question}`,
    "",
    `CANDIDATES:\n${catalog || "(none)"}`,
  ].join("\n");

  const result = await callLlm({
    prompt,
    temperature: 0.2,
    signal: input.signal,
    type: "library_ask",
  });

  let parsed: LibraryAskResult = { answer: result.content.trim(), citations: [] };
  try {
    const raw = extractJson(result.content) as {
      answer?: string;
      citations?: { id?: string; reason?: string }[];
    };
    const allowed = new Set(input.candidates.map((c) => c.id));
    parsed = {
      answer: (raw.answer ?? result.content).trim(),
      citations: Array.isArray(raw.citations)
        ? raw.citations
            .filter((c) => c?.id && allowed.has(c.id))
            .map((c) => ({ id: c.id!, reason: (c.reason ?? "").trim() || "Relevant match" }))
            .slice(0, 8)
        : [],
    };
  } catch {
    // Fall back to prose answer if the model ignored JSON.
  }

  await logLlmRequest({
    model: result.config.model,
    baseUrl: result.config.baseUrl,
    prompt: result.prompt,
    response: result.content,
    parsed,
    durationMs: result.durationMs,
    tokenUsage: result.usage,
    includePayloads: result.config.logLlmPayloads,
  });

  return parsed;
}

export async function getEffectiveEmbeddingIdentity() {
  const { model, baseUrl } = await getEmbeddingConfig();
  return { model, endpoint: baseUrl };
}

export async function generateEmbedding(text: string, signal?: AbortSignal) {
  return (await generateEmbeddingResult(text, signal)).vector;
}

export async function generateEmbeddingResult(text: string, signal?: AbortSignal, connection?: EmbeddingConnection): Promise<GeneratedEmbedding> {
  const config = await getEmbeddingConfig(connection);
  try {
    const response = await config.client.embeddings.create({
      model: config.model,
      input: text.slice(0, 8000),
    }, { signal, timeout: 15000 }); // 15s timeout for embeddings
    const embedding = response.data?.[0]?.embedding;
    if (!embedding?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    validateEmbeddingVector(embedding);
    return { vector: embedding, identity: { model: config.model, endpoint: config.baseUrl, dimensions: embedding.length } };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (status === 404 || /404/.test(rawMessage)) {
      throw new Error(
        `Embeddings endpoint not found at ${config.baseUrl} (model "${config.model}"). ` +
          `Set Settings → Embedding base URL to an OpenAI-compatible embeddings server ` +
          `(e.g. Ollama at http://127.0.0.1:11434/v1) and Embedding model (e.g. nomic-embed-text).`
      );
    }
    throw new Error(
      `Embedding failed via ${config.baseUrl} model "${config.model}": ${rawMessage}`
    );
  }
}

// --- Internal Helpers ---

function normalizeEnrichment(parsed: any, input: any): Enrichment {
  const raw = rawResponseSchema.parse(parsed);
  const summary = (raw.summary ?? "").trim();
  const context = `${input.folderName ?? ""}\n${input.text ?? ""}\n${input.sourceText ?? ""}`.toLowerCase();
  
  let category = (raw.category ?? "").trim();
  if (!category || /^other$/i.test(category)) {
    if (/\b(shop|shopping|buy|purchase|deal|discount|coupon|sale|amazon|ebay|store|product review|unboxing)\b/.test(context)) {
      category = "Shopping";
    } else if (/\b(music|song|songs|album|playlist|choir|piano|guitar|dj|mix|soundtrack|uplifting)\b/.test(context)) {
      category = "Music";
    } else {
      category = "Other";
    }
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag: string) => tag.trim()).filter(Boolean)
    : typeof raw.tags === "string"
      ? raw.tags.split(",").map((tag: string) => tag.trim()).filter(Boolean)
      : [];

  return {
    summary,
    category,
    tags: tags.length ? tags : undefined,
  };
}
