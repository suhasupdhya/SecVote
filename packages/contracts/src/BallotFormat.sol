// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BallotFormat
/// @notice On-chain half of docs/ballot-format.md. The browser (apps/web/src/lib/crypto/ballot.ts),
/// the API (secvote.domain.ballot) and this library must agree byte for byte.
///
/// Open ballot, version 1, fixed 64 bytes:
///   [0]        version   = 0x01
///   [1]        mode      = 0x00 (open)
///   [2]        raceCount = R (must equal the election's race count)
///   [3..3+R)   one choice byte per race: candidate index, NOTA (0xFE) or ABSTAIN (0xFF)
///   [3+R..64)  zero padding (canonical: must be zero)
library BallotFormat {
    uint8 internal constant VERSION = 0x01;
    uint8 internal constant MODE_OPEN = 0x00;
    uint8 internal constant MODE_SEALED = 0x01;
    uint256 internal constant OPEN_BALLOT_SIZE = 64;
    /// @dev Sealed ballots: ECIES ciphertext of a fixed 256-byte plaintext
    /// (65 ephemeral pk + 16 nonce + 16 tag + 256). See docs/ballot-format.md.
    uint256 internal constant SEALED_BALLOT_SIZE = 353;
    uint8 internal constant METHOD_PLURALITY = 0;
    uint8 internal constant METHOD_IRV = 1;
    uint256 internal constant PUBLIC_KEY_SIZE = 33; // compressed secp256k1
    uint8 internal constant NOTA = 0xFE;
    uint8 internal constant ABSTAIN = 0xFF;
    uint8 internal constant MAX_RACES = 32;
    uint8 internal constant MAX_CANDIDATES = 200;

    error BallotFormat__BadLength();
    error BallotFormat__BadHeader();
    error BallotFormat__BadRaceCount();
    error BallotFormat__BadChoice(uint256 race, uint8 choice);
    error BallotFormat__NonCanonicalPadding();

    /// @notice Validates an open ballot and returns the choice for each race.
    function decodeOpen(bytes calldata ballot, uint8[] storage candidateCounts, bool allowNota)
        internal
        view
        returns (uint8[] memory choices)
    {
        if (ballot.length != OPEN_BALLOT_SIZE) revert BallotFormat__BadLength();
        if (uint8(ballot[0]) != VERSION || uint8(ballot[1]) != MODE_OPEN) revert BallotFormat__BadHeader();

        uint256 races = candidateCounts.length;
        if (uint8(ballot[2]) != races) revert BallotFormat__BadRaceCount();

        choices = new uint8[](races);
        for (uint256 i = 0; i < races; i++) {
            uint8 c = uint8(ballot[3 + i]);
            bool ok = c < candidateCounts[i] || c == ABSTAIN || (allowNota && c == NOTA);
            if (!ok) revert BallotFormat__BadChoice(i, c);
            choices[i] = c;
        }
        for (uint256 j = 3 + races; j < OPEN_BALLOT_SIZE; j++) {
            if (ballot[j] != 0) revert BallotFormat__NonCanonicalPadding();
        }
    }
}
