import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { onViewportSample, viewportLog, type ViewportSample } from "../lib/viewport";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";

const line = (s: ViewportSample) =>
  [
    `${(s.t / 1000).toFixed(1)}s ${s.event}`,
    `inner ${s.innerWidth}×${s.innerHeight}`,
    `vv ${s.vvWidth}×${s.vvHeight}@${s.vvScale} top${s.vvOffsetTop}`,
    `fixed ${s.fixedWidth}×${s.fixedHeight}`,
    `client ${s.clientWidth}×${s.clientHeight}`,
    `screen ${s.screenWidth}×${s.screenHeight}`,
    `safe ${s.safeArea}`,
    `${s.orientation}${s.standalone ? " app" : " browser"} ${s.visibility}`,
    `→ ${s.applied ?? "ignored"}`,
  ].join(" | ");

/**
 * Temporary "Diagnostica schermo" panel: live viewport measurements and their history, to fix the
 * layout after rotating or folding the installed app on devices that cannot be emulated.
 */
export function ViewportDiagnostics({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState(viewportLog);
  const [copied, setCopied] = useState(false);
  useEffect(() => onViewportSample(() => setLog(viewportLog())), []);

  const text = [`Intake ${new Date().toISOString()}`, navigator.userAgent, ...log.map(line)].join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return createPortal(
    <div className="diag-panel" role="dialog" aria-modal="true" aria-label={t.diagnostics.title}>
      <div className="diag-head">
        <h2>{t.diagnostics.title}</h2>
        <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
          <CloseIcon size={18} strokeWidth={2.5} />
        </button>
      </div>
      <p className="sheet-note">{t.diagnostics.hint}</p>
      <div className="diag-actions">
        <button type="button" className="button-primary-small" onClick={copy}>
          {copied ? t.diagnostics.copied : t.diagnostics.copy}
        </button>
      </div>
      <textarea className="diag-log" readOnly value={text} aria-label={t.diagnostics.title} />
    </div>,
    document.body,
  );
}
