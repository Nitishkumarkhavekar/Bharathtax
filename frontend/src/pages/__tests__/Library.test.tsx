import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const libraryList = vi.fn();
const libraryDelete = vi.fn();
vi.mock("@/api", () => ({
  api: { libraryList: () => libraryList(), libraryDelete: (id: number) => libraryDelete(id) },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// confirm() always resolves true so delete proceeds without a real dialog.
vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: async () => true, dialog: null }),
}));

import Library from "@/pages/Library";

const ITEMS = [
  { id: 1, kind: "answer", title: "What is s.68?", content: "A long answer ".repeat(30), source_url: null, sections: ["68"], ref_id: "ans:1", created_at: "2026-08-20T10:00:00Z" },
  { id: 2, kind: "ruling", title: "ACIT vs Alpha", content: "Held: sustained", source_url: "http://x/2", sections: ["68"], ref_id: "corpus:2", created_at: "2026-08-21T10:00:00Z" },
  { id: 3, kind: "ruling", title: "PCIT vs Beta", content: "Held: quashed", source_url: "http://x/3", sections: ["147"], ref_id: "corpus:3", created_at: "2026-08-22T10:00:00Z" },
];

function renderPage() {
  return render(<MemoryRouter><Library /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  libraryList.mockResolvedValue(ITEMS);
  libraryDelete.mockResolvedValue(undefined);
});

describe("Library page", () => {
  it("lists all saved items by default", async () => {
    renderPage();
    expect(await screen.findByText("What is s.68?")).toBeInTheDocument();
    expect(screen.getByText("ACIT vs Alpha")).toBeInTheDocument();
    expect(screen.getByText("PCIT vs Beta")).toBeInTheDocument();
  });

  it("filters to a single kind when a tab is clicked", async () => {
    renderPage();
    await screen.findByText("What is s.68?");
    await userEvent.click(screen.getByRole("button", { name: /^Answers/ }));
    // the answer stays, the rulings are filtered out
    expect(screen.getByText("What is s.68?")).toBeInTheDocument();
    expect(screen.queryByText("ACIT vs Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("PCIT vs Beta")).not.toBeInTheDocument();
  });

  it("deletes an item and removes it from the list", async () => {
    renderPage();
    await screen.findByText("ACIT vs Alpha");
    const removeButtons = screen.getAllByRole("button", { name: /remove from library/i });
    await userEvent.click(removeButtons[0]); // first row (answer)
    await waitFor(() => expect(libraryDelete).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText("What is s.68?")).not.toBeInTheDocument());
  });

  it("shows an empty state when nothing is saved", async () => {
    libraryList.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nothing saved yet/i)).toBeInTheDocument();
  });
});
