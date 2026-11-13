// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ElectionTestBase, MockVerifier} from "./Base.t.sol";
import {Election} from "../src/Election.sol";
import {ElectionFactory} from "../src/ElectionFactory.sol";
import {BallotFormat} from "../src/BallotFormat.sol";

/// Each v1 attack from the rebuild plan is a test here (named "V1_n").
contract ElectionTest is ElectionTestBase {
    // ================================================================ happy path
    function test_CastBallot_CountsVote() public {
        _ready(election);
        bytes memory b = _ballot(1, 0);
        vm.expectEmit(true, true, false, true, address(election));
        emit Election.BallotCast(42, 0, b);
        vm.prank(attacker); // anyone may submit (relayer or voter self-submit)
        election.castBallot(_proof(election, 42, b), b);

        assertEq(election.ballotCount(), 1);
        assertTrue(election.nullifierUsed(42));
        uint256[] memory r0 = election.results(0);
        assertEq(r0.length, 5);
        assertEq(r0[1], 1);
        assertEq(election.results(1)[0], 1);
    }

    function test_CastBallot_NotaAndAbstain() public {
        _ready(election);
        bytes memory b = _ballot(BallotFormat.NOTA, BallotFormat.ABSTAIN);
        election.castBallot(_proof(election, 1, b), b);
        assertEq(election.results(0)[3], 1); // NOTA slot
        assertEq(election.results(1)[3], 1); // ABSTAIN slot
    }

    function test_Freeze_RecordsRootAndCount() public {
        _register(election, _commitments(0, 5));
        uint256 root = election.currentRoot();
        vm.warp(REG_END);
        election.freeze();
        assertTrue(election.frozen());
        assertEq(election.frozenRoot(), root);
        assertEq(election.memberCount(), 5);
    }

    // ================================================================ V1 #4: double voting
    function test_V1_4_RevertWhen_DoubleVote() public {
        _ready(election);
        bytes memory b = _ballot(0, 0);
        election.castBallot(_proof(election, 7, b), b);
        bytes memory b2 = _ballot(2, 1); // same voter, different choice
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 7, b2);
        vm.expectRevert(Election.Election__NullifierUsed.selector);
        election.castBallot(p_, b2);
    }

    // ================================================================ V1 #2: proof must be ZK + valid
    function test_V1_2_RevertWhen_ProofInvalid() public {
        _ready(election);
        MockVerifier(address(verifier)).setResult(false);
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(Election.Election__InvalidProof.selector);
        election.castBallot(p_, b);
    }

    // ================================================================ cross-election replay
    function test_RevertWhen_WrongScope() public {
        Election other = _create("election-2", BallotFormat.MODE_OPEN, true);
        _ready(election);
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 1, b);
        p.scope = other.scope();
        vm.expectRevert(Election.Election__WrongScope.selector);
        election.castBallot(p, b);
    }

    // ================================================================ relayer cannot swap ballot
    function test_RevertWhen_BallotSwappedAfterProving() public {
        _ready(election);
        bytes memory signed = _ballot(0, 0);
        bytes memory swapped = _ballot(2, 1);
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, signed);
        vm.expectRevert(Election.Election__MessageNotBoundToBallot.selector);
        election.castBallot(p_, swapped);
    }

    // ================================================================ V1 #5: roll changes mid-election
    function test_V1_5_RevertWhen_OldRootUsedAfterFreeze() public {
        _register(election, _commitments(0, 2));
        uint256 oldRoot = election.currentRoot();
        vm.prank(registrar);
        election.addMembers(_commitments(2, 1));
        _openVoting(election);
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 1, b);
        p.merkleTreeRoot = oldRoot; // Semaphore alone would still accept this root for 1 hour
        vm.expectRevert(Election.Election__RootNotFrozenRoot.selector);
        election.castBallot(p, b);
    }

    function test_V1_5_RevertWhen_AddMembersAfterRegistration() public {
        _register(election, _commitments(0, 2));
        vm.warp(REG_END);
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.AwaitingVote));
        election.addMembers(_commitments(10, 1));
    }

    function test_V1_5_RevertWhen_AddMembersDuringVoting() public {
        _ready(election);
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Voting));
        election.addMembers(_commitments(10, 1));
    }

    function test_V1_5_RevertWhen_AddMembersByNonRegistrar() public {
        vm.warp(REG_START);
        bytes32 role = election.REGISTRAR_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role)
        );
        election.addMembers(_commitments(0, 1));
    }

    function test_RevertWhen_AddMembersBeforeRegistration() public {
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Pending));
        election.addMembers(_commitments(0, 1));
    }

    function test_RevertWhen_DuplicateCommitment() public {
        _register(election, _commitments(0, 1));
        vm.prank(registrar);
        vm.expectRevert();
        election.addMembers(_commitments(0, 1));
    }

    // ================================================================ V1 #6: pause enforced on-chain
    function test_V1_6_RevertWhen_Paused() public {
        _ready(election);
        vm.prank(officer);
        election.pause();
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        election.castBallot(p_, b);

        vm.prank(officer);
        election.unpause();
        election.castBallot(_proof(election, 1, b), b);
        assertEq(election.ballotCount(), 1);
    }

    function test_RevertWhen_PauseByNonOfficer() public {
        bytes32 role = election.OFFICER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role));
        election.pause();
    }

    // ================================================================ phases
    function test_RevertWhen_CastBeforeVoting() public {
        _register(election, _commitments(0, 2));
        vm.warp(REG_END);
        election.freeze();
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 1, b);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.AwaitingVote));
        election.castBallot(p, b);
    }

    function test_RevertWhen_CastAfterVoteEnd() public {
        _ready(election);
        vm.warp(VOTE_END);
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 1, b);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Closed));
        election.castBallot(p, b);
    }

    function test_RevertWhen_CastWithoutFreeze() public {
        _register(election, _commitments(0, 2));
        vm.warp(VOTE_START);
        bytes memory b = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 1, b);
        vm.expectRevert(Election.Election__NotFrozen.selector);
        election.castBallot(p, b);
    }

    function test_RevertWhen_FreezeDuringRegistration() public {
        vm.warp(REG_START);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Registration));
        election.freeze();
    }

    function test_RevertWhen_FreezeTwice() public {
        vm.warp(REG_END);
        election.freeze();
        vm.expectRevert(Election.Election__AlreadyFrozen.selector);
        election.freeze();
    }

    // ================================================================ ballot format
    function test_RevertWhen_BallotWrongLength() public {
        _ready(election);
        bytes memory b = new bytes(63);
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(BallotFormat.BallotFormat__BadLength.selector);
        election.castBallot(p_, b);
    }

    function test_RevertWhen_ChoiceOutOfRange() public {
        _ready(election);
        bytes memory b = _ballot(3, 0); // race 0 has 3 candidates: 0..2
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(abi.encodeWithSelector(BallotFormat.BallotFormat__BadChoice.selector, 0, 3));
        election.castBallot(p_, b);
    }

    function test_RevertWhen_NotaNotAllowed() public {
        Election noNota = _create("no-nota", BallotFormat.MODE_OPEN, false);
        _ready(noNota);
        bytes memory b = _ballot(BallotFormat.NOTA, 0);
        ISemaphore.SemaphoreProof memory p_ = _proof(noNota, 1, b);
        vm.expectRevert(abi.encodeWithSelector(BallotFormat.BallotFormat__BadChoice.selector, 0, BallotFormat.NOTA));
        noNota.castBallot(p_, b);
    }

    function test_RevertWhen_NonZeroPadding() public {
        _ready(election);
        bytes memory b = _ballot(0, 0);
        b[63] = 0x01;
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(BallotFormat.BallotFormat__NonCanonicalPadding.selector);
        election.castBallot(p_, b);
    }

    function test_RevertWhen_WrongRaceCount() public {
        _ready(election);
        bytes memory b = _ballot(0, 0);
        b[2] = bytes1(uint8(1));
        ISemaphore.SemaphoreProof memory p_ = _proof(election, 1, b);
        vm.expectRevert(BallotFormat.BallotFormat__BadRaceCount.selector);
        election.castBallot(p_, b);
    }

    function test_SealedMode_AcceptsFixedSizeCiphertext() public {
        Election sealedE = _create("sealed", BallotFormat.MODE_SEALED, true);
        _ready(sealedE);
        bytes memory c = new bytes(BallotFormat.SEALED_BALLOT_SIZE);
        sealedE.castBallot(_proof(sealedE, 1, c), c);
        assertEq(sealedE.ballotCount(), 1);
        bytes memory shortC = new bytes(100);
        ISemaphore.SemaphoreProof memory p_ = _proof(sealedE, 2, shortC);
        vm.expectRevert(BallotFormat.BallotFormat__BadLength.selector);
        sealedE.castBallot(p_, shortC);
    }

    // ================================================================ close-out
    function test_DeclareResult_OnlyOfficerOnlyAfterCloseOnlyOnce() public {
        _ready(election);
        vm.prank(officer);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Voting));
        election.declareResult(bytes32(uint256(1)));

        vm.warp(VOTE_END);
        vm.prank(attacker);
        vm.expectRevert();
        election.declareResult(bytes32(uint256(1)));

        vm.prank(officer);
        election.declareResult(bytes32(uint256(1)));
        assertEq(election.resultHash(), bytes32(uint256(1)));

        vm.prank(officer);
        vm.expectRevert(Election.Election__AlreadySet.selector);
        election.declareResult(bytes32(uint256(2)));
    }

    function test_RevealKey_OnlySealedAfterClose() public {
        vm.warp(VOTE_END);
        vm.prank(officer);
        vm.expectRevert(Election.Election__NotSealed.selector);
        election.revealKey(hex"01");

        Election sealedE = _create("sealed-2", BallotFormat.MODE_SEALED, true);
        vm.prank(officer);
        sealedE.revealKey(hex"0102");
        assertEq(sealedE.revealedKey(), hex"0102");
    }

    // ================================================================ factory / init
    function test_RevertWhen_InitializeTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        election.initialize(ISemaphore(address(semaphore)), bytes32(0), _config(0, true), attacker, attacker);
    }

    function test_RevertWhen_ImplementationInitialized() public {
        Election impl = Election(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(ISemaphore(address(semaphore)), bytes32(0), _config(0, true), attacker, attacker);
    }

    function test_RevertWhen_FactoryCreateByNonOfficer() public {
        Election.Config memory c = _config(0, true);
        vm.prank(attacker);
        vm.expectRevert();
        factory.createElection(keccak256("x"), c, attacker, attacker);
    }

    function test_RevertWhen_RefTaken() public {
        Election.Config memory c = _config(0, true);
        vm.expectRevert(ElectionFactory.ElectionFactory__RefTaken.selector);
        factory.createElection(keccak256(bytes("election-1")), c, officer, registrar);
    }

    function test_RevertWhen_BadConfig() public {
        Election.Config memory c = _config(0, true);
        c.voteStart = c.regEnd - 1;
        vm.expectRevert(Election.Election__BadConfig.selector);
        factory.createElection(keccak256("bad"), c, officer, registrar);
    }

    function test_RevertWhen_RankedChoiceInOpenMode() public {
        Election.Config memory c = _config(BallotFormat.MODE_OPEN, true);
        c.raceMethods[0] = BallotFormat.METHOD_IRV;
        vm.expectRevert(Election.Election__BadConfig.selector);
        factory.createElection(keccak256("irv-open"), c, officer, registrar);
    }

    function test_RevertWhen_SealedWithoutValidPublicKey() public {
        Election.Config memory c = _config(BallotFormat.MODE_SEALED, true);
        c.publicKey = new bytes(65); // must be 33-byte compressed
        vm.expectRevert(Election.Election__BadConfig.selector);
        factory.createElection(keccak256("bad-pk"), c, officer, registrar);
        c.publicKey = new bytes(33);
        c.raceMethods = new uint8[](1); // length must match races
        vm.expectRevert(Election.Election__BadConfig.selector);
        factory.createElection(keccak256("bad-methods"), c, officer, registrar);
    }

    function test_SealedConfig_StoresMethodsAndKey() public {
        Election s = _create("sealed-cfg", BallotFormat.MODE_SEALED, true);
        uint8[] memory m = s.raceMethods();
        assertEq(m.length, 2);
        assertEq(m[1], BallotFormat.METHOD_IRV);
        assertEq(s.publicKey().length, 33);
    }

    function test_PredictAddress() public view {
        assertEq(factory.predictAddress(keccak256(bytes("election-1"))), address(election));
    }

    // ================================================================ fuzz
    function testFuzz_CastOnlyInVotingWindow(uint64 t) public {
        _register(election, _commitments(0, 2));
        vm.warp(REG_END);
        election.freeze();
        t = uint64(bound(t, REG_END, VOTE_END + 10_000));
        vm.warp(t);
        bytes memory b = _ballot(0, 1);
        ISemaphore.SemaphoreProof memory p = _proof(election, 99, b);
        bool inWindow = t >= VOTE_START && t < VOTE_END;
        if (!inWindow) vm.expectRevert();
        election.castBallot(p, b);
        assertEq(election.ballotCount(), inWindow ? 1 : 0);
    }

    function testFuzz_AddMembersOnlyInRegistration(uint64 t) public {
        t = uint64(bound(t, T0, VOTE_END + 10_000));
        vm.warp(t);
        bool inWindow = t >= REG_START && t < REG_END;
        vm.prank(registrar);
        if (!inWindow) vm.expectRevert();
        election.addMembers(_commitments(0, 1));
    }

    function testFuzz_AnyByteChoiceValidatedPerRace(uint8 a, uint8 b) public {
        _ready(election);
        bytes memory ballot = _ballot(a, b);
        bool ok = (a < 3 || a == BallotFormat.NOTA || a == BallotFormat.ABSTAIN)
            && (b < 2 || b == BallotFormat.NOTA || b == BallotFormat.ABSTAIN);
        ISemaphore.SemaphoreProof memory p = _proof(election, 5, ballot);
        if (!ok) vm.expectRevert();
        election.castBallot(p, ballot);
    }

    // ================================================================ early close (officer)
    function test_EndRegistrationNow_ClosesAndFreezes() public {
        _register(election, _commitments(0, 3));
        uint256 root = election.currentRoot();
        vm.warp(REG_START + 50);
        vm.prank(officer);
        election.endRegistrationNow();
        assertEq(election.regEnd(), REG_START + 50);
        assertTrue(election.frozen());
        assertEq(election.frozenRoot(), root);
        assertEq(election.memberCount(), 3);
        assertEq(uint8(election.phase()), uint8(Election.Phase.AwaitingVote));
        assertEq(election.voteStart(), VOTE_START); // voting time untouched
    }

    function test_EndRegistrationNow_BlocksLateMembers() public {
        _register(election, _commitments(0, 1));
        vm.prank(officer);
        election.endRegistrationNow();
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.AwaitingVote));
        election.addMembers(_commitments(10, 1));
    }

    function test_StartVotingNow_FromRegistration_AcceptsBallots() public {
        _register(election, _commitments(0, 2));
        vm.warp(REG_START + 10);
        vm.prank(officer);
        election.startVotingNow();
        assertTrue(election.frozen());
        assertEq(election.regEnd(), REG_START + 10);
        assertEq(election.voteStart(), REG_START + 10);
        assertEq(uint8(election.phase()), uint8(Election.Phase.Voting));
        bytes memory b = _ballot(1, 0);
        election.castBallot(_proof(election, 9, b), b);
        assertEq(election.ballotCount(), 1);
        assertEq(election.voteEnd(), VOTE_END); // closing time untouched
    }

    function test_StartVotingNow_FromAwaitingVote() public {
        _register(election, _commitments(0, 2));
        vm.warp(REG_END + 5);
        election.freeze();
        vm.prank(officer);
        election.startVotingNow();
        assertEq(election.voteStart(), REG_END + 5);
        assertEq(election.regEnd(), REG_END); // not moved
        assertEq(uint8(election.phase()), uint8(Election.Phase.Voting));
    }

    function test_RevertWhen_EarlyCloseByNonOfficer() public {
        vm.warp(REG_START);
        bytes32 role = election.OFFICER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role));
        election.endRegistrationNow();
        vm.prank(registrar); // the relayer/registrar is not automatically an officer
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, role));
        election.startVotingNow();
    }

    function test_RevertWhen_EarlyCloseInWrongPhase() public {
        vm.prank(officer); // before registration opens
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Pending));
        election.startVotingNow();
        _ready(election); // now voting
        vm.prank(officer);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Voting));
        election.startVotingNow();
        vm.prank(officer);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Voting));
        election.endRegistrationNow();
    }

    function test_RevertWhen_EarlyCloseWhilePaused() public {
        vm.warp(REG_START);
        vm.startPrank(officer);
        election.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        election.endRegistrationNow();
        vm.stopPrank();
    }

    function testFuzz_EarlyCloseOnlyShortens(uint64 t) public {
        t = uint64(bound(t, REG_START, REG_END - 1));
        vm.warp(t);
        vm.prank(officer);
        election.startVotingNow();
        assertLe(election.regEnd(), REG_END);
        assertLe(election.voteStart(), VOTE_START);
        assertLe(election.regEnd(), election.voteStart());
        assertEq(election.voteEnd(), VOTE_END);
    }

    // ================================================================ end voting early
    function test_EndVotingNow_ClosesAndAllowsDeclare() public {
        _ready(election);
        bytes memory b = _ballot(2, 1);
        election.castBallot(_proof(election, 1, b), b);
        vm.warp(VOTE_START + 30);
        vm.prank(officer);
        election.endVotingNow();
        assertEq(election.voteEnd(), VOTE_START + 30);
        assertEq(uint8(election.phase()), uint8(Election.Phase.Closed));

        bytes memory late = _ballot(0, 0);
        ISemaphore.SemaphoreProof memory p = _proof(election, 2, late);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Closed));
        election.castBallot(p, late);

        vm.prank(officer);
        election.declareResult(bytes32(uint256(7)));
        assertEq(election.results(0)[2], 1);
    }

    function test_RevertWhen_EndVotingOutsideVoting() public {
        vm.warp(REG_START);
        vm.prank(officer);
        vm.expectRevert(abi.encodeWithSelector(Election.Election__WrongPhase.selector, Election.Phase.Registration));
        election.endVotingNow();
    }

    function test_RevertWhen_EndVotingByNonOfficer() public {
        _ready(election);
        bytes32 role = election.OFFICER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role));
        election.endVotingNow();
    }

    function test_RevertWhen_EndVotingWhilePaused() public {
        _ready(election);
        vm.startPrank(officer);
        election.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        election.endVotingNow();
        vm.stopPrank();
    }

    function testFuzz_EndVotingOnlyShortens(uint64 t) public {
        _ready(election);
        t = uint64(bound(t, VOTE_START, VOTE_END - 1));
        vm.warp(t);
        vm.prank(officer);
        election.endVotingNow();
        assertLe(election.voteEnd(), VOTE_END);
        assertGe(election.voteEnd(), election.voteStart());
    }
}
