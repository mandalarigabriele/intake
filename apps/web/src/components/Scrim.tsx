import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Dimmed backdrop for sheets, rendered into <body>. Inside the app layout iOS Safari clips fixed
 * elements to the scrolling .shell-main, so the sheet ended up under the sidebar in landscape.
 */
export function Scrim({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="scrim" onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}
