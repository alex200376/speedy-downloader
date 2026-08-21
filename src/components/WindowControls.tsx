import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls() {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex shrink-0 items-center justify-end gap-0 h-8 select-none"
    >
      <button
        onClick={() => win.minimize()}
        className="flex items-center justify-center w-11 h-8 text-[var(--text-2)] hover:bg-white/10 transition-colors"
        title="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="5.5" width="10" height="1" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        onClick={() => win.toggleMaximize()}
        className="flex items-center justify-center w-11 h-8 text-[var(--text-2)] hover:bg-white/10 transition-colors"
        title="Maximize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="1.5"
            y="1.5"
            width="9"
            height="9"
            rx="1"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        onClick={() => win.close()}
        className="flex items-center justify-center w-11 h-8 text-[var(--text-2)] hover:bg-rose-500 hover:text-white transition-colors rounded-tr-lg"
        title="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
