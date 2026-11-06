import webpush from "web-push";
import type { SecretStore } from "../db/secretStore.js";
import type { StoredSubscription } from "../db/reminderStore.js";
import type { PushSender } from "./reminderScheduler.js";
import type { Notification } from "./reminders.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VAPID_SECRET = "push.vapid";

/** The server's VAPID key pair, generated on first use and kept encrypted in the secret store. */
export function vapidKeys(secrets: Pick<SecretStore, "get" | "set">): VapidKeys {
  const stored = secrets.get<VapidKeys>(VAPID_SECRET);
  if (stored?.publicKey && stored.privateKey) return stored;
  const keys = webpush.generateVAPIDKeys();
  secrets.set(VAPID_SECRET, keys);
  return keys;
}

/** Sends Web Push notifications signed with the VAPID keys (subject: the app's public URL). */
export class WebPushSender implements PushSender {
  constructor(
    private readonly keys: VapidKeys,
    private readonly subject: string,
  ) {}

  async send(subscription: StoredSubscription, notification: Notification): Promise<"ok" | "gone"> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(notification), {
        vapidDetails: { subject: this.subject, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey },
        TTL: 60 * 60,
        urgency: "high",
      });
      return "ok";
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      throw error;
    }
  }
}
