// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";

contract PayeesTest is Base {
    uint256 internal potId;
    address internal newShop = makeAddr("Okafor Hardware");

    function setUp() public override {
        super.setUp();
        _register(newShop, 6);
        potId = _fundedPot(500 * FUSD);
    }

    // ------------------------------------------------------------------- add

    function test_funderApprovesANewPayee() public {
        _addPayee(potId, newShop, "Okafor Hardware");
        Earmark.Payee memory p = earmark.payeeInfo(potId, newShop);
        assertTrue(p.approved);
        assertEq(p.name, "Okafor Hardware");
        _pay(potId, recipient, newShop, 10 * FUSD, "");
        assertEq(token.balanceOf(newShop), 10 * FUSD);
    }

    function test_onlyTheFundersKeyCanApprove() public {
        uint256 nonce = earmark.nonceOf(funder);
        string memory st = earmark.addPayeeStatement(potId, stranger, "Me", nonce, _validUntil());
        Earmark.Auth memory forged = Earmark.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.addPayee(potId, stranger, "Me", forged);
    }

    function test_aStolenClassicalKeyCantAddAPayee() public {
        // The attack a post-quantum dApp must stop: someone holding the funder's ECDSA
        // key sends the transaction themselves, adding their own address.
        Earmark.Auth memory noPq = Earmark.Auth(earmark.nonceOf(funder), _validUntil(), new bytes(4627));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.addPayee(potId, stranger, "Totally legit", noPq);
        assertFalse(earmark.payeeInfo(potId, stranger).approved);
    }

    function test_cantApproveTwice() public {
        Earmark.Auth memory a =
            _auth(funder, earmark.addPayeeStatement(potId, supplierA, "Again", earmark.nonceOf(funder), _validUntil()));
        vm.expectRevert(Earmark.AlreadyApproved.selector);
        earmark.addPayee(potId, supplierA, "Again", a);
    }

    function test_cantApproveTheRecipient() public {
        Earmark.Auth memory a =
            _auth(funder, earmark.addPayeeStatement(potId, recipient, "Me", earmark.nonceOf(funder), _validUntil()));
        vm.expectRevert(Earmark.BadAddress.selector);
        earmark.addPayee(potId, recipient, "Me", a);
    }

    function test_cantApproveThePotsOwnVault() public {
        address vault = earmark.potInfo(potId).vault;
        Earmark.Auth memory a =
            _auth(funder, earmark.addPayeeStatement(potId, vault, "Loop", earmark.nonceOf(funder), _validUntil()));
        vm.expectRevert(Earmark.BadAddress.selector);
        earmark.addPayee(potId, vault, "Loop", a);
    }

    // ---------------------------------------------------------------- remove

    function test_funderStopsPayingAPayee() public {
        Earmark.Auth memory a =
            _auth(funder, earmark.removePayeeStatement(potId, supplierB, earmark.nonceOf(funder), _validUntil()));
        earmark.removePayee(potId, supplierB, a);
        assertFalse(earmark.payeeInfo(potId, supplierB).approved);

        Earmark.Auth memory p = _auth(
            recipient,
            earmark.payStatement(potId, supplierB, FUSD, "", recipient, earmark.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Earmark.NotApproved.selector);
        earmark.pay(potId, supplierB, FUSD, "", recipient, p);
    }

    function test_removeThenAddAgainKeepsOneEntry() public {
        Earmark.Auth memory a =
            _auth(funder, earmark.removePayeeStatement(potId, supplierB, earmark.nonceOf(funder), _validUntil()));
        earmark.removePayee(potId, supplierB, a);
        _addPayee(potId, supplierB, "Brightline Electrical");
        (address[] memory addrs,) = earmark.payeesOf(potId);
        assertEq(addrs.length, 2);
    }

    function test_removingClearsTheConfirmation() public {
        _confirm(supplierA);
        Earmark.Auth memory a =
            _auth(funder, earmark.removePayeeStatement(potId, supplierA, earmark.nonceOf(funder), _validUntil()));
        earmark.removePayee(potId, supplierA, a);
        _addPayee(potId, supplierA, "Halden Building Supplies");
        assertFalse(earmark.payeeInfo(potId, supplierA).confirmed, "a new approval needs a new confirmation");
    }

    function test_cantRemoveAnUnknownPayee() public {
        vm.expectRevert(Earmark.NotApproved.selector);
        earmark.removePayee(potId, stranger, Earmark.Auth(0, _validUntil(), ""));
    }

    // --------------------------------------------------------------- request

    function test_recipientAsksAndFunderApproves() public {
        Earmark.Auth memory r = _auth(
            recipient,
            earmark.requestPayeeStatement(potId, newShop, "Okafor Hardware", earmark.nonceOf(recipient), _validUntil())
        );
        earmark.requestPayee(potId, newShop, "Okafor Hardware", r);
        Earmark.Payee memory p = earmark.payeeInfo(potId, newShop);
        assertTrue(p.requested);
        assertFalse(p.approved, "asking is not approving");

        _addPayee(potId, newShop, "Okafor Hardware");
        p = earmark.payeeInfo(potId, newShop);
        assertTrue(p.approved);
        assertFalse(p.requested);
        (address[] memory addrs,) = earmark.payeesOf(potId);
        assertEq(addrs.length, 3, "listed once");
    }

    function test_onlyTheRecipientCanAsk() public {
        uint256 nonce = earmark.nonceOf(recipient);
        string memory st = earmark.requestPayeeStatement(potId, newShop, "Shop", nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        earmark.requestPayee(potId, newShop, "Shop", a);
    }

    function test_cantAskForAnAlreadyApprovedPayee() public {
        Earmark.Auth memory a = _auth(
            recipient, earmark.requestPayeeStatement(potId, supplierA, "A", earmark.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Earmark.AlreadyApproved.selector);
        earmark.requestPayee(potId, supplierA, "A", a);
    }

    function test_recipientCantAskToPayThemselves() public {
        Earmark.Auth memory a = _auth(
            recipient, earmark.requestPayeeStatement(potId, recipient, "Me", earmark.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Earmark.BadAddress.selector);
        earmark.requestPayee(potId, recipient, "Me", a);
    }

    // --------------------------------------------------------------- confirm

    function test_aPayeeConfirmsWithItsOwnKey() public {
        vm.expectEmit(true, true, false, false, address(earmark));
        emit Earmark.PayeeConfirmed(potId, supplierA);
        _confirm(supplierA);
        assertTrue(earmark.payeeInfo(potId, supplierA).confirmed);
    }

    function test_nobodyElseCanConfirmForThePayee() public {
        uint256 nonce = earmark.nonceOf(supplierA);
        string memory st = earmark.confirmPayeeStatement(potId, supplierA, nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(funder, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", supplierA));
        earmark.confirmPayee(potId, supplierA, a);
    }

    function test_aPayeeWithoutAPostQuantumKeyCantConfirm() public {
        address plain = makeAddr("no pq key");
        _addPayee(potId, plain, "Plain Shop");
        vm.expectRevert(abi.encodeWithSignature("NoPqcKey(address)", plain));
        earmark.confirmPayee(potId, plain, Earmark.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_onlyApprovedPayeesConfirm() public {
        vm.expectRevert(Earmark.NotApproved.selector);
        earmark.confirmPayee(potId, stranger, Earmark.Auth(0, _validUntil(), ""));
    }

    // ------------------------------------------------------------------ limits

    function test_atMostFiftyPayees() public {
        for (uint256 i; i < 48; ++i) _addPayee(potId, address(uint160(0x5000 + i)), "Shop");
        Earmark.Auth memory a =
            _auth(funder, earmark.addPayeeStatement(potId, stranger, "One more", earmark.nonceOf(funder), _validUntil()));
        vm.expectRevert(Earmark.TooManyPayees.selector);
        earmark.addPayee(potId, stranger, "One more", a);
    }

    function _confirm(address payee) internal {
        Earmark.Auth memory a =
            _auth(payee, earmark.confirmPayeeStatement(potId, payee, earmark.nonceOf(payee), _validUntil()));
        earmark.confirmPayee(potId, payee, a);
    }
}
