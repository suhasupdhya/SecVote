// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {Election} from "../src/Election.sol";
import {ElectionFactory} from "../src/ElectionFactory.sol";
import {BallotFormat} from "../src/BallotFormat.sol";

/// @dev Stands in for the Groth16 verifier so we can test Election's own checks in isolation.
/// Real proofs are exercised in RealProof.t.sol.
contract MockVerifier is ISemaphoreVerifier {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[4] calldata, uint256)
        external
        view
        returns (bool)
    {
        return result;
    }
}

abstract contract ElectionTestBase is Test {
    uint64 internal constant T0 = 1_000_000;
    uint64 internal constant REG_START = T0 + 100;
    uint64 internal constant REG_END = T0 + 1_000;
    uint64 internal constant VOTE_START = T0 + 2_000;
    uint64 internal constant VOTE_END = T0 + 3_000;

    ISemaphoreVerifier internal verifier;
    Semaphore internal semaphore;
    ElectionFactory internal factory;
    Election internal election;

    address internal officer = makeAddr("officer");
    address internal registrar = makeAddr("registrar");
    address internal attacker = makeAddr("attacker");

    function _verifier() internal virtual returns (ISemaphoreVerifier) {
        return ISemaphoreVerifier(address(new MockVerifier()));
    }

    function setUp() public virtual {
        vm.warp(T0);
        verifier = _verifier();
        semaphore = new Semaphore(verifier);
        factory = new ElectionFactory(ISemaphore(address(semaphore)), address(this));
        election = _create("election-1", BallotFormat.MODE_OPEN, true);
    }

    function _config(uint8 mode, bool allowNota) internal pure returns (Election.Config memory c) {
        uint8[] memory counts = new uint8[](2);
        counts[0] = 3; // President: 3 candidates
        counts[1] = 2; // Secretary: 2 candidates
        uint8[] memory methods = new uint8[](2);
        if (mode == BallotFormat.MODE_SEALED) methods[1] = BallotFormat.METHOD_IRV;
        c = Election.Config({
            regStart: REG_START,
            regEnd: REG_END,
            voteStart: VOTE_START,
            voteEnd: VOTE_END,
            mode: mode,
            allowNota: allowNota,
            candidateCounts: counts,
            raceMethods: methods,
            publicKey: mode == BallotFormat.MODE_SEALED ? new bytes(33) : bytes("")
        });
    }

    function _create(string memory id, uint8 mode, bool allowNota) internal returns (Election) {
        return Election(factory.createElection(keccak256(bytes(id)), _config(mode, allowNota), officer, registrar));
    }

    // ------------------------------------------------------------ helpers
    function _commitments(uint256 from, uint256 n) internal pure returns (uint256[] memory c) {
        c = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            c[i] = uint256(keccak256(abi.encode("member", from + i))) >> 8; // < SNARK field
        }
    }

    function _register(Election e, uint256[] memory commitments) internal {
        vm.warp(REG_START);
        vm.prank(registrar);
        e.addMembers(commitments);
    }

    function _openVoting(Election e) internal {
        vm.warp(REG_END);
        e.freeze();
        vm.warp(VOTE_START);
    }

    /// @dev Registers 3 members and opens voting.
    function _ready(Election e) internal {
        _register(e, _commitments(0, 3));
        _openVoting(e);
    }

    function _ballot(uint8 a, uint8 b) internal pure returns (bytes memory out) {
        out = new bytes(BallotFormat.OPEN_BALLOT_SIZE);
        out[0] = bytes1(BallotFormat.VERSION);
        out[1] = bytes1(BallotFormat.MODE_OPEN);
        out[2] = bytes1(uint8(2));
        out[3] = bytes1(a);
        out[4] = bytes1(b);
    }

    function _proof(Election e, uint256 nullifier, bytes memory ballot)
        internal
        view
        returns (ISemaphore.SemaphoreProof memory p)
    {
        uint256[8] memory points;
        p = ISemaphore.SemaphoreProof({
            merkleTreeDepth: 10,
            merkleTreeRoot: e.frozenRoot(),
            nullifier: nullifier,
            message: uint256(keccak256(ballot)),
            scope: e.scope(),
            points: points
        });
    }
}
