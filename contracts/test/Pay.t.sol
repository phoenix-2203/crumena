// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
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
        assertEq(crumena.potBalance(potId), 750 * FUSD);
        assertEq(crumena.potInfo(potId).paidOut, 250 * FUSD);
        assertEq(crumena.nonceOf(recipient), 1);
    }

    function test_funderCanPayToo() public {
        _pay(potId, funder, supplierB, 40 * FUSD, "");
        assertEq(token.balanceOf(supplierB), 40 * FUSD);
    }

    function test_emitsPaid() public {
        vm.expectEmit(true, true, true, true, address(crumena));
        emit Crumena.Paid(potId, supplierA, 5 * FUSD, "deposit", recipient);
        _pay(potId, recipient, supplierA, 5 * FUSD, "deposit");
    }

    function test_canPayEverythingInThePot() public {
        _pay(potId, recipient, supplierA, 1000 * FUSD, "all of it");
        assertEq(crumena.potBalance(potId), 0);
    }

    function test_paymentsGoStraightFromTheVaultToThePayee() public {
        address vault = crumena.potInfo(potId).vault;
        _pay(potId, recipient, supplierA, 1 * FUSD, "");
        assertEq(token.balanceOf(vault), 999 * FUSD);
        assertEq(token.balanceOf(address(crumena)), 0, "Crumena itself never holds money");
        assertEq(token.balanceOf(relayer), 0, "nor does whoever sends the transaction");
    }

    // ----------------------------------------------------------- refused

    function test_cantPaySomeoneWhoIsNotApproved() public {
        Crumena.Auth memory a = _payAuth(recipient, stranger, 10 * FUSD, "");
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.pay(potId, stranger, 10 * FUSD, "", recipient, a);
    }

    function test_cantPayTheRecipientThemselves() public {
        Crumena.Auth memory a = _payAuth(recipient, recipient, 10 * FUSD, "");
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.pay(potId, recipient, 10 * FUSD, "", recipient, a);
    }

    function test_onlyTheRecipientOrFunderCanSign() public {
        Crumena.Auth memory a = _payAuth(supplierA, supplierA, 10 * FUSD, "");
        vm.expectRevert(Crumena.NotAllowed.selector);
        crumena.pay(potId, supplierA, 10 * FUSD, "", supplierA, a);
    }

    function test_aSignatureByAnotherKeyIsRefused() public {
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 10 * FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_theRecipientsClassicalKeyAloneCantPay() public {
        Crumena.Auth memory a = Crumena.Auth(0, _validUntil(), new bytes(4627));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_theAmountPayeeAndMemoAreAllSigned() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "PO-1");
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierA, 11 * FUSD, "PO-1", recipient, a);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierB, 10 * FUSD, "PO-1", recipient, a);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierA, 10 * FUSD, "PO-2", recipient, a);
    }

    function test_aSignatureForOnePotCantPayFromAnother() public {
        uint256 other = _fundedPot(1000 * FUSD);
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(other, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aSignatureWorksOnce() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
        vm.expectRevert(abi.encodeWithSelector(Crumena.BadNonce.selector, 1, 0));
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_anExpiredSignatureIsRefused() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.warp(a.validUntil + 1);
        vm.expectRevert(Crumena.Expired.selector);
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aSignatureCantBeValidForMoreThanAWeek() public {
        uint64 until = uint64(block.timestamp + 7 days + 1);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 10 * FUSD, "", recipient, nonce, until);
        Crumena.Auth memory a = Crumena.Auth(nonce, until, _sig(recipient, st));
        vm.expectRevert(Crumena.ValidTooLong.selector);
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_cantPayMoreThanThePotHolds() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 1001 * FUSD, "");
        vm.expectRevert(abi.encodeWithSelector(Crumena.NotEnoughInPot.selector, 1000 * FUSD, 1001 * FUSD));
        crumena.pay(potId, supplierA, 1001 * FUSD, "", recipient, a);
    }

    function test_cantPayNothing() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 0, "");
        vm.expectRevert(Crumena.ZeroAmount.selector);
        crumena.pay(potId, supplierA, 0, "", recipient, a);
    }

    function test_cantPayAfterTheEndDate() public {
        vm.warp(crumena.potInfo(potId).endsAt + 1);
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "");
        vm.expectRevert(Crumena.PotEnded.selector);
        crumena.pay(potId, supplierA, 10 * FUSD, "", recipient, a);
    }

    function test_aMemoCantAddLines() public {
        Crumena.Auth memory a = _payAuth(recipient, supplierA, 10 * FUSD, "PO-1\nTo: someone else");
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));
        crumena.pay(potId, supplierA, 10 * FUSD, "PO-1\nTo: someone else", recipient, a);
    }

    function test_unknownPot() public {
        vm.expectRevert(Crumena.NoSuchPot.selector);
        crumena.pay(99, supplierA, 1, "", recipient, Crumena.Auth(0, _validUntil(), ""));
    }

    // ------------------------------------------------------- pay confirmed only

    function test_aConfirmedOnlyPotPaysOnlyConfirmedPayees() public {
        Crumena.NewPot memory p = _newPot();
        p.confirmedOnly = true;
        uint256 strict = _createSigned(p);
        _fund(strict, 100 * FUSD);

        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(strict, supplierA, FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(Crumena.NotConfirmed.selector);
        crumena.pay(strict, supplierA, FUSD, "", recipient, a);

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
        assertEq(token.balanceOf(supplierA) + token.balanceOf(supplierB) + crumena.potBalance(potId), total);
        assertEq(crumena.potInfo(potId).paidOut, x + y);
    }

    // ----------------------------------------------------------- helpers

    function _payAuth(address by, address to, uint256 amount, string memory memo)
        internal
        view
        returns (Crumena.Auth memory)
    {
        uint256 nonce = crumena.nonceOf(by);
        string memory st = crumena.payStatement(potId, to, amount, memo, by, nonce, _validUntil());
        return Crumena.Auth(nonce, _validUntil(), _sig(by, st));
    }

    function _confirm(uint256 id, address payee) internal {
        Crumena.Auth memory a =
            _auth(payee, crumena.confirmPayeeStatement(id, payee, crumena.nonceOf(payee), _validUntil()));
        crumena.confirmPayee(id, payee, a);
    }
}
