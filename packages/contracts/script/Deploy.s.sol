// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {ElectionFactory} from "../src/ElectionFactory.sol";

/// Deploys Semaphore (verifier + groups) and the ElectionFactory, then grants the relayer the
/// factory OFFICER_ROLE so the backend outbox can create elections.
///
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $DEPLOYER_KEY
///
/// Env: RELAYER_ADDRESS (required), SEMAPHORE_ADDRESS (optional: reuse an existing deployment,
/// e.g. the official one on Base Sepolia / Sepolia).
contract Deploy is Script {
    function run() external {
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address existing = vm.envOr("SEMAPHORE_ADDRESS", address(0));

        vm.startBroadcast();
        address admin = msg.sender;
        address semaphore = existing;
        if (semaphore == address(0)) {
            SemaphoreVerifier verifier = new SemaphoreVerifier();
            semaphore = address(new Semaphore(ISemaphoreVerifier(address(verifier))));
        }
        ElectionFactory factory = new ElectionFactory(ISemaphore(semaphore), admin);
        factory.grantRole(factory.OFFICER_ROLE(), relayer);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", block.number);
        vm.serializeAddress(key, "admin", admin);
        vm.serializeAddress(key, "relayer", relayer);
        vm.serializeAddress(key, "semaphore", semaphore);
        string memory json = vm.serializeAddress(key, "electionFactory", address(factory));
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("ElectionFactory", address(factory));
        console2.log("Semaphore", semaphore);
    }
}
