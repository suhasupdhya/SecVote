// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title Election
 * @notice A single election instance. Works identically for a government
 *         constituency election or a college/university student election —
 *         only the off-chain identity-proofing step differs; this contract
 *         only ever sees anonymous cryptographic commitments, never identities.
 *
 * ANONYMITY MODEL (Merkle + nullifier):
 *   1. Off-chain, the election admin generates one secret per eligible voter
 *      and privately delivers it to that voter (e.g. Aadhaar-linked encrypted
 *      OTP flow for govt elections, or college-email delivery for student
 *      elections). The admin never publishes the secret->identity mapping.
 *   2. leaf_i = keccak256(secret_i) for every voter is combined off-chain into
 *      a Merkle tree; only the ROOT is stored on-chain (merkleRoot below).
 *   3. To vote, a voter reveals nullifier = keccak256(secret_i) together with
 *      a Merkle proof that this nullifier is a leaf of the tree. The contract
 *      never sees msg.sender tied to any identity — it only checks
 *      "this is a valid, unused voter secret" and "this nullifier hasn't
 *      voted yet". This makes the vote unlinkable to any registered identity
 *      while still preventing double voting and fake/unregistered voters.
 *
 * LIMITATION (documented honestly for the project report):
 *   Because the nullifier + proof are visible in the public mempool before
 *   confirmation, a malicious actor could theoretically front-run and submit
 *   someone else's nullifier first. In production this is mitigated by
 *   routing votes through a permissioned backend/relayer over TLS rather
 *   than directly from a public wallet — the backend submits on the voter's
 *   behalf so the secret is never exposed to the public mempool.
 */
contract Election {
    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    address public admin;
    string public title;
    string public domain; // e.g. "GOVT" or "COLLEGE" — informational only
    uint256 public startTime;
    uint256 public endTime;
    bytes32 public merkleRoot;
    bool public finalized;

    Candidate[] public candidates;
    mapping(bytes32 => bool) public usedNullifiers;
    uint256 public totalVotesCast;

    event VoteCast(bytes32 indexed nullifier, uint256 candidateId, uint256 timestamp);
    event MerkleRootUpdated(bytes32 newRoot);
    event ElectionFinalized(uint256 timestamp);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Election: caller is not admin");
        _;
    }

    modifier duringVotingWindow() {
        require(block.timestamp >= startTime, "Election: voting has not started");
        require(block.timestamp <= endTime, "Election: voting has closed");
        _;
    }

    constructor(
        address _admin,
        string memory _title,
        string memory _domain,
        string[] memory _candidateNames,
        uint256 _startTime,
        uint256 _endTime,
        bytes32 _merkleRoot
    ) {
        require(_admin != address(0), "Election: invalid admin");
        require(_candidateNames.length >= 2, "Election: need at least 2 candidates");
        require(_endTime > _startTime, "Election: end must be after start");

        admin = _admin;
        title = _title;
        domain = _domain;
        startTime = _startTime;
        endTime = _endTime;
        merkleRoot = _merkleRoot;

        for (uint256 i = 0; i < _candidateNames.length; i++) {
            candidates.push(Candidate({id: i, name: _candidateNames[i], voteCount: 0}));
        }
    }

    /// @notice Admin can update the eligible-voter Merkle root before election finalization.
    function updateMerkleRoot(bytes32 _newRoot) external onlyAdmin {
        require(!finalized, "Election: election is finalized");
        merkleRoot = _newRoot;
        emit MerkleRootUpdated(_newRoot);
    }

    /**
     * @notice Cast a vote.
     * @param candidateId Index into the candidates array.
     * @param nullifier keccak256(secret) — proves eligibility, never reused.
     * @param proof Merkle proof that `nullifier` is a leaf under merkleRoot.
     */
    function castVote(
        uint256 candidateId,
        bytes32 nullifier,
        bytes32[] calldata proof
    ) external duringVotingWindow {
        require(candidateId < candidates.length, "Election: invalid candidate");
        require(!usedNullifiers[nullifier], "Election: this vote token has already been used");

        bool validVoter = MerkleProof.verify(proof, merkleRoot, nullifier);
        require(validVoter, "Election: not on the eligible voter list");

        usedNullifiers[nullifier] = true;
        candidates[candidateId].voteCount += 1;
        totalVotesCast += 1;

        emit VoteCast(nullifier, candidateId, block.timestamp);
    }

    /// @notice Anyone can independently verify a specific vote token was used.
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    /// @notice Locks the election as finalized after voting closes. Purely a status flag —
    ///         results are always publicly readable via getResults(), finalized or not.
    function finalizeElection() external onlyAdmin {
        require(block.timestamp > endTime, "Election: voting still open");
        require(!finalized, "Election: already finalized");
        finalized = true;
        emit ElectionFinalized(block.timestamp);
    }

    function getResults() external view returns (Candidate[] memory) {
        return candidates;
    }

    function getCandidateCount() external view returns (uint256) {
        return candidates.length;
    }
}
