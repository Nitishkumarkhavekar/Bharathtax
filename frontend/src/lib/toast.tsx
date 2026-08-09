// Global toast notifications, backed by sonner.
// Preserves the imperative singleton API used across the app
// (toast.success / .error / .info / .message — sonner is a superset), so no
// call site changes. Mount <Toaster /> once near the app root (see main.tsx).

import { Toaster as SonnerToaster } from "sonner";

export { toast } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      expand={false}
      gap={8}
      toastOptions={{
        // Match the app's flat, rounded, Inter aesthetic.
        className: "bt-toast",
        style: {
          fontFamily: "inherit",
          borderRadius: "0.75rem",
          fontSize: "13px",
        },
      }}
    />
  );
}
