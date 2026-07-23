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
  terms_accepted_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
  created_at: string;
};

export type VehicleType =
  | "sedan"
  | "kombi"
  | "hatchback"
  | "suv"
  | "van"
  | "dostawczy"
  | "sportowe"
  | "kabriolet"
  | "elektryczne"
  | "inne";
export type FuelType = "benzyna" | "diesel" | "hybryda" | "elektryczny" | "lpg";
export type Transmission = "manualna" | "automatyczna";
export type CancellationPolicy = "flexible" | "moderate" | "strict";
export type FuelPolicy = "full_to_full" | "same_level" | "included";
export type FuelLevel = "empty" | "quarter" | "half" | "three_quarters" | "full";

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
  registration_number: string | null;
  insurance_document_path: string | null;
  vehicle_type: VehicleType | null;
  fuel_type: FuelType | null;
  transmission: Transmission | null;
  seats: number | null;
  mileage_limit_km: number | null;
  mileage_overage_fee_per_km: number | null;
  fuel_policy: FuelPolicy | null;
  security_deposit_amount: number | null;
  price_per_month: number | null;
  delivery_available: boolean;
  delivery_info: string | null;
  cancellation_policy: CancellationPolicy;
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
export type PaymentStatus = "unpaid" | "paid" | "refunded" | "partially_refunded" | "failed";
export type DepositStatus = "not_required" | "held" | "captured" | "released" | "failed";

export type Booking = {
  id: string;
  car_id: string;
  owner_id: string;
  renter_id: string;
  start_date: string;
  end_date: string;
  status: BookingStatus;
  pickup_odometer_km: number | null;
  pickup_fuel_level: FuelLevel | null;
  return_odometer_km: number | null;
  return_fuel_level: FuelLevel | null;
  total_price: number | null;
  platform_fee_amount: number | null;
  stripe_checkout_session_id: string | null;
  payment_status: PaymentStatus;
  deposit_amount: number | null;
  stripe_deposit_payment_intent_id: string | null;
  deposit_status: DepositStatus;
  created_at: string;
  updated_at: string;
};

export type BookingExtraChargeStatus = "requested" | "paid" | "cancelled";

export type BookingExtraCharge = {
  id: string;
  booking_id: string;
  amount_pln: number;
  reason: string;
  status: BookingExtraChargeStatus;
  stripe_checkout_session_id: string | null;
  created_at: string;
};

export type BookingExtensionStatus = "pending" | "paid" | "expired";

export type BookingExtension = {
  id: string;
  booking_id: string;
  new_end_date: string;
  additional_amount_pln: number;
  status: BookingExtensionStatus;
  stripe_checkout_session_id: string | null;
  created_at: string;
};

export type TripPhotoStage = "pickup" | "return";

export type TripPhoto = {
  id: string;
  booking_id: string;
  uploader_id: string;
  stage: TripPhotoStage;
  storage_path: string;
  created_at: string;
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
  deleted_at: string | null;
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
  deleted_at: string | null;
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
  deleted_at: string | null;
};

export type AdminNotification = {
  id: string;
  type: "new_registration" | "new_car_pending" | "new_identity_verification" | "new_referral";
  body: string;
  link: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type Referral = {
  id: string;
  referrer_id: string;
  referred_id: string;
  created_at: string;
};

export type IdentityVerificationStatus = "pending" | "approved" | "rejected";
export type FaceMatchResult = "not_run" | "match" | "no_match" | "error";
export type VerificationMethod = "manual" | "phone_handoff";

export type IdentityVerification = {
  id: string;
  user_id: string;
  document_path: string;
  document_back_path: string | null;
  selfie_path: string | null;
  status: IdentityVerificationStatus;
  rejection_reason: string | null;
  face_match_score: number | null;
  face_match_result: FaceMatchResult;
  verification_method: VerificationMethod;
  biometric_consent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HandoffStatus =
  | "pending"
  | "code_sent"
  | "claimed"
  | "photos_uploaded"
  | "completed"
  | "expired"
  | "cancelled";

export type IdentityVerificationHandoff = {
  id: string;
  user_id: string;
  token: string;
  email: string;
  code_hash: string | null;
  code_expires_at: string | null;
  code_attempts: number;
  code_send_count: number;
  code_last_sent_at: string | null;
  status: HandoffStatus;
  claimed_at: string | null;
  handoff_expires_at: string;
  document_front_path: string | null;
  document_back_path: string | null;
  selfie_path: string | null;
  document_front_uploaded_at: string | null;
  document_back_uploaded_at: string | null;
  selfie_uploaded_at: string | null;
  result_identity_verification_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminNotificationRead = {
  id: string;
  notification_id: string;
  user_id: string;
  read_at: string;
};

export type NotificationType =
  | "car_approved"
  | "car_rejected"
  | "booking_accepted"
  | "booking_declined"
  | "booking_cancelled"
  | "identity_verification_approved"
  | "identity_verification_rejected"
  | "booking_paid"
  | "deposit_captured"
  | "booking_confirmed"
  | "extra_charge_requested"
  | "booking_extended";

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationType;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
  deleted_at: string | null;
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
      booking_extra_charges: {
        Row: BookingExtraCharge;
        Insert: Partial<BookingExtraCharge> & { booking_id: string; amount_pln: number; reason: string };
        Update: Partial<BookingExtraCharge>;
        Relationships: [
          {
            foreignKeyName: "booking_extra_charges_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_extensions: {
        Row: BookingExtension;
        Insert: Partial<BookingExtension> & {
          booking_id: string;
          new_end_date: string;
          additional_amount_pln: number;
        };
        Update: Partial<BookingExtension>;
        Relationships: [
          {
            foreignKeyName: "booking_extensions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_photos: {
        Row: TripPhoto;
        Insert: Partial<TripPhoto> & {
          booking_id: string;
          uploader_id: string;
          stage: TripPhotoStage;
          storage_path: string;
        };
        Update: Partial<TripPhoto>;
        Relationships: [
          {
            foreignKeyName: "trip_photos_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
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
      notifications: {
        Row: Notification;
        Insert: Partial<Notification> & { user_id: string; type: NotificationType; body: string };
        Update: Partial<Notification>;
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      identity_verification_handoffs: {
        Row: IdentityVerificationHandoff;
        Insert: Partial<IdentityVerificationHandoff> & { user_id: string; token: string; email: string };
        Update: Partial<IdentityVerificationHandoff>;
        Relationships: [
          {
            foreignKeyName: "identity_verification_handoffs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "identity_verification_handoffs_result_identity_verification_id_fkey";
            columns: ["result_identity_verification_id"];
            isOneToOne: false;
            referencedRelation: "identity_verifications";
            referencedColumns: ["id"];
          },
        ];
      };
      referrals: {
        Row: Referral;
        Insert: Partial<Referral> & { referrer_id: string; referred_id: string };
        Update: Partial<Referral>;
        Relationships: [
          {
            foreignKeyName: "referrals_referrer_id_fkey";
            columns: ["referrer_id"];
            isOneToOne: false;
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
