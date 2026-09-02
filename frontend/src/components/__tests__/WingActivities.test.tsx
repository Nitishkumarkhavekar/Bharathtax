import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const departmentTaxonomy = vi.fn();
vi.mock("@/api", () => ({ api: { departmentTaxonomy: () => departmentTaxonomy() } }));
let mockSession: { workspaceProfile: string | null; workspaceWings?: string[]; designation?: string | null } | null = { workspaceProfile: "officer" };
vi.mock("@/auth", () => ({ useAuth: () => ({ session: mockSession }) }));

import WingActivities from "@/components/WingActivities";

const WINGS = [
  { key: "officer", label: "Assessing Officer", group: "Assessment", standpoint: "", sections: [],
    activities: ["Draft 143(3) orders", "Watch 153 time-barring"], tools: ["/drafting", "/rulings"],
    template_groups: [], calc_tabs: [], deadlines: [] },
  { key: "tds", label: "TDS", group: "TDS", standpoint: "", sections: [],
    activities: ["Process 201 defaults"], tools: ["/drafting"], template_groups: [], calc_tabs: [], deadlines: [] },
];
const DESIGS = [
  { key: "ta", label: "Tax Assistant", tier: "ministerial", cadre: "ministerial",
    activities: ["Generate penalty show-cause notices", "Maintain the registers"], serves: "partial", tools: ["/drafting"] },
  { key: "ito", label: "Income Tax Officer", tier: "field", cadre: "executive" },   // no role desk
];

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = { workspaceProfile: "officer" };
  departmentTaxonomy.mockResolvedValue({ wings: WINGS, designations: DESIGS, tiers: [], approvals: [] });
});

const r = () => render(<MemoryRouter><WingActivities /></MemoryRouter>);

describe("WingActivities", () => {
  it("renders the officer's wing activities + tool links", async () => {
    r();
    expect(await screen.findByText(/Your desk — Assessing Officer/)).toBeInTheDocument();
    expect(screen.getByText("Draft 143(3) orders")).toBeInTheDocument();
    expect(screen.getByText("Watch 153 time-barring")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Drafting/ })).toBeInTheDocument();
  });

  it("picks the first wing for a 'custom' profile", async () => {
    mockSession = { workspaceProfile: "custom", workspaceWings: ["tds", "officer"] };
    r();
    expect(await screen.findByText(/Your desk — TDS/)).toBeInTheDocument();
    expect(screen.getByText("Process 201 defaults")).toBeInTheDocument();
  });

  it("shows a role desk for a ministerial designation, alongside the wing", async () => {
    mockSession = { workspaceProfile: "officer", designation: "ta" };
    r();
    expect(await screen.findByText(/Your role — Tax Assistant/)).toBeInTheDocument();
    expect(screen.getByText("Generate penalty show-cause notices")).toBeInTheDocument();
    // wing desk still present
    expect(screen.getByText(/Your desk — Assessing Officer/)).toBeInTheDocument();
  });

  it("shows no role desk for a field officer (ITO) — wing only", async () => {
    mockSession = { workspaceProfile: "officer", designation: "ito" };
    r();
    expect(await screen.findByText(/Your desk — Assessing Officer/)).toBeInTheDocument();
    expect(screen.queryByText(/Your role —/)).not.toBeInTheDocument();
  });

  it("renders nothing when the profile is 'all'", async () => {
    mockSession = { workspaceProfile: "all" };
    const { container } = r();
    await waitFor(() => expect(departmentTaxonomy).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
