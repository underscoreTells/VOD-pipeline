import type { Asset } from '../types/database.js';

export interface IPCSuccess<T> {
  success: true;
  data: T;
}

export interface IPCFailure {
  success: false;
  error: string;
  code?: string;
}

export type IPCResult<T> = IPCSuccess<T> | IPCFailure;

export interface DependencyStatus {
  name: string;
  available: boolean;
  detail: string;
  required: boolean;
}

export interface EnvironmentDoctorResult {
  ok: boolean;
  statuses: DependencyStatus[];
}

export type AssetAvailabilityIssue = 'missing_file' | 'missing_parent';

export interface AssetAvailability {
  exists: boolean;
  issue: AssetAvailabilityIssue | null;
  savedPath: string;
  nearestExistingAncestor: string | null;
  checkedAt: string;
}

export type ProjectAsset = Asset & {
  availability: AssetAvailability;
};

export class AgentStreamParseError extends Error {
  line: string;
  cause?: unknown;

  constructor(line: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? 'Unknown parse failure');
    super(`Failed to parse NDJSON line: ${detail}`);
    this.name = 'AgentStreamParseError';
    this.line = line;
    this.cause = cause;
  }
}
