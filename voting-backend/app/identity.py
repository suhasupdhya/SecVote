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
        # Placeholder rule: looks like a real Voter ID (e.g. ABC1234567)
        return len(voter_id) >= 6
    elif domain == "COLLEGE":
        # Placeholder rule: must look like a college email or roll number
        return "@" in voter_id or voter_id.isalnum()
    return False
