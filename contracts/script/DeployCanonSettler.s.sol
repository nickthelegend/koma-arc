// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CanonRegistry} from "../src/CanonRegistry.sol";
import {CanonSettler} from "../src/cre/CanonSettler.sol";

/// Deploys the Chainlink CRE receiver for canon settlement and gives it RELAYER_ROLE on the CanonRegistry.
///   ADDRESSES=../.data/addresses.local.json DEPLOYER_KEY=0x… forge script script/DeployCanonSettler.s.sol \
///     --rpc-url koma_local --broadcast
/// env: ADDRESSES (the launchpad address book; `canonSettler` and `creForwarder` are added to it),
///      FORWARDER (defaults to Chainlink's MockKeystoneForwarder on Monad testnet, the one `cre workflow simulate
///      --broadcast` uses; for a deployed workflow use the KeystoneForwarder from Chainlink's CRE docs),
///      DEPLOYER_KEY (else the default broadcaster). On mainnet the registry admin is a Safe: when the deployer
///      can't grant the role, the script prints the Safe transaction instead.
contract DeployCanonSettler is Script {
    address constant MOCK_FORWARDER_MONAD_TESTNET = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;

    function run() external returns (CanonSettler settler) {
        string memory book = vm.envString("ADDRESSES");
        string memory json = vm.readFile(book);
        CanonRegistry registry = CanonRegistry(vm.parseJsonAddress(json, ".canonRegistry"));
        address forwarder = vm.envOr("FORWARDER", block.chainid == 143 ? address(0) : MOCK_FORWARDER_MONAD_TESTNET);
        require(forwarder != address(0), "Monad mainnet: set FORWARDER to Chainlink's KeystoneForwarder");
        require(forwarder.code.length > 0, "FORWARDER has no code on this chain");

        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0));
        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);

        settler = new CanonSettler(forwarder, registry);
        bytes32 role = registry.RELAYER_ROLE();
        if (registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer)) {
            registry.grantRole(role, address(settler));
            console.log("RELAYER_ROLE granted to the settler");
        } else {
            console.log("Registry admin must grant the role. Safe tx to", address(registry));
            console.logBytes(abi.encodeCall(registry.grantRole, (role, address(settler))));
        }
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(settler)), book, ".canonSettler");
        vm.writeJson(vm.toString(forwarder), book, ".creForwarder");
        console.log("CanonSettler", address(settler));
        console.log("forwarder   ", forwarder);
    }
}
