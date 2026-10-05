-- Neravu Phase 6B: Initial Relational Schema
-- Version: 001
-- Description: Core relational schema for users, profiles, family contacts, permissions,
--              hospitals, vehicles, journeys, state history, pricing snapshots, emergency incidents, and audit logs.

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  phone VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Patient Profiles
CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_address JSONB NOT NULL,
  mobility_notes TEXT,
  preferred_hospital_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Care Partner Profiles
CREATE TABLE IF NOT EXISTS care_partner_profiles (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  languages_spoken TEXT[] NOT NULL DEFAULT '{}',
  vehicle_type VARCHAR(64),
  vehicle_registration VARCHAR(64),
  verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  availability_status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Family Contacts
CREATE TABLE IF NOT EXISTS family_contacts (
  id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(64) NOT NULL,
  relationship VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Trusted Contact Permissions
CREATE TABLE IF NOT EXISTS trusted_contact_permissions (
  contact_id VARCHAR(64) PRIMARY KEY REFERENCES family_contacts(id) ON DELETE CASCADE,
  permission_level VARCHAR(32) NOT NULL DEFAULT 'EMERGENCY_ONLY',
  can_view_status BOOLEAN NOT NULL DEFAULT true,
  can_view_location BOOLEAN NOT NULL DEFAULT false,
  can_view_clinical_context BOOLEAN NOT NULL DEFAULT false,
  can_receive_emergency_notifications BOOLEAN NOT NULL DEFAULT true,
  can_communicate_with_partner BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Hospitals
CREATE TABLE IF NOT EXISTS hospitals (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  entrance_or_department VARCHAR(255),
  access_notes TEXT,
  emergency_contact_phone VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR(64) PRIMARY KEY,
  partner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  year INTEGER NOT NULL,
  license_plate VARCHAR(64) NOT NULL UNIQUE,
  accessibility_features TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Journeys
CREATE TABLE IF NOT EXISTS journeys (
  id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id),
  care_partner_id VARCHAR(64) REFERENCES users(id),
  current_state VARCHAR(64) NOT NULL DEFAULT 'REQUESTED',
  booking_type VARCHAR(32) NOT NULL DEFAULT 'ON_DEMAND',
  is_round_trip BOOLEAN NOT NULL DEFAULT true,
  pickup_location JSONB NOT NULL,
  hospital_destination JSONB NOT NULL,
  return_dropoff_location JSONB NOT NULL,
  special_assistance_notes TEXT,
  previous_state_before_emergency VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Journey State History (Audit trail of every transition)
CREATE TABLE IF NOT EXISTS journey_state_history (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  from_state VARCHAR(64) NOT NULL,
  to_state VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Pricing Snapshots (Immutable fare snapshot per booking)
CREATE TABLE IF NOT EXISTS pricing_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE UNIQUE,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  total_estimated_fare NUMERIC(10, 2) NOT NULL,
  base_booking_fee NUMERIC(10, 2) NOT NULL,
  transit_distance_fee NUMERIC(10, 2) NOT NULL,
  companion_service_time_fee NUMERIC(10, 2) NOT NULL,
  platform_service_fee NUMERIC(10, 2) NOT NULL,
  taxes_fee NUMERIC(10, 2) NOT NULL,
  is_estimate BOOLEAN NOT NULL DEFAULT true,
  is_development_pricing BOOLEAN NOT NULL DEFAULT true,
  breakdown_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Emergency Incidents (Operational incident logs, non-clinical resolution)
CREATE TABLE IF NOT EXISTS emergency_incidents (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  category VARCHAR(64) NOT NULL,
  description TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  state_at_trigger VARCHAR(64) NOT NULL,
  previous_journey_state VARCHAR(64),
  location_snapshot JSONB,
  destination_snapshot JSONB,
  triggered_by_user_id VARCHAR(64) NOT NULL,
  triggered_by_role VARCHAR(32),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id VARCHAR(64),
  resolution_notes TEXT -- STRICTLY NON-CLINICAL OPERATIONAL NOTES ONLY
);

-- 12. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performant lookups and relational integrity
CREATE INDEX IF NOT EXISTS idx_journeys_patient_id ON journeys(patient_id);
CREATE INDEX IF NOT EXISTS idx_journeys_care_partner_id ON journeys(care_partner_id);
CREATE INDEX IF NOT EXISTS idx_journeys_current_state ON journeys(current_state);
CREATE INDEX IF NOT EXISTS idx_state_history_journey_id ON journey_state_history(journey_id);
CREATE INDEX IF NOT EXISTS idx_emergency_journey_id ON emergency_incidents(journey_id);
CREATE INDEX IF NOT EXISTS idx_emergency_status ON emergency_incidents(status);
CREATE INDEX IF NOT EXISTS idx_family_contacts_patient_id ON family_contacts(patient_id);
