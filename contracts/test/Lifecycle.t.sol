// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
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
        uint64 later = crumena.potInfo(potId).endsAt + 7 days;
        _extend(later);
        assertEq(crumena.potInfo(potId).endsAt, later);
    }

    function test_theEndCantMoveEarlier() public {
        uint64 earlier = crumena.potInfo(potId).endsAt - 1;
        Crumena.Auth memory a =
            _auth(funder, crumena.extendStatement(potId, earlier, crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.BadEnd.selector);
        crumena.extend(potId, earlier, a);
    }

    function test_onlyTheFunderMovesTheEnd() public {
        uint64 later = crumena.potInfo(potId).endsAt + 1 days;
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.extendStatement(potId, later, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.extend(potId, later, a);
    }

    // --------------------------------------------------------------- release

    function test_funderGivesTheRestToTheRecipient() public {
        _pay(potId, recipient, supplierA, 100 * FUSD, "");
        vm.expectEmit(true, true, false, true, address(crumena));
        emit Crumena.Released(potId, recipient, 200 * FUSD);
        _release();
        assertEq(token.balanceOf(recipient), 200 * FUSD);
        assertTrue(crumena.potInfo(potId).closed);
    }

    function test_aClosedPotPaysNobody() public {
        _release();
        Crumena.Auth memory a = _auth(
            recipient, crumena.payStatement(potId, supplierA, FUSD, "", recipient, crumena.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Crumena.PotClosed.selector);
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_onlyTheFundersKeyReleases() public {
        Crumena.Auth memory a = Crumena.Auth(crumena.nonceOf(funder), _validUntil(), new bytes(4627));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.release(potId, a);
    }

    // --------------------------------------------------------------- reclaim

    function test_afterTheEndTheRestGoesBackToTheFunder() public {
        _pay(potId, recipient, supplierA, 120 * FUSD, "");
        vm.warp(crumena.potInfo(potId).endsAt + 1);
        vm.prank(stranger); // anyone can trigger it: the money can only go to the funder
        crumena.reclaim(potId);
        assertEq(token.balanceOf(funder), 180 * FUSD);
        assertEq(crumena.balanceOf(potId), 0);
        assertTrue(crumena.potInfo(potId).closed);
    }

    function test_notBeforeTheEnd() public {
        vm.warp(crumena.potInfo(potId).endsAt);
        vm.expectRevert(Crumena.PotNotEnded.selector);
        crumena.reclaim(potId);
    }

    function test_nothingToReclaim() public {
        _pay(potId, recipient, supplierA, 300 * FUSD, "");
        vm.warp(crumena.potInfo(potId).endsAt + 1);
        vm.expectRevert(Crumena.NothingToMove.selector);
        crumena.reclaim(potId);
    }

    function test_moneyPaidIntoAClosedPotGoesBackToTheFunder() public {
        _release();
        _fund(potId, 25 * FUSD); // someone pays into the old pot address
        crumena.reclaim(potId);
        assertEq(token.balanceOf(funder), 25 * FUSD);
    }

    function test_unknownPotCantBeReclaimed() public {
        vm.expectRevert(Crumena.NoSuchPot.selector);
        crumena.reclaim(42);
    }

    // ----------------------------------------------------------------- vault

    function test_onlyCrumenaCanMoveMoneyOutOfAVault() public {
        PotVault vault = PotVault(crumena.potInfo(potId).vault);
        vm.prank(funder);
        vm.expectRevert(PotVault.NotCrumena.selector);
        vault.send(address(token), funder, 1);
    }

    // ---------------------------------------------------------------- helpers

    function _extend(uint64 newEnd) internal {
        Crumena.Auth memory a = _auth(funder, crumena.extendStatement(potId, newEnd, crumena.nonceOf(funder), _validUntil()));
        crumena.extend(potId, newEnd, a);
    }

    function _release() internal {
        Crumena.Auth memory a = _auth(funder, crumena.releaseStatement(potId, crumena.nonceOf(funder), _validUntil()));
        crumena.release(potId, a);
    }
}
