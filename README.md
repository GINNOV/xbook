# XBook Console

![XBook Console Banner](public/splash.jpg)

**XBook Console** is a personal, private knowledge base and triage console that aggregates your saved links, bookmarks, and learning assets from platforms like **X (Twitter)** and **YouTube** into a single, fully searchable local database. 

It offloads your memory by automatically enriching bookmarks with AI-generated summaries, semantic tags, categorizations, and vector embeddings—allowing you to perform conceptual semantic searches over everything you've saved.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history and unreleased work.

## Workflow
My need is the same as many others that scan the web for knowledge but want a local, private, and searchable solution for follow ups and further exploration. A common workflow I have developed is to: add to my bookmarks, run XBook Console to import and enrich what I bookmarked, when I need something on a subject I know I've bookmarked, I can ask Hermes to use the XBook apis to generate content in Obsidian.

---

## What XBook Console Does

* **Unified Inbox:** Pulls X posts and YouTube playlists dynamically into a single inbox.
* **Local AI Enrichment:** Processes bookmarks using local LLMs (via Ollama, LM Studio, etc.) or remote APIs to extract concise summaries, categorize content, and apply relevant tags.
* **Semantic Vector Search:** Ranks compatible vectors within the selected source and filters. Keyword substring, whole-word, and phrase modes remain available when embeddings are unavailable.
* **Privacy & Local Ownership:** Bookmarks, credentials, and the SQLite database stay on this machine. XBook does not run its own tracking service. If Settings points chat or embeddings at a remote or LAN endpoint, the text sent for enrichment, semantic search, or Ask is transmitted to that endpoint. Downloads omit stored credentials unless you explicitly include them. Local backups and technical logs can still contain secrets.

---

## Dual Experience Setup

Depending on your comfort level, you can run and interact with XBook Console in two ways:

### 1. The Default Experience (Native Desktop App)
Designed for everyday usage without touching a terminal.
* **Single-Click Execution:** Download the latest build from the [GitHub Releases](https://github.com/GINNOV/xbook/releases) page and launch the native desktop application (`xbook.app`).
* **Self-Configuring Backend:** The app automatically launches its own local SQLite database, sets up folders, runs schema migrations, and orchestrates backend processes in the background.
* **Default Browser Integration:** Dynamic OAuth authentication for X and Google launches securely in your default web browser (leveraging your active sessions) and feeds credentials back to the local database automatically.
* **Secure Auto-Updates:** The app cryptographically verifies and installs verified releases behind the scenes.

### 2. The Developer Experience (CLI Setup)
Designed for compiling, extending, testing, or building custom configurations.
* **Next.js & Rust Pipeline:** Access the raw Next.js web application, inspect database Prisma schemas, run the Vitest and Playwright test suites, or compile Tauri desktop packages yourself.
* **Environment Configuration:** Override configuration settings directly via terminal env variables or development consoles.
* **Full Developer Setup:** See the [Developer Guide](developer.md) to get started with terminal setup.

## Daily controls

Choose X or YouTube on the Dashboard. **Process inbox** submits one server-owned import, summarize, and index run that continues after navigation. **Processing** shows cumulative results and saved recovery actions. Stop and Resume act on the same run. Monthly caps count new local entries; provider request quota is separate.

**Folders** separates Sync names, Import, Summarize, and Index. Folder names and local counts open that exact library scope. Playlist entry counts differ from unique videos because a video can appear in several playlists. Imports preserve IDs, membership, read dates, and manual summaries.

**Settings** distinguishes configured, tested, expired, disconnected, and unavailable states. Chat and embedding tests use the displayed draft separately. Tabs preserve edits; failed saves keep the draft and show a retryable error. Save before starting an operation.

**Library** exposes captured source separately from generated digests, including completeness, provenance, and video timestamps when available. Ask uses saved evidence and returns citations or insufficient evidence. Summaries default to English unless a custom prompt overrides that instruction; Target language controls on-demand translation.

Technical logs retain prompt and response previews even when full payload logging is off. Downloads omit stored credentials by default, but private source text and technical logs can remain. Full local backups include credentials. See the seven guides linked from **Docs** for setup, connections, models, inbox processing, library reference, Settings, and Agent API.
