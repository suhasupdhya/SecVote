// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Election} from "./Election.sol";

/// @title ElectionFactory
/// @notice Deploys Election clones (EIP-1167) and keeps the public registry.
/// On testnet the OFFICER_ROLE is meant to be held by a Safe multisig (Phase 5).
contract ElectionFactory is AccessControl {
    bytes32 public constant OFFICER_ROLE = keccak256("OFFICER_ROLE");

    ISemaphore public immutable semaphore;
    address public immutable implementation;

    address[] public elections;
    mapping(bytes32 ref => address election) public electionByRef;

    event ElectionCreated(address indexed election, bytes32 indexed ref, uint256 index);

    error ElectionFactory__RefTaken();

    constructor(ISemaphore semaphore_, address admin) {
        semaphore = semaphore_;
        implementation = address(new Election());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OFFICER_ROLE, admin);
    }

    /// @param ref Deterministic id derived from the off-chain election id; also the CREATE2 salt.
    function createElection(bytes32 ref, Election.Config calldata config, address officer, address registrar)
        external
        onlyRole(OFFICER_ROLE)
        returns (address election)
    {
        if (electionByRef[ref] != address(0)) revert ElectionFactory__RefTaken();
        election = Clones.cloneDeterministic(implementation, ref);
        Election(election).initialize(semaphore, ref, config, officer, registrar);
        electionByRef[ref] = election;
        elections.push(election);
        emit ElectionCreated(election, ref, elections.length - 1);
    }

    function predictAddress(bytes32 ref) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, ref);
    }

    function electionCount() external view returns (uint256) {
        return elections.length;
    }
}
