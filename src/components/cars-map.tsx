"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { getCityCoords } from "@/lib/pl-cities";

export type MapCar = {
  id: string;
  brand: string;
  model: string;
  city: string;
  pricePerDay: number;
};

export function CarsMap({ cars }: { cars: MapCar[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;

    (async () => {
      const L = (await import("leaflet")).default;

      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!containerRef.current) return;

      map = L.map(containerRef.current).setView([52.0, 19.3], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const byCity = new Map<string, MapCar[]>();
      for (const car of cars) {
        const coords = getCityCoords(car.city);
        if (!coords) continue;
        const list = byCity.get(car.city) ?? [];
        list.push(car);
        byCity.set(car.city, list);
      }

      for (const [city, cityCars] of Array.from(byCity.entries())) {
        const coords = getCityCoords(city);
        if (!coords) continue;
        const marker = L.marker(coords).addTo(map!);
        const popupHtml = `
          <div style="min-width:180px">
            <p style="font-weight:600;margin-bottom:4px">${city} (${cityCars.length})</p>
            ${cityCars
              .slice(0, 5)
              .map(
                (c) =>
                  `<a href="/auta/${c.id}" style="display:block;font-size:13px;padding:2px 0;color:#0284c7">${c.brand} ${c.model} — ${c.pricePerDay.toFixed(0)} zł/dzień</a>`
              )
              .join("")}
            ${cityCars.length > 5 ? `<p style="font-size:12px;color:#888;margin-top:4px">+ ${cityCars.length - 5} więcej</p>` : ""}
          </div>
        `;
        marker.bindPopup(popupHtml);
      }
    })();

    return () => {
      map?.remove();
    };
  }, [cars]);

  return <div ref={containerRef} className="h-[500px] w-full rounded-lg border" />;
}
