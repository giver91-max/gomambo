export type ProfileRole = "owner" | "admin";

// A professional rental company. Deliberately NOT a role on profiles: a
// company is not a login, it has many members, and its legal identity must
// not sit on a row a booking counterparty can read (migration 0042).
export type PartnerStatus = "draft" | "pending" | "active" | "suspended" | "terminated";
export type PartnerMemberRole = "owner" | "manager" | "staff";
export type PartnerDocumentKind =
  | "krs"
  | "ceidg"
  | "nip_confirmation"
  | "insurance"
  | "other";

// Public half — what a customer is shown about who is renting them the car.
export type Partner = {
  id: string;
  trade_name: string;
  city: string | null;
  description: string | null;
  logo_path: string | null;
  status: PartnerStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

// Members and admins only.
export type PartnerPrivate = {
  partner_id: string;
  legal_name: string | null;
  nip: string | null;
  regon: string | null;
  krs: string | null;
  address_street: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
  updated_at: string;
};

export type PartnerMember = {
  partner_id: string;
  profile_id: string;
  role: PartnerMemberRole;
  created_at: string;
};

export type PartnerDocument = {
  id: string;
  partner_id: string;
  kind: PartnerDocumentKind;
  storage_path: string;
  original_name: string | null;
  valid_until: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
};
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
  // Lets this account browse/book while the site is in maintenance mode.
  maintenance_bypass: boolean;
  created_at: string;
};

