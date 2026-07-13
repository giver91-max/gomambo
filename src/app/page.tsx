import { createClient } from "@/lib/supabase/server";
import { LandingPage, type LandingCar } from "@/components/landing-page";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  let displayName = "Panel";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single();
    isAdmin = profile?.role === "admin";
    displayName = profile?.full_name || "Panel";
  }

  let maintenanceMode = false;
  if (!isAdmin) {
    const { data: siteSettings } = await supabase
      .from("site_settings")
      .select("maintenance_mode")
      .eq("id", 1)
      .single();
    maintenanceMode = siteSettings?.maintenance_mode ?? false;
  }

  const { data: cars } = maintenanceMode
    ? { data: [] }
    : await supabase
        .from("cars")
        .select("id, brand, model, year, city, price_per_day, car_images(storage_path, position)")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .order("position", { referencedTable: "car_images", ascending: true })
        .limit(6);

  const landingCars: LandingCar[] = (cars ?? []).map((car) => {
    const images = (car.car_images ?? []) as {
      storage_path: string;
      position: number;
    }[];
    const imageUrl = images[0]
      ? supabase.storage.from("car-images").getPublicUrl(images[0].storage_path)
          .data.publicUrl
      : null;

    return {
      id: car.id,
      brand: car.brand,
      model: car.model,
      year: car.year,
      city: car.city,
      pricePerDay: Number(car.price_per_day),
      imageUrl,
    };
  });

  return <LandingPage cars={landingCars} isLoggedIn={!!user} displayName={displayName} />;
}
