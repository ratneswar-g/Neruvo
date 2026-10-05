import { AuthSession, AuthUser, IAuthService } from './types.ts';

export interface OtpRequestParams {
  phoneNumber: string; // E.164 formatted string
}

export interface OtpRequestResult {
  success: boolean;
  referenceId: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
}

export interface OtpVerificationParams {
  phoneNumber: string;
  referenceId: string;
  code: string;
}

export interface RegistrationParams {
  phoneNumber: string;
  name: string;
  role: 'PATIENT' | 'CARE_PARTNER' | 'FAMILY_CONTACT';
}

/**
 * Production Authentication Contract.
 * Outlines the interface for SMS/OTP phone verification when a real SMS provider is integrated.
 * In Phase 2, this contract is defined but intentionally not implemented with real providers.
 */
export interface IProductionOTPAuthService extends IAuthService {
  /**
   * Dispatches an SMS OTP to the user's verified phone number.
   * Throws if provider quota is exceeded or number format is invalid.
   */
  requestOtp(params: OtpRequestParams): Promise<OtpRequestResult>;

  /**
   * Verifies the 6-digit OTP code against the active reference ID.
   * Returns an authoritative authenticated session.
   */
  verifyOtp(params: OtpVerificationParams): Promise<AuthSession>;

  /**
   * Completes initial profile setup during first-time phone sign-up.
   */
  registerUser(params: RegistrationParams): Promise<AuthUser>;
}
