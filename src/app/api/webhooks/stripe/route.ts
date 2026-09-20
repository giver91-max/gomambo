import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  constructWebhookEvent,
  getCheckoutSessionPayment,
  isConnectAccountOnboarded,
  refundCheckoutSession,
  releaseDeposit,
} from "@/lib/stripe";
import { reportMoneyFailure } from "@/lib/money-alerts";
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
    // BLIK settles asynchronously: "completed" fires while the payment is
    // still pending and the money only lands (or doesn't) later, with
    // async_payment_succeeded / async_payment_failed. Both success events
    // run the same body — every guard and refund below has to be reachable
    // from whichever one actually carries the money.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
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
        if (!paymentIntentId) break;

        const { data: depositBooking } = await admin
          .from("bookings")
          .select("status, deposit_status")
          .eq("id", bookingId)
          .single();
        // A redelivered event must not drag an already-released (or
        // captured) hold back to 'held' and re-alarm.
        if (depositBooking?.deposit_status === "released" || depositBooking?.deposit_status === "captured") {
          break;
        }

        // Hold completed after the booking was cancelled — release it now
        // rather than leaving the renter's card blocked until Stripe's
        // ~7-day authorisation expiry.
        if (depositBooking?.status === "cancelled" || depositBooking?.status === "declined") {
          const release = await releaseDeposit(paymentIntentId);
          await admin
            .from("bookings")
            .update({
              stripe_deposit_payment_intent_id: paymentIntentId,
              deposit_status: release.ok ? "released" : "held",
            })
            .eq("id", bookingId);
          if (!release.ok) {
            await reportMoneyFailure(
              "deposit_release_failed",
              `Kaucja do rezerwacji ${bookingId} została zablokowana już po jej anulowaniu, a automatyczne zwolnienie się nie powiodło (${release.error}). Anuluj płatność ${paymentIntentId} ręcznie w Stripe.`
            );
          }
          break;
        }

        await admin
          .from("bookings")
          .update({ stripe_deposit_payment_intent_id: paymentIntentId, deposit_status: "held" })
          .eq("id", bookingId);
        break;
      }

      // Everything past this point books money as received. A "completed"
      // session can still be unpaid (BLIK pending, or already failed), so
      // nothing may be marked paid until Stripe says the payment settled.
      // Read from the signed event payload, never from an extra API call:
      // an API failure here would return 200 and lose the payment for good,
      // since Stripe wouldn't redeliver.
      const eventIntent =
        session.payment_intent && typeof session.payment_intent !== "string"
          ? session.payment_intent
          : null;
      if (session.payment_status !== "paid" && eventIntent?.status !== "succeeded") break;

      if (session.metadata?.kind === "extra_charge") {
        const extraChargeId = session.metadata?.extraChargeId;
        if (!extraChargeId) break;
        const { data: currentCharge } = await admin
          .from("booking_extra_charges")
          .select("status, stripe_checkout_session_id")
          .eq("id", extraChargeId)
          .single();
        if (!currentCharge) break;

        if (currentCharge.status === "paid") {
          // Same session = redelivery. A different one means the renter paid
          // twice (a superseded session stayed alive) — send that back.
          if (currentCharge.stripe_checkout_session_id === session.id) break;
          const duplicateCharge = await refundCheckoutSession(session.id);
          if (!duplicateCharge.ok) {
            await reportMoneyFailure(
              "refund_failed",
              `Dopłata ${extraChargeId} (rezerwacja ${bookingId}) została opłacona po raz drugi sesją ${session.id}, a automatyczny zwrot się nie powiódł (${duplicateCharge.error}). Zwróć tę płatność ręcznie w Stripe.`
            );
          }
          break;
        }

        // Matched by id, not by session: if the renter completed a session
        // that had since been replaced, that payment is still the real one
        // for this charge — record it against the session that actually paid.
        const { data: extraCharge } = await admin
          .from("booking_extra_charges")
          .update({ status: "paid", stripe_checkout_session_id: session.id })
          .eq("id", extraChargeId)
          .eq("status", "requested")
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
          .select("new_end_date, additional_amount_pln, status, refunded_at")
          .eq("id", extensionId)
          .single();
        if (!extension) break;
        // Repeat delivery of an extension we already applied.
        if (extension.status === "paid") break;

        // Neutralised by a cancellation or a retry, yet the payment landed
        // anyway (the expire lost a race, or failed). The money has to go
        // back — without this the row is the only trace and nobody reads it.
        if (extension.status === "expired") {
          if (extension.refunded_at) break;
          const staleRefund = await refundCheckoutSession(session.id);
          if (staleRefund.ok) {
            await admin
              .from("booking_extensions")
              .update({ refunded_at: new Date().toISOString() })
              .eq("id", extensionId)
              .is("refunded_at", null);
          } else {
            await reportMoneyFailure(
              "refund_failed",
              `Płatność ${session.id} za wygaszone przedłużenie ${extensionId} (rezerwacja ${bookingId}) dotarła mimo wygaszenia, a automatyczny zwrot się nie powiódł (${staleRefund.error}). Zwróć ją ręcznie w Stripe.`
            );
          }
          break;
        }

        const { data: extensionBooking } = await admin
          .from("bookings")
          .select("status")
          .eq("id", bookingId)
          .single();

        // Paid from a stale tab after the booking stopped being active —
        // there is no trip to extend, so the money goes back instead of
        // silently moving the end date of a dead booking.
        if (extensionBooking?.status !== "accepted") {
          const refund = await refundCheckoutSession(session.id);
          await admin
            .from("booking_extensions")
            .update({
              status: "expired",
              ...(refund.ok ? { refunded_at: new Date().toISOString() } : {}),
            })
            .eq("id", extensionId);
          if (!refund.ok) {
            await reportMoneyFailure(
              "refund_failed",
              `Najemca opłacił przedłużenie ${extensionId}, choć rezerwacja ${bookingId} nie jest już aktywna, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć płatność ${session.id} ręcznie w Stripe.`
            );
          }
          break;
        }

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

      const { data: current } = await admin
        .from("bookings")
        .select("status, payment_status, stripe_checkout_session_id")
        .eq("id", bookingId)
        .single();
      if (!current) break;

      // Paid after the booking died (stale tab, late BLIK confirmation) —
      // refund instead of banking money for a trip that won't happen.
      if (current.status === "cancelled" || current.status === "declined") {
        const refund = await refundCheckoutSession(session.id);
        if (!refund.ok) {
          await reportMoneyFailure(
            "refund_failed",
            `Płatność ${session.id} za rezerwację ${bookingId} dotarła po jej anulowaniu, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć ją ręcznie w Stripe.`
          );
        }
        break;
      }
      if (current.payment_status === "paid") {
        // Same session: Stripe simply redelivered the event.
        if (current.stripe_checkout_session_id === session.id) break;
        // Different session: the rental was genuinely paid twice (two
        // sessions stayed alive). Refunding is idempotent, so a redelivery
        // of this same second payment won't double-refund or false-alarm.
        const duplicate = await refundCheckoutSession(session.id);
        if (!duplicate.ok) {
          await reportMoneyFailure(
            "refund_failed",
            `Rezerwacja ${bookingId} została opłacona po raz drugi sesją ${session.id} (w bazie zapisana jest ${current.stripe_checkout_session_id ?? "brak"}), a automatyczny zwrot się nie powiódł (${duplicate.error}). Zwróć tę płatność ręcznie w Stripe.`
          );
        }
        break;
      }

      // Matched by booking id rather than session id: a renter who retried
      // checkout may have completed the SUPERSEDED session, and that payment
      // is just as real — re-point the booking at whatever actually paid, so
      // a later refund targets the right session.
      const paid = await getCheckoutSessionPayment(session.id);
      const { data: booking } = await admin
        .from("bookings")
        .update({
          payment_status: "paid",
          stripe_checkout_session_id: session.id,
          ...(paid.ok && paid.data.amountTotalPln !== null
            ? { total_price: paid.data.amountTotalPln }
            : {}),
          ...(paid.ok && paid.data.applicationFeePln !== null
            ? { platform_fee_amount: paid.data.applicationFeePln }
            : {}),
        })
        .eq("id", bookingId)
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

    // The async payment (BLIK) never arrived. No money moved, so there is
    // nothing to refund and every row is already in its pre-payment state —
    // but the renter is sitting there waiting for a confirmation that will
    // never come, and a deposit hold may be blocking their card.
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;
      if (!bookingId || session.metadata?.kind === "security_deposit") break;

      const { data: failedBooking } = await admin
        .from("bookings")
        .select("renter_id, deposit_status, stripe_deposit_payment_intent_id, cars(brand, model)")
        .eq("id", bookingId)
        .single();
      if (!failedBooking) break;

      // The deposit is taken on the rental session's success_url, so the
      // hold can already exist while the rental payment itself fails.
      if (failedBooking.deposit_status === "held" && failedBooking.stripe_deposit_payment_intent_id) {
        const release = await releaseDeposit(failedBooking.stripe_deposit_payment_intent_id);
        if (release.ok) {
          await admin.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
        } else {
          await reportMoneyFailure(
            "deposit_release_failed",
            `Płatność za rezerwację ${bookingId} nie powiodła się, a zwolnienie kaucji też się nie udało (${release.error}). Anuluj płatność ${failedBooking.stripe_deposit_payment_intent_id} ręcznie w Stripe.`
          );
        }
      }

      const failedCar = failedBooking.cars as unknown as { brand: string; model: string } | null;
      const failedLabel = failedCar ? `${failedCar.brand} ${failedCar.model}` : "auto";
      await notifyUser({
        userId: failedBooking.renter_id,
        type: "payment_failed",
        subject: `Płatność nie powiodła się: ${failedLabel}`,
        body: `Twoja płatność za ${failedLabel} nie doszła do skutku. Nie pobraliśmy żadnych środków — możesz spróbować ponownie.`,
        emailHtml: `
          <p>Twoja płatność na GoMambo nie doszła do skutku — nie pobraliśmy żadnych środków.</p>
          <ul><li><strong>Auto:</strong> ${failedLabel}</li></ul>
          <p>Możesz spróbować ponownie w panelu.</p>
          <p><a href="${SITE_URL}/dashboard/rentals">Przejdź do rezerwacji →</a></p>
        `,
        link: "/dashboard/rentals",
      });
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
