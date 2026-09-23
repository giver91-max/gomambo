/**
 * Escape a value before interpolating it into notification HTML.
 *
 * Everything that reaches an email body from the database is user-supplied:
 * a car's brand and model, the delivery note, a profile's full name, the
 * plate. The mail goes out from the GoMambo domain over an authenticated
 * Resend connection, so an unescaped `<a href>` in any of those fields is a
 * phishing link the recipient has every reason to trust.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
