import { useToastStore } from "../store/toastStore";

const KIND_STYLE = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  error: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  info: "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]",
};

export default function Toasts() {
  const items = useToastStore((s) => s.items);
  const remove = useToastStore((s) => s.remove);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-80 flex-col gap-2 sm:bottom-5 sm:right-5">
      {items.map((toast) => (
        <div
          key={toast.id}
          onClick={() => remove(toast.id)}
          className={`animate-pop pointer-events-auto cursor-pointer rounded-lg border px-4 py-3 text-[13px] font-medium shadow-[var(--shadow)] ${KIND_STYLE[toast.kind]}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}