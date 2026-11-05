import { useEffect, useRef, useState } from "react";
import { useDisconnectNutrition, useSignOut, type User } from "../api/queries";
import { t } from "../lib/strings";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";

const THEMES: ThemePreference[] = ["system", "light", "dark"];

interface Props {
  user: User;
  /** "avatar": round button (mobile header); "row": full-width row (sidebar footer). */
  variant: "avatar" | "row";
}

/** Profile button with sign-out and Nutrition disconnect. */
export function ProfileMenu({ user, variant }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const ref = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();
  const disconnect = useDisconnectNutrition();
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const avatar = user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial;

  return (
    <div className="profile" data-variant={variant} ref={ref}>
      <button
        type="button"
        className={variant === "avatar" ? "avatar" : "profile-row"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.profile.label}
        onClick={() => setOpen((v) => !v)}
      >
        {variant === "avatar" ? (
          avatar
        ) : (
          <>
            <span className="avatar avatar-sm" aria-hidden="true">
              {avatar}
            </span>
            <span className="profile-email">{user.email}</span>
          </>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-caption">
            {t.profile.signedInAs}
            <br />
            <strong>{user.email}</strong>
          </p>
          <div className="menu-section">
            <span className="menu-label" id="theme-label">
              {t.profile.theme}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  className="segmented-option"
                  onClick={() => {
                    setTheme(option);
                    setThemePreference(option);
                  }}
                >
                  {t.profile.themeOptions[option]}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              if (window.confirm(t.profile.disconnectConfirm)) disconnect.mutate();
              setOpen(false);
            }}
          >
            {t.profile.disconnectNutrition}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => signOut.mutate()}>
            {t.profile.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
