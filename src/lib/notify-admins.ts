import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminNotification, Database } from "@/types/database";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

type EmailRow = [label: string, value: string | number | null | undefined];

export type AdminAlert = {
  /**
   * The in-app queue entry. Omit it for something that needs no action — an
   * FYI such as an automatically approved verification — so the queue stays
   * a to-do list; the e-mail still goes out.
   */
  queue?: { type: AdminNotification["type"]; body: string };
  /** Path inside the site the admin should open, e.g. "/admin/cars". */
  link: string;
  email: {
    subject: string;
    /** One or two sentences: what happened and whether anything is needed. */
    intro: string;
    rows: EmailRow[];
    cta: string;
  };
};

/**
 * Tells GoMambo's admins that something happened — in the panel AND by
 * e-mail — and never throws. Used for identity verifications (see
 * lib/identity-alerts.ts), which until now only added a row to a panel queue
 * nobody was watching, so people waited days for an approval.
 *
 * Recipients are whoever has role = 'admin', read at send time, so adding a
 * second admin needs no code change. (New-car e-mails are separate and go to
 * auto@gomambo.pl — see dashboard/cars/actions.ts.)
 *
 * The HTML is built HERE from plain values, and every value is escaped.
 * Callers pass text, never markup, because almost everything in these mails
 * — names, a rejection reason — was typed by a user, and a mail from the
 * GoMambo domain is exactly where an injected link would be trusted.
 */
export async function notifyAdmins(
  admin: SupabaseClient<Database>,
  alert: AdminAlert
): Promise<void> {
  if (alert.queue) {
    const { error } = await admin.from("admin_notifications").insert({
      type: alert.queue.type,
      body: alert.queue.body,
      link: alert.link,
    });
    if (error) {
      console.error("[notify-admins] queue insert failed", {
        type: alert.queue.type,
        code: error.code,
        message: error.message,
      });
    }
  }

  let recipients: string[] = [];
  try {
    const { data: admins, error } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (error) throw error;
    const emails = await Promise.all(
      (admins ?? []).map(async ({ id }) => {
        const { data } = await admin.auth.admin.getUserById(id);
        return data?.user?.email ?? null;
      })
    );
    recipients = Array.from(new Set(emails.filter((e): e is string => !!e)));
  } catch (error) {
    console.error("[notify-admins] could not resolve admin recipients", error);
    return;
  }

  if (recipients.length === 0) {
    console.error("[notify-admins] no admin with an e-mail address; nothing sent", {
      subject: alert.email.subject,
    });
    return;
  }

  const html = renderAdminEmail(alert);
  // A subject is a header, not HTML — but it must stay one line.
  const subject = alert.email.subject.replace(/[\r\n]+/g, " ").slice(0, 200);
  await Promise.all(recipients.map((to) => sendNotificationEmail({ to, subject, html })));
}

function renderAdminEmail({ link, email }: AdminAlert): string {
  const rows = email.rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(
          label
        )}</td><td style="padding:4px 0;vertical-align:top">${escapeHtml(String(value))}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p>${escapeHtml(email.intro)}</p>
      ${rows ? `<table style="border-collapse:collapse;margin:12px 0">${rows}</table>` : ""}
      <p><a href="${SITE_URL}${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#f5c518;color:#111;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(
        email.cta
      )} →</a></p>
      <p style="color:#888;font-size:12px">Powiadomienie z panelu administratora GoMambo.</p>
    </div>
  `;
}
