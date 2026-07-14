"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CarsMap, type MapCar } from "./cars-map";

export function ResultsViewToggle({
  mapCars,
  children,
}: {
  mapCars: MapCar[];
  children: React.ReactNode;
}) {
  const [view, setView] = useState<"list" | "map">("list");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn(
            "px-3 py-2 text-sm",
            view === "list" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
          )}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setView("map")}
          className={cn(
            "px-3 py-2 text-sm",
            view === "map" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
          )}
        >
          Mapa
        </button>
      </div>

      {view === "list" ? children : <CarsMap cars={mapCars} />}
    </div>
  );
}
