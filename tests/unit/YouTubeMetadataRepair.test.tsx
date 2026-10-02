import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import YouTubeMetadataRepair from "@/app/components/YouTubeMetadataRepair";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("saved YouTube metadata repair controls", () => {
  it("defaults to raw-only repair and explicitly continues from the last committed cursor", async () => {
    const fetchFixture = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, status: "paused", reason: "item_limit", afterId: "yt:first", scanned: 50, updated: 3, requests: 0 }))
      .mockResolvedValueOnce(Response.json({ ok: true, status: "completed", afterId: "yt:last", scanned: 4, updated: 1, requests: 0 }));
    vi.stubGlobal("fetch", fetchFixture);
    render(<YouTubeMetadataRepair />);
    fireEvent.click(screen.getByRole("button", { name: "Repair saved metadata" }));
    await screen.findByText("Resume cursor: yt:first");
    expect(JSON.parse(fetchFixture.mock.calls[0][1].body)).toMatchObject({ afterId: null, maxRequests: 0, maxItems: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Continue metadata repair" }));
    await screen.findByText("Metadata repair completed.");
    expect(JSON.parse(fetchFixture.mock.calls[1][1].body)).toMatchObject({ afterId: "yt:first", maxRequests: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Continue metadata repair" })).not.toBeInTheDocument();
  });
  it("retains authoritative refresh intent on Continue and displays retry errors", async () => {
    const fetchFixture = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, status: "paused", reason: "quota", afterId: "yt:cursor", scanned: 1, updated: 1, requests: 1 }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "Another operation owns the library." }, { status: 409 }));
    vi.stubGlobal("fetch", fetchFixture);
    render(<YouTubeMetadataRepair />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh metadata from YouTube" }));
    await screen.findByText("YouTube quota was reached. Continue after quota resets.");
    fireEvent.click(screen.getByRole("button", { name: "Continue metadata repair" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Another operation owns the library.");
    expect(JSON.parse(fetchFixture.mock.calls[1][1].body)).toMatchObject({ afterId: "yt:cursor", maxRequests: 1, refresh: "all" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue metadata repair" })).toBeEnabled());
  });
});
