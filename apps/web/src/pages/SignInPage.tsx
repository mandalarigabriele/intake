import { GoogleIcon } from "../components/icons";
import { Logo } from "../components/Logo";
import { t } from "../lib/strings";

export function SignInPage({ notice }: { notice: string | null }) {
  return (
    <div className="page focus-page signin-page">
      <div className="focus-spacer" />
      <Logo size={96} filled />
      <h1 className="signin-title">{t.appName}</h1>
      <p className="signin-tagline">{t.signIn.tagline}</p>
      <div className="focus-spacer" />
      {notice && <p className="notice">{notice}</p>}
      <a className="button-google" href="/auth/google">
        <GoogleIcon />
        {t.signIn.button}
      </a>
      <p className="focus-footnote">{t.signIn.ownerOnly}</p>
    </div>
  );
}
