// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {BallotFormat} from "./BallotFormat.sol";

/// @title Election
/// @notice One election, deployed as an EIP-1167 clone by ElectionFactory.
/// Eligibility is a Semaphore group; a ballot is accepted only with a zero-knowledge proof of
/// membership in the *frozen* roll, bound to this election (scope) and to the exact ballot bytes (message).
/// Phases are enforced here by timestamps, not by the backend.
///
/// @dev Nullifiers are stored here and proofs are checked with Semaphore.verifyProof (view), NOT
/// validateProof: validateProof is permissionless, so a front-runner could replay a proof from the
/// mempool directly against Semaphore and burn the voter's nullifier without the ballot being cast.
/// See docs/adr/0001-semaphore.md.
contract Election is AccessControl, Pausable, Initializable {
    // ---------------------------------------------------------------- roles
    bytes32 public constant OFFICER_ROLE = keccak256("OFFICER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // ---------------------------------------------------------------- types
    enum Phase {
        Pending, // before regStart
        Registration, // [regStart, regEnd)
        AwaitingVote, // [regEnd, voteStart) — roll can be frozen
        Voting, // [voteStart, voteEnd)
        Closed // >= voteEnd
    }

    struct Config {
        uint64 regStart;
        uint64 regEnd;
        uint64 voteStart;
        uint64 voteEnd;
        uint8 mode; // BallotFormat.MODE_OPEN | MODE_SEALED
        bool allowNota;
        uint8[] candidateCounts; // one entry per race
        uint8[] raceMethods; // per race: 0 plurality, 1 instant-runoff (sealed only)
        bytes publicKey; // sealed mode only (Phase 4)
    }

    // ---------------------------------------------------------------- storage
    ISemaphore public semaphore;
    uint256 public groupId;
    uint256 public scope;
    bytes32 public ref; // off-chain election id (hash), set by the factory

    uint64 public regStart;
    uint64 public regEnd;
    uint64 public voteStart;
    uint64 public voteEnd;
    uint8 public mode;
    bool public allowNota;
    uint8[] internal _candidateCounts;
    uint8[] internal _raceMethods;
    bytes public publicKey;

    bool public frozen;
    uint256 public frozenRoot;
    uint256 public memberCount;

    uint256 public ballotCount;
    mapping(uint256 nullifier => bool used) public nullifierUsed;
    mapping(uint256 race => mapping(uint256 choice => uint256 votes)) internal _tally;

    bytes public revealedKey;
    bytes32 public resultHash;

    // ---------------------------------------------------------------- events
    event MembersAdded(uint256 indexed startIndex, uint256[] commitments, uint256 merkleRoot);
    event Frozen(uint256 merkleRoot, uint256 memberCount);
    event BallotCast(uint256 indexed nullifier, uint256 indexed index, bytes ballot);
    event KeyRevealed(bytes key);
    event ResultDeclared(bytes32 resultHash);
    /// @notice The officer shortened the timeline. Windows can only ever be brought forward, never extended.
    event ScheduleShortened(uint64 regEnd, uint64 voteStart);
    /// @notice The officer closed voting before its scheduled end.
    event VotingEndedEarly(uint64 voteEnd);

    // ---------------------------------------------------------------- errors
    error Election__BadConfig();
    error Election__WrongPhase(Phase current);
    error Election__AlreadyFrozen();
    error Election__NotFrozen();
    error Election__WrongScope();
    error Election__MessageNotBoundToBallot();
    error Election__RootNotFrozenRoot();
    error Election__NullifierUsed();
    error Election__InvalidProof();
    error Election__NotSealed();
    error Election__AlreadySet();
    error Election__EmptyBatch();

    constructor() {
        _disableInitializers();
    }

    function initialize(ISemaphore semaphore_, bytes32 ref_, Config calldata c, address officer, address registrar)
        external
        initializer
    {
        if (
            !(c.regStart < c.regEnd && c.regEnd <= c.voteStart && c.voteStart < c.voteEnd)
                || c.candidateCounts.length == 0 || c.candidateCounts.length > BallotFormat.MAX_RACES
                || c.mode > BallotFormat.MODE_SEALED || officer == address(0) || registrar == address(0)
                || c.raceMethods.length != c.candidateCounts.length
                || (c.mode == BallotFormat.MODE_SEALED && c.publicKey.length != BallotFormat.PUBLIC_KEY_SIZE)
                || (c.mode == BallotFormat.MODE_OPEN && c.publicKey.length != 0)
        ) revert Election__BadConfig();
        for (uint256 i = 0; i < c.candidateCounts.length; i++) {
            if (c.candidateCounts[i] == 0 || c.candidateCounts[i] > BallotFormat.MAX_CANDIDATES) {
                revert Election__BadConfig();
            }
            // Open ballots are tallied on chain as plurality; ranked-choice needs sealed ballots.
            if (c.raceMethods[i] > BallotFormat.METHOD_IRV) revert Election__BadConfig();
            if (c.mode == BallotFormat.MODE_OPEN && c.raceMethods[i] != BallotFormat.METHOD_PLURALITY) {
                revert Election__BadConfig();
            }
        }

        semaphore = semaphore_;
        ref = ref_;
        regStart = c.regStart;
        regEnd = c.regEnd;
        voteStart = c.voteStart;
        voteEnd = c.voteEnd;
        mode = c.mode;
        allowNota = c.allowNota;
        _candidateCounts = c.candidateCounts;
        _raceMethods = c.raceMethods;
        publicKey = c.publicKey;

        groupId = semaphore_.createGroup(); // this contract is the group admin
        scope = uint256(keccak256(abi.encode(block.chainid, address(this))));

        _grantRole(DEFAULT_ADMIN_ROLE, officer);
        _grantRole(OFFICER_ROLE, officer);
        _grantRole(REGISTRAR_ROLE, registrar);
    }

    // ---------------------------------------------------------------- views
    function phase() public view returns (Phase) {
        if (block.timestamp < regStart) return Phase.Pending;
        if (block.timestamp < regEnd) return Phase.Registration;
        if (block.timestamp < voteStart) return Phase.AwaitingVote;
        if (block.timestamp < voteEnd) return Phase.Voting;
        return Phase.Closed;
    }

    function candidateCounts() external view returns (uint8[] memory) {
        return _candidateCounts;
    }

    function raceMethods() external view returns (uint8[] memory) {
        return _raceMethods;
    }

    function raceCount() external view returns (uint256) {
        return _candidateCounts.length;
    }

    /// @notice Open-mode counts for one race: [candidate 0..n-1, NOTA, ABSTAIN].
    function results(uint256 race) external view returns (uint256[] memory counts) {
        uint256 n = _candidateCounts[race];
        counts = new uint256[](n + 2);
        for (uint256 i = 0; i < n; i++) {
            counts[i] = _tally[race][i];
        }
        counts[n] = _tally[race][BallotFormat.NOTA];
        counts[n + 1] = _tally[race][BallotFormat.ABSTAIN];
    }

    function currentRoot() external view returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
    }

    function currentSize() public view returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeSize(groupId);
    }

    // ---------------------------------------------------------------- registration
    /// @notice Adds identity commitments to the roll. Only during registration, never after freeze.
    function addMembers(uint256[] calldata commitments) external onlyRole(REGISTRAR_ROLE) whenNotPaused {
        _requirePhase(Phase.Registration);
        if (frozen) revert Election__AlreadyFrozen();
        if (commitments.length == 0) revert Election__EmptyBatch();
        uint256 start = currentSize();
        semaphore.addMembers(groupId, commitments);
        emit MembersAdded(start, commitments, ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId));
    }

    /// @notice Locks the roll. Callable by anyone once registration has ended.
    function freeze() external {
        if (frozen) revert Election__AlreadyFrozen();
        Phase p = phase();
        if (p == Phase.Pending || p == Phase.Registration) revert Election__WrongPhase(p);
        _freeze();
    }

    // ---------------------------------------------------------------- early close (officer)
    /// @notice Close registration now and freeze the roll in the same transaction.
    /// Only shortens the registration window; it can never be reopened or extended.
    function endRegistrationNow() external onlyRole(OFFICER_ROLE) whenNotPaused {
        _requirePhase(Phase.Registration);
        regEnd = uint64(block.timestamp);
        _freeze();
        emit ScheduleShortened(regEnd, voteStart);
    }

    /// @notice Open voting now. If registration is still open it is closed and the roll frozen first,
    /// so there is never a moment where members could be added while ballots are accepted.
    function startVotingNow() external onlyRole(OFFICER_ROLE) whenNotPaused {
        Phase p = phase();
        if (p != Phase.Registration && p != Phase.AwaitingVote) revert Election__WrongPhase(p);
        if (p == Phase.Registration) regEnd = uint64(block.timestamp);
        if (!frozen) _freeze();
        voteStart = uint64(block.timestamp);
        emit ScheduleShortened(regEnd, voteStart);
    }

    /// @notice Close voting now so results can be declared. Only brings the end forward; voting can never
    /// be reopened. Ballots already accepted are final; anything arriving afterwards is rejected.
    function endVotingNow() external onlyRole(OFFICER_ROLE) whenNotPaused {
        _requirePhase(Phase.Voting);
        voteEnd = uint64(block.timestamp);
        emit VotingEndedEarly(voteEnd);
    }

    function _freeze() internal {
        frozen = true;
        memberCount = currentSize();
        frozenRoot = memberCount == 0 ? 0 : ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
        emit Frozen(frozenRoot, memberCount);
    }

    // ---------------------------------------------------------------- voting
    /// @notice Casts a ballot. Permissionless: the relayer or the voter themselves may submit.
    function castBallot(ISemaphore.SemaphoreProof calldata proof, bytes calldata ballot) external whenNotPaused {
        _requirePhase(Phase.Voting);
        if (!frozen) revert Election__NotFrozen();
        if (proof.scope != scope) revert Election__WrongScope();
        if (proof.message != uint256(keccak256(ballot))) revert Election__MessageNotBoundToBallot();
        if (proof.merkleTreeRoot != frozenRoot) revert Election__RootNotFrozenRoot();
        if (nullifierUsed[proof.nullifier]) revert Election__NullifierUsed();

        if (mode == BallotFormat.MODE_OPEN) {
            uint8[] memory choices = BallotFormat.decodeOpen(ballot, _candidateCounts, allowNota);
            for (uint256 i = 0; i < choices.length; i++) {
                _tally[i][choices[i]] += 1;
            }
        } else if (ballot.length != BallotFormat.SEALED_BALLOT_SIZE) {
            revert BallotFormat.BallotFormat__BadLength();
        }

        if (!semaphore.verifyProof(groupId, proof)) revert Election__InvalidProof();

        nullifierUsed[proof.nullifier] = true;
        uint256 index = ballotCount++;
        emit BallotCast(proof.nullifier, index, ballot);
    }

    // ---------------------------------------------------------------- after close
    function revealKey(bytes calldata key) external onlyRole(OFFICER_ROLE) {
        _requirePhase(Phase.Closed);
        if (mode != BallotFormat.MODE_SEALED) revert Election__NotSealed();
        if (revealedKey.length != 0 || key.length == 0) revert Election__AlreadySet();
        revealedKey = key;
        emit KeyRevealed(key);
    }

    function declareResult(bytes32 hash) external onlyRole(OFFICER_ROLE) {
        _requirePhase(Phase.Closed);
        if (resultHash != bytes32(0) || hash == bytes32(0)) revert Election__AlreadySet();
        resultHash = hash;
        emit ResultDeclared(hash);
    }

    // ---------------------------------------------------------------- emergency
    function pause() external onlyRole(OFFICER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OFFICER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- internal
    function _requirePhase(Phase expected) internal view {
        Phase p = phase();
        if (p != expected) revert Election__WrongPhase(p);
    }
}
