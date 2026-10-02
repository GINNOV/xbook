"use client";

import { z } from "zod";
import { useState, useEffect, useRef } from "react";
import { useSettingsContext } from "./useSettingsContext";
import { connectionFingerprint } from "../../lib/settings-draft";

export function useLLMSettings() {
  const { form, setForm, setMessage, defaultPrompt, connectionTests, testConnection } = useSettingsContext();
  
  const [llmTest, setLlmTest] = useState<string | null>(null);
  const chat = connectionTests.llm?.fingerprint === connectionFingerprint("llm", form) ? connectionTests.llm : undefined;
  const embedding = connectionTests.embedding?.fingerprint === connectionFingerprint("embedding", form) ? connectionTests.embedding : undefined;
  const [clearingLogs, setClearingLogs] = useState(false);
  const [modelHistory, setModelHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem("xbook:llm-model-history");
    if (raw) {
      try {
        const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
        if (parsed.success) setModelHistory(parsed.data);
      } catch (e) {
        console.error("Failed to parse model history", e);
      }
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const testLlm = () => testConnection("llm");
  const testEmbedding = () => testConnection("embedding");

  const applyLlmPreset = (preset: "lmstudio" | "vllm" | "ollama" | "remote") => {
    if (preset === "ollama") {
      setForm((prev) => ({
        ...prev,
        llmBaseUrl: "http://127.0.0.1:11434/v1",
        llmApiKey: "ollama",
        llmConcurrency: 1,
        llmEmbeddingBaseUrl: "http://127.0.0.1:11434/v1",
        llmEmbeddingModel: prev.llmEmbeddingModel || "nomic-embed-text",
      }));
      return;
    }

    if (preset === "lmstudio") {
      setForm((prev) => ({
        ...prev,
        llmBaseUrl: "http://127.0.0.1:1234/v1",
        llmApiKey: "lm-studio",
        llmConcurrency: 1,
      }));
      return;
    }

    if (preset === "vllm") {
      setForm((prev) => ({
        ...prev,
        llmBaseUrl: "http://127.0.0.1:8000/v1",
        llmApiKey: "EMPTY",
        llmConcurrency: 4,
        // vLLM chat servers often lack /v1/embeddings — default embeddings to local Ollama.
        llmEmbeddingBaseUrl: prev.llmEmbeddingBaseUrl || "http://127.0.0.1:11434/v1",
        llmEmbeddingModel: prev.llmEmbeddingModel || "nomic-embed-text",
      }));
      return;
    }

    // High-concurrency LAN/remote OpenAI-compatible vLLM (edit host/model as needed).
    setForm((prev) => ({
      ...prev,
      llmBaseUrl: "https://api.example.com/v1",
      llmApiKey: "EMPTY",
      llmModel: "gemma-4-26b",
      llmConcurrency: 32,
      llmContextWindow: 32768,
      llmEmbeddingBaseUrl: prev.llmEmbeddingBaseUrl || "http://127.0.0.1:11434/v1",
      llmEmbeddingModel: prev.llmEmbeddingModel || "nomic-embed-text",
    }));
  };

  const clearProcessingHistory = async () => {
    setClearingLogs(true);
    setMessage(null);
    try {
      const res = await fetch("/api/processing/clear", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Clear failed");
      setMessage("Processing history cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clear failed");
    } finally {
      setClearingLogs(false);
    }
  };

  const resetPrompt = () => {
    setForm((prev) => ({ ...prev, llmPrompt: defaultPrompt }));
  };

  const cleanupStuckJobs = async () => {
    setLlmTest(null);
    try {
      const res = await fetch("/api/processing/runs/cleanup", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Cleanup failed");
      setLlmTest(json.message);
    } catch (error) {
      setLlmTest(error instanceof Error ? error.message : "Cleanup failed");
    }
  };

  const fetchModels = async () => {
    setFetchingModels(true);
    setLlmTest(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: form.llmBaseUrl, apiKey: form.llmApiKey }),
      });
      const json = z.object({ models: z.array(z.string()).optional(), error: z.string().optional() }).parse(await res.json());
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch models");
      const models = json.models ?? [];
      if (models.length > 0) {
        setModelHistory((prev) => Array.from(new Set([...models, ...prev])).slice(0, 10));
        setShowHistory(true);
        setLlmTest(`Found ${models.length} models on server.`);
      }
    } catch (error) {
      setLlmTest(error instanceof Error ? error.message : "Fetch models failed");
    } finally {
      setFetchingModels(false);
    }
  };

  return {
    llmTest: chat?.message ?? null,
    modelMessage: llmTest,
    chatTestState: chat?.status,
    embeddingTestState: embedding?.status,
    testingLlm: chat?.status === "testing",
    clearingLogs,
    modelHistory,
    showHistory,
    setShowHistory,
    historyRef,
    testLlm,
    testEmbedding,
    testingEmbedding: embedding?.status === "testing",
    embeddingTest: embedding?.message ?? null,
    applyLlmPreset,
    clearProcessingHistory,
    resetPrompt,
    fetchModels,
    fetchingModels,
    cleanupStuckJobs,
  };
}
