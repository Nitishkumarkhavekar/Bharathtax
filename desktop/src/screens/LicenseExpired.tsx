interface Props {
  reason: string; // "unauthorised" | "quota" | "license" | "network"
  message: string;
  onSignIn: () => void;
}

const TITLES: Record<string, string> = {
  unauthorised: "Session expired",
  quota: "Token quota completed",
  license: "License expired",
  network: "Server unreachable",
};

export default function LicenseExpired({ reason, message, onSignIn }: Props) {
  const title = TITLES[reason] || "Access blocked";
  const isQuota = reason === "quota";
  const isLicense = reason === "license";
  const isFatal = isQuota || isLicense;

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div
          className={`w-14 h-14 rounded-full mx-auto grid place-items-center mb-4 ${
            isFatal ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isFatal ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </>
            ) : (
              <>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </>
            )}
          </svg>
        </div>

        <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
        <p className="text-slate-600 mt-3 leading-relaxed">{message}</p>

        {isQuota && (
          <div className="mt-6 text-xs bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-left text-slate-600">
            <div className="font-semibold text-slate-700 mb-1">What this means</div>
            You have used the AI token allowance included with your license. New
            appeal drafts cannot be generated until additional tokens are
            allocated by your administrator or the license is renewed.
          </div>
        )}

        {isLicense && (
          <div className="mt-6 text-xs bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-left text-slate-600">
            <div className="font-semibold text-slate-700 mb-1">What this means</div>
            Your license key is no longer valid — it has either expired or been
            deactivated by your administrator. Once a new key is issued, sign
            in again and activate it from the license screen.
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={onSignIn}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
          >
            {reason === "network" ? "Retry sign-in" : "Back to sign-in"}
          </button>
        </div>
      </div>
    </div>
  );
}
