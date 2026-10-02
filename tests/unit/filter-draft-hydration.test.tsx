import { useLayoutEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterControls } from "@/app/components/bookmarks/FilterControls";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
const props = { categories: [], folders: [], counts: { total: 0, pending: 0, summarized: 0, uncategorized: 0, noFolder: 0, videos: 0 }, q: "nomic", source: "x", category: "", status: "", video: false, semantic: false, folderId: "", sort: "import" as const, dir: "desc" as const };
describe("filter draft lifecycle", () => {
  it("preserves text entered after form commit but before passive mount effects", () => {
    function EarlyInput() {
      useLayoutEffect(() => { fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "nomic embedding" } }); }, []);
      return <FilterControls {...props} />;
    }
    render(<EarlyInput />);
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("nomic embedding");
  });
  it("retains drafts across identical scope renders but resets for actual navigation", () => {
    const view = render(<FilterControls {...props} />);
    fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "draft phrase" } });
    view.rerender(<FilterControls {...props} counts={{ ...props.counts, total: 1 }} />);
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("draft phrase");
    view.rerender(<FilterControls {...props} q="new scope" source="yt" />);
    expect(screen.getByLabelText("Search bookmarks")).toHaveValue("new scope");
  });
});
