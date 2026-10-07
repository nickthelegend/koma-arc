// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployLaunchpad} from "../script/DeployLaunchpad.s.sol";

contract GuardHarness is DeployLaunchpad {
    function preflight(Config memory c) external view {
        _preflight(c);
    }

    function config(address deployer) external view returns (Config memory) {
        return _config(deployer);
    }
}

/// The Monad mainnet guards of script/DeployLaunchpad.s.sol (AUDIT.md M-3), exercised offline: the chain id is
/// set to 143 and the book addresses get placeholder code.
contract DeployGuardsTest is Test {
    GuardHarness h;
    DeployLaunchpad.Config c;

    function setUp() public {
        h = new GuardHarness();
        vm.chainId(143);
        DeployLaunchpad.Book memory b = h.book(143);
        c.mainnet = true;
        c.deployer = makeAddr("deployer");
        c.admin = makeAddr("safe");
        c.treasury = makeAddr("treasury");
        c.relayer = makeAddr("relayer");
        c.usdc = b.usdc;
        c.poolManager = b.poolManager;
        c.positionManager = b.positionManager;
        c.permit2 = b.permit2;
        c.v4Quoter = b.v4Quoter;
        c.erc6551Registry = b.erc6551Registry;
        c.accountProxy = b.accountProxy;
        c.accountImpl = b.accountImpl;
        c.baseURI = "https://koma.example/api/characters/";
        c.issuesBaseURI = "https://koma.example/api/tokens/";
        address[9] memory withCode = [
            b.usdc, b.poolManager, b.positionManager, b.permit2, b.v4Quoter, b.erc6551Registry, b.accountProxy,
            b.accountImpl, c.admin
        ];
        for (uint256 i; i < withCode.length; i++) {
            vm.etch(withCode[i], hex"00");
        }
        vm.etch(CREATE2_FACTORY, hex"00");
    }

    function test_MainnetBook() public view {
        DeployLaunchpad.Book memory b = h.book(143);
        assertEq(b.usdc, 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a, "AUSD");
        assertEq(b.poolManager, 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e);
        assertEq(b.positionManager, 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016);
        assertEq(b.v4Quoter, 0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891);
        assertEq(b.permit2, 0x000000000022D473030F116dDEE9F6B43aC78BA3);
        assertEq(b.erc6551Registry, 0x000000006551c19487814612e58FE06813775758);
        DeployLaunchpad.Book memory t = h.book(10143);
        assertEq(t.usdc, 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC, "testnet AUSD");
        assertEq(t.poolManager, address(0), "no Uniswap v4 on Monad testnet: the script deploys it");
        assertEq(h.book(1).usdc, address(0), "unknown chains get no defaults");
    }

    function test_TestnetDeploysItsOwnUniswapV4() public {
        vm.chainId(10143);
        vm.etch(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC, hex"00");
        DeployLaunchpad.Config memory t = h.config(makeAddr("deployer"));
        assertTrue(t.deployV4);
        assertFalse(t.mainnet);
        h.preflight(t); // passes without a PoolManager: the deploy creates one
    }

    function test_MainnetNeverDeploysUniswapV4() public {
        vm.setEnv("ADMIN", vm.toString(c.admin));
        vm.setEnv("TREASURY", vm.toString(c.treasury));
        vm.setEnv("RELAYER", vm.toString(c.relayer));
        vm.setEnv("BASE_URI", c.baseURI);
        vm.setEnv("KOMA_BASE_URI", c.issuesBaseURI);
        DeployLaunchpad.Config memory m = h.config(makeAddr("deployer"));
        assertFalse(m.deployV4);
        assertEq(m.poolManager, 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e);
    }

    function test_ValidMainnetConfigPasses() public view {
        h.preflight(c);
    }

    function test_RevertWhen_RelayerIsAdmin() public {
        c.relayer = c.admin;
        vm.expectRevert(DeployLaunchpad.RelayerIsAdmin.selector);
        h.preflight(c);
    }

    function test_RevertWhen_AdminIsDeployer() public {
        c.admin = c.deployer;
        vm.etch(c.deployer, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployLaunchpad.MainnetRequires.selector, "ADMIN != deployer (the deployer renounces every role)"
            )
        );
        h.preflight(c);
    }

    function test_RevertWhen_AdminIsEoa() public {
        c.admin = makeAddr("eoa-admin");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployLaunchpad.MainnetRequires.selector,
                "ADMIN with code (a Safe); set ALLOW_EOA_ADMIN=true to override"
            )
        );
        h.preflight(c);
    }

    function test_RevertWhen_LocalhostUri() public {
        c.baseURI = "http://localhost:4310/api/characters/";
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.LocalhostURI.selector, c.baseURI));
        h.preflight(c);
    }

    function test_RevertWhen_BookAddressHasNoCode() public {
        vm.etch(c.poolManager, "");
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.NoCode.selector, "POOL_MANAGER", c.poolManager));
        h.preflight(c);
    }
}
