// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ElectionTestBase} from "./Base.t.sol";
import {Election} from "../src/Election.sol";

contract ElectionHandler is Test {
    Election public election;
    address public registrar;
    uint256 public ghostAccepted;
    uint256 public ghostAcceptedAfterEnd;
    uint256 public ghostMembersAddedAfterFreeze;
    uint256 internal nextMember = 1_000;
    uint256[] public nullifiers;

    constructor(Election e, address r) {
        election = e;
        registrar = r;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 600));
    }

    function addMembers(uint256 n) external {
        n = bound(n, 1, 5);
        uint256[] memory c = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            c[i] = uint256(keccak256(abi.encode("inv", nextMember++))) >> 8;
        }
        bool wasFrozen = election.frozen();
        vm.prank(registrar);
        try election.addMembers(c) {
            if (wasFrozen) ghostMembersAddedAfterFreeze++;
        } catch {}
    }

    function freeze() external {
        try election.freeze() {} catch {}
    }

    function cast(uint256 nullifier, uint8 a, uint8 b) external {
        bytes memory ballot = new bytes(64);
        ballot[0] = 0x01;
        ballot[2] = 0x02;
        ballot[3] = bytes1(uint8(bound(a, 0, 2)));
        ballot[4] = bytes1(uint8(bound(b, 0, 1)));
        nullifier = bound(nullifier, 1, 50); // force collisions to probe double voting
        uint256[8] memory pts;
        ISemaphore.SemaphoreProof memory p = ISemaphore.SemaphoreProof(
            10, election.frozenRoot(), nullifier, uint256(keccak256(ballot)), election.scope(), pts
        );
        try election.castBallot(p, ballot) {
            ghostAccepted++;
            nullifiers.push(nullifier);
            if (block.timestamp >= election.voteEnd()) ghostAcceptedAfterEnd++;
        } catch {}
    }

    function nullifierCount() external view returns (uint256) {
        return nullifiers.length;
    }
}

contract ElectionInvariantTest is ElectionTestBase {
    ElectionHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ElectionHandler(election, registrar);
        vm.warp(REG_START);
        targetContract(address(handler));
    }

    /// ballotCount == number of distinct stored nullifiers == accepted calls
    function invariant_BallotCountMatchesNullifiers() public view {
        assertEq(election.ballotCount(), handler.ghostAccepted());
        assertEq(election.ballotCount(), handler.nullifierCount());
        for (uint256 i = 0; i < handler.nullifierCount(); i++) {
            assertTrue(election.nullifierUsed(handler.nullifiers(i)));
        }
    }

    /// The roll never changes after freeze.
    function invariant_MembersFixedAfterFreeze() public view {
        assertEq(handler.ghostMembersAddedAfterFreeze(), 0);
        if (election.frozen()) assertEq(election.currentSize(), election.memberCount());
    }

    /// Nothing is accepted after voteEnd.
    function invariant_NothingAfterVoteEnd() public view {
        assertEq(handler.ghostAcceptedAfterEnd(), 0);
    }

    /// Open-mode tallies always sum to the ballot count, per race.
    function invariant_TallySumsToBallots() public view {
        for (uint256 race = 0; race < 2; race++) {
            uint256[] memory r = election.results(race);
            uint256 sum;
            for (uint256 i = 0; i < r.length; i++) {
                sum += r[i];
            }
            assertEq(sum, election.ballotCount());
        }
    }
}
