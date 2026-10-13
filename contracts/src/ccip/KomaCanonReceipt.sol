// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// Message-only remote canon receipts. This never mints, buys or moves USDC/NFTs.
contract KomaCanonReceipt is CCIPReceiver, Ownable2Step {
    struct Receipt { uint256 issueId; bytes32 contentHash; bytes32 paymentTx; bytes32 messageId; }
    mapping(uint64 => mapping(address => bool)) public allowedSenders;
    mapping(bytes32 => bool) public received;
    mapping(bytes32 => Receipt) public receipts;
    event CanonReceived(bytes32 indexed key, bytes32 indexed messageId, uint64 indexed sourceChain, address sender, uint256 seriesId, uint256 episode, uint256 issueId, bytes32 contentHash, bytes32 paymentTx);
    event SenderAllowed(uint64 indexed selector, address indexed sender, bool allowed);
    error InvalidReceipt();
    error UntrustedSource();
    error DuplicateMessage();
    error ConflictingCanon();
    constructor(address router, address owner_) CCIPReceiver(router) Ownable(owner_) {}
    function allowSender(uint64 selector, address sender, bool allowed) external onlyOwner {
        if (selector == 0 || sender == address(0)) revert InvalidReceipt();
        allowedSenders[selector][sender] = allowed;
        emit SenderAllowed(selector, sender, allowed);
    }
    function receiptKey(uint64 source, address sender, uint256 seriesId, uint256 episode) public pure returns (bytes32) {
        return keccak256(abi.encode(source, sender, seriesId, episode));
    }
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        if (message.sender.length != 32 || message.destTokenAmounts.length != 0) revert InvalidReceipt();
        address sender = abi.decode(message.sender, (address));
        if (!allowedSenders[message.sourceChainSelector][sender]) revert UntrustedSource();
        if (received[message.messageId]) revert DuplicateMessage();
        (uint8 version, uint256 seriesId, uint256 episode, uint256 issueId, bytes32 contentHash, bytes32 paymentTx) = abi.decode(message.data, (uint8, uint256, uint256, uint256, bytes32, bytes32));
        if (version != 1 || seriesId == 0 || episode == 0 || issueId == 0 || contentHash == bytes32(0) || paymentTx == bytes32(0)) revert InvalidReceipt();
        bytes32 key = receiptKey(message.sourceChainSelector, sender, seriesId, episode);
        Receipt memory previous = receipts[key];
        if (previous.issueId != 0 && (previous.issueId != issueId || previous.contentHash != contentHash || previous.paymentTx != paymentTx)) revert ConflictingCanon();
        received[message.messageId] = true;
        receipts[key] = Receipt(issueId, contentHash, paymentTx, message.messageId);
        emit CanonReceived(key, message.messageId, message.sourceChainSelector, sender, seriesId, episode, issueId, contentHash, paymentTx);
    }
}
