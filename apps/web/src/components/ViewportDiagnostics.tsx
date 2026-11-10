import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HEIGHT_MODES, getHeightMode, onViewportSample, setHeightMode, viewportLog, type HeightMode, type ViewportSample } from "../lib/viewport";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";

const line = (s: ViewportSample) =>
  [
    `${s.t.toFixed(1)}s ${s.event} [${s.mode}]`,
    `inner ${s.inner}`,
    `vv ${s.visual}`,
    `fixed ${s.fixed}`,
    `dvh ${s.dvh} svh ${s.svh} lvh ${s.lvh}`,
    `client ${s.client}`,
    `safe ${s.safeArea}`,
    `${s.orientation}${s.standalone ? " app" : " browser"}`,
    `→ ${s.applied ?? "css"}`,
  ].join(" | ");

/**
 * Temporary "Diagnostica schermo" panel: viewport readings with their history, a Copy button and
 * the layout height mode of this device, to fix the installed app on a foldable iPhone.
 */
export function ViewportDiagnostics({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState(viewportLog);
  const [mode, setMode] = useState<HeightMode>(getHeightMode);
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
      <span className="menu-label" id="height-mode-label">
        {t.diagnostics.mode}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="height-mode-label">
        {HEIGHT_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className="segmented-option"
            onClick={() => {
              setMode(option);
              setHeightMode(option);
            }}
          >
            {t.diagnostics.modes[option]}
          </button>
        ))}
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
