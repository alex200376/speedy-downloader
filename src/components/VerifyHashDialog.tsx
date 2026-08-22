import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { verifyHash } from "../api";
import { useToastStore } from "../store/toastStore";
import { XIcon, ShieldIcon, CheckIcon, AlertIcon, CopyIcon } from "./icons";

interface Props {
  open: boolean;
  taskId: string;
  filename: string;
  onClose: () => void;
}

const ALGORITHMS = [
  { key: "sha256", label: "SHA-256" },
  { key: "md5", label: "MD5" },
] as const;

export default function VerifyHashDialog({ open, taskId, filename, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.push);
  const [algorithm, setAlgorithm] = useState("sha256");
  const [expectedHash, setExpectedHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    hash: string;
    algorithm: string;
    matched: boolean | null;
  } | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setAlgorithm("sha256");
      setExpectedHash("");
      setResult(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const handleVerify = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await verifyHash(taskId, algorithm, expectedHash.trim() || undefined);
      if (!r) {
        toast("error", t("toast.error"));
        return;
      }
      setResult(r);
      if (r.matched === true) {
        toast("success", `${t("task.hashMatched")}: ${r.hash.slice(0, 16)}…`);
      } else if (r.matched === false) {
        toast("error", `${t("task.hashMismatch")}: ${r.hash.slice(0, 16)}…`);
      } else {
        toast("info", `${t("task.hash")}: ${r.hash.slice(0, 16)}…`);
      }
    } catch {
      toast("error", t("toast.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyHash = () => {
    if (result?.hash) {
      navigator.clipboard.writeText(result.hash);
      toast("success", t("toast.copied") || "Copied");
    }
  };

  const input =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-2 sm:mx-0 w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            <ShieldIcon width={18} height={18} className="text-[var(--accent)]" />
            {t("action.verify")}
          </h3>
          <button onClick={onClose} className="icon-btn">
            <XIcon width={16} height={16} />
          </button>
        </div>

        {/* Filename */}
        <div className="mb-4 truncate rounded-lg bg-[var(--bg-2)] px-3 py-2 text-[12.5px] text-[var(--text)]">
          {filename}
        </div>

        {/* Algorithm selector */}
        <div className="mb-3">
          <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
            {t("verify.algorithm")}
          </label>
          <div className="flex gap-2">
            {ALGORITHMS.map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  setAlgorithm(a.key);
                  setResult(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition ${
                  algorithm === a.key
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text-2)]/40"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Manual hash input */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
            {t("verify.expectedHash")}{" "}
            <span className="font-normal text-[var(--muted)]">({t("verify.optional")})</span>
          </label>
          <input
            type="text"
            value={expectedHash}
            onChange={(e) => {
              setExpectedHash(e.target.value);
              setResult(null);
            }}
            placeholder={algorithm === "sha256" ? "Paste expected SHA-256 hash here…" : "Paste expected MD5 hash here…"}
            className={input}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Result */}
        {result && (
          <div
            className={`mb-4 rounded-xl border p-4 ${
              result.matched === true
                ? "border-emerald-500/30 bg-emerald-500/10"
                : result.matched === false
                ? "border-rose-500/30 bg-rose-500/10"
                : "border-[var(--border)] bg-[var(--bg-2)]"
            }`}
          >
            {/* Status badge */}
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              {result.matched === true ? (
                <>
                  <CheckIcon width={18} height={18} className="text-emerald-400" />
                  <span className="text-emerald-400">{t("task.hashMatched")}</span>
                </>
              ) : result.matched === false ? (
                <>
                  <AlertIcon width={18} height={18} className="text-rose-400" />
                  <span className="text-rose-400">{t("task.hashMismatch")}</span>
                </>
              ) : (
                <span className="text-[var(--text-2)]">{t("task.hash")}</span>
              )}
              <span className="ml-auto rounded bg-[var(--bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                {result.algorithm.toUpperCase()}
              </span>
            </div>

            {/* Hash value - full width, word-wrapped */}
            <div className="group relative">
              <div className="break-all rounded-lg bg-[var(--bg)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text)]">
                {result.hash}
              </div>
              <button
                onClick={handleCopyHash}
                className="absolute right-2 top-2 rounded-md bg-[var(--panel)] p-1.5 text-[var(--muted)] opacity-0 transition hover:bg-[var(--panel-2)] hover:text-[var(--text)] group-hover:opacity-100"
                title="Copy hash"
              >
                <CopyIcon width={14} height={14} />
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && !result && (
          <div className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-6 text-[13px] text-[var(--muted)]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            {t("verify.computing") || "Computing hash…"}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2.5">
          <button onClick={onClose} className="btn btn-outline">
            {t("action.close")}
          </button>
          <button onClick={handleVerify} disabled={loading} className="btn btn-primary">
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <ShieldIcon width={15} height={15} />
            )}
            {loading ? "" : t("action.verify")}
          </button>
        </div>
      </div>
    </div>
  );
}
