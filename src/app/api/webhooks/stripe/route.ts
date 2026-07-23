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

      if (session.metadata?.kind === "security_deposit") {
        // The deposit's PaymentIntent only exists once the customer has
        // actually reached checkout — this is the first point session.
        // payment_intent is reliably populated, so it's stored here rather
        // than at session-creation time (see createDepositCheckoutSession).
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
        if (paymentIntentId) {
          await admin
            .from("bookings")
            .update({ stripe_deposit_payment_intent_id: paymentIntentId, deposit_status: "held" })
            .eq("id", bookingId);
        }
        break;
      }

      if (session.metadata?.kind === "extra_charge") {
        const extraChargeId = session.metadata?.extraChargeId;
        if (!extraChargeId) break;
        const { data: extraCharge } = await admin
          .from("booking_extra_charges")
          .update({ status: "paid" })
          .eq("id", extraChargeId)
          .eq("stripe_checkout_session_id", session.id)
          .select("amount_pln, reason, bookings(owner_id, cars(brand, model))")
          .single();
        if (extraCharge) {
          const booking = extraCharge.bookings as unknown as {
            owner_id: string;
            cars: { brand: string; model: string } | null;
          } | null;
          if (booking) {
            const carLabel = booking.cars ? `${booking.cars.brand} ${booking.cars.model}` : "auto";
            await notifyUser({
              userId: booking.owner_id,
              type: "extra_charge_requested",
              subject: `Dopłata opłacona: ${carLabel}`,
              body: `Najemca opłacił dodatkową opłatę ${Number(extraCharge.amount_pln).toFixed(2)} zł za ${carLabel} (${extraCharge.reason}).`,
              emailHtml: `
                <p>Najemca opłacił zgłoszoną przez Ciebie dodatkową opłatę na GoMambo.</p>
                <ul>
                  <li><strong>Auto:</strong> ${carLabel}</li>
                  <li><strong>Kwota:</strong> ${Number(extraCharge.amount_pln).toFixed(2)} zł</li>
                  <li><strong>Powód:</strong> ${extraCharge.reason}</li>
                </ul>
                <p><a href="${SITE_URL}/dashboard/bookings">Zobacz rezerwacje →</a></p>
              `,
            });
          }
        }
        break;
      }

      if (session.metadata?.kind === "trip_extension") {
        const extensionId = session.metadata?.extensionId;
        if (!extensionId) break;
        const { data: extension } = await admin
          .from("booking_extensions")
          .select("new_end_date, additional_amount_pln, status")
          .eq("id", extensionId)
          .single();
        if (!extension || extension.status === "paid") break;

        await admin.from("booking_extensions").update({ status: "paid" }).eq("id", extensionId);

        const { data: updatedBooking } = await admin
          .from("bookings")
          .select("total_price, owner_id, renter_id, cars(brand, model)")
          .eq("id", bookingId)
          .single();
        if (updatedBooking) {
          const newTotal = Number(updatedBooking.total_price ?? 0) + Number(extension.additional_amount_pln);
          await admin
            .from("bookings")
            .update({ end_date: extension.new_end_date, total_price: newTotal })
            .eq("id", bookingId);

          const car = updatedBooking.cars as unknown as { brand: string; model: string } | null;
          const carLabel = car ? `${car.brand} ${car.model}` : "auto";
          for (const userId of [updatedBooking.owner_id, updatedBooking.renter_id]) {
            await notifyUser({
              userId,
              type: "booking_extended",
              subject: `Wynajem przedłużony: ${carLabel}`,
              body: `Wynajem ${carLabel} został przedłużony do ${extension.new_end_date}.`,
              emailHtml: `
                <p>Wynajem na GoMambo został przedłużony.</p>
                <ul>
                  <li><strong>Auto:</strong> ${carLabel}</li>
                  <li><strong>Nowa data zakończenia:</strong> ${extension.new_end_date}</li>
                </ul>
                <p><a href="${SITE_URL}/dashboard/bookings">Zobacz rezerwacje →</a></p>
              `,
            });
          }
        }
        break;
      }

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
