export type ProfileRole = "owner" | "admin";
export type CarStatus = "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  role: ProfileRole;
  full_name: string;
  phone: string | null;
  avatar_path: string | null;
  notify_email: boolean;
  notify_sms: boolean;
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

export type Favorite = {
  id: string;
  user_id: string;
  car_id: string;
  created_at: string;
};

export type BookingStatus = "requested" | "accepted" | "declined" | "cancelled" | "completed";

export type Booking = {
  id: string;
  car_id: string;
  owner_id: string;
  renter_id: string;
  start_date: string;
  end_date: string;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  car_id: string;
  owner_id: string;
  renter_id: string;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
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
      favorites: {
        Row: Favorite;
        Insert: Partial<Favorite> & { user_id: string; car_id: string };
        Update: Partial<Favorite>;
        Relationships: [
          {
            foreignKeyName: "favorites_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: Booking;
        Insert: Partial<Booking> & {
          car_id: string;
          owner_id: string;
          renter_id: string;
          start_date: string;
          end_date: string;
        };
        Update: Partial<Booking>;
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: Conversation;
        Insert: Partial<Conversation> & { car_id: string; owner_id: string; renter_id: string };
        Update: Partial<Conversation>;
        Relationships: [
          {
            foreignKeyName: "conversations_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: Message;
        Insert: Partial<Message> & { conversation_id: string; sender_id: string; body: string };
        Update: Partial<Message>;
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
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
