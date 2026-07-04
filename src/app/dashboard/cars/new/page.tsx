import { NewCarForm } from "./new-car-form";

export default function NewCarPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Dodaj auto</h1>
      <p className="text-sm text-muted-foreground">
        Po dodaniu auto trafi do weryfikacji przez administratora. Otrzymasz
        informację, gdy zostanie zatwierdzone lub odrzucone.
      </p>
      <NewCarForm />
    </div>
  );
}
