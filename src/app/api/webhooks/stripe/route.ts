import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEPOSIT_KIND,
  constructWebhookEvent,
  getCheckoutSessionPayment,
  isConnectAccountOnboarded,
  refundCheckoutSession,
} from "@/lib/stripe";
import { reportMoneyFailure } from "@/lib/money-alerts";
import { requestVerificationIfDue } from "@/lib/booking-verification";
import {
  handleDepositPayment,
  markDepositDisputed,
  markDepositPaymentFailed,
  markDepositProcessing,
  reopenDepositForExtension,
  requestDepositIfDue,
  syncDepositRefunds,
} from "@/lib/deposit-service";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { formatZl } from "@/lib/deposit";

// Answered when a deposit write failed: Stripe retries a non-2xx delivery,
// a 200 would lose the event for good.
const retryLater = () => NextResponse.json({ error: "retry" }, { status: 500 });

const intentIdOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

// Authenticated by the `stripe-signature` header (verified against
// STRIPE_WEBHOOK_SECRET in constructWebhookEvent), not by a user session —
// that signature check is this route's admin boundary, which is why using
// createAdminClient() here is safe despite its usual "session-admin only"
// warning. The service role passes enforce_booking_column_rules untouched
// (auth.uid() is null), so these writes go through cleanly.
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

      // The security deposit is a payment of its own on GoMambo's balance
      // (deposit-service.ts). Its money only counts once Stripe says it has
      // settled; a BLIK still on its way is recorded as "processing" and
      // releases nothing.
      if (session.metadata?.kind === DEPOSIT_KIND) {
        const paymentIntentId = intentIdOf(session.payment_intent);
        if (!paymentIntentId) break;
        const depositIntent =
          session.payment_intent && typeof session.payment_intent !== "string"
            ? session.payment_intent
            : null;
        if (session.payment_status === "paid" || depositIntent?.status === "succeeded") {
          const outcome = await handleDepositPayment(admin, {
            bookingId,
            sessionId: session.id,
            paymentIntentId,
            amountTotalPln: session.amount_total !== null ? session.amount_total / 100 : null,
          });
          if (outcome === "retry") return retryLater();
          break;
        }

        // Completed but unpaid: a BLIK still on its way — or one that has
        // already failed. Stripe does not promise the order of events, and a
        // "completed" retried after an error can land after the failure it
        // belongs to; parked in "processing", that dead payment would keep
        // the renter from paying again and hide the deposit from the
        // pickup-day alarm. So the intent's own state is read from Stripe
        // (the event usually carries only its id); a failed read answers 500
        // and Stripe asks again.
        const current = await getCheckoutSessionPayment(session.id);
        if (!current.ok) return retryLater();
        const intentStatus = current.data.paymentIntentStatus;
        if (current.data.paymentStatus === "paid" || intentStatus === "succeeded") {
          const outcome = await handleDepositPayment(admin, {
            bookingId,
            sessionId: session.id,
            paymentIntentId: current.data.paymentIntentId ?? paymentIntentId,
            amountTotalPln: current.data.amountTotalPln,
          });
          if (outcome === "retry") return retryLater();
          break;
        }
        if (intentStatus === "processing" || intentStatus === "requires_action") {
          const outcome = await markDepositProcessing(admin, {
            bookingId,
            sessionId: session.id,
            paymentIntentId,
          });
          if (outcome === "retry") return retryLater();
        }
        // Anything else already failed: the deposit stays "requested", and
        // the failure events (if they had not come yet) find nothing to undo.
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
          .select("status, payment_method, stripe_checkout_session_id")
          .eq("id", extraChargeId)
          .single();
        if (!currentCharge) break;

        // The charge was called off (its booking was cancelled) while the
        // renter still had the Checkout page open. Nothing below would match
        // a 'cancelled' row, so without this the money would just sit here.
        if (currentCharge.status === "cancelled") {
          const refundCancelled = await refundCheckoutSession(session.id);
          if (!refundCancelled.ok) {
            await reportMoneyFailure(
              "refund_failed",
              `Dopłata ${extraChargeId} (rezerwacja ${bookingId}) została opłacona po jej anulowaniu, a automatyczny zwrot się nie powiódł (${refundCancelled.error}). Zwróć płatność ${session.id} ręcznie w Stripe.`
            );
          }
          break;
        }

        if (currentCharge.status === "paid") {
          // Same session = redelivery. A different one means the renter paid
          // twice (a superseded session stayed alive) — send that back.
          // Unless it was settled by bank transfer: then NO card payment can
          // be a redelivery of this row, whatever session it came from.
          if (
            currentCharge.payment_method !== "bank_transfer" &&
            currentCharge.stripe_checkout_session_id === session.id
          )
            break;
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
              body: `Najemca opłacił dodatkową opłatę ${formatZl(Number(extraCharge.amount_pln))} za ${carLabel} (${extraCharge.reason}).`,
              emailHtml: `
                <p>Najemca opłacił zgłoszoną przez Ciebie dodatkową opłatę na GoMambo.</p>
                <ul>
                  <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
                  <li><strong>Kwota:</strong> ${formatZl(Number(extraCharge.amount_pln))}</li>
                  <li><strong>Powód:</strong> ${escapeHtml(extraCharge.reason)}</li>
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
          .select("new_end_date, additional_amount_pln, platform_fee_pln, status, refunded_at")
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
          .select("status, renter_id, cars(brand, model)")
          .eq("id", bookingId)
          .single();

        // The deposit has a say too. The checkout page lives about a day, so
        // it can be paid after the daily job saw end_date pass and opened
        // the owner's review window — the booking is still "accepted" then,
        // and without this the old end date's window would refund the whole
        // deposit while the car is still out. Nothing decided yet: the window
        // closes again (reopenDepositForExtension). Already settled or kept:
        // the extension can't be secured any more, so it is refunded below.
        let depositSettled = false;
        if (extensionBooking?.status === "accepted") {
          const reopened = await reopenDepositForExtension(admin, bookingId);
          if (reopened === "retry") return retryLater();
          depositSettled = reopened === "blocked";
        }

        // Paid from a stale tab after the booking stopped being active —
        // there is no trip to extend, so the money goes back instead of
        // silently moving the end date of a dead booking.
        if (extensionBooking?.status !== "accepted" || depositSettled) {
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
              depositSettled
                ? `Najemca opłacił przedłużenie ${extensionId} rezerwacji ${bookingId}, gdy kaucja była już rozliczona, więc przedłużenia nie zastosowaliśmy, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć płatność ${session.id} ręcznie w Stripe.`
                : `Najemca opłacił przedłużenie ${extensionId}, choć rezerwacja ${bookingId} nie jest już aktywna, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć płatność ${session.id} ręcznie w Stripe.`
            );
          }
          // The renter may still be driving, sure the trip is extended.
          if (depositSettled && extensionBooking) {
            const extensionCar = extensionBooking.cars as unknown as { brand: string; model: string } | null;
            const extensionLabel = extensionCar ? `${extensionCar.brand} ${extensionCar.model}` : "auto";
            await notifyUser({
              userId: extensionBooking.renter_id,
              type: "booking_extended",
              subject: `Przedłużenie nie zostało zastosowane: ${extensionLabel}`,
              body: `Wynajem ${extensionLabel} był już rozliczany, gdy dotarła płatność za przedłużenie, więc go nie przedłużyliśmy. ${refund.ok ? "Płatność za przedłużenie zwracamy." : "Płatność za przedłużenie zwrócimy — zajmujemy się tym."} Oddaj auto zgodnie z ustaleniami z właścicielem albo napisz do nas.`,
              emailHtml: `
                <p>Płatność za przedłużenie wynajmu <strong>${escapeHtml(extensionLabel)}</strong> dotarła, gdy wynajem był już rozliczany — dlatego go nie przedłużyliśmy.</p>
                <p>${refund.ok ? "Płatność za przedłużenie zwracamy: BLIK zwykle do 2 godzin, karta do 10 dni roboczych." : "Płatność za przedłużenie zwrócimy — zajmujemy się tym, nie musisz nic robić."}</p>
                <p>Oddaj auto zgodnie z ustaleniami z właścicielem albo napisz do nas: kontakt@gomambo.pl.</p>
                <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
              `,
              link: "/dashboard/rentals",
            });
          }
          break;
        }

        await admin.from("booking_extensions").update({ status: "paid" }).eq("id", extensionId);

        const { data: updatedBooking } = await admin
          .from("bookings")
          .select("total_price, platform_fee_amount, owner_id, renter_id, cars(brand, model)")
          .eq("id", bookingId)
          .single();
        if (updatedBooking) {
          // additional_amount_pln is GROSS, so the booking's fee column has
          // to grow with it — the owner's payout is shown as
          // total_price - platform_fee_amount, and leaving the fee behind
          // overstates it by exactly the extension's commission.
          const newTotal = Number(updatedBooking.total_price ?? 0) + Number(extension.additional_amount_pln);
          const newFee =
            Number(updatedBooking.platform_fee_amount ?? 0) + Number(extension.platform_fee_pln ?? 0);
          await admin
            .from("bookings")
            .update({
              end_date: extension.new_end_date,
              total_price: newTotal,
              platform_fee_amount: newFee,
            })
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
                  <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
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
        .select("status, payment_status, payment_method, stripe_checkout_session_id")
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
        // Same session: Stripe simply redelivered the event. That shortcut
        // only holds while the webhook is the ONLY thing that can set 'paid'
        // — an admin confirming a bank transfer also sets it, and then money
        // arriving from Stripe is a genuine second payment, not a redelivery.
        if (
          current.payment_method !== "bank_transfer" &&
          current.stripe_checkout_session_id === session.id
        )
          break;
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
        // A trip starting within the lead window needs its pre-pickup
        // verification and its deposit asked for now — the daily job may
        // already have run.
        await requestVerificationIfDue(admin, bookingId);
        await requestDepositIfDue(admin, bookingId);
        const car = booking.cars as unknown as { brand: string; model: string } | null;
        await notifyUser({
          userId: booking.owner_id,
          type: "booking_paid",
          subject: "Płatność za wynajem otrzymana",
          body: car
            ? `Najemca opłacił wynajem ${car.brand} ${car.model}. Rezerwacja jest potwierdzona.`
            : "Najemca opłacił wynajem. Rezerwacja jest potwierdzona.",
          emailHtml: `
            <p>Najemca opłacił rezerwację${car ? ` — ${escapeHtml(`${car.brand} ${car.model}`)}` : ""}.</p>
            <p>Kwota: ${booking.total_price ? formatZl(Number(booking.total_price)) : "? zł"}.</p>
            <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
          `,
        });
      }
      break;
    }

    // The async payment (BLIK) never arrived. No money moved, so there is
    // nothing to refund and every row is already in its pre-payment state —
    // but the renter is sitting there waiting for a confirmation that will
    // never come.
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;
      if (!bookingId) break;

      if (session.metadata?.kind === DEPOSIT_KIND) {
        const outcome = await markDepositPaymentFailed(admin, {
          bookingId,
          paymentIntentId: intentIdOf(session.payment_intent),
        });
        if (outcome === "retry") return retryLater();
        break;
      }

      const { data: failedBooking } = await admin
        .from("bookings")
        .select("renter_id, cars(brand, model)")
        .eq("id", bookingId)
        .single();
      if (!failedBooking) break;

      const failedCar = failedBooking.cars as unknown as { brand: string; model: string } | null;
      const failedLabel = failedCar ? `${failedCar.brand} ${failedCar.model}` : "auto";
      await notifyUser({
        userId: failedBooking.renter_id,
        type: "payment_failed",
        subject: `Płatność nie powiodła się: ${failedLabel}`,
        body: `Twoja płatność za ${failedLabel} nie doszła do skutku. Nie pobraliśmy żadnych środków — możesz spróbować ponownie.`,
        emailHtml: `
          <p>Twoja płatność na GoMambo nie doszła do skutku — nie pobraliśmy żadnych środków.</p>
          <ul><li><strong>Auto:</strong> ${escapeHtml(failedLabel)}</li></ul>
          <p>Możesz spróbować ponownie w panelu.</p>
          <p><a href="${SITE_URL}/dashboard/rentals">Przejdź do rezerwacji →</a></p>
        `,
        link: "/dashboard/rentals",
      });
      break;
    }

    // The deposit's intent carries its own metadata (set through
    // payment_intent_data), which is the only reason this event can be
    // attributed at all. A card declined inside an open Checkout page also
    // lands here, but the deposit is still "requested" then and nothing
    // changes; only a payment that had reached "processing" goes back.
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.metadata?.kind !== DEPOSIT_KIND || !intent.metadata?.bookingId) break;
      const outcome = await markDepositPaymentFailed(admin, {
        bookingId: intent.metadata.bookingId,
        paymentIntentId: intent.id,
      });
      if (outcome === "retry") return retryLater();
      break;
    }

    // An unpaid session ran out. For a deposit nothing changes: the renter
    // simply opens a new one, and payDeposit settles this one first anyway.
    case "checkout.session.expired":
      break;

    // A refund moved (BLIK refunds settle asynchronously, card refunds can
    // fail days later). For a deposit, the row is brought in line with
    // Stripe's full list of refunds on that payment; any other failed
    // refund — a rental, an extension — goes to a human.
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object as Stripe.Refund;
      const paymentIntentId = intentIdOf(refund.payment_intent);
      if (paymentIntentId) {
        const outcome = await syncDepositRefunds(admin, paymentIntentId);
        if (outcome === "retry") return retryLater();
        if (outcome === "ok") break;
      }
      // refund.failed only: a failure also arrives as refund.updated, and
      // one failure must make one alert.
      if (event.type === "refund.failed") {
        await reportMoneyFailure(
          "refund_failed",
          `Zwrot ${refund.id} (${formatZl(refund.amount / 100)}, płatność ${paymentIntentId ?? "?"}) nie powiódł się w Stripe (${refund.failure_reason ?? "brak powodu"}). Pieniądze wróciły na saldo GoMambo — zwróć je najemcy ponownie albo przelewem.`
        );
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = intentIdOf(charge.payment_intent);
      if (!paymentIntentId) break;
      const outcome = await syncDepositRefunds(admin, paymentIntentId);
      if (outcome === "retry") return retryLater();
      break;
    }

    // A chargeback. On a deposit every automatic move stops; on anything
    // else an admin still has to answer it in Stripe.
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = intentIdOf(dispute.payment_intent);
      const outcome = paymentIntentId
        ? await markDepositDisputed(admin, { paymentIntentId, disputeId: dispute.id })
        : "not_deposit";
      if (outcome === "retry") return retryLater();
      if (outcome === "not_deposit") {
        await reportMoneyFailure(
          "payment_disputed",
          `Klient zgłosił w banku reklamację płatności ${paymentIntentId ?? intentIdOf(dispute.charge) ?? "?"} (spór ${dispute.id}, ${formatZl(dispute.amount / 100)}, powód: ${dispute.reason}). Odpowiedz na spór w Stripe przed terminem.`
        );
      }
      break;
    }

    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      await reportMoneyFailure(
        "payment_disputed",
        `Spór ${dispute.id} (płatność ${intentIdOf(dispute.payment_intent) ?? "?"}, ${formatZl(dispute.amount / 100)}) został zamknięty ze statusem „${dispute.status}”. Jeśli dotyczył kaucji, rozlicz ją teraz w panelu kaucji.`
      );
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
