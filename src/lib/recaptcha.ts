import "server-only";

const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const MIN_SCORE = 0.5;

export async function verifyRecaptcha(
  token: string | null,
  expectedAction: string
): Promise<boolean> {
  if (!SECRET_KEY) return true;
  if (!token) return false;

  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: SECRET_KEY, response: token }),
    });
    const data = await res.json();
    return (
      data.success === true &&
      data.action === expectedAction &&
      typeof data.score === "number" &&
      data.score >= MIN_SCORE
    );
  } catch {
    return false;
  }
}
