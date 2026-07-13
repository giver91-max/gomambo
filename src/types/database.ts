export type ProfileRole = "owner" | "admin";
export type CarStatus = "pending" | "approved" | "rejected" | "paused";

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

export type Review = {
  id: string;
  booking_id: string;
  car_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
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

export type SiteSettings = {
  id: number;
  maintenance_mode: boolean;
  updated_at: string;
};

export type AdminConversation = {
  id: string;
  user_id: string;
  created_at: string;
};

export type AdminChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type AdminNotification = {
  id: string;
  type: "new_registration" | "new_car_pending" | "new_identity_verification";
  body: string;
  link: string | null;
  created_at: string;
};

export type IdentityVerificationStatus = "pending" | "approved" | "rejected";

export type IdentityVerification = {
  id: string;
  user_id: string;
  document_path: string;
  status: IdentityVerificationStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminNotificationRead = {
  id: string;
  notification_id: string;
  user_id: string;
  read_at: string;
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
      reviews: {
        Row: Review;
        Insert: Partial<Review> & {
          booking_id: string;
          reviewer_id: string;
          reviewee_id: string;
          rating: number;
        };
        Update: Partial<Review>;
        Relationships: [
          {
            foreignKeyName: "reviews_car_id_fkey";
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
      site_settings: {
        Row: SiteSettings;
        Insert: Partial<SiteSettings> & { id: number };
        Update: Partial<SiteSettings>;
        Relationships: [];
      };
      admin_conversations: {
        Row: AdminConversation;
        Insert: Partial<AdminConversation> & { user_id: string };
        Update: Partial<AdminConversation>;
        Relationships: [
          {
            foreignKeyName: "admin_conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_chat_messages: {
        Row: AdminChatMessage;
        Insert: Partial<AdminChatMessage> & { conversation_id: string; sender_id: string; body: string };
        Update: Partial<AdminChatMessage>;
        Relationships: [
          {
            foreignKeyName: "admin_chat_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "admin_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_notifications: {
        Row: AdminNotification;
        Insert: Partial<AdminNotification> & { type: AdminNotification["type"]; body: string };
        Update: Partial<AdminNotification>;
        Relationships: [];
      };
      admin_notification_reads: {
        Row: AdminNotificationRead;
        Insert: Partial<AdminNotificationRead> & { notification_id: string; user_id: string };
        Update: Partial<AdminNotificationRead>;
        Relationships: [
          {
            foreignKeyName: "admin_notification_reads_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "admin_notifications";
            referencedColumns: ["id"];
          },
        ];
      };
      identity_verifications: {
        Row: IdentityVerification;
        Insert: Partial<IdentityVerification> & { user_id: string; document_path: string };
        Update: Partial<IdentityVerification>;
        Relationships: [
          {
            foreignKeyName: "identity_verifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
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
