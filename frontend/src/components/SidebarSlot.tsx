import { ReactNode, createContext, useContext, useEffect, useState } from "react";

// Sidebar slot — a page-scoped hook that injects a React node into the
// primary sidebar (Layout.tsx) above the Workspace nav. Used by feature
// pages like Drafting to promote their in-page list (e.g. "Your drafts")
// into the persistent sidebar without hard-coding it in Layout.
//
// Contract:
//   * The provider (SidebarSlotProvider) sits inside Layout and exposes
//     `content` for Layout to render, and `setContent` for pages to call.
//   * useSidebarPanel(node) sets the slot on mount and clears it on
//     unmount, so navigating away from the page reverts to the default
//     sidebar layout.

type Ctx = {
  content: ReactNode | null;
  setContent: (node: ReactNode | null) => void;
};

const SidebarSlotCtx = createContext<Ctx>({ content: null, setContent: () => {} });

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  return (
    <SidebarSlotCtx.Provider value={{ content, setContent }}>
      {children}
    </SidebarSlotCtx.Provider>
  );
}

/** Read the currently-injected sidebar panel. Layout uses this. */
export function useSidebarSlotContent(): ReactNode | null {
  return useContext(SidebarSlotCtx).content;
}

/** Inject a node into the sidebar for the lifetime of the calling component. */
export function useSidebarPanel(node: ReactNode | null): void {
  const { setContent } = useContext(SidebarSlotCtx);
  useEffect(() => {
    setContent(node);
    return () => setContent(null);
  }, [node, setContent]);
}
