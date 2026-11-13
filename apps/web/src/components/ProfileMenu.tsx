import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { useDisconnectNutrition, useSignOut, type User } from "../api/queries";
import { t } from "../lib/strings";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
import { RemindersSheet } from "./RemindersSheet";

const THEMES: ThemePreference[] = ["system", "light", "dark"];

interface Props {
  user: User;
  /** "avatar": round button (mobile header); "row": full-width row (sidebar footer). */
  variant: "avatar" | "row";
}

/** Profile button with sign-out and Nutrition disconnect. */
export function ProfileMenu({ user, variant }: Props) {
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const [, navigate] = useLocation();
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
        ref={button}
        onClick={() => {
          // In the sidebar the menu is wider than the column, which scrolls and would clip it:
          // pin it to the viewport above the profile row instead, scrolling if the height is short
          if (variant === "row" && !open && button.current) {
            const rect = button.current.getBoundingClientRect();
            setMenuStyle({ position: "fixed", left: rect.left, right: "auto", top: "auto", bottom: window.innerHeight - rect.top + 8, maxHeight: rect.top - 16, overflowY: "auto" });
          }
          setOpen((v) => !v);
        }}
      >
        {variant === "avatar" ? (
          avatar
        ) : (
          <>
            <span className="avatar avatar-sm" aria-hidden="true">
              {avatar}
            </span>
            <span className="profile-email">{user.name ?? user.email}</span>
          </>
        )}
      </button>
      {open && (
        <div className="menu" role="menu" style={variant === "row" ? menuStyle : undefined}>
          <p className="menu-caption">
            {t.profile.signedInAs}
            <br />
            <strong>{user.name ?? user.email}</strong>
            {user.name && (
              <>
                <br />
                {user.email}
              </>
            )}
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
              setOpen(false);
              navigate("/salute");
            }}
          >
            {t.profile.appleHealth}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setReminders(true);
              setOpen(false);
            }}
          >
            {t.profile.reminders}
          </button>
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
      {reminders && <RemindersSheet onClose={() => setReminders(false)} />}
    </div>
  );
}
