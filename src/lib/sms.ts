import "server-only";

const SMSAPI_TOKEN = process.env.SMSAPI_TOKEN;
const SMSAPI_FROM = process.env.SMSAPI_FROM;

// Same "unconfigured = safe no-op" pattern as src/lib/face-match.ts and
// src/lib/stripe.ts — SMS is a secondary channel on top of email/in-app
// notifications, so a missing token must never block the primary
// notifyUser() write, just skip the SMS silently.
export function isSmsConfigured(): boolean {
  return Boolean(SMSAPI_TOKEN && SMSAPI_FROM);
}

// No official SDK for SMSAPI.pl — plain REST, same as src/lib/recaptcha.ts.
export async function sendNotificationSms(to: string, message: string): Promise<boolean> {
  if (!SMSAPI_TOKEN || !SMSAPI_FROM) return false;

  try {
    const response = await fetch("https://api.smsapi.pl/sms.do", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SMSAPI_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        to,
        from: SMSAPI_FROM,
        message: message.slice(0, 160),
        format: "json",
      }),
    });
    const data = await response.json();
    if (data.error) {
      console.error("sendNotificationSms: SMSAPI returned an error:", data);
      return false;
    }
    return true;
  } catch (error) {
    console.error("sendNotificationSms: request failed:", error);
    return false;
  }
}
