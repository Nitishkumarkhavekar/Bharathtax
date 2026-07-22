interface Props {
  username: string | null;
  onSignOut?: () => void;
}

// Slim top bar: brand on the left, signed-in user + sign-out on the right.
// The server URL is intentionally NOT surfaced anywhere — it is baked into
// the build at package time (see electron/build-config.ts) and migrated
// silently on upgrade (see electron/main.ts).  Officers should never need
// to see or think about it.
export default function SettingsBar({ username, onSignOut }: Props) {
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

      {username && (
        <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
          <div className="text-sm text-right">
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
