"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { Settings } from "../../components/settings/types";

import { connectionDraft, connectionFingerprint, connectionResponseSchema, draftFingerprint, validateSettingsDraft, type ConnectionType, type ConnectionTest } from "../../lib/settings-draft";

type SettingsContextType = {
  applySavedPatch: (patch: Partial<Settings>) => void;
  connectionTests: Partial<Record<ConnectionType, ConnectionTest>>;
  testConnection: (type: ConnectionType) => Promise<void>;
  validationError: string | null;
  messageError: boolean;
  form: Settings;
  setForm: React.Dispatch<React.SetStateAction<Settings>>;
  saving: boolean;
  setSaving: (v: boolean) => void;
  message: string | null;
  setMessage: (v: string | null) => void;
  updateField: (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  updateNumberField: (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => void;
  updateBooleanField: (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => void;
  persistSettings: (newForm?: Settings) => Promise<boolean>;
  defaultPrompt: string;
  isDirty: boolean;
};

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within a SettingsProvider");
  }
  return context;
}

export function SettingsProvider({
  children,
  initial,
  defaultPrompt,
}: {
  children: React.ReactNode;
  initial: Settings;
  defaultPrompt: string;
}) {
  const [form, setForm] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(initial);
  const [connectionTests, setConnectionTests] = useState<Partial<Record<ConnectionType, ConnectionTest>>>({});
  const [messageError, setMessageError] = useState(false);
  const isDirty = draftFingerprint(form) !== draftFingerprint(saved);
  const validationError = validateSettingsDraft(form);
  const current = useRef(form);
  current.current = form;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Refresh saved values without discarding the draft.
  useEffect(() => {
    if (draftFingerprint(current.current) === draftFingerprint(savedRef.current)) setForm(initial);
    setSaved(initial);
  }, [initial]);

  const updateField = useCallback(
    (key: keyof Settings) =>
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [key]: event.target.value }));
      },
    []
  );

  const updateNumberField = useCallback(
    (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [key]: value ? Number(value) : null }));
    },
    []
  );

  const updateBooleanField = useCallback(
    (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: event.target.checked }));
    },
    []
  );

  const persistSettings = async (newForm?: Settings) => {
    const dataToSave = newForm || form;
    const invalid = validateSettingsDraft(dataToSave);
    if (invalid) { setMessage(invalid); setMessageError(true); return false; }
    setSaving(true);
    setMessage(null);
    setMessageError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSave),
      });

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const json = await res.json();
        if (!res.ok) {
          const err = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
          throw new Error(err ?? "Save failed");
        }
      } else {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Save failed with status ${res.status}`);
        }
      }

      setSaved(dataToSave);
      setMessage("Settings saved.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
      setMessageError(true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applySavedPatch = (patch: Partial<Settings>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setSaved((previous) => ({ ...previous, ...patch }));
  };

  const testConnection = async (type: ConnectionType) => {
    const draft = form;
    const fingerprint = connectionFingerprint(type, draft);
    const update = (status: ConnectionTest["status"], text: string, testedAt?: string) => {
      setConnectionTests((previous) => ({ ...previous, [type]: { fingerprint, status, message: text, testedAt } }));
    };
    const invalid = validateSettingsDraft(draft);
    if (invalid) { update("unavailable", invalid); return; }
    if ((type === "llm" && (!draft.llmModel?.trim() || !draft.llmBaseUrl?.trim())) || (type === "embedding" && (!draft.llmEmbeddingModel?.trim() || !(draft.llmEmbeddingBaseUrl?.trim() || draft.llmBaseUrl?.trim())))) {
      update("unavailable", "Enter the displayed model and endpoint before testing."); return;
    }
    update("testing", "Testing displayed values…");
    try {
      const response = await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connectionDraft(type, draft)) });
      const result = connectionResponseSchema.parse(await response.json());
      if (!response.ok || result.ok === false) throw new Error(result.error ?? "Connection test failed.");
      update("tested", result.message ?? "Displayed connection tested successfully.", result.testedAt ?? new Date().toISOString());
    } catch (error) { update("unavailable", error instanceof Error ? error.message : "Connection test failed."); }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ""; } };
    const leave = (event: MouseEvent) => {
      if (!isDirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return;
      if (!window.confirm("Leave Settings and discard unsaved changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", leave, true); };
  }, [isDirty]);

  return (
    <SettingsContext.Provider
      value={{
        form,
        setForm,
        applySavedPatch, connectionTests, testConnection, validationError, messageError,
        saving,
        setSaving,
        message,
        setMessage,
        updateField,
        updateNumberField,
        updateBooleanField,
        persistSettings,
        defaultPrompt,
        isDirty,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
