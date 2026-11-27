// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";

/// @notice Spending rules (a cap per payment, a limit per period) and freezing.
contract RulesTest is Base {
    // ------------------------------------------------------------- helpers

    function _rules(uint256 maxPer, uint256 periodLimit, uint32 periodDays) internal pure returns (Crumena.Rules memory) {
        return Crumena.Rules({maxPerPayment: maxPer, periodLimit: periodLimit, periodDays: periodDays});
    }

    function _potWith(Crumena.Rules memory r, uint256 amount) internal returns (uint256 potId) {
        Crumena.NewPot memory p = _newPot();
        p.rules = r;
        potId = _createSigned(p);
        _fund(potId, amount);
    }

    function _setRules(uint256 potId, Crumena.Rules memory r) internal {
        Crumena.Auth memory a = _auth(funder, crumena.rulesStatement(potId, r, crumena.nonceOf(funder), _validUntil()));
        vm.prank(relayer);
        crumena.setRules(potId, r, a);
    }

    function _setFrozen(uint256 potId, bool frozen) internal {
        Crumena.Auth memory a = _auth(funder, crumena.frozenStatement(potId, frozen, crumena.nonceOf(funder), _validUntil()));
        vm.prank(relayer);
        crumena.setFrozen(potId, frozen, a);
    }

    /// @notice A properly signed payment, expected to revert with `reason`.
    function _expectPayRevert(uint256 potId, uint256 amount, bytes memory reason) internal {
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, amount, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(reason);
        crumena.pay(potId, supplierA, amount, "", recipient, a);
    }

    // ------------------------------------------------------------- creating

    function test_rulesAreStoredAtCreation() public {
        uint256 potId = _potWith(_rules(50 * FUSD, 200 * FUSD, 7), 0);
        Crumena.Pot memory pot = crumena.potInfo(potId);
        assertEq(pot.maxPerPayment, 50 * FUSD);
        assertEq(pot.periodLimit, 200 * FUSD);
        assertEq(pot.periodDays, 7);
    }

    function test_aPeriodLimitNeedsAPeriodAndTheOtherWayRound() public {
        Crumena.NewPot memory p = _newPot();
        p.rules = _rules(0, 100 * FUSD, 0);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadRules.selector));
        p.rules = _rules(0, 0, 7);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadRules.selector));
        p.rules = _rules(0, 100 * FUSD, 367);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadRules.selector));
    }

    // --------------------------------------------------------- cap per payment

    function test_aPaymentUpToTheCapGoesThrough() public {
        uint256 potId = _potWith(_rules(50 * FUSD, 0, 0), 500 * FUSD);
        _pay(potId, recipient, supplierA, 50 * FUSD, "");
        assertEq(token.balanceOf(supplierA), 50 * FUSD);
    }

    function test_aPaymentOverTheCapIsRefused() public {
        uint256 potId = _potWith(_rules(50 * FUSD, 0, 0), 500 * FUSD);
        _expectPayRevert(potId, 50 * FUSD + 1, abi.encodeWithSelector(Crumena.OverPaymentLimit.selector, 50 * FUSD));
    }

    // -------------------------------------------------------- limit per period

    function test_thePeriodLimitCountsEveryPaymentInThePeriod() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        _pay(potId, recipient, supplierA, 60 * FUSD, "");
        vm.warp(START + 6 days);
        _pay(potId, recipient, supplierA, 40 * FUSD, "");
        _expectPayRevert(potId, 1, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, 0));

        (uint256 spent, uint256 limit, uint64 resetsAt) = crumena.periodSpending(potId);
        assertEq(spent, 100 * FUSD);
        assertEq(limit, 100 * FUSD);
        assertEq(resetsAt, START + 7 days);
    }

    function test_theRefusalSaysWhatIsLeftThisPeriod() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        _pay(potId, recipient, supplierA, 70 * FUSD, "");
        _expectPayRevert(potId, 31 * FUSD, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, 30 * FUSD));
    }

    function test_aNewPeriodStartsAfresh() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
        vm.warp(START + 7 days);
        (uint256 spent,, uint64 resetsAt) = crumena.periodSpending(potId);
        assertEq(spent, 0);
        assertEq(resetsAt, START + 14 days);
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
        assertEq(token.balanceOf(supplierA), 200 * FUSD);
    }

    function test_skippedPeriodsDontCarryOver() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        vm.warp(START + 21 days); // three quiet weeks
        _expectPayRevert(potId, 100 * FUSD + 1, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, 100 * FUSD));
    }

    function test_aPotWithoutAPeriodLimitReportsZeros() public {
        uint256 potId = _fundedPot(10 * FUSD);
        (uint256 spent, uint256 limit, uint64 resetsAt) = crumena.periodSpending(potId);
        assertEq(spent + limit + resetsAt, 0);
    }

    // ------------------------------------------------------- changing rules

    function test_theFunderChangesTheRules() public {
        uint256 potId = _potWith(_rules(50 * FUSD, 0, 0), 500 * FUSD);
        _setRules(potId, _rules(0, 0, 0));
        _pay(potId, recipient, supplierA, 300 * FUSD, "");
        assertEq(token.balanceOf(supplierA), 300 * FUSD);
    }

    function test_keepingThePeriodKeepsWhatWasSpent() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        _pay(potId, recipient, supplierA, 80 * FUSD, "");
        _setRules(potId, _rules(0, 120 * FUSD, 7));
        _expectPayRevert(potId, 41 * FUSD, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, 40 * FUSD));
    }

    /// @notice QCAI (v3 audit, "overflow in period calculation"): a limit lowered below what
    ///         was already spent this period refuses with OverPeriodLimit(0), not an
    ///         arithmetic panic, and pays again once the next period starts.
    function test_aPeriodLimitLoweredBelowWhatWasSpentRefusesCleanly() public {
        uint256 potId = _potWith(_rules(0, 60 * FUSD, 7), 200 * FUSD);
        _pay(potId, recipient, supplierA, 50 * FUSD, "");
        _setRules(potId, _rules(0, 40 * FUSD, 7));
        _expectPayRevert(potId, 1, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, 0));
        (uint256 spent, uint256 limit,) = crumena.periodSpending(potId);
        assertEq(spent, 50 * FUSD);
        assertEq(limit, 40 * FUSD);
        vm.warp(START + 7 days);
        _pay(potId, recipient, supplierA, 40 * FUSD, "");
        assertEq(token.balanceOf(supplierA), 90 * FUSD);
    }

    function test_changingThePeriodLengthStartsCountingAfresh() public {
        uint256 potId = _potWith(_rules(0, 100 * FUSD, 7), 500 * FUSD);
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
        vm.warp(START + 3 days);
        _setRules(potId, _rules(0, 30 * FUSD, 1));
        _pay(potId, recipient, supplierA, 30 * FUSD, "");
        (uint256 spent,, uint64 resetsAt) = crumena.periodSpending(potId);
        assertEq(spent, 30 * FUSD);
        assertEq(resetsAt, START + 4 days);
    }

    function test_onlyTheFunderChangesTheRules() public {
        uint256 potId = _potWith(_rules(50 * FUSD, 0, 0), 500 * FUSD);
        Crumena.Rules memory none = _rules(0, 0, 0);
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.rulesStatement(potId, none, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.setRules(potId, none, a);
    }

    function test_badRulesAreRefusedWhenChanged() public {
        uint256 potId = _fundedPot(10 * FUSD);
        Crumena.Rules memory bad = _rules(0, 10 * FUSD, 0);
        Crumena.Auth memory a = _auth(funder, crumena.rulesStatement(potId, bad, crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.BadRules.selector);
        crumena.setRules(potId, bad, a);
    }

    // ---------------------------------------------------------------- freezing

    function test_aFrozenPotPaysNobodyUntilUnfrozen() public {
        uint256 potId = _fundedPot(100 * FUSD);
        _setFrozen(potId, true);
        assertTrue(crumena.potInfo(potId).frozen);
        _expectPayRevert(potId, FUSD, abi.encodeWithSelector(Crumena.PotFrozen.selector));

        _setFrozen(potId, false);
        _pay(potId, recipient, supplierA, FUSD, "");
        assertEq(token.balanceOf(supplierA), FUSD);
    }

    function test_freezingTwiceIsRefused() public {
        uint256 potId = _fundedPot(10 * FUSD);
        _setFrozen(potId, true);
        Crumena.Auth memory a = _auth(funder, crumena.frozenStatement(potId, true, crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.NoChange.selector);
        crumena.setFrozen(potId, true, a);
    }

    function test_onlyTheFunderFreezes() public {
        uint256 potId = _fundedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.frozenStatement(potId, true, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.setFrozen(potId, true, a);
    }

    function test_aFrozenPotCanStillBeReleasedOrReturned() public {
        uint256 potId = _fundedPot(100 * FUSD);
        _setFrozen(potId, true);
        vm.warp(crumena.potInfo(potId).endsAt + 1);
        crumena.reclaim(potId);
        assertEq(token.balanceOf(funder), 100 * FUSD);
    }

    // -------------------------------------------------------------------- fuzz

    /// @notice However payments are spread over time, no period ever pays out more than its limit.
    function testFuzz_noPeriodPaysMoreThanItsLimit(uint256 seed) public {
        uint256 limit = 100 * FUSD;
        uint256 potId = _potWith(_rules(0, limit, 3), 10_000 * FUSD);
        uint256[] memory paid = new uint256[](10);
        uint256 t = START; // kept here: with via-IR, block.timestamp in a test can stay at its first value
        for (uint256 i; i < 25; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            t += seed % 1 days;
            vm.warp(t);
            uint256 period = (t - START) / 3 days;
            if (period >= paid.length) break;
            uint256 amount = 1 + (seed >> 64) % (60 * FUSD);
            if (paid[period] + amount <= limit) {
                _pay(potId, recipient, supplierA, amount, "");
                paid[period] += amount;
            } else {
                _expectPayRevert(potId, amount, abi.encodeWithSelector(Crumena.OverPeriodLimit.selector, limit - paid[period]));
            }
        }
        for (uint256 p; p < paid.length; ++p) assertLe(paid[p], limit);
    }
}
