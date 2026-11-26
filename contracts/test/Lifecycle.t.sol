// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";
import {PotVault} from "../src/PotVault.sol";

/// @notice The end of a pot: moving the end date, giving the rest to the recipient,
///         and the funder getting the rest back.
contract LifecycleTest is Base {
    uint256 internal potId;

    function setUp() public override {
        super.setUp();
        potId = _fundedPot(300 * FUSD);
    }

    // ---------------------------------------------------------------- extend

    function test_funderMovesTheEndLater() public {
        uint64 later = earmark.potInfo(potId).endsAt + 7 days;
        _extend(later);
        assertEq(earmark.potInfo(potId).endsAt, later);
    }

    function test_theEndCantMoveEarlier() public {
        uint64 earlier = earmark.potInfo(potId).endsAt - 1;
        Earmark.Auth memory a =
            _auth(funder, earmark.extendStatement(potId, earlier, earmark.nonceOf(funder), _validUntil()));
        vm.expectRevert(Earmark.BadEnd.selector);
        earmark.extend(potId, earlier, a);
    }

    function test_onlyTheFunderMovesTheEnd() public {
        uint64 later = earmark.potInfo(potId).endsAt + 1 days;
        uint256 nonce = earmark.nonceOf(funder);
        string memory st = earmark.extendStatement(potId, later, nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.extend(potId, later, a);
    }

    // --------------------------------------------------------------- release

    function test_funderGivesTheRestToTheRecipient() public {
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
        vm.expectEmit(true, true, false, true, address(earmark));
        emit Earmark.Released(potId, recipient, 200 * FUSD);
        _release();
        assertEq(token.balanceOf(recipient), 200 * FUSD);
        assertTrue(earmark.potInfo(potId).closed);
    }

    function test_aClosedPotPaysNobody() public {
        _release();
        Earmark.Auth memory a = _auth(
            recipient, earmark.payStatement(potId, supplierA, FUSD, "", recipient, earmark.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Earmark.PotClosed.selector);
        earmark.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_onlyTheFundersKeyReleases() public {
        Earmark.Auth memory a = Earmark.Auth(earmark.nonceOf(funder), _validUntil(), new bytes(4627));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.release(potId, a);
    }

    // --------------------------------------------------------------- reclaim

    function test_afterTheEndTheRestGoesBackToTheFunder() public {
        _pay(potId, recipient, supplierA, 120 * FUSD, "");
        vm.warp(earmark.potInfo(potId).endsAt + 1);
        vm.prank(stranger); // anyone can trigger it: the money can only go to the funder
        earmark.reclaim(potId);
        assertEq(token.balanceOf(funder), 180 * FUSD);
        assertEq(earmark.balanceOf(potId), 0);
        assertTrue(earmark.potInfo(potId).closed);
    }

    function test_notBeforeTheEnd() public {
        vm.warp(earmark.potInfo(potId).endsAt);
        vm.expectRevert(Earmark.PotNotEnded.selector);
        earmark.reclaim(potId);
    }

    function test_nothingToReclaim() public {
        _pay(potId, recipient, supplierA, 300 * FUSD, "");
        vm.warp(earmark.potInfo(potId).endsAt + 1);
        vm.expectRevert(Earmark.NothingToMove.selector);
        earmark.reclaim(potId);
    }

    function test_moneyPaidIntoAClosedPotGoesBackToTheFunder() public {
        _release();
        _fund(potId, 25 * FUSD); // someone pays into the old pot address
        earmark.reclaim(potId);
        assertEq(token.balanceOf(funder), 25 * FUSD);
    }

    function test_unknownPotCantBeReclaimed() public {
        vm.expectRevert(Earmark.NoSuchPot.selector);
        earmark.reclaim(42);
    }

    // ----------------------------------------------------------------- vault

    function test_onlyEarmarkCanMoveMoneyOutOfAVault() public {
        PotVault vault = PotVault(earmark.potInfo(potId).vault);
        vm.prank(funder);
        vm.expectRevert(PotVault.NotEarmark.selector);
        vault.send(address(token), funder, 1);
    }

    // ---------------------------------------------------------------- helpers

    function _extend(uint64 newEnd) internal {
        Earmark.Auth memory a = _auth(funder, earmark.extendStatement(potId, newEnd, earmark.nonceOf(funder), _validUntil()));
        earmark.extend(potId, newEnd, a);
    }

    function _release() internal {
        Earmark.Auth memory a = _auth(funder, earmark.releaseStatement(potId, earmark.nonceOf(funder), _validUntil()));
        earmark.release(potId, a);
    }
}
