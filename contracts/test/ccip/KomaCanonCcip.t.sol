// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {KomaCanonReceipt} from "../../src/ccip/KomaCanonReceipt.sol";
import {KomaCanonSender} from "../../src/ccip/KomaCanonSender.sol";
import {KomaIssues} from "../../src/KomaIssues.sol";
import {CanonRegistry} from "../../src/CanonRegistry.sol";
contract ReceiptRouter {
    bytes public sent;
    bool public supported = true;
    function isChainSupported(uint64) external view returns (bool) { return supported; }
    function getFee(uint64, Client.EVM2AnyMessage calldata m) external pure returns (uint256) { require(m.tokenAmounts.length == 0 && m.feeToken == address(0)); return 123; }
    function ccipSend(uint64, Client.EVM2AnyMessage calldata m) external payable returns (bytes32) { require(msg.value == 123); sent = m.data; return keccak256(m.data); }
    function setSupported(bool on) external { supported = on; }
}
contract KomaCanonCcipTest is Test {
    ReceiptRouter router;
    KomaCanonReceipt receiver;
    address source = address(0xBEEF);
    function setUp() public { router = new ReceiptRouter(); receiver = new KomaCanonReceipt(address(router), address(this)); receiver.allowSender(7, source, true); }
    function incoming(bytes32 id, uint256 issue) internal view returns (Client.Any2EVMMessage memory) {
        return Client.Any2EVMMessage({messageId:id,sourceChainSelector:7,sender:abi.encode(source),data:abi.encode(uint8(1),uint256(1),uint256(1),issue,keccak256("content"),keccak256("payment")),destTokenAmounts:new Client.EVMTokenAmount[](0)});
    }
    function test_AuthenticReceiptStoresAndRejectsReplay() public {
        Client.Any2EVMMessage memory m = incoming(bytes32(uint256(1)), 3);
        vm.prank(address(router)); receiver.ccipReceive(m);
        (uint256 issue, bytes32 content,,) = receiver.receipts(receiver.receiptKey(7, source, 1, 1));
        assertEq(issue,3); assertEq(content,keccak256("content"));
        vm.expectRevert(KomaCanonReceipt.DuplicateMessage.selector); vm.prank(address(router)); receiver.ccipReceive(m);
    }
    function test_RejectsWrongRouterSourceSenderAndAttachedTokens() public {
        Client.Any2EVMMessage memory m = incoming(bytes32(uint256(1)),3);
        vm.expectRevert(); receiver.ccipReceive(m);
        m.sourceChainSelector=8; vm.expectRevert(KomaCanonReceipt.UntrustedSource.selector); vm.prank(address(router)); receiver.ccipReceive(m);
        m.sourceChainSelector=7; m.sender=abi.encode(address(0xBAD)); vm.expectRevert(KomaCanonReceipt.UntrustedSource.selector); vm.prank(address(router)); receiver.ccipReceive(m);
        m.sender=abi.encode(source); m.destTokenAmounts=new Client.EVMTokenAmount[](1); m.destTokenAmounts[0]=Client.EVMTokenAmount(address(0x3600),1);
        vm.expectRevert(KomaCanonReceipt.InvalidReceipt.selector); vm.prank(address(router)); receiver.ccipReceive(m);
    }
    function test_RejectsConflictingCanonAndBadVersion() public {
        Client.Any2EVMMessage memory m = incoming(bytes32(uint256(1)),3); vm.prank(address(router)); receiver.ccipReceive(m);
        m=incoming(bytes32(uint256(2)),4); vm.expectRevert(KomaCanonReceipt.ConflictingCanon.selector); vm.prank(address(router)); receiver.ccipReceive(m);
        m.data=abi.encode(uint8(2),uint256(2),uint256(1),uint256(3),keccak256("content"),keccak256("payment"));
        vm.expectRevert(KomaCanonReceipt.InvalidReceipt.selector); vm.prank(address(router)); receiver.ccipReceive(m);
    }
    function test_SenderReadsFinalizedCanonAndActualIssue_NoTokens() public {
        address canon=address(0xCA); address issues=address(0x15);
        vm.etch(canon,hex"00"); vm.etch(issues,hex"00");
        KomaCanonSender sender=new KomaCanonSender(address(router),canon,issues,address(this));
        sender.setDestination(8,address(receiver));
        vm.mockCall(canon,abi.encodeCall(CanonRegistry.slot,(1,1)),abi.encode(uint64(1),uint64(2),true,uint256(3),uint256(1)));
        KomaIssues.Issue memory issue=KomaIssues.Issue(keccak256("content"),keccak256("payment"),0,1,2);
        vm.mockCall(issues,abi.encodeCall(KomaIssues.issue,(3)),abi.encode(issue));
        assertEq(sender.quote(8,1,1),123);
        vm.expectRevert(abi.encodeWithSelector(KomaCanonSender.IncorrectFee.selector,123)); sender.send{value:124}(8,1,1);
        sender.send{value:123}(8,1,1);
        assertEq(router.sent(),abi.encode(uint8(1),uint256(1),uint256(1),uint256(3),issue.contentHash,issue.paymentTx));
        vm.mockCall(canon,abi.encodeCall(CanonRegistry.slot,(1,1)),abi.encode(uint64(1),uint64(2),false,uint256(0),uint256(1)));
        vm.expectRevert(KomaCanonSender.NotFinalized.selector); sender.quote(8,1,1);
    }
    function test_ConfigurationRequiresOwnerAndSupportedRoutes() public {
        vm.expectRevert(); vm.prank(address(0xBAD)); receiver.allowSender(7,address(0x123),true);
        KomaCanonSender sender=new KomaCanonSender(address(router),address(0xCA),address(0x15),address(this));
        router.setSupported(false); vm.expectRevert(KomaCanonSender.InvalidConfiguration.selector); sender.setDestination(8,address(receiver));
    }
}
