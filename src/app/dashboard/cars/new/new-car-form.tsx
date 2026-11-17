"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCar, deleteCarDraft, validateNewCar, type CarDraftResult } from "../actions";
import {
  adminAttachCarImages,
  adminCreateCarDraft,
  adminDeleteCarDraft,
} from "@/app/admin/cars/new/actions";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";
import { applyCommission, formatHintPriceZl } from "@/lib/pricing";
import { formatPriceZl } from "@/lib/money-format";
import { PlateCoverEditor } from "@/components/plate-cover-editor";
import { DEFAULT_STICKER, flattenImageWithSticker, type StickerRect } from "@/lib/plate-cover";
import {
  checkPhotoFile,
  fileExtension,
  MAX_UPLOAD_IMAGE_BYTES,
  prepareDocumentFile,
  unreadablePhotoMessage,
} from "@/lib/image-resize";
import {
  CANCELLATION_POLICY_DESCRIPTIONS,
  CANCELLATION_POLICY_LABELS,
  FUEL_POLICY_DESCRIPTIONS,
  FUEL_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";
import type {
  CancellationPolicy,
  FuelPolicy,
  FuelType,
  Transmission,
  VehicleType,
} from "@/types/database";
import { DEPOSIT_REQUEST_LEAD_DAYS, DEPOSIT_REVIEW_DAYS } from "@/lib/deposit";

const MAX_IMAGES = 8;
const MAX_INSURANCE_BYTES = 8 * 1024 * 1024;

// The failures that are not about what was typed. The form keeps everything
// typed and picked, and the messages say so. CONNECTION_FAILED also covers a
// form left open across a deploy, which only a refresh fixes.
const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo. Sprawdź internet i spróbuj ponownie — wpisane dane i wybrane zdjęcia zostały w formularzu. Jeśli błąd się powtarza, odśwież stronę: wpisane dane zostaną, zdjęcia i polisę trzeba będzie wybrać jeszcze raz.";
const UPLOAD_FAILED =
  "Nie udało się wgrać plików — sprawdź połączenie z internetem i spróbuj ponownie. Wpisane dane i wybrane zdjęcia zostały w formularzu.";
const OUTCOME_UNKNOWN =
  "Połączenie przerwało się w trakcie zapisu i nie wiemy, czy auto się zapisało. Sprawdź listę w „Moje auta”, zanim dodasz je ponownie.";
const OUTCOME_UNKNOWN_FOR_OWNER =
  "Połączenie przerwało się w trakcie zapisu i nie wiemy, czy auto się zapisało. Sprawdź auta tego właściciela, zanim dodasz je ponownie.";
const SESSION_EXPIRED =
  "Sesja wygasła. Zaloguj się ponownie — wpisane dane zostaną w tej karcie przeglądarki.";

// The typed fields survive a refresh, a back-and-forward, or the phone
// killing the tab while the camera is open (Android does that when memory is
// short). Never the files — a File cannot be stored — nor the rental-right
// statement, which is ticked consciously each time.
const DRAFT_KEY_PREFIX = "gomambo:new-car-draft";
const DRAFT_SKIPPED_FIELDS = new Set(["images", "insurance", "rental_right", "recaptchaToken"]);

type StoredFile = { bucket: "car-images" | "car-insurance"; path: string };

function isCarResult(value: unknown): value is CarDraftResult {
  return typeof value === "object" && value !== null && "error" in value;
}

// Everything a duplicated car can safely start from — never includes
// registration_number, insurance_document_path, photos, or status: every
// physical car needs its own registration, its own policy, and its own
// photos, and a duplicate always re-enters moderation from scratch.
export type NewCarInitialValues = {
  brand: string;
  model: string;
  year: number;
  price_per_day: number;
  city: string;
  vehicle_type: VehicleType | null;
  fuel_type: FuelType | null;
  transmission: Transmission | null;
  seats: number | null;
  mileage_limit_km: number | null;
  mileage_overage_fee_per_km: number | null;
  price_per_month: number | null;
  security_deposit_amount: number | null;
  fuel_policy: FuelPolicy | null;
  delivery_available: boolean;
  delivery_info: string | null;
  cancellation_policy: CancellationPolicy;
  description: string | null;
};

// `forOwnerId` turns this into the admin's "add a car for this owner" form
// (src/app/admin/cars/new): the same fields, photos and plate cover, saved
// onto the owner's account by the admin actions instead of the caller's own.
export function NewCarForm({
  initialValues,
  forOwnerId,
  commissionRate,
}: {
  initialValues?: NewCarInitialValues;
  forOwnerId?: string;
  /** The owner's fee rate, to show what the renter will actually see. */
  commissionRate?: number;
}) {
  const router = useRouter();
  const [priceInput, setPriceInput] = useState(
    initialValues?.price_per_day ? String(initialValues.price_per_day) : ""
  );
  const ownerPrice = Number(priceInput);
  const priceBreakdown =
    commissionRate !== undefined && ownerPrice > 0
      ? applyCommission(ownerPrice, commissionRate)
      : null;
  const [previews, setPreviews] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [stickers, setStickers] = useState<(StickerRect | null)[]>([]);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deliveryAvailable, setDeliveryAvailable] = useState(initialValues?.delivery_available ?? false);
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  // Set once the car is saved, so the button stays disabled while the
  // dashboard loads instead of inviting a second click (and a second car).
  const [submitted, setSubmitted] = useState(false);
  const photoSelectionRun = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const restoredDeliveryInfo = useRef<string | undefined>(undefined);

  const draftKey = `${DRAFT_KEY_PREFIX}:${forOwnerId ?? "self"}`;
  // A saved draft only applies to the form it was typed into: "Duplikuj to
  // auto" after an abandoned attempt starts from the car being duplicated,
  // not from the old draft.
  const draftOrigin = JSON.stringify(initialValues ?? null);

  useEffect(() => {
    let saved: { origin?: unknown; fields?: unknown } | null = null;
    try {
      const raw = sessionStorage.getItem(draftKey);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      return;
    }
    const form = formRef.current;
    if (!form || !saved || saved.origin !== draftOrigin) return;
    if (typeof saved.fields !== "object" || saved.fields === null) return;

    for (const [name, value] of Object.entries(saved.fields as Record<string, unknown>)) {
      if (typeof value !== "string" || DRAFT_SKIPPED_FIELDS.has(name)) continue;
      if (name === "delivery_available") {
        setDeliveryAvailable(value === "true");
        continue;
      }
      if (name === "price_per_day") setPriceInput(value);
      // The delivery note is only rendered once delivery is ticked, so it
      // may not exist yet — it takes this value as its default when it does.
      if (name === "delivery_info") restoredDeliveryInfo.current = value;
      const field = form.elements.namedItem(name);
      if (
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement ||
        (field instanceof HTMLInputElement && field.type !== "file" && field.type !== "checkbox")
      ) {
        field.value = value;
      }
    }
    // Once, on mount: the inputs are uncontrolled, so this only fills them in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDraft() {
    const form = formRef.current;
    if (!form) return;
    const fields: Record<string, string> = {};
    for (const [name, value] of Array.from(new FormData(form).entries())) {
      if (typeof value === "string" && !DRAFT_SKIPPED_FIELDS.has(name)) fields[name] = value;
    }
    const delivery = form.elements.namedItem("delivery_available");
    fields.delivery_available =
      delivery instanceof HTMLInputElement && delivery.checked ? "true" : "false";
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ origin: draftOrigin, fields }));
    } catch {
      // Private mode or storage full: the form still works, just without the draft.
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }

  function handleInsuranceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInsuranceFile(file);
  }

  // Every photo is opened as soon as it is picked: a HEIC file from an iPhone
  // that this browser cannot decode is refused here, with how to send a JPG,
  // instead of failing after the whole form has been sent.
  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const selected = Array.from(input.files ?? []);
    const run = ++photoSelectionRun.current;
    setError(null);
    setCheckingPhotos(true);

    const accepted: File[] = [];
    const problems: { file: File; message: string }[] = [];
    for (const file of selected) {
      const message = await checkPhotoFile(file);
      if (message) problems.push({ file, message });
      else accepted.push(file);
    }
    // A newer selection replaced this one while it was being checked.
    if (run !== photoSelectionRun.current) return;
    setCheckingPhotos(false);

    if (accepted.length === 0) input.value = "";
    setPreviews((old) => {
      old.forEach((url) => URL.revokeObjectURL(url));
      return accepted.map((f) => URL.createObjectURL(f));
    });
    setFiles(accepted);
    setStickers(accepted.map(() => DEFAULT_STICKER));
    if (problems.length > 0) {
      const others = problems.slice(1).map((p) => `„${p.file.name}”`);
      setError(
        others.length > 0
          ? `${problems[0].message} Pominięte są też: ${others.join(", ")}.`
          : problems[0].message
      );
    }
  }

  function updateSticker(index: number, rect: StickerRect) {
    setStickers((prev) => prev.map((s, i) => (i === index ? rect : s)));
  }

  function toggleSticker(index: number) {
    setStickers((prev) => prev.map((s, i) => (i === index ? (s ? null : DEFAULT_STICKER) : s)));
  }

  /** Best effort: a file left behind costs storage, never a broken listing. */
  async function removeStoredFiles(supabase: ReturnType<typeof createClient>, stored: StoredFile[]) {
    for (const bucket of ["car-images", "car-insurance"] as const) {
      const paths = stored.filter((f) => f.bucket === bucket).map((f) => f.path);
      if (paths.length === 0) continue;
      try {
        await supabase.storage.from(bucket).remove(paths);
      } catch (err) {
        console.error("new car form: could not remove uploaded files", err);
      }
    }
  }

  /** Upload into `folder`; false (with whatever did upload recorded) on failure. */
  async function uploadFiles(
    supabase: ReturnType<typeof createClient>,
    folder: string,
    photos: File[],
    insurance: File,
    stored: StoredFile[]
  ): Promise<boolean> {
    for (let index = 0; index < photos.length; index++) {
      setStatus(`Wgrywanie zdjęcia ${index + 1} z ${photos.length}…`);
      const path = `${folder}/${crypto.randomUUID()}.${fileExtension(photos[index])}`;
      const { error: uploadError } = await supabase.storage
        .from("car-images")
        .upload(path, photos[index], { contentType: photos[index].type });
      if (uploadError) {
        console.error("new car form: photo upload failed", uploadError);
        return false;
      }
      stored.push({ bucket: "car-images", path });
    }

    setStatus("Wgrywanie polisy OC…");
    const isPdf = insurance.type === "application/pdf";
    const path = `${folder}/${crypto.randomUUID()}.${fileExtension(insurance, isPdf ? "pdf" : "jpg")}`;
    const { error: uploadError } = await supabase.storage
      .from("car-insurance")
      .upload(path, insurance, { contentType: insurance.type || undefined });
    if (uploadError) {
      console.error("new car form: policy upload failed", uploadError);
      return false;
    }
    stored.push({ bucket: "car-insurance", path });
    return true;
  }

  /**
   * After a call whose answer never arrived: did the car get saved? Read
   * back rather than guessed — removing the photos of a car that WAS saved
   * would break its listing, and keeping a half-saved one would leave an
   * empty car in the admin queue.
   */
  async function savedCarOutcome(
    supabase: ReturnType<typeof createClient>,
    carId: string
  ): Promise<"saved" | "absent" | "unknown"> {
    try {
      const { data, error: readError } = await supabase
        .from("cars")
        .select("id, car_images(id)")
        .eq("id", carId)
        .maybeSingle();
      if (readError) return "unknown";
      if (!data) return "absent";
      if ((data.car_images ?? []).length > 0) return "saved";
      // The server stopped between saving the car and its photos.
      const undo = await deleteCarDraft(carId);
      return isCarResult(undo) && undo.error === null ? "absent" : "unknown";
    } catch {
      return "unknown";
    }
  }

  function finishSaved() {
    clearDraft();
    setSubmitted(true);
    router.push("/dashboard");
  }

  async function submitAsOwner(formData: FormData, photos: File[], insurance: File) {
    setStatus("Sprawdzanie danych…");
    let check: unknown;
    try {
      check = await validateNewCar(formData);
    } catch (err) {
      console.error("new car form: validateNewCar failed", err);
    }
    if (!isCarResult(check)) {
      setError(CONNECTION_FAILED);
      return;
    }
    if (check.error) {
      setError(check.error);
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError(SESSION_EXPIRED);
      return;
    }

    // The car's id is chosen here so the files can be uploaded into its
    // folder BEFORE the car exists: nothing is written to the database until
    // the photos and the policy are safely in Storage.
    const carId = crypto.randomUUID();
    const stored: StoredFile[] = [];
    let keepFiles = false;
    try {
      if (!(await uploadFiles(supabase, `${user.id}/${carId}`, photos, insurance, stored))) {
        setError(UPLOAD_FAILED);
        return;
      }

      setStatus("Zapisywanie auta…");
      // Fetched now, not at the start: the token lasts two minutes, and the
      // uploads on a slow phone connection can take longer than that.
      const token = await getRecaptchaToken("add_car");
      formData.set("recaptchaToken", token ?? "");
      let result: unknown;
      try {
        result = await createCar(
          carId,
          stored.filter((f) => f.bucket === "car-images").map((f) => f.path),
          stored.find((f) => f.bucket === "car-insurance")!.path,
          formData
        );
      } catch (err) {
        console.error("new car form: createCar failed", err);
      }

      if (isCarResult(result) && result.error === null && result.carId === carId) {
        keepFiles = true;
        finishSaved();
        return;
      }
      if (isCarResult(result) && result.error) {
        // A refusal: createCar has already undone whatever it wrote.
        setError(result.error);
        return;
      }
      const outcome = await savedCarOutcome(supabase, carId);
      if (outcome === "saved") {
        keepFiles = true;
        finishSaved();
        return;
      }
      if (outcome === "unknown") {
        keepFiles = true;
        setError(OUTCOME_UNKNOWN);
        return;
      }
      setError(CONNECTION_FAILED);
    } finally {
      if (!keepFiles) await removeStoredFiles(supabase, stored);
    }
  }

  // The admin's "add for an owner" path keeps its draft-first flow: its
  // actions (src/app/admin/cars/new) create the car on the owner's account
  // and move the files there. A draft that its uploads do not reach is
  // deleted again.
  async function submitForOwner(ownerId: string, formData: FormData, photos: File[], insurance: File) {
    setStatus("Zapisywanie danych auta…");
    const token = await getRecaptchaToken("add_car");
    formData.set("recaptchaToken", token ?? "");
    let draft: unknown;
    try {
      draft = await adminCreateCarDraft(ownerId, { error: null }, formData);
    } catch (err) {
      console.error("new car form: adminCreateCarDraft failed", err);
    }
    if (!isCarResult(draft)) {
      setError(CONNECTION_FAILED);
      return;
    }
    if (draft.error || !draft.carId) {
      setError(draft.error ?? "Nie udało się zapisać auta.");
      return;
    }
    const carId = draft.carId;

    const supabase = createClient();
    const stored: StoredFile[] = [];
    let attached = false;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError(SESSION_EXPIRED);
        return;
      }
      if (!(await uploadFiles(supabase, `${user.id}/${carId}`, photos, insurance, stored))) {
        setError(UPLOAD_FAILED);
        return;
      }

      setStatus("Finalizowanie…");
      // From here on adminAttachCarImages owns the files and the draft: it
      // rolls back on its own failures, and a car it saved must keep them.
      attached = true;
      let finalize: unknown;
      try {
        finalize = await adminAttachCarImages(
          ownerId,
          carId,
          stored
            .filter((f) => f.bucket === "car-images")
            .map((f, position) => ({ path: f.path, position })),
          stored.find((f) => f.bucket === "car-insurance")!.path
        );
      } catch (err) {
        console.error("new car form: adminAttachCarImages failed", err);
        setError(OUTCOME_UNKNOWN_FOR_OWNER);
        return;
      }
      // adminAttachCarImages redirects on success instead of returning a
      // value — only a returned error means it did not go through.
      if (isCarResult(finalize) && finalize.error) {
        setError(finalize.error);
        return;
      }
      clearDraft();
      setSubmitted(true);
    } finally {
      if (!attached) {
        await removeStoredFiles(supabase, stored);
        try {
          await adminDeleteCarDraft(carId);
        } catch (err) {
          console.error("new car form: could not delete the draft", err);
        }
      }
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (files.length === 0) {
      setError("Dodaj przynajmniej jedno zdjęcie auta.");
      return;
    }
    if (files.length > MAX_IMAGES) {
      setError(`Maksymalnie ${MAX_IMAGES} zdjęć.`);
      return;
    }
    if (!insuranceFile) {
      setError("Dodaj skan lub zdjęcie polisy OC.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    // The "images"/"insurance" fields still hold raw File objects from the
    // file inputs (FormData captures every named control in the form) —
    // strip them so this request stays tiny; files upload directly to
    // Storage.
    formData.delete("images");
    formData.delete("insurance");
    const photosToUpload = files;
    const stickersToUpload = stickers;
    const insuranceSource = insuranceFile;

    startTransition(async () => {
      try {
        // Everything that can fail on this device happens before anything
        // is sent, so a photo this browser cannot open never leaves half a
        // car behind.
        setStatus("Przygotowywanie zdjęć…");
        const prepared: File[] = [];
        for (let index = 0; index < photosToUpload.length; index++) {
          let image: File;
          try {
            image = await flattenImageWithSticker(photosToUpload[index], stickersToUpload[index]);
          } catch (err) {
            console.error("new car form: could not prepare a photo", err);
            setError(unreadablePhotoMessage(photosToUpload[index]));
            return;
          }
          if (image.size > MAX_UPLOAD_IMAGE_BYTES) {
            setError(`Zdjęcie „${photosToUpload[index].name}” jest za duże nawet po zmniejszeniu — wybierz inne.`);
            return;
          }
          prepared.push(image);
        }
        const insurance = await prepareDocumentFile(insuranceSource, MAX_INSURANCE_BYTES);
        if (insurance.error !== undefined) {
          setError(insurance.error);
          return;
        }

        if (forOwnerId) {
          await submitForOwner(forOwnerId, formData, prepared, insurance.file);
        } else {
          await submitAsOwner(formData, prepared, insurance.file);
        }
      } catch (err) {
        // Anything not handled step by step above. Without this the
        // transition rethrows into Next's bare "Application error" screen
        // and every field typed so far is gone.
        console.error("new car form", err);
        setError(CONNECTION_FAILED);
      } finally {
        setStatus(null);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={saveDraft} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="brand">Marka</Label>
          <Input id="brand" name="brand" required placeholder="Toyota" defaultValue={initialValues?.brand} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" required placeholder="Corolla" defaultValue={initialValues?.model} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="year">Rok produkcji</Label>
          <Input
            id="year"
            name="year"
            type="number"
            required
            min={1990}
            max={new Date().getFullYear() + 1}
            placeholder="2020"
            defaultValue={initialValues?.year}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_day">Cena / dzień (zł)</Label>
          <Input
            id="price_per_day"
            name="price_per_day"
            type="number"
            step="1"
            min={1}
            required
            placeholder="150"
            defaultValue={initialValues?.price_per_day}
            onChange={(e) => setPriceInput(e.target.value)}
          />
          {priceBreakdown !== null && (
            // What the code does today: the listing shows this price, and the
            // fee is a separate line added when the renter picks dates.
            <p className="text-xs text-muted-foreground">
              {priceBreakdown.commission > 0
                ? `Przy rezerwacji doliczamy najemcy opłatę serwisową GoMambo (${formatHintPriceZl(priceBreakdown.commission)}/dzień), więc zapłaci ${formatHintPriceZl(priceBreakdown.gross)}/dzień. `
                : ""}
              Ty dostajesz całe {formatPriceZl(priceBreakdown.rental)}.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="city">Miasto</Label>
        <Input id="city" name="city" required placeholder="Warszawa" defaultValue={initialValues?.city} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vehicle_type">Typ pojazdu</Label>
          <select
            id="vehicle_type"
            name="vehicle_type"
            required
            defaultValue={initialValues?.vehicle_type ?? ""}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz typ
            </option>
            {(Object.entries(VEHICLE_TYPE_LABELS) as [VehicleType, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fuel_type">Rodzaj paliwa</Label>
          <select
            id="fuel_type"
            name="fuel_type"
            required
            defaultValue={initialValues?.fuel_type ?? ""}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz paliwo
            </option>
            {(Object.entries(FUEL_TYPE_LABELS) as [FuelType, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="transmission">Skrzynia biegów</Label>
          <select
            id="transmission"
            name="transmission"
            required
            defaultValue={initialValues?.transmission ?? ""}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz skrzynię
            </option>
            {(Object.entries(TRANSMISSION_LABELS) as [Transmission, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="seats">Liczba miejsc</Label>
          <Input
            id="seats"
            name="seats"
            type="number"
            min={1}
            max={9}
            required
            placeholder="5"
            defaultValue={initialValues?.seats ?? undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mileage_limit_km">Limit km / dzień (opcjonalnie)</Label>
          <Input
            id="mileage_limit_km"
            name="mileage_limit_km"
            type="number"
            min={1}
            placeholder="bez limitu"
            defaultValue={initialValues?.mileage_limit_km ?? undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mileage_overage_fee_per_km">Opłata za km ponad limit (zł, opcjonalnie)</Label>
          <Input
            id="mileage_overage_fee_per_km"
            name="mileage_overage_fee_per_km"
            type="number"
            step="0.01"
            min={0}
            placeholder="np. 1.50"
            defaultValue={initialValues?.mileage_overage_fee_per_km ?? undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price_per_month">Cena / miesiąc (zł, opcjonalnie)</Label>
          <Input
            id="price_per_month"
            name="price_per_month"
            type="number"
            step="1"
            min={1}
            placeholder="np. 2400"
            defaultValue={initialValues?.price_per_month ?? undefined}
          />
          <p className="text-xs text-muted-foreground">
            Zniżkowa cena dla wynajmu 28 dni i dłużej.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="security_deposit_amount">Kaucja zabezpieczająca (zł, opcjonalnie)</Label>
          <Input
            id="security_deposit_amount"
            name="security_deposit_amount"
            type="number"
            step="1"
            min={0}
            placeholder="np. 500"
            defaultValue={initialValues?.security_deposit_amount ?? undefined}
          />
          <p className="text-xs text-muted-foreground">
            Najemca wpłaca kaucję {DEPOSIT_REQUEST_LEAD_DAYS} dni przed odbiorem (karta lub BLIK).
            GoMambo przechowuje ją do rozliczenia. Zwracamy ją po Twoim potwierdzeniu albo
            automatycznie {DEPOSIT_REVIEW_DAYS} dni po zwrocie, chyba że wcześniej zatrzymasz część
            na szkodę. Opłatę za obsługę kaucji płaci najemca — nie pomniejsza ona kaucji.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fuel_policy">Polityka paliwa</Label>
          <select
            id="fuel_policy"
            name="fuel_policy"
            required
            defaultValue={initialValues?.fuel_policy ?? "full_to_full"}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {(Object.entries(FUEL_POLICY_LABELS) as [FuelPolicy, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label} — {FUEL_POLICY_DESCRIPTIONS[value]}
                </option>
              )
            )}
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="delivery_available"
            value="true"
            checked={deliveryAvailable}
            onChange={(e) => setDeliveryAvailable(e.target.checked)}
            className="size-4"
          />
          Oferuję dowóz auta
        </label>
        {deliveryAvailable && (
          <Input
            name="delivery_info"
            placeholder="np. Dowóz w promieniu 20 km za 50 zł, na lotnisko za 100 zł"
            defaultValue={restoredDeliveryInfo.current ?? initialValues?.delivery_info ?? undefined}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cancellation_policy">Polityka anulowania</Label>
        <select
          id="cancellation_policy"
          name="cancellation_policy"
          defaultValue={initialValues?.cancellation_policy ?? "moderate"}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {(Object.entries(CANCELLATION_POLICY_LABELS) as [CancellationPolicy, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label} — {CANCELLATION_POLICY_DESCRIPTIONS[value]}
              </option>
            )
          )}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="registration_number">Numer rejestracyjny</Label>
        <Input
          id="registration_number"
          name="registration_number"
          required
          placeholder="WX 12345"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="insurance_valid_until">Polisa OC ważna do</Label>
          <Input id="insurance_valid_until" name="insurance_valid_until" type="date" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inspection_valid_until">Badanie techniczne ważne do</Label>
          <Input id="inspection_valid_until" name="inspection_valid_until" type="date" required />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Przypomnimy przed końcem każdej daty. Gdy któraś minie, wstrzymamy ogłoszenie, aż dodasz
        nowy dokument — bez ważnego OC i przeglądu auta nie wolno wynajmować.
      </p>

      <div className="space-y-2">
        <Label htmlFor="insurance">Polisa OC (zdjęcie albo PDF do 8 MB)</Label>
        <Input
          id="insurance"
          name="insurance"
          type="file"
          accept="image/*,application/pdf"
          required
          onChange={handleInsuranceChange}
        />
        <p className="text-xs text-muted-foreground">
          Dokument widzi tylko nasz zespół podczas weryfikacji ogłoszenia.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Opis (opcjonalnie)</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Dodatkowe informacje o aucie…"
          defaultValue={initialValues?.description ?? undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="images">Zdjęcia auta (max 8, zmniejszamy je automatycznie)</Label>
        <p className="text-xs text-muted-foreground">
          Dobre zdjęcia realnie zwiększają liczbę zapytań: rób je w świetle dziennym, pokaż
          auto z czterech stron, dodaj wnętrze i deskę rozdzielczą, i posprzątaj przed sesją.
        </p>
        <Input
          id="images"
          name="images"
          type="file"
          accept="image/*"
          multiple
          required
          onChange={handleFilesChange}
        />
        {previews.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Przeciągnij nasze logo, aby ukryć swoją tablicę rejestracyjną. Jeśli na
              zdjęciu nie widać tablicy, możesz je pominąć.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {previews.map((src, i) => (
                <div key={i} className="space-y-1">
                  <PlateCoverEditor
                    imageUrl={src}
                    sticker={stickers[i] ?? null}
                    onChange={(rect) => updateSticker(i, rect)}
                  />
                  <button
                    type="button"
                    onClick={() => toggleSticker(i)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {stickers[i]
                      ? "Nie widać tablicy na tym zdjęciu — usuń logo"
                      : "Przywróć logo na tym zdjęciu"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <input type="checkbox" name="rental_right" required className="mt-0.5 size-4 shrink-0" />
        <span>
          {forOwnerId
            ? "Właściciel potwierdził nam, że może wynajmować to auto — jest jego właścicielem albo ma zgodę właściciela lub leasingodawcy na odpłatny wynajem."
            : "Potwierdzam, że mogę wynajmować to auto — auto jest moje albo mam zgodę właściciela lub leasingodawcy na odpłatny wynajem."}
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending || submitted || checkingPhotos}>
        {submitted
          ? "Zapisane — przechodzimy dalej…"
          : isPending
            ? status ?? "Chwileczkę…"
            : checkingPhotos
              ? "Sprawdzamy zdjęcia…"
              : forOwnerId
                ? "Dodaj i zatwierdź auto"
                : "Dodaj auto do weryfikacji"}
      </Button>
    </form>
  );
}
