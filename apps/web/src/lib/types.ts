export type Role = "voter" | "admin" | "officer" | "trustee" | "observer"
export type Phase = "pending" | "registration" | "awaiting_vote" | "voting" | "closed"

export type User = { id: string; email: string; name: string; roles: Role[]; email_verified: boolean }

export type Candidate = { id: string; name: string; manifesto: string }
export type Race = { id: string; title: string; seats: number; method: string; candidates: Candidate[] }

export type Election = {
  id: string
  slug: string
  title: string
  org: string
  description: string
  races: Race[]
  allow_nota: boolean
  mode: "open" | "sealed"
  high_stakes: boolean
  /** only registration numbers on the office's voter list may apply */
  eligible_only?: boolean
  reg_start: string
  reg_end: string
  vote_start: string
  vote_end: string
  status: "draft" | "deploying" | "published" | "failed"
  phase: Phase | null
  chain: {
    address: string | null
    scope: string | null
    frozen: boolean
    frozen_root: string | null
    member_count: number
    ballot_count: number
    paused: boolean
    result_hash: string | null
    deploy_block: number | null
    error: string | null
    public_key: string | null
    revealed_key: string | null
  }
  transactions?: { id: string; kind: string; status: string; tx_hash: string | null; error: string | null }[]
  trustees?: TrusteeRow[]
  ceremony_at?: string | null
  roll_status?: { pending_review: number; approved_no_identity: number; joining_roll: number; enrolled: number }
}

export type RegistrationStatus = "pending_review" | "approved" | "rejected" | "commitment_submitted" | "enrolled"

export type Registration = {
  id: string
  election_id: string
  election_title: string | null
  election_slug: string | null
  status: RegistrationStatus
  reg_no: string
  department?: string
  year?: number
  commitment: string | null
  member_index: number | null
  reject_reason: string | null
  /** 1 for the first application, 2 after re-applying. A rejected voter may re-apply once. */
  attempts: number
  max_attempts: number
  can_reapply: boolean
  auto_approved?: boolean
  enrol_code_sent?: boolean
  enrol_code_expires?: string | null
  phase?: Phase | null
}

export type ReviewItem = {
  id: string
  status: RegistrationStatus
  name: string
  email: string
  reg_no: string
  department: string
  year: number
  approvals: number
  approvals_needed: number
  approved_by_me: boolean
  has_document: boolean
  attempts: number
  max_attempts: number
  previous_reject_reason: string | null
  reject_reason: string | null
  on_list: boolean
  auto_approved: boolean
}

export type BallotStatus = {
  ballot_id: string
  election_id: string
  status: "pending" | "sent" | "confirmed" | "failed"
  tx_hash: string | null
  block_number: number | null
  nullifier: string
  on_bulletin: boolean
  index: number | null
  error: string | null
}

export type Results = {
  mode: string
  final: boolean
  /** true once the officer has declared the result on chain */
  published: boolean
  /** true when an official is looking at a not-yet-published count */
  preview: boolean
  ballots: number
  computed_hash: string | null
  declared_hash: string | null
  /** sealed election whose key hasn't been revealed yet: nobody can count */
  awaiting_key?: boolean
  races: null | {
    race_id: string
    title: string
    method: "plurality" | "irv"
    candidates: { id: string; name: string; votes: number }[]
    nota: number
    abstain: number
    invalid: number
    winner: number
    first: number[] | null
    rounds: { counts: number[]; exhausted: number }[] | null
  }[]
}

export type TrusteeRow = {
  id: string
  slot: number
  name: string
  email: string
  public_key: string | null
  key_registered: boolean
  share_issued: boolean
  share_uploaded: boolean
}

export type TrusteeElection = {
  election_id: string
  slug: string
  title: string
  org: string
  status: "draft" | "deploying" | "published" | "failed"
  phase: Phase | null
  slot: number
  key_registered: boolean
  trustee_public_key: string | null
  ceremony_done: boolean
  share_issued: boolean
  share_uploaded: boolean
  key_revealed: boolean
  vote_end: string
}
