import type { ComponentType } from "react";

interface Props {
  title: string;
  heading: string;
  body: string;
  Icon: ComponentType<{ size?: number }>;
}

/** Section that is not built yet: title plus a centered "coming soon" state. */
export function ComingSoonPage({ title, heading, body, Icon }: Props) {
  return (
    <div className="page section-page">
      <h1 className="page-title">{title}</h1>
      <div className="coming-soon">
        <span className="coming-soon-icon">
          <Icon size={32} />
        </span>
        <strong>{heading}</strong>
        <p className="muted">{body}</p>
      </div>
    </div>
  );
}
