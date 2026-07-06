export type ProfileRole = "owner" | "admin";
export type CarStatus = "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  role: ProfileRole;
  full_name: string;
  phone: string | null;
  created_at: string;
};

export type Car = {
  id: string;
  owner_id: string;
  brand: string;
  model: string;
  year: number;
  price_per_day: number;
  city: string;
  description: string | null;
  status: CarStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CarImage = {
  id: string;
  car_id: string;
  storage_path: string;
  position: number;
  created_at: string;
};

export type CarAvailability = {
  id: string;
  car_id: string;
  date: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      cars: {
        Row: Car;
        Insert: Partial<Car> & {
          owner_id: string;
          brand: string;
          model: string;
          year: number;
          price_per_day: number;
          city: string;
        };
        Update: Partial<Car>;
        Relationships: [
          {
            foreignKeyName: "cars_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      car_images: {
        Row: CarImage;
        Insert: Partial<CarImage> & { car_id: string; storage_path: string };
        Update: Partial<CarImage>;
        Relationships: [
          {
            foreignKeyName: "car_images_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      car_availability: {
        Row: CarAvailability;
        Insert: Partial<CarAvailability> & { car_id: string; date: string };
        Update: Partial<CarAvailability>;
        Relationships: [
          {
            foreignKeyName: "car_availability_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
