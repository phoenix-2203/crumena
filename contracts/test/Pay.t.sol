// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";
import {Text} from "../src/lib/Text.sol";

contract PayTest is Base {
    uint256 internal potId;

    function setUp() public override {
        super.setUp();
        potId = _fundedPot(1000 * FUSD);
    }

    function test_recipientPaysAnApprovedPayee() public {
        _pay(potId, recipient, supplierA, 250 * FUSD, "PO-1042 materials");
        assertEq(token.balanceOf(supplierA), 250 * FUSD);
        assertEq(earmark.balanceOf(potId), 750 * FUSD);
        assertEq(earmark.potInfo(potId).paidOut, 250 * FUSD);
        assertEq(earmark.nonceOf(recipient), 1);
    }

    function test_funderCanPayToo() public {
        _pay(potId, funder, supplierB, 40 * FUSD, "");
        assertEq(token.balanceOf(supplierB), 40 * FUSD);
    }

    function test_emitsPaid() public {
        vm.expectEmit(true, true, true, true, address(earmark));
        emit Earmark.Paid(potId, supplierA, 5 * FUSD, "deposit", recipient);
        _pay(potId, recipient, supplierA, 5 * FUSD, "deposit");
    }

    function test_canPayEverythingInThePot() public {
        _pay(potId, recipient, supplierA, 1000 * FUSD, "all of it");
        assertEq(earmark.balanceOf(potId), 0);
    }

    function test_paymentsGoStraightFromTheVaultToThePayee() public {
        address vault = earmark.potInfo(potId).vault;
        _pay(potId, recipient, supplierA, 1 * FUSD, "");
        assertEq(token.balanceOf(vault), 999 * FUSD);
        assertEq(token.balanceOf(address(earmark)), 0, "Earmark itself never holds money");
        assertEq(token.balanceOf(relayer), 0, "nor does whoever sends the transaction");
    }

    // ----------------------------------------------------------- refused

    function test_cantPaySomeoneWhoIsNotApproved() public {
        Earmark.Auth memory a = _payAuth(recipient, stranger, 10 * FUSD, "");
        vm.expectRevert(Earmark.NotApproved.selector);
        earmark.pay(potId, stranger, 10 * FUSD, "", recipient, a);
    }

    function test_cantPayTheRecipientThemselves() public {
        Earmark.Auth memory a = _payAuth(recipient, recipient, 10 * FUSD, "");
        vm.expectRevert(Earmark.NotApproved.selector);
        earmark.pay(potId, recipient, 10 * FUSD, "", recipient, a);
    }

    function test_onlyTheRecipientOrFunderCanSign() public {
        Earmark.Auth memory a = _payAuth(supplierA, supplierA, 10 * FUSD, "");
        vm.expectRevert(Earmark.NotAllowed.selector);
        earmark.pay(potId, supplierA, 10 * FUSD, "", supplierA, a);
    }

    function test_aSignatureByAnotherKeyIsRefused() public {
        uint256 nonce = earmark.nonceOf(recipient);
        string memory st = earmark.payStatement(potId, supplierA, 10 * FUSD, "", recipient, nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_theRecipientsClassicalKeyAloneCantPay() public {
        Earmark.Auth memory a = Earmark.Auth(0, _validUntil(), new bytes(4627));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_theAmountPayeeAndMemoAreAllSigned() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "PO-1");
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(potId, supplierA, 11 * FUSD, "PO-1", recipient, a);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(potId, supplierB, 10 * FUSD, "PO-1", recipient, a);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(potId, supplierA, 10 * FUSD, "PO-2", recipient, a);
    }

    function test_aSignatureForOnePotCantPayFromAnother() public {
        uint256 other = _fundedPot(1000 * FUSD);
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.pay(other, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aSignatureWorksOnce() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
        vm.expectRevert(abi.encodeWithSelector(Earmark.BadNonce.selector, 1, 0));
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_anExpiredSignatureIsRefused() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.warp(a.validUntil + 1);
        vm.expectRevert(Earmark.Expired.selector);
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aSignatureCantBeValidForMoreThanAWeek() public {
        uint64 until = uint64(block.timestamp + 7 days + 1);
        uint256 nonce = earmark.nonceOf(recipient);
        string memory st = earmark.payStatement(potId, supplierA, 10 * FUSD, "", recipient, nonce, until);
        Earmark.Auth memory a = Earmark.Auth(nonce, until, _sig(recipient, st));
        vm.expectRevert(Earmark.ValidTooLong.selector);
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_cantPayMoreThanThePotHolds() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 1001 * FUSD, "");
        vm.expectRevert(abi.encodeWithSelector(Earmark.NotEnoughInPot.selector, 1000 * FUSD, 1001 * FUSD));
        earmark.pay(potId, supplierA, 1001 * FUSD, "", recipient, a);
    }

    function test_cantPayNothing() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 0, "");
        vm.expectRevert(Earmark.ZeroAmount.selector);
        earmark.pay(potId, supplierA, 0, "", recipient, a);
    }

    function test_cantPayAfterTheEndDate() public {
        vm.warp(earmark.potInfo(potId).endsAt + 1);
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.expectRevert(Earmark.PotEnded.selector);
        earmark.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aMemoCantAddLines() public {
        Earmark.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "PO-1\nTo: someone else");
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));
        earmark.pay(potId, supplierA, 10 * FUSD, "PO-1\nTo: someone else", recipient, a);
    }

    function test_unknownPot() public {
        vm.expectRevert(Earmark.NoSuchPot.selector);
        earmark.pay(99, supplierA, 1, "", recipient, Earmark.Auth(0, _validUntil(), ""));
    }

    // ------------------------------------------------------- pay confirmed only

    function test_aConfirmedOnlyPotPaysOnlyConfirmedPayees() public {
        Earmark.NewPot memory p = _newPot();
        p.confirmedOnly = true;
        uint256 strict = _createSigned(p);
        _fund(strict, 100 * FUSD);

        uint256 nonce = earmark.nonceOf(recipient);
        string memory st = earmark.payStatement(strict, supplierA, FUSD, "", recipient, nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(Earmark.NotConfirmed.selector);
        earmark.pay(strict, supplierA, FUSD, "", recipient, a);

        _confirm(strict, supplierA);
        _pay(strict, recipient, supplierA, FUSD, "");
        assertEq(token.balanceOf(supplierA), FUSD);
    }

    // -------------------------------------------------------------- fuzz

    function testFuzz_paymentsAddUp(uint96 a, uint96 b) public {
        uint256 total = 1000 * FUSD;
        uint256 x = bound(a, 1, total - 1);
        uint256 y = bound(b, 1, total - x);
        _pay(potId, recipient, supplierA, x, "");
        _pay(potId, funder, supplierB, y, "");
        assertEq(token.balanceOf(supplierA) + token.balanceOf(supplierB) + earmark.balanceOf(potId), total);
        assertEq(earmark.potInfo(potId).paidOut, x + y);
    }

    // ----------------------------------------------------------- helpers

    function _payAuth(address by, address to, uint256 amount, string memory memo)
        internal
        view
        returns (Earmark.Auth memory)
    {
        uint256 nonce = earmark.nonceOf(by);
        string memory st = earmark.payStatement(potId, to, amount, memo, by, nonce, _validUntil());
        return Earmark.Auth(nonce, _validUntil(), _sig(by, st));
    }

    function _confirm(uint256 id, address payee) internal {
        Earmark.Auth memory a =
            _auth(payee, earmark.confirmPayeeStatement(id, payee, earmark.nonceOf(payee), _validUntil()));
        earmark.confirmPayee(id, payee, a);
    }
}
