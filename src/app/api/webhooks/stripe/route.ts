import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { constructWebhookEvent, isConnectAccountOnboarded } from "@/lib/stripe";
import { notifyUser } from "@/lib/notify-user";
import { SITE_URL } from "@/lib/site";

// Authenticated by the `stripe-signature` header (verified against
// STRIPE_WEBHOOK_SECRET in constructWebhookEvent), not by a user session —
// that signature check is this route's admin boundary, which is why using
// createAdminClient() here is safe despite its usual "session-admin only"
// warning. bookings has no update-blocking trigger (only the harmless
// set_updated_at bump), confirmed separately, so these service-role writes
// go through cleanly.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();
  const event = constructWebhookEvent(payload, signature);
  if (!event) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;
      if (!bookingId) break;

      const { data: booking } = await admin
        .from("bookings")
        .update({ payment_status: "paid" })
        .eq("id", bookingId)
        .eq("stripe_checkout_session_id", session.id)
        .select("owner_id, total_price, cars(brand, model)")
        .single();

      if (booking) {
        const car = booking.cars as unknown as { brand: string; model: string } | null;
        await notifyUser({
          userId: booking.owner_id,
          type: "booking_paid",
          subject: "Płatność za wynajem otrzymana",
          body: car
            ? `Najemca opłacił wynajem ${car.brand} ${car.model}. Rezerwacja jest potwierdzona.`
            : "Najemca opłacił wynajem. Rezerwacja jest potwierdzona.",
          emailHtml: `
            <p>Najemca opłacił rezerwację${car ? ` — ${car.brand} ${car.model}` : ""}.</p>
            <p>Kwota: ${booking.total_price ? Number(booking.total_price).toFixed(2) : "?"} zł.</p>
            <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
          `,
        });
      }
      break;
    }

    case "payment_intent.amount_capturable_updated": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await admin
        .from("bookings")
        .update({ deposit_status: "held" })
        .eq("stripe_deposit_payment_intent_id", intent.id);
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.metadata?.kind === "security_deposit") {
        await admin
          .from("bookings")
          .update({ deposit_status: "failed" })
          .eq("stripe_deposit_payment_intent_id", intent.id);
      }
      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const onboarded = await isConnectAccountOnboarded(account.id);
      await admin
        .from("profiles")
        .update({ stripe_connect_onboarded: onboarded })
        .eq("stripe_connect_account_id", account.id);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
