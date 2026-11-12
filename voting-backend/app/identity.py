"""
Identity verification adapter.

This is intentionally a MOCK for the student project — real Aadhaar eKYC
access requires UIDAI authorization that a student project won't have.
The point to make in your report: the rest of the system (token issuance,
Merkle tree, voting, tallying) doesn't care which verifier ran — it only
receives a yes/no "is this voter_id eligible and not yet issued a token".
"""


def verify_identity(domain: str, voter_id: str) -> bool:
    """
    domain: "GOVT" or "COLLEGE"
    voter_id: Aadhaar-linked Voter ID (GOVT) or roll number / college email (COLLEGE)

    Replace the bodies below with real calls:
      - GOVT: UIDAI Aadhaar OTP verification API
      - COLLEGE: institutional SSO / college email OTP
    """
    if domain == "GOVT":
        # Accept any non-empty voter ID string (e.g. Voter ID / Aadhaar / Reg No)
        return bool(voter_id and len(voter_id.strip()) >= 1)
    elif domain == "COLLEGE":
        # Accept any non-empty college roll number or email
        return bool(voter_id and len(voter_id.strip()) >= 1)
    return True
