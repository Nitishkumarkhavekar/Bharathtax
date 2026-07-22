import { useEffect, useState } from "react";
import { getServerUrl, setServerUrl } from "../api";

interface Props {
  username: string | null;
  onSignOut?: () => void;
}

// Slim top bar: brand, current server URL (click to edit), user + sign-out.
export default function SettingsBar({ username, onSignOut }: Props) {
  const [serverUrl, setUrl] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    getServerUrl().then(setUrl);
  }, []);

  const save = async () => {
    const clean = draft.trim().replace(/\/+$/, "");
    if (!clean) return;
    await setServerUrl(clean);
    setUrl(clean);
    setEditing(false);
  };

  return (
    <header className="flex items-center gap-4 px-6 h-14 border-b border-slate-200 bg-white/70 backdrop-blur">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <div className="w-8 h-8 rounded-lg bg-brand-700 grid place-items-center text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18" />
            <path d="M6 8h12" />
            <path d="M4 15l3-7 3 7" />
            <path d="M14 15l3-7 3 7" />
            <path d="M4 20h16" />
          </svg>
        </div>
        <div>
          <div className="leading-tight">BharatTax Appeal Order</div>
          <div className="text-xs text-slate-500 font-normal">CIT(A) / NFAC drafting</div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="text-xs text-slate-500 flex items-center gap-2">
        {editing ? (
          <>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-72"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://api.example.com"
              autoFocus
            />
            <button
              onClick={save}
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="text-slate-400">Server:</span>
            <button
              className="text-slate-700 hover:text-brand-600 underline decoration-dotted"
              onClick={() => {
                setDraft(serverUrl);
                setEditing(true);
              }}
              title="Change the BharatTax server URL"
            >
              {serverUrl || "(not set)"}
            </button>
          </>
        )}
      </div>

      {username && (
        <div className="flex items-center gap-3 pl-4 border-l border-slate-200 ml-2">
          <div className="text-sm">
            <div className="font-medium text-slate-800">{username}</div>
            <div className="text-xs text-slate-500">Signed in</div>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="text-sm text-slate-500 hover:text-red-600"
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </header>
  );
}
