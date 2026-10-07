// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {KomaIssues} from "../src/KomaIssues.sol";
import {CurveMathReference} from "../src/CurveMathReference.sol";
import {RoyaltyRouterReference} from "../src/RoyaltyRouterReference.sol";
import {IRoyaltyRouter} from "../src/interfaces/IRoyaltyRouter.sol";
import {CharacterNFT} from "../src/CharacterNFT.sol";
import {CanonRegistry} from "../src/CanonRegistry.sol";
import {Graduator} from "../src/Graduator.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {KomaSwapper} from "../src/KomaSwapper.sol";
import {CurveDeployer} from "../src/deployers/CurveDeployer.sol";
import {CoinDeployer} from "../src/deployers/CoinDeployer.sol";

/// @title Deploy the KOMA launchpad on Monad
/// @notice Runbook: docs/DEPLOY-LATER.md. Summary:
///
///   Monad testnet (10143):
///     DEPLOYER_KEY=0x.. ALLOW_EOA_ADMIN=true BASE_URI=https://<app>/api/characters/ KOMA_BASE_URI=https://<app>/api/tokens/ \
///     forge script script/DeployLaunchpad.s.sol --rpc-url monad_testnet --broadcast
///     Uniswap v4 isn't deployed on Monad testnet, so this script deploys the canonical v4 PoolManager,
///     PositionManager and V4Quoter from Uniswap's published artifacts (unless POOL_MANAGER etc. are given).
///   Monad mainnet (143): canonical Uniswap v4 and AUSD from the book; keystore signer only, ADMIN a Safe:
///     ADMIN=<Safe> TREASURY=<Safe> RELAYER=<server key> BASE_URI=.. KOMA_BASE_URI=.. \
///     forge script script/DeployLaunchpad.s.sol --rpc-url monad --account <keystore> --sender <addr> --broadcast
///
///   The curve math and the royalty router are the Solidity contracts (CurveMathReference, RoyaltyRouterReference).
///   The stablecoin everywhere ("usdc" in the code) is Agora's AUSD.
///
///   Env: ADMIN (default: deployer, off-mainnet only), TREASURY, RELAYER, KOMA_ISSUES (existing issues contract;
///   else a fresh one), BASE_URI, KOMA_BASE_URI, MIN_GRADUATION_TARGET / MIN_VOTING_WINDOW (launch floors;
///   default 1,000 AUSD / 1 h on 143, 1 AUSD / 60 s elsewhere), ALLOW_EOA_ADMIN (143: accept an ADMIN without
///   code), USDC, POOL_MANAGER, POSITION_MANAGER, PERMIT2, V4_QUOTER, ERC6551_REGISTRY, ACCOUNT_PROXY,
///   ACCOUNT_IMPL, ADDRESSES_OUT (default ../deploy/addresses.<chainId>.json; "none" skips writing).
///
///   At the end the deployer holds no role anywhere (when ADMIN != deployer): ADMIN gets DEFAULT_ADMIN_ROLE on
///   every AccessControl contract and the router's ownership, RELAYER only the operational roles.
contract DeployLaunchpad is Script {
    uint256 internal constant MONAD = 143;
    uint256 internal constant MONAD_TESTNET = 10143; // also the local anvil fork of Monad testnet
    // CREATE2_FACTORY (forge-std CommonBase): the Arachnid deterministic-deployment proxy, present on Monad,
    // Monad testnet and anvil.
    string internal constant POOL_MANAGER_ARTIFACT = "../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json";
    string internal constant POSITION_MANAGER_ARTIFACT =
        "../node_modules/@uniswap/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json";
    string internal constant V4_QUOTER_ARTIFACT = "../node_modules/@uniswap/v4-periphery/foundry-out/V4Quoter.sol/V4Quoter.json";
    uint160 internal constant GRADUATOR_HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG;

    struct Book {
        address usdc;
        address poolManager;
        address positionManager;
        address permit2;
        address v4Quoter;
        address erc6551Registry;
        address accountProxy;
        address accountImpl;
    }

    struct Config {
        bool mainnet;
        address deployer;
        address admin;
        address usdc;
        address treasury;
        address relayer;
        address komaIssues;
        /// Uniswap v4 isn't on this chain (Monad testnet): deploy PoolManager, PositionManager and V4Quoter here.
        bool deployV4;
        address poolManager;
        address positionManager;
        address permit2;
        address v4Quoter;
        address erc6551Registry;
        address accountProxy;
        address accountImpl;
        string baseURI;
        string issuesBaseURI;
        uint256 minGraduationTarget;
        uint64 minVotingWindow;
    }

    struct Deployment {
        address komaIssues;
        address seriesFactory;
        address characterNft;
        address canonRegistry;
        address graduator;
        address swapper;
        address curveMath;
        address royaltyRouter;
        address poolManager;
        address positionManager;
        address v4Quoter;
        /// router.factory() == seriesFactory and router.owner() == admin after this run
        bool routerWired;
        uint256 deployBlock;
    }

    error NoSigner();
    error MainnetRequires(string what);
    error MainnetOverride(string name, address book, address given);
    error MissingAddress(string name);
    error NoCode(string name, address at);
    error RelayerIsAdmin();
    error LocalhostURI(string uri);
    error RouterMisconfigured(string what);
    error RouterOwnedByStranger(address owner);
    error GraduatorDeployFailed();
    error PostCheck(string what);

    function run() public virtual returns (Deployment memory d) {
        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0));
        // Mainnet signs with a keystore / hardware wallet (`--account`, `--ledger`), never a raw env key.
        if (pk != 0 && block.chainid == MONAD) revert MainnetRequires("--account keystore signer, not DEPLOYER_KEY");
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);
        if (deployer == DEFAULT_SENDER) revert NoSigner(); // forgot --account/--sender: never deploy as forge's default
        Config memory cfg = _config(deployer);
        _preflight(cfg);

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        d = _deploy(cfg);
        vm.stopBroadcast();

        _postCheck(cfg, d);
        d.deployBlock = _chainBlockNumber();
        _log(cfg, d);
        _write(cfg, d);
    }

    // ------------------------------------------------------------------ configuration

    /// @notice Canonical addresses per chain. Monad mainnet values are checked to have code in `_preflight`.
    function book(uint256 chainId) public pure returns (Book memory b) {
        if (chainId == MONAD) {
            b.usdc = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a; // AUSD
            b.poolManager = 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e;
            b.positionManager = 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016;
            b.v4Quoter = 0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891;
        } else if (chainId == MONAD_TESTNET) {
            b.usdc = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // AUSD (Agora testnet)
            // No Uniswap v4 on Monad testnet: left empty, deployed by this script.
        } else {
            return b; // unknown chain: everything must come from env
        }
        b.permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        // Tokenbound v0.3 (same addresses and code on both chains)
        b.erc6551Registry = 0x000000006551c19487814612e58FE06813775758;
        b.accountProxy = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
        b.accountImpl = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    }

    function _config(address deployer) internal view virtual returns (Config memory c) {
        c.mainnet = block.chainid == MONAD;
        c.deployer = deployer;
        Book memory b = book(block.chainid);
        c.usdc = _addr("USDC", b.usdc, c.mainnet);
        c.permit2 = _addr("PERMIT2", b.permit2, c.mainnet);
        c.poolManager = vm.envOr("POOL_MANAGER", b.poolManager);
        c.deployV4 = !c.mainnet && c.poolManager == address(0);
        if (!c.deployV4) {
            c.poolManager = _addr("POOL_MANAGER", b.poolManager, c.mainnet);
            c.positionManager = _addr("POSITION_MANAGER", b.positionManager, c.mainnet);
            c.v4Quoter = _addr("V4_QUOTER", b.v4Quoter, c.mainnet);
        }
        c.erc6551Registry = _addr("ERC6551_REGISTRY", b.erc6551Registry, c.mainnet);
        c.accountProxy = _addr("ACCOUNT_PROXY", b.accountProxy, c.mainnet);
        c.accountImpl = _addr("ACCOUNT_IMPL", b.accountImpl, c.mainnet);

        c.komaIssues = vm.envOr("KOMA_ISSUES", address(0));

        if (c.mainnet) {
            // No silent defaults on mainnet: every role holder is explicit.
            c.admin = _required("ADMIN");
            c.treasury = _required("TREASURY");
            c.relayer = _required("RELAYER");
            c.baseURI = _requiredString("BASE_URI");
            c.issuesBaseURI = c.komaIssues == address(0) ? _requiredString("KOMA_BASE_URI") : "";
            c.minGraduationTarget = vm.envOr("MIN_GRADUATION_TARGET", uint256(1_000e6));
            c.minVotingWindow = uint64(vm.envOr("MIN_VOTING_WINDOW", uint256(3_600)));
        } else {
            c.admin = vm.envOr("ADMIN", deployer);
            c.treasury = vm.envOr("TREASURY", deployer);
            c.relayer = vm.envOr("RELAYER", deployer);
            c.baseURI = vm.envOr("BASE_URI", string("http://localhost:4310/api/characters/"));
            c.issuesBaseURI = vm.envOr("KOMA_BASE_URI", string("http://localhost:4310/api/tokens/"));
            c.minGraduationTarget = vm.envOr("MIN_GRADUATION_TARGET", uint256(1e6));
            c.minVotingWindow = uint64(vm.envOr("MIN_VOTING_WINDOW", uint256(60)));
        }
    }

    function _preflight(Config memory c) internal view {
        _requireCode("USDC", c.usdc);
        if (!c.deployV4) {
            _requireCode("POOL_MANAGER", c.poolManager);
            _requireCode("POSITION_MANAGER", c.positionManager);
        }
        _requireCode("PERMIT2", c.permit2);
        _requireCode("ERC6551_REGISTRY", c.erc6551Registry);
        _requireCode("ACCOUNT_PROXY", c.accountProxy);
        _requireCode("ACCOUNT_IMPL", c.accountImpl);
        _requireCode("CREATE2_FACTORY", CREATE2_FACTORY);
        if (c.komaIssues != address(0)) _requireCode("KOMA_ISSUES", c.komaIssues);
        if (!c.mainnet) return;

        _requireCode("V4_QUOTER", c.v4Quoter);
        if (c.relayer == c.admin) revert RelayerIsAdmin();
        if (c.admin == c.deployer) revert MainnetRequires("ADMIN != deployer (the deployer renounces every role)");
        if (c.admin.code.length == 0 && !vm.envOr("ALLOW_EOA_ADMIN", false)) {
            revert MainnetRequires("ADMIN with code (a Safe); set ALLOW_EOA_ADMIN=true to override");
        }
        _noLocalhost(c.baseURI);
        _noLocalhost(c.issuesBaseURI);
    }

    // ------------------------------------------------------------------ deployment

    function _deploy(Config memory c) internal returns (Deployment memory d) {
        if (c.deployV4) {
            // Canonical Uniswap v4 bytecode from Uniswap's published artifacts (PoolManager owner = ADMIN).
            c.poolManager = deployCode(POOL_MANAGER_ARTIFACT, abi.encode(c.admin));
            c.positionManager =
                deployCode(POSITION_MANAGER_ARTIFACT, abi.encode(c.poolManager, c.permit2, 300_000, address(0), address(0)));
            c.v4Quoter = deployCode(V4_QUOTER_ARTIFACT, abi.encode(c.poolManager));
        }
        d.poolManager = c.poolManager;
        d.positionManager = c.positionManager;
        d.v4Quoter = c.v4Quoter;
        d.curveMath = address(new CurveMathReference());
        RoyaltyRouterReference router = new RoyaltyRouterReference();
        router.initialize(c.usdc, c.treasury, c.deployer);
        d.royaltyRouter = address(router);

        d.komaIssues = c.komaIssues != address(0)
            ? c.komaIssues
            : address(new KomaIssues(c.admin, c.relayer, c.issuesBaseURI));

        d.characterNft =
            address(new CharacterNFT(c.deployer, c.erc6551Registry, c.accountProxy, c.accountImpl, c.baseURI));
        d.canonRegistry = address(new CanonRegistry(c.deployer));
        d.graduator = address(_deployGraduator(c));
        d.seriesFactory = address(_newFactory(c, d));
        d.swapper = address(new KomaSwapper(c.poolManager, d.graduator, c.usdc));

        // Operational roles: the factory mints/registers, the relayer launches and runs canon.
        CharacterNFT nft = CharacterNFT(d.characterNft);
        CanonRegistry canon = CanonRegistry(d.canonRegistry);
        Graduator graduator = Graduator(d.graduator);
        SeriesFactory factory = SeriesFactory(d.seriesFactory);
        nft.grantRole(nft.MINTER_ROLE(), address(factory));
        canon.grantRole(canon.FACTORY_ROLE(), address(factory));
        canon.grantRole(canon.RELAYER_ROLE(), c.relayer);
        graduator.grantRole(graduator.FACTORY_ROLE(), address(factory));
        factory.grantRole(factory.LAUNCHER_ROLE(), c.relayer);

        d.routerWired = _wireRouter(c, d.royaltyRouter, d.seriesFactory);

        // Hand every admin role to ADMIN and drop the deployer's.
        if (c.admin != c.deployer) {
            _handOver(IAccessControl(address(nft)), c);
            _handOver(IAccessControl(address(canon)), c);
            _handOver(IAccessControl(address(graduator)), c);
            _handOver(IAccessControl(address(factory)), c);
        }
    }

    function _newFactory(Config memory c, Deployment memory d) internal returns (SeriesFactory) {
        return new SeriesFactory(
            c.deployer,
            c.usdc,
            d.curveMath,
            d.royaltyRouter,
            d.characterNft,
            d.canonRegistry,
            d.graduator,
            c.treasury,
            address(new CurveDeployer()),
            address(new CoinDeployer()),
            c.minGraduationTarget,
            c.minVotingWindow
        );
    }

    /// @dev Front-run safe ordering: only the owner can point the router at a factory, and the owner hands the
    ///      router to ADMIN last. Returns false when ADMIN already owns it (ADMIN must send setFactory itself).
    function _wireRouter(Config memory c, address routerAddr, address factory) internal returns (bool) {
        IRoyaltyRouter r = IRoyaltyRouter(routerAddr);
        address owner = r.owner();
        if (owner == c.deployer) {
            if (r.factory() != factory) r.setFactory(factory);
            if (c.admin != c.deployer) r.transferOwnership(c.admin);
            return true;
        }
        if (owner == c.admin) return r.factory() == factory;
        revert RouterOwnedByStranger(owner);
    }

    function _handOver(IAccessControl ac, Config memory c) internal {
        bytes32 adminRole = 0x00; // DEFAULT_ADMIN_ROLE
        ac.grantRole(adminRole, c.admin);
        ac.renounceRole(adminRole, c.deployer);
    }

    /// @dev The Graduator is the v4 hook of every series pool (initialize gating, AUDIT.md H-1), so its address
    ///      must carry exactly the BEFORE_INITIALIZE flag: CREATE2 through the deterministic deployer with a
    ///      mined salt. The init code binds the admin (deployer) and the chain's addresses, so a front-runner
    ///      replaying the salt deploys the identical contract.
    function _deployGraduator(Config memory c) internal returns (Graduator g) {
        bytes memory initCode = abi.encodePacked(
            type(Graduator).creationCode,
            abi.encode(c.deployer, c.poolManager, c.positionManager, c.permit2, c.usdc, c.treasury)
        );
        (bytes32 salt, address predicted) = mineGraduatorSalt(keccak256(initCode));
        (bool ok, bytes memory ret) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        if (!ok || ret.length != 20 || address(bytes20(ret)) != predicted) revert GraduatorDeployFailed();
        g = Graduator(predicted);
    }

    function mineGraduatorSalt(bytes32 initCodeHash) public view returns (bytes32 salt, address predicted) {
        uint160 mask = Hooks.ALL_HOOK_MASK;
        for (uint256 i;; i++) {
            salt = bytes32(i);
            predicted = vm.computeCreate2Address(salt, initCodeHash, CREATE2_FACTORY);
            if (uint160(predicted) & mask == GRADUATOR_HOOK_FLAGS && predicted.code.length == 0) return (salt, predicted);
        }
    }

    // ------------------------------------------------------------------ post-deploy checks

    function _postCheck(Config memory c, Deployment memory d) internal view {
        bytes32 adminRole = 0x00;
        address[4] memory acs = [d.characterNft, d.canonRegistry, d.graduator, d.seriesFactory];
        for (uint256 i; i < acs.length; i++) {
            IAccessControl ac = IAccessControl(acs[i]);
            if (!ac.hasRole(adminRole, c.admin)) revert PostCheck("admin missing DEFAULT_ADMIN_ROLE");
            if (c.admin != c.deployer && ac.hasRole(adminRole, c.deployer)) revert PostCheck("deployer kept admin");
            if (c.relayer != c.admin && ac.hasRole(adminRole, c.relayer)) revert PostCheck("relayer is admin");
        }
        if (c.komaIssues == address(0)) {
            KomaIssues issues = KomaIssues(d.komaIssues);
            if (!issues.hasRole(adminRole, c.admin)) revert PostCheck("issues admin");
            if (c.relayer != c.admin && issues.hasRole(adminRole, c.relayer)) revert PostCheck("issues: relayer is admin");
            if (!issues.hasRole(issues.MINTER_ROLE(), c.relayer)) revert PostCheck("issues minter");
        }
        SeriesFactory f = SeriesFactory(d.seriesFactory);
        if (!f.hasRole(f.LAUNCHER_ROLE(), c.relayer)) revert PostCheck("launcher");
        CanonRegistry canon = CanonRegistry(d.canonRegistry);
        if (!canon.hasRole(canon.RELAYER_ROLE(), c.relayer)) revert PostCheck("canon relayer");
        if (!canon.hasRole(canon.FACTORY_ROLE(), d.seriesFactory)) revert PostCheck("canon factory");
        Graduator g = Graduator(d.graduator);
        if (!g.hasRole(g.FACTORY_ROLE(), d.seriesFactory)) revert PostCheck("graduator factory");
        if (g.treasury() != c.treasury || address(g.poolManager()) != d.poolManager) revert PostCheck("graduator config");
        if (uint160(d.graduator) & Hooks.ALL_HOOK_MASK != GRADUATOR_HOOK_FLAGS) revert PostCheck("graduator hook flags");
        CharacterNFT nft = CharacterNFT(d.characterNft);
        if (!nft.hasRole(nft.MINTER_ROLE(), d.seriesFactory)) revert PostCheck("nft minter");
        IRoyaltyRouter r = IRoyaltyRouter(d.royaltyRouter);
        if (r.usdc() != c.usdc || r.treasury() != c.treasury) revert PostCheck("router config");
        if (d.routerWired && (r.factory() != d.seriesFactory || r.owner() != c.admin)) revert PostCheck("router wiring");
    }

    // ------------------------------------------------------------------ helpers

    function _addr(string memory name, address bookValue, bool mainnet) internal view returns (address v) {
        v = vm.envOr(name, bookValue);
        if (mainnet && v != bookValue) revert MainnetOverride(name, bookValue, v);
        if (v == address(0)) revert MissingAddress(name);
    }

    function _required(string memory name) internal view returns (address v) {
        v = vm.envOr(name, address(0));
        if (v == address(0)) revert MainnetRequires(name);
    }

    function _requiredString(string memory name) internal view returns (string memory v) {
        v = vm.envOr(name, string(""));
        if (bytes(v).length == 0) revert MainnetRequires(name);
    }

    function _requireCode(string memory name, address a) internal view {
        if (a.code.length == 0) revert NoCode(name, a);
    }

    function _noLocalhost(string memory uri) internal pure {
        bytes memory u = bytes(uri);
        if (_contains(u, "localhost") || _contains(u, "127.0.0.1") || _contains(u, ".test/")) revert LocalhostURI(uri);
    }

    function _contains(bytes memory h, bytes memory n) internal pure returns (bool) {
        if (n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length && hit; j++) {
                hit = h[i + j] == n[j];
            }
            if (hit) return true;
        }
        return false;
    }

    /// @dev The block the RPC reports (what indexers start from); falls back to the EVM value with no RPC.
    function _chainBlockNumber() internal returns (uint256 n) {
        try vm.rpc("eth_blockNumber", "[]") returns (bytes memory raw) {
            for (uint256 i; i < raw.length; i++) {
                n = (n << 8) | uint8(raw[i]);
            }
        } catch {
            n = vm.getBlockNumber();
        }
    }

    function _log(Config memory c, Deployment memory d) internal view {
        console.log("chain           ", block.chainid);
        console.log("PoolManager (v4)", d.poolManager);
        console.log("SeriesFactory   ", d.seriesFactory);
        console.log("CharacterNFT    ", d.characterNft);
        console.log("CanonRegistry   ", d.canonRegistry);
        console.log("Graduator (hook)", d.graduator);
        console.log("KomaSwapper     ", d.swapper);
        console.log("CurveMath       ", d.curveMath);
        console.log("RoyaltyRouter   ", d.royaltyRouter);
        console.log("KomaIssues      ", d.komaIssues);
        console.log("admin           ", c.admin);
        console.log("treasury        ", c.treasury);
        console.log("relayer         ", c.relayer);
        if (c.relayer == c.deployer) console.log("WARNING: the relayer is the deployer key");

        console.log("");
        console.log("POST-DEPLOY CHECKLIST (deploy/DEPLOY.md has the full runbook)");
        if (!d.routerWired) {
            console.log("[ ] ADMIN (Safe) must send on the router - launches revert until it does:");
            console.log(string.concat("    ", vm.toString(d.royaltyRouter), " setFactory(address) ", vm.toString(d.seriesFactory)));
        } else {
            console.log("[x] router: factory set, ownership transferred to ADMIN");
        }
        console.log("[ ] verify sources on Sourcify (forge verify-contract --verifier sourcify --chain <id>)");
        console.log("[ ] check roles with cast call hasRole (deployer must hold none)");
        console.log("[ ] smoke test with the smallest amounts (MAINNET.md section 6)");
    }

    function _write(Config memory c, Deployment memory d) internal {
        string memory out = vm.envOr(
            "ADDRESSES_OUT", string.concat(vm.projectRoot(), "/../deploy/addresses.", vm.toString(block.chainid), ".json")
        );
        if (keccak256(bytes(out)) == keccak256("none")) return;
        string memory k = "launchpad";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "usdc", c.usdc);
        vm.serializeAddress(k, "komaIssues", d.komaIssues);
        vm.serializeAddress(k, "seriesFactory", d.seriesFactory);
        vm.serializeAddress(k, "characterNft", d.characterNft);
        vm.serializeAddress(k, "canonRegistry", d.canonRegistry);
        vm.serializeAddress(k, "graduator", d.graduator);
        vm.serializeAddress(k, "swapper", d.swapper);
        vm.serializeAddress(k, "curveMath", d.curveMath);
        vm.serializeAddress(k, "royaltyRouter", d.royaltyRouter);
        vm.serializeString(k, "engine", "solidity");
        vm.serializeAddress(k, "poolManager", d.poolManager);
        vm.serializeAddress(k, "positionManager", d.positionManager);
        vm.serializeAddress(k, "permit2", c.permit2);
        vm.serializeAddress(k, "v4Quoter", d.v4Quoter);
        vm.serializeAddress(k, "erc6551Registry", c.erc6551Registry);
        vm.serializeAddress(k, "accountProxy", c.accountProxy);
        vm.serializeAddress(k, "accountImpl", c.accountImpl);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "relayer", c.relayer);
        vm.serializeAddress(k, "admin", c.admin);
        vm.serializeBool(k, "routerWired", d.routerWired);
        vm.serializeUint(k, "minGraduationTarget", c.minGraduationTarget);
        vm.serializeUint(k, "minVotingWindow", c.minVotingWindow);
        string memory json = vm.serializeUint(k, "deployBlock", d.deployBlock);
        vm.writeJson(json, out);
        console.log("addresses written to", out);
    }
}
