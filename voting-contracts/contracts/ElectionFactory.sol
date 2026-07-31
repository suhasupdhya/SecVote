// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Election.sol";

/**
 * @title ElectionFactory
 * @notice Deploys and tracks isolated Election instances. This is what makes
 *         the platform reusable for both government elections and college/
 *         university student elections on the same deployed system — every
 *         election gets its own contract instance, its own candidate list,
 *         its own eligible-voter Merkle root, and its own time window, so
 *         concurrent elections never interfere with each other.
 */
contract ElectionFactory {
    struct ElectionRecord {
        address electionAddress;
        string title;
        string domain; // "GOVT" or "COLLEGE"
        address admin;
    }

    address public owner;
    uint256 public electionCount;
    mapping(uint256 => ElectionRecord) public elections;

    event ElectionCreated(
        uint256 indexed electionId,
        address indexed electionAddress,
        string title,
        string domain,
        address admin
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "ElectionFactory: caller is not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Create a new election instance. Callable by the platform owner
     *         (e.g. Election Commission backend for govt use, or college
     *         admin backend for student council use).
     */
    function createElection(
        address _electionAdmin,
        string memory _title,
        string memory _domain,
        string[] memory _candidateNames,
        uint256 _startTime,
        uint256 _endTime,
        bytes32 _merkleRoot
    ) external onlyOwner returns (uint256 electionId, address electionAddress) {
        Election newElection = new Election(
            _electionAdmin,
            _title,
            _domain,
            _candidateNames,
            _startTime,
            _endTime,
            _merkleRoot
        );

        electionId = electionCount;
        elections[electionId] = ElectionRecord({
            electionAddress: address(newElection),
            title: _title,
            domain: _domain,
            admin: _electionAdmin
        });
        electionCount += 1;

        emit ElectionCreated(electionId, address(newElection), _title, _domain, _electionAdmin);
        return (electionId, address(newElection));
    }

    function getElection(uint256 _electionId) external view returns (ElectionRecord memory) {
        return elections[_electionId];
    }

    function getAllElectionAddresses() external view returns (address[] memory) {
        address[] memory addrs = new address[](electionCount);
        for (uint256 i = 0; i < electionCount; i++) {
            addrs[i] = elections[i].electionAddress;
        }
        return addrs;
    }
}
