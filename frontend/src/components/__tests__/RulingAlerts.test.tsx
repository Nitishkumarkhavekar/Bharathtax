import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API layer. Both "@/api" and the component's "../api" resolve to the
// same module, so mocking the resolved id intercepts either specifier.
const rulingAlerts = vi.fn();
const librarySavedRefs = vi.fn();
const librarySave = vi.fn();
const libraryUnsaveRef = vi.fn();
vi.mock("@/api", () => ({
  api: {
    rulingAlerts: () => rulingAlerts(),
    librarySavedRefs: () => librarySavedRefs(),
    librarySave: (b: unknown) => librarySave(b),
    libraryUnsaveRef: (k: string, r: string) => libraryUnsaveRef(k, r),
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RulingAlerts from "@/components/RulingAlerts";

const DATA = {
  sections: ["68", "147"],
  source: "usage" as const,
  fresh_count: 1,
  items: [
    { id: 1, title: "ACIT vs Alpha", digest: "Held: s.68 addition sustained", source_url: "http://x/1", matched: ["68"], date: "2026-08-01", fresh: true },
    { id: 2, title: "PCIT vs Beta", digest: "s.147 reopening quashed", source_url: "http://x/2", matched: ["147"], date: "2026-07-01", fresh: false },
  ],
};

function renderCard() {
  return render(<MemoryRouter><RulingAlerts /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  rulingAlerts.mockResolvedValue(DATA);
  librarySavedRefs.mockResolvedValue([]); // nothing saved yet
  librarySave.mockResolvedValue({ id: 99 });
  libraryUnsaveRef.mockResolvedValue(undefined);
});

describe("RulingAlerts", () => {
  it("renders matched rulings and flags fresh ones", async () => {
    renderCard();
    expect(await screen.findByText("ACIT vs Alpha")).toBeInTheDocument();
    expect(screen.getByText("PCIT vs Beta")).toBeInTheDocument();
    // header reflects that at least one is fresh
    expect(screen.getByText("New rulings on your topics")).toBeInTheDocument();
    // exactly one NEW badge (the fresh item)
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("saves a ruling to the library with the right payload", async () => {
    renderCard();
    await screen.findByText("ACIT vs Alpha");
    const saveButtons = screen.getAllByRole("button", { name: /save to library/i });
    await userEvent.click(saveButtons[0]);

    await waitFor(() => expect(librarySave).toHaveBeenCalledTimes(1));
    expect(librarySave).toHaveBeenCalledWith(expect.objectContaining({
      kind: "ruling",
      title: "ACIT vs Alpha",
      ref_id: "corpus:1",
      sections: ["68"],
    }));
    // button flips to the saved (remove) affordance
    expect(await screen.findByRole("button", { name: /remove from library/i })).toBeInTheDocument();
  });

  it("un-saves an already-saved ruling", async () => {
    librarySavedRefs.mockResolvedValue(["corpus:1"]); // item 1 already saved
    renderCard();
    await screen.findByText("ACIT vs Alpha");
    const removeBtn = await screen.findByRole("button", { name: /remove from library/i });
    await userEvent.click(removeBtn);
    await waitFor(() => expect(libraryUnsaveRef).toHaveBeenCalledWith("ruling", "corpus:1"));
  });

  it("renders nothing when there are no matching rulings", async () => {
    rulingAlerts.mockResolvedValue({ ...DATA, items: [], fresh_count: 0 });
    const { container } = renderCard();
    // give the effect a tick, then assert empty
    await waitFor(() => expect(rulingAlerts).toHaveBeenCalled());
    expect(container.querySelector("li")).toBeNull();
  });
});
