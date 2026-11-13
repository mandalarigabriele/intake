import { Link } from "wouter";
import type { User } from "../api/queries";
import { t } from "../lib/strings";

/** Google picture, or the first letter of the name. */
export function Avatar({ user, className }: { user: User; className: string }) {
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  return (
    <span className={className} aria-hidden="true">
      {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  );
}

/** The avatar opens Profilo (docs/design § Navigation): round in the Today header, a full row in the sidebar. */
export function ProfileLink({ user, variant }: { user: User; variant: "avatar" | "row" }) {
  return (
    <Link href="/profilo" className={variant === "avatar" ? "profile-link" : "profile-row"} aria-label={t.profile.open}>
      <Avatar user={user} className={variant === "avatar" ? "avatar" : "avatar avatar-sm"} />
      {variant === "row" && <span className="profile-email">{user.name ?? user.email}</span>}
    </Link>
  );
}
