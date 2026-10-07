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

    function ensureErc6551(Config memory c) external {
        _ensureErc6551(c);
    }
}

/// The Arc mainnet guards of script/DeployLaunchpad.s.sol (AUDIT.md), exercised offline: the chain id is set to
/// 5042 and the book addresses get placeholder code. (vm.setEnv is process-wide and tests run in parallel, so only
/// one test sets env and none asserts on env-dependent defaults.)
contract DeployGuardsTest is Test {
    uint256 constant ARC = 5042;
    uint256 constant ARC_TESTNET = 5042002;
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address constant ACCOUNT_IMPL = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    address constant GUARDIAN = 0x2FE5ccb0d7Ea195FEb87987d3573F9fcCE2b5D57;
    address constant FORWARDER = 0xcA1167915584462449EE5b4Ea51c37fE81eCDCCD;

    GuardHarness h;
    DeployLaunchpad.Config c;

    function setUp() public {
        h = new GuardHarness();
        vm.chainId(ARC);
        DeployLaunchpad.Book memory b = h.book(ARC);
        c.mainnet = true;
        c.deployV4 = true;
        c.deployer = makeAddr("deployer");
        c.admin = makeAddr("safe");
        c.treasury = makeAddr("treasury");
        c.relayer = makeAddr("relayer");
        c.usdc = b.usdc;
        c.permit2 = b.permit2;
        c.erc6551Registry = b.erc6551Registry;
        c.accountProxy = b.accountProxy;
        c.accountImpl = b.accountImpl;
        c.baseURI = "https://koma.example/api/characters/";
        c.issuesBaseURI = "https://koma.example/api/tokens/";
        address[3] memory withCode = [b.usdc, b.permit2, c.admin];
        for (uint256 i; i < withCode.length; i++) {
            vm.etch(withCode[i], hex"00");
        }
        vm.etch(CREATE2_FACTORY, hex"00");
    }

    function test_ArcBook() public view {
        for (uint256 i; i < 2; i++) {
            DeployLaunchpad.Book memory b = h.book(i == 0 ? ARC : ARC_TESTNET);
            assertEq(b.usdc, USDC, "USDC is the native gas token's ERC-20 interface");
            assertEq(b.poolManager, address(0), "no Uniswap v4 on Arc: the script deploys it");
            assertEq(b.permit2, 0x000000000022D473030F116dDEE9F6B43aC78BA3);
            assertEq(b.erc6551Registry, REGISTRY);
            assertEq(b.accountProxy, ACCOUNT_PROXY);
            assertEq(b.accountImpl, ACCOUNT_IMPL);
        }
        assertEq(h.book(1).usdc, address(0), "unknown chains get no defaults");
    }

    function test_TestnetDeploysItsOwnUniswapV4() public {
        vm.chainId(ARC_TESTNET);
        DeployLaunchpad.Config memory t = h.config(makeAddr("deployer"));
        assertTrue(t.deployV4);
        assertFalse(t.mainnet);
        h.preflight(t); // passes without a PoolManager or Tokenbound: the deploy creates them
    }

    function test_MainnetDeploysUniswapV4AndNeedsExplicitRoles() public {
        vm.setEnv("ADMIN", vm.toString(c.admin));
        vm.setEnv("TREASURY", vm.toString(c.treasury));
        vm.setEnv("RELAYER", vm.toString(c.relayer));
        vm.setEnv("BASE_URI", c.baseURI);
        vm.setEnv("KOMA_BASE_URI", c.issuesBaseURI);
        DeployLaunchpad.Config memory m = h.config(makeAddr("deployer"));
        assertTrue(m.mainnet);
        assertTrue(m.deployV4);
        assertEq(m.usdc, USDC);
        assertEq(m.minGraduationTarget, 1_000e6, "mainnet launch floor: 1,000 USDC");
        assertEq(m.minVotingWindow, 3_600);
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

    function test_RevertWhen_GivenPoolManagerHasNoCode() public {
        c.deployV4 = false;
        c.poolManager = makeAddr("pool-manager");
        c.positionManager = makeAddr("position-manager");
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.NoCode.selector, "POOL_MANAGER", c.poolManager));
        h.preflight(c);
    }

    function test_RevertWhen_NonCanonical6551HasNoCode() public {
        c.accountImpl = makeAddr("custom-impl");
        vm.etch(REGISTRY, hex"00");
        vm.etch(ACCOUNT_PROXY, hex"00");
        vm.expectRevert(abi.encodeWithSelector(DeployLaunchpad.NoCode.selector, "ACCOUNT_IMPL", c.accountImpl));
        h.preflight(c);
    }

    /// The stored init code replays the canonical ERC-6551 registry and Tokenbound v0.3 at their exact addresses,
    /// with the same runtime code as everywhere else (checked against the test fixture's etched Arbitrum One code).
    function test_ReplaysCanonicalErc6551() public {
        // the real Arachnid deterministic-deployment proxy runtime
        vm.etch(
            CREATE2_FACTORY,
            hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
        );
        address[5] memory parts = [REGISTRY, GUARDIAN, FORWARDER, ACCOUNT_IMPL, ACCOUNT_PROXY];
        for (uint256 i; i < parts.length; i++) {
            assertEq(parts[i].code.length, 0);
        }
        h.ensureErc6551(c);
        for (uint256 i; i < parts.length; i++) {
            assertGt(parts[i].code.length, 0, "deployed at the canonical address");
        }
        assertEq(keccak256(REGISTRY.code), keccak256(vm.parseBytes(vm.readFile("test/utils/bytecode/ERC6551Registry.hex"))));
        assertEq(keccak256(ACCOUNT_PROXY.code), keccak256(vm.parseBytes(vm.readFile("test/utils/bytecode/AccountProxy.hex"))));
        assertEq(keccak256(GUARDIAN.code), keccak256(vm.parseBytes(vm.readFile("test/utils/bytecode/AccountGuardian.hex"))));
        // a second run is a no-op
        h.ensureErc6551(c);
    }
}
