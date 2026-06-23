"use client";
import { useState } from "react";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.36 1.43c0 1.14-.42 2.1-1.27 2.96-.85.86-1.84 1.32-2.97 1.27a3.2 3.2 0 0 1-.05-.5c0-1.1.45-2.07 1.34-2.93.89-.86 1.86-1.31 2.9-1.36.03.18.05.37.05.56zm3.85 16.27c-.55 1.27-1.22 2.42-2.02 3.45-1.1 1.4-2 2.1-2.7 2.1-.55 0-1.27-.27-2.16-.8-.9-.53-1.74-.8-2.5-.8-.8 0-1.66.27-2.6.8-.95.53-1.7.81-2.27.83-.66.03-1.58-.69-2.74-2.14-1.05-1.3-1.88-2.78-2.5-4.43C.55 14.78.21 13 .21 11.32c0-1.91.41-3.56 1.24-4.93.65-1.1 1.51-1.96 2.6-2.6 1.08-.64 2.25-.97 3.5-.99.62 0 1.42.18 2.39.55.97.37 1.6.55 1.88.55.36 0 .91-.21 1.65-.62.95-.52 1.74-.74 2.4-.65 1.77.14 3.1.86 3.98 2.16-1.6.97-2.39 2.34-2.38 4.1.01 1.38.5 2.53 1.45 3.43.42.43.9.76 1.42 1-.13.36-.27.71-.42 1.05z" />
    </svg>
  );
}

export default function OAuthButtons() {
  const [tooltip, setTooltip] = useState<string | null>(null);

  const handleClick = (provider: string) => {
    setTooltip(provider);
    setTimeout(() => setTooltip(null), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-700" />
        <span className="text-xs text-gray-500">OR</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => handleClick("google")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800/50 text-sm text-gray-300 opacity-60 cursor-not-allowed hover:opacity-80 transition-opacity"
          >
            <GoogleIcon /> Google
          </button>
          {tooltip === "google" && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-gray-300 whitespace-nowrap">
              Coming soon
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => handleClick("apple")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800/50 text-sm text-gray-300 opacity-60 cursor-not-allowed hover:opacity-80 transition-opacity"
          >
            <AppleIcon /> Apple
          </button>
          {tooltip === "apple" && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-gray-300 whitespace-nowrap">
              Coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
