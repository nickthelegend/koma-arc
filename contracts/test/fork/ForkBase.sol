// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

interface IFiatToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function authorizationState(address, bytes32) external view returns (bool);
    function name() external view returns (string memory);
}

interface IAgoraFaucet {
    function requestFunds(address recipient) external;
}

/// @notice Monad testnet fork harness. Fork tests are skipped unless FORK_TESTS=1 so `forge test` stays
///         offline-safe. RPC: FORK_RPC (default: the public Monad testnet RPC); optional FORK_BLOCK to pin a block.
///         The stablecoin is Agora's real AUSD (EIP-3009 + EIP-2612), funded from Agora's own testnet faucet.
abstract contract ForkBase is Test {
    address internal constant USDC = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // AUSD on Monad testnet
    address internal constant AUSD_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address internal constant ACCOUNT_IMPL = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    /// Agora's faucet pays this much per request, with a 60 s cooldown shared by everyone.
    uint256 internal constant FAUCET_DRIP = 10_000e6;
    address internal constant SINK = address(0xdEaD);

    IFiatToken internal usdc = IFiatToken(USDC);

    function _fork() internal {
        if (!vm.envOr("FORK_TESTS", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("FORK_RPC", vm.envOr("MONAD_TESTNET_RPC_URL", string("https://testnet-rpc.monad.xyz")));
        uint256 blockNumber = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        assertEq(block.chainid, 10143, "not Monad testnet");
    }

    /// @dev Exactly `amount` AUSD for `who`, from Agora's faucet (surplus burned to 0xdEaD).
    function _dealUsdc(address who, uint256 amount) internal {
        uint256 have = usdc.balanceOf(who);
        while (have < amount) {
            vm.warp(block.timestamp + 61); // the faucet's global cooldown
            IAgoraFaucet(AUSD_FAUCET).requestFunds(who);
            uint256 next = usdc.balanceOf(who);
            require(next > have, "AUSD faucet paid nothing");
            have = next;
        }
        if (have > amount) {
            vm.prank(who);
            usdc.transfer(SINK, have - amount);
        }
        assertEq(usdc.balanceOf(who), amount, "AUSD balance");
    }

    /// @dev Fresh EOA with no code (public anvil keys are swept on Monad testnet).
    function _wallet(string memory label) internal returns (address addr, uint256 pk) {
        (addr, pk) = makeAddrAndKey(string.concat("koma-fork-", label));
        assertEq(addr.code.length, 0, "wallet has code");
    }

    function _signReceive(uint256 pk, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(pk),
                to,
                value,
                uint256(0),
                block.timestamp + 1 hours,
                nonce
            )
        );
        (v, r, s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }
}
