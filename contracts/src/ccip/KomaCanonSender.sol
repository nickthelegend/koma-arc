// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CanonRegistry} from "../CanonRegistry.sol";
import {KomaIssues} from "../KomaIssues.sol";
/// Publish actual finalized onchain canon. Caller pays native CCIP fee; no token approvals or sends.
contract KomaCanonSender is Ownable2Step {
    IRouterClient public immutable router;
    CanonRegistry public immutable canon;
    KomaIssues public immutable issues;
    mapping(uint64 => address) public destinations;
    event DestinationSet(uint64 indexed selector, address receiver);
    event CanonSent(bytes32 indexed messageId, uint64 indexed destination, uint256 indexed seriesId, uint256 episode, uint256 issueId);
    error InvalidConfiguration();
    error NotFinalized();
    error IncorrectFee(uint256 required);
    constructor(address router_, address canon_, address issues_, address owner_) Ownable(owner_) {
        if (router_ == address(0) || canon_ == address(0) || issues_ == address(0)) revert InvalidConfiguration();
        router = IRouterClient(router_); canon = CanonRegistry(canon_); issues = KomaIssues(issues_);
    }
    function setDestination(uint64 selector, address receiver) external onlyOwner {
        if (selector == 0) revert InvalidConfiguration();
        if (receiver != address(0) && !router.isChainSupported(selector)) revert InvalidConfiguration();
        destinations[selector] = receiver; emit DestinationSet(selector, receiver);
    }
    function message(uint64 selector, uint256 seriesId, uint256 episode) public view returns (Client.EVM2AnyMessage memory) {
        address receiver = destinations[selector];
        if (receiver == address(0)) revert InvalidConfiguration();
        (, , bool finalized, uint256 winner, ) = canon.slot(seriesId, episode);
        if (!finalized || winner == 0) revert NotFinalized();
        KomaIssues.Issue memory issue = issues.issue(winner);
        return Client.EVM2AnyMessage({ receiver: abi.encode(receiver), data: abi.encode(uint8(1), seriesId, episode, winner, issue.contentHash, issue.paymentTx), tokenAmounts: new Client.EVMTokenAmount[](0), feeToken: address(0), extraArgs: Client._argsToBytes(Client.GenericExtraArgsV2({ gasLimit: 250_000, allowOutOfOrderExecution: true })) });
    }
    function quote(uint64 selector, uint256 seriesId, uint256 episode) external view returns (uint256) { return router.getFee(selector, message(selector, seriesId, episode)); }
    function send(uint64 selector, uint256 seriesId, uint256 episode) external payable returns (bytes32 messageId) {
        Client.EVM2AnyMessage memory m = message(selector, seriesId, episode);
        uint256 fee = router.getFee(selector, m);
        if (msg.value != fee) revert IncorrectFee(fee);
        messageId = router.ccipSend{value: fee}(selector, m);
        (, , , uint256 winner, ) = canon.slot(seriesId, episode);
        emit CanonSent(messageId, selector, seriesId, episode, winner);
    }
}
