import { useEffect, useRef, useState } from "react";
import type { User } from "../api/queries";
import { t } from "../lib/strings";

interface Props {
  dateLabel: string;
  title: string;
  user: User;
  onSignOut: () => void;
}

/** Page header: date, big title and an avatar menu with sign-out. */
export function Header({ dateLabel, title, user, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <header className="page-header">
      <div>
        <p className="page-date">{dateLabel}</p>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="avatar-menu" ref={menuRef}>
        <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`${t.signIn.signedInAs} ${user.email}`} onClick={() => setOpen((v) => !v)}>
          {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial}
        </button>
        {open && (
          <div className="menu" role="menu">
            <p className="menu-caption">
              {t.signIn.signedInAs}
              <br />
              <strong>{user.email}</strong>
            </p>
            <button type="button" role="menuitem" className="menu-item" onClick={onSignOut}>
              {t.signIn.signOut}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
