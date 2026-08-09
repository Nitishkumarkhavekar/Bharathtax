import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

// Root error boundary: a render throw anywhere below (a malformed API payload,
// a non-null assertion that fires, a lazy-chunk that fails to load) would
// otherwise blank the entire app. This catches it and offers a way back.
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <div className="mx-auto mb-3 size-11 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-[15px] font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-1.5 text-[13px] text-slate-500 leading-snug">
            The page hit an unexpected error. Reloading usually fixes it — your
            work is saved on the server.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium
                       hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RotateCcw className="size-4" /> Reload
          </button>
        </div>
      </div>
    );
  }
}
