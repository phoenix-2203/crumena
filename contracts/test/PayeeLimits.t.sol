// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
import {Text} from "../src/lib/Text.sol";

/// @notice What each payee may receive in total, the amount the spender asks for with a
///         new payee, and the short link code.
contract PayeeLimitsTest is Base {
    address internal newShop = makeAddr("Okafor Hardware");

    function _limitedPot(uint256 limitA) internal returns (uint256 potId) {
        Crumena.NewPot memory p = _newPot();
        p.limits[0] = limitA;
        potId = _createSigned(p);
        _fund(potId, 500 * FUSD);
    }

    // ------------------------------------------------------------ at creation

    function test_createStoresEachPayeesLimit() public {
        uint256 potId = _limitedPot(30 * FUSD);
        Crumena.Payee memory a = crumena.payeeInfo(potId, supplierA);
        Crumena.Payee memory b = crumena.payeeInfo(potId, supplierB);
        assertEq(a.limit, 30 * FUSD);
        assertEq(a.paid, 0);
        assertEq(b.limit, 0, "no limit");
    }

    function test_createRejectsLimitsOfTheWrongLength() public {
        Crumena.NewPot memory p = _newPot();
        p.limits = new uint256[](1);
        vm.expectRevert(Crumena.TooManyPayees.selector);
        crumena.createPot(p, Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_createdLimitIsInTheSignedText() public {
        Crumena.NewPot memory p = _newPot();
        p.limits[0] = 30 * FUSD;
        Crumena.Auth memory a = _createAuth(p);
        p.limits[0] = 3000 * FUSD; // the relayer raises it after the funder signed
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.createPot(p, a);
        assertEq(crumena.potCount(), 0);
    }

    // ------------------------------------------------------------------ paying

    function test_paymentsCountTowardsThePayeesLimit() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 12 * FUSD, "");
        _pay(potId, recipient, supplierA, 18 * FUSD, "");
        assertEq(crumena.payeeInfo(potId, supplierA).paid, 30 * FUSD);
        assertEq(token.balanceOf(supplierA), 30 * FUSD);
    }

    function test_aPaymentPastThePayeesLimitIsRefusedEvenSigned() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 25 * FUSD, "");
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 6 * FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSelector(Crumena.OverPayeeLimit.selector, 5 * FUSD));
        crumena.pay(potId, supplierA, 6 * FUSD, "", recipient, a);
        assertEq(crumena.payeeInfo(potId, supplierA).paid, 25 * FUSD);
    }

    function test_reachingTheLimitExactlyThenNothingMore() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 30 * FUSD, "");
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 1, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSelector(Crumena.OverPayeeLimit.selector, 0));
        crumena.pay(potId, supplierA, 1, "", recipient, a);
    }

    function test_noLimitMeansOnlyThePotsRules() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierB, 400 * FUSD, "");
        assertEq(crumena.payeeInfo(potId, supplierB).paid, 400 * FUSD);
    }

    function test_theFunderIsHeldToTheLimitToo() public {
        uint256 potId = _limitedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.payStatement(potId, supplierA, 11 * FUSD, "", funder, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(funder, st));
        vm.expectRevert(abi.encodeWithSelector(Crumena.OverPayeeLimit.selector, 10 * FUSD));
        crumena.pay(potId, supplierA, 11 * FUSD, "", funder, a);
    }

    function testFuzz_aPayeeNeverReceivesMoreThanItsLimit(uint256 limit, uint256[6] memory amounts) public {
        limit = bound(limit, 1, 200 * FUSD);
        uint256 potId = _limitedPot(limit);
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(amounts[i], 1, 120 * FUSD);
            Crumena.Payee memory before = crumena.payeeInfo(potId, supplierA);
            uint256 nonce = crumena.nonceOf(recipient);
            string memory st = crumena.payStatement(potId, supplierA, amount, "", recipient, nonce, _validUntil());
            Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
            if (before.paid + amount > limit) {
                vm.expectRevert(abi.encodeWithSelector(Crumena.OverPayeeLimit.selector, limit - before.paid));
            }
            crumena.pay(potId, supplierA, amount, "", recipient, a);
            assertLe(crumena.payeeInfo(potId, supplierA).paid, limit);
        }
        assertEq(token.balanceOf(supplierA), crumena.payeeInfo(potId, supplierA).paid);
    }

    // ------------------------------------------------------- changing a limit

    function test_theFunderRaisesALimit() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 30 * FUSD, "");
        vm.expectEmit(true, true, false, true, address(crumena));
        emit Crumena.PayeeLimitChanged(potId, supplierA, 50 * FUSD);
        _setPayeeLimit(potId, supplierA, 50 * FUSD);
        _pay(potId, recipient, supplierA, 20 * FUSD, "");
        assertEq(crumena.payeeInfo(potId, supplierA).paid, 50 * FUSD);
    }

    function test_aLimitLoweredBelowWhatWasPaidStopsPayments() public {
        uint256 potId = _limitedPot(0);
        _pay(potId, recipient, supplierA, 40 * FUSD, "");
        _setPayeeLimit(potId, supplierA, 30 * FUSD);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 1, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSelector(Crumena.OverPayeeLimit.selector, 0));
        crumena.pay(potId, supplierA, 1, "", recipient, a);
    }

    function test_settingNoLimitAgain() public {
        uint256 potId = _limitedPot(10 * FUSD);
        _setPayeeLimit(potId, supplierA, 0);
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
    }

    function test_onlyTheFunderChangesALimit() public {
        uint256 potId = _limitedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.payeeLimitStatement(potId, supplierA, 500 * FUSD, nonce, _validUntil());
        // the spender signs the funder's statement with its own key
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.setPayeeLimit(potId, supplierA, 500 * FUSD, a);
        assertEq(crumena.payeeInfo(potId, supplierA).limit, 10 * FUSD);
    }

    function test_theSignedLimitIsTheOneApplied() public {
        uint256 potId = _limitedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        Crumena.Auth memory a = Crumena.Auth(
            nonce, _validUntil(), _sig(funder, crumena.payeeLimitStatement(potId, supplierA, 20 * FUSD, nonce, _validUntil()))
        );
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.setPayeeLimit(potId, supplierA, 2000 * FUSD, a);
    }

    function test_limitChangesNeedAnApprovedPayeeAndAChange() public {
        uint256 potId = _limitedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), new bytes(4627));
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.setPayeeLimit(potId, stranger, 5 * FUSD, a);
        vm.expectRevert(Crumena.NoChange.selector);
        crumena.setPayeeLimit(potId, supplierA, 10 * FUSD, a);
    }

    function test_noLimitChangesOnAClosedPot() public {
        uint256 potId = _limitedPot(10 * FUSD);
        Crumena.Auth memory r = _auth(funder, crumena.releaseStatement(potId, crumena.nonceOf(funder), _validUntil()));
        crumena.release(potId, r);
        Crumena.Auth memory a = Crumena.Auth(crumena.nonceOf(funder), _validUntil(), new bytes(4627));
        vm.expectRevert(Crumena.PotClosed.selector);
        crumena.setPayeeLimit(potId, supplierA, 5 * FUSD, a);
    }

    function test_removingAndApprovingAgainKeepsWhatWasPaid() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 30 * FUSD, "");
        Crumena.Auth memory a =
            _auth(funder, crumena.removePayeeStatement(potId, supplierA, crumena.nonceOf(funder), _validUntil()));
        crumena.removePayee(potId, supplierA, a);
        string memory st = crumena.addPayeeStatement(potId, supplierA, "Halden", 40 * FUSD, 0, _validUntil());
        assertTrue(_contains(st, "\nUp to: 40 fUSD in total\nAlready paid: 30 fUSD\n"));
        _addPayee(potId, supplierA, "Halden", 40 * FUSD);
        _pay(potId, recipient, supplierA, 10 * FUSD, "");
        assertEq(crumena.payeeInfo(potId, supplierA).paid, 40 * FUSD);
    }

    // ------------------------------------------------------- approve and request

    function test_approvingWithALimit() public {
        uint256 potId = _limitedPot(0);
        vm.expectEmit(true, true, false, true, address(crumena));
        emit Crumena.PayeeApproved(potId, newShop, "Okafor Hardware", 15 * FUSD);
        _addPayee(potId, newShop, "Okafor Hardware", 15 * FUSD);
        assertEq(crumena.payeeInfo(potId, newShop).limit, 15 * FUSD);
    }

    function test_theApprovedLimitIsTheOneSigned() public {
        uint256 potId = _limitedPot(0);
        uint256 nonce = crumena.nonceOf(funder);
        Crumena.Auth memory a = Crumena.Auth(
            nonce, _validUntil(), _sig(funder, crumena.addPayeeStatement(potId, newShop, "Okafor", 15 * FUSD, nonce, _validUntil()))
        );
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.addPayee(potId, newShop, "Okafor", 0, a); // the relayer drops the limit
        assertFalse(crumena.payeeInfo(potId, newShop).approved);
    }

    function test_theSpenderAsksForAnAmount() public {
        uint256 potId = _limitedPot(0);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.requestPayeeStatement(potId, newShop, "Okafor Hardware", 12_500_000, nonce, _validUntil());
        assertTrue(_contains(st, "\nPayee: Okafor Hardware\nAddress: "));
        assertTrue(_contains(st, "\nAmount: 12.5 fUSD\nSigned by: "));
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectEmit(true, true, false, true, address(crumena));
        emit Crumena.PayeeRequested(potId, newShop, "Okafor Hardware", 12_500_000);
        crumena.requestPayee(potId, newShop, "Okafor Hardware", 12_500_000, a);
        Crumena.Payee memory p = crumena.payeeInfo(potId, newShop);
        assertTrue(p.requested);
        assertEq(p.asked, 12_500_000);

        // the funder approves a different amount of its choice; the request is settled
        _addPayee(potId, newShop, "Okafor Hardware", 10 * FUSD);
        p = crumena.payeeInfo(potId, newShop);
        assertEq(p.limit, 10 * FUSD);
        assertEq(p.asked, 0);
        assertFalse(p.requested);
    }

    function test_aRequestNeedsAnAmount() public {
        uint256 potId = _limitedPot(0);
        Crumena.Auth memory a = Crumena.Auth(0, _validUntil(), new bytes(4627));
        vm.expectRevert(Crumena.ZeroAmount.selector);
        crumena.requestPayee(potId, newShop, "Okafor", 0, a);
    }

    function test_theAskedAmountIsTheOneSigned() public {
        uint256 potId = _limitedPot(0);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.requestPayeeStatement(potId, newShop, "Okafor", 5 * FUSD, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.requestPayee(potId, newShop, "Okafor", 500 * FUSD, a);
    }

    function test_whatTheFunderSignsToChangeALimit() public {
        uint256 potId = _limitedPot(30 * FUSD);
        _pay(potId, recipient, supplierA, 12_500_000, "");
        string memory st = crumena.payeeLimitStatement(potId, supplierA, 50 * FUSD, 7, uint64(START + 3600));
        assertEq(
            st,
            string.concat(
                "Crumena: change what pot #",
                Text.decimal(potId),
                " may pay a payee\nPot: Office fit-out, phase 1\nPayee: Halden Building Supplies\nAddress: ",
                Text.hexAddress(supplierA),
                "\nUp to: 50 fUSD in total\nAlready paid: 12.5 fUSD\nSigned by: ",
                Text.qorAddress(funder),
                "\nNonce: 7\nValid until: 2026-11-26 10:00 UTC\nContract: ",
                Text.hexAddress(address(crumena)),
                " on qorechain-diana"
            )
        );
        assertTrue(_contains(crumena.payeeLimitStatement(potId, supplierA, 0, 7, uint64(START + 3600)), "\nUp to: no limit\n"));
    }

    // -------------------------------------------------------------- link codes

    function test_eachPotHasAShortCodeFromItsVault() public {
        uint256 a = _createSigned(_newPot());
        uint256 b = _createSigned(_newPot());
        assertEq(crumena.potOfCode(bytes8(bytes20(crumena.potInfo(a).vault))), a);
        assertEq(crumena.potOfCode(bytes8(bytes20(crumena.potInfo(b).vault))), b);
        assertEq(crumena.potOfCode(bytes8(0)), 0);
    }

    // ----------------------------------------------------------------- helpers

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length && ok; ++j) ok = h[i + j] == n[j];
            if (ok) return true;
        }
        return false;
    }
}