// Per-owner platform commission override (fleet promo). Fraction 0–1,
// strictly < 1; no row = platform default (see src/lib/commission.ts).
export type OwnerCommissionOverride = {
  owner_id: string;
  commission_rate: number;
  commission_rate_until: string | null;
  updated_at: string;
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
  // Set when the car is operated by a professional Partner rather than an
  // individual. owner_id stays the acting person — payouts and conversations
  // hang off it (migration 0042).
  partner_id: string | null;
  // Peer-to-peer listings keep the instant book they have today; Partner
  // cars are created with false, because Rafał's decision is that a Partner
  // confirms each booking.
  instant_book: boolean;
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

// Kept off public.cars on purpose: an approved listing is world-readable and
// RLS filters rows, never columns, so anything here would otherwise be served
// to anonymous REST clients along with the price (migration 0037).
export type CarPrivate = {
  car_id: string;
  registration_number: string | null;
  insurance_document_path: string | null;
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

// Stripe Checkout, or a bank transfer an admin confirms by hand.
export type PaymentMethod = "stripe" | "bank_transfer";

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
  payment_method: PaymentMethod;
  deposit_amount: number | null;
  stripe_deposit_payment_intent_id: string | null;
  deposit_status: DepositStatus;
  created_at: string;
  updated_at: string;
  pickup_instructions_sent_at: string | null;
};

export type BookingExtraChargeStatus = "requested" | "paid" | "cancelled";

export type BookingExtraCharge = {
  id: string;
  booking_id: string;
  amount_pln: number;
  reason: string;
  status: BookingExtraChargeStatus;
  payment_method: PaymentMethod;
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
  // Platform fee Stripe took on this extension (null before 0033 / unpaid).
  platform_fee_pln: number | null;
  // Set when the extension's own Stripe charge was refunded on cancellation.
  refunded_at: string | null;
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
  type:
    | "new_registration"
    | "new_car_pending"
    | "new_identity_verification"
    | "new_referral"
    | "commission_fallback"
    | "refund_failed"
    | "deposit_release_failed"
    | "bank_transfer_declared"
    | "damage_reported"
    | "booking_verification_escalated"
    | "new_partner_pending";
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
  | "booking_extended"
  | "payment_failed"
  | "damage_reported"
  | "booking_verification_requested"
  | "booking_verification_approved"
  | "booking_verification_pending_owner";

export type DamageReportStatus = "open" | "resolved";

// Filed by either side of a rental; reaches the other party AND GoMambo.
// No client insert policy — the server action writes it, so nobody can file
// a report in the counterparty's name.
export type DamageReport = {
  id: string;
  booking_id: string;
  reporter_id: string;
  reporter_role: "owner" | "renter";
  description: string;
  status: DamageReportStatus;
  created_at: string;
  resolved_at: string | null;
};

// Separate table, not a column: the report row is readable by both booking
// participants, and RLS cannot hide a column from them (migration 0039).
export type DamageReportNote = {
  report_id: string;
  note: string;
  updated_at: string;
};

// Per-BOOKING re-verification shortly before pickup. identity_verifications
// is per USER and approved once, which does not catch an account handed to
// someone else afterwards — the risk that actually matters at handover.
export type BookingVerification = {
  booking_id: string;
  status: "pending_renter" | "pending_owner" | "approved" | "escalated";
  selfie_path: string | null;
  face_match_result: FaceMatchResult | null;
  face_match_score: number | null;
  requested_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  escalated_at: string | null;
  reminder_sent_at: string | null;
};

// Separate table, not a column: the verification row is readable by both
// participants, and an owner's objection or GoMambo's note is an unverified
// accusation about one of them (migration 0041).
export type BookingVerificationNote = {
  booking_id: string;
  reason: string;
  updated_at: string;
};

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
          {
            foreignKeyName: "cars_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partners: {
        Row: Partner;
        Insert: Partial<Partner> & { trade_name: string };
        Update: Partial<Partner>;
        Relationships: [];
      };
      partner_private: {
        Row: PartnerPrivate;
        Insert: Partial<PartnerPrivate> & { partner_id: string };
        Update: Partial<PartnerPrivate>;
        Relationships: [
          {
            foreignKeyName: "partner_private_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: true;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_members: {
        Row: PartnerMember;
        Insert: Partial<PartnerMember> & { partner_id: string; profile_id: string };
        Update: Partial<PartnerMember>;
        Relationships: [
          {
            foreignKeyName: "partner_members_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_documents: {
        Row: PartnerDocument;
        Insert: Partial<PartnerDocument> & {
          partner_id: string;
          kind: PartnerDocumentKind;
          storage_path: string;
        };
        Update: Partial<PartnerDocument>;
        Relationships: [
          {
            foreignKeyName: "partner_documents_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
        ];
      };
      car_private: {
        Row: CarPrivate;
        Insert: Partial<CarPrivate> & { car_id: string };
        Update: Partial<CarPrivate>;
        Relationships: [
          {
            foreignKeyName: "car_private_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: true;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_verification_notes: {
        Row: BookingVerificationNote;
        Insert: Partial<BookingVerificationNote> & { booking_id: string; reason: string };
        Update: Partial<BookingVerificationNote>;
        Relationships: [
          {
            foreignKeyName: "booking_verification_notes_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "booking_verifications";
            referencedColumns: ["booking_id"];
          },
        ];
      };
      booking_verifications: {
        Row: BookingVerification;
        Insert: Partial<BookingVerification> & { booking_id: string };
        Update: Partial<BookingVerification>;
        Relationships: [
          {
            foreignKeyName: "booking_verifications_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      damage_report_notes: {
        Row: DamageReportNote;
        Insert: Partial<DamageReportNote> & { report_id: string; note: string };
        Update: Partial<DamageReportNote>;
        Relationships: [
          {
            foreignKeyName: "damage_report_notes_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: true;
            referencedRelation: "damage_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      damage_reports: {
        Row: DamageReport;
        Insert: Partial<DamageReport> & {
          booking_id: string;
          reporter_id: string;
          reporter_role: "owner" | "renter";
          description: string;
        };
        Update: Partial<DamageReport>;
        Relationships: [
          {
            foreignKeyName: "damage_reports_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
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
      owner_commission_overrides: {
        Row: OwnerCommissionOverride;
        Insert: Partial<OwnerCommissionOverride> & { owner_id: string; commission_rate: number };
        Update: Partial<OwnerCommissionOverride>;
        Relationships: [
          {
            foreignKeyName: "owner_commission_overrides_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
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
