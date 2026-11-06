import type { ReminderSettings } from "@intake/shared";
import { useEffect, useState } from "react";
import { usePushStatus, useReminderSettings, useSubscribePush, useTestPush, useUnsubscribePush } from "../api/queries";
import { currentSubscription, pushSupport, subscribeDevice } from "../lib/push";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";
import { Scrim } from "./Scrim";

const KINDS: Array<keyof ReminderSettings> = ["meal", "todo", "water", "summary"];

/** "Promemoria": turn notifications on for this device and choose which reminders are sent. */
export function RemindersSheet({ onClose }: { onClose: () => void }) {
  const support = pushSupport();
  const status = usePushStatus(true);
  const subscribe = useSubscribePush();
  const unsubscribe = useUnsubscribePush();
  const saveSettings = useReminderSettings();
  const test = useTestPush();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSubscription()
      .then((subscription) => setEndpoint(subscription?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  const enable = async () => {
    if (!status.data) return;
    setError(null);
    setBusy(true);
    try {
      const json = await subscribeDevice(status.data.publicKey);
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("subscribe-failed");
      await subscribe.mutateAsync({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setEndpoint(json.endpoint);
    } catch (e) {
      setError((e as Error).message === "permission-denied" ? t.reminders.denied : t.reminders.failed);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!endpoint) return;
    setError(null);
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      await subscription?.unsubscribe();
      await unsubscribe.mutateAsync(endpoint);
      setEndpoint(null);
    } catch {
      setError(t.reminders.failed);
    } finally {
      setBusy(false);
    }
  };

  const settings = status.data?.settings;

  return (
    <Scrim onClose={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t.reminders.title} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.reminders.title}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="sheet-list">
          <div className="sheet-row" data-static>
            <span className="sheet-row-text">
              <strong>{t.reminders.device}</strong>
              <span className="muted">
                {support === "needs-install" ? t.reminders.needsInstall : support === "unsupported" ? t.reminders.unsupported : endpoint ? t.reminders.on : t.reminders.off}
              </span>
            </span>
            {support === "supported" &&
              (endpoint ? (
                <button type="button" className="button-secondary-small" disabled={busy} onClick={disable}>
                  {t.reminders.disable}
                </button>
              ) : (
                <button type="button" className="button-primary-small" disabled={busy || !status.data} onClick={enable}>
                  {t.reminders.enable}
                </button>
              ))}
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}

        <span className="sheet-section">{t.reminders.which}</span>
        <div className="sheet-list">
          {KINDS.map((kind) => (
            <label key={kind} className="sheet-row toggle-row">
              <span className="sheet-row-text">
                <strong>{t.reminders.kinds[kind].title}</strong>
                <span className="muted">{t.reminders.kinds[kind].hint}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings?.[kind] ?? false}
                disabled={!settings || saveSettings.isPending}
                onChange={(event) => settings && saveSettings.mutate({ ...settings, [kind]: event.target.checked })}
              />
            </label>
          ))}
        </div>
        {saveSettings.isError && <p className="error-text">{t.reminders.failed}</p>}

        {status.data && status.data.devices > 0 && (
          <button type="button" className="button-neutral" disabled={test.isPending} onClick={() => test.mutate()}>
            {t.reminders.test}
          </button>
        )}
        {test.isSuccess && <p className="sheet-note">{t.reminders.testSent(test.data.sent)}</p>}
        {test.isError && <p className="error-text">{t.reminders.failed}</p>}
        <p className="sheet-note">{status.data ? t.reminders.devices(status.data.devices) : t.loading}</p>
      </div>
    </Scrim>
  );
}
