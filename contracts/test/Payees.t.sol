// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";

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
        Crumena.Payee memory p = crumena.payeeInfo(potId, newShop);
        assertTrue(p.approved);
        assertEq(p.name, "Okafor Hardware");
        _pay(potId, recipient, newShop, 10 * FUSD, "");
        assertEq(token.balanceOf(newShop), 10 * FUSD);
    }

    function test_onlyTheFundersKeyCanApprove() public {
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.addPayeeStatement(potId, stranger, "Me", nonce, _validUntil());
        Crumena.Auth memory forged = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.addPayee(potId, stranger, "Me", forged);
    }

    function test_aStolenClassicalKeyCantAddAPayee() public {
        // The attack a post-quantum dApp must stop: someone holding the funder's ECDSA
        // key sends the transaction themselves, adding their own address.
        Crumena.Auth memory noPq = Crumena.Auth(crumena.nonceOf(funder), _validUntil(), new bytes(4627));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.addPayee(potId, stranger, "Totally legit", noPq);
        assertFalse(crumena.payeeInfo(potId, stranger).approved);
    }

    function test_cantApproveTwice() public {
        Crumena.Auth memory a =
            _auth(funder, crumena.addPayeeStatement(potId, supplierA, "Again", crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.AlreadyApproved.selector);
        crumena.addPayee(potId, supplierA, "Again", a);
    }

    function test_cantApproveTheRecipient() public {
        Crumena.Auth memory a =
            _auth(funder, crumena.addPayeeStatement(potId, recipient, "Me", crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.BadAddress.selector);
        crumena.addPayee(potId, recipient, "Me", a);
    }

    function test_cantApproveThePotsOwnVault() public {
        address vault = crumena.potInfo(potId).vault;
        Crumena.Auth memory a =
            _auth(funder, crumena.addPayeeStatement(potId, vault, "Loop", crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.BadAddress.selector);
        crumena.addPayee(potId, vault, "Loop", a);
    }

    // ---------------------------------------------------------------- remove

    function test_funderStopsPayingAPayee() public {
        Crumena.Auth memory a =
            _auth(funder, crumena.removePayeeStatement(potId, supplierB, crumena.nonceOf(funder), _validUntil()));
        crumena.removePayee(potId, supplierB, a);
        assertFalse(crumena.payeeInfo(potId, supplierB).approved);

        Crumena.Auth memory p = _auth(
            recipient,
            crumena.payStatement(potId, supplierB, FUSD, "", recipient, crumena.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.pay(potId, supplierB, FUSD, "", recipient, p);
    }

    function test_removeThenAddAgainKeepsOneEntry() public {
        Crumena.Auth memory a =
            _auth(funder, crumena.removePayeeStatement(potId, supplierB, crumena.nonceOf(funder), _validUntil()));
        crumena.removePayee(potId, supplierB, a);
        _addPayee(potId, supplierB, "Brightline Electrical");
        (address[] memory addrs,) = crumena.payeesOf(potId);
        assertEq(addrs.length, 2);
    }

    function test_removingClearsTheConfirmation() public {
        _confirm(supplierA);
        Crumena.Auth memory a =
            _auth(funder, crumena.removePayeeStatement(potId, supplierA, crumena.nonceOf(funder), _validUntil()));
        crumena.removePayee(potId, supplierA, a);
        _addPayee(potId, supplierA, "Halden Building Supplies");
        assertFalse(crumena.payeeInfo(potId, supplierA).confirmed, "a new approval needs a new confirmation");
    }

    function test_cantRemoveAnUnknownPayee() public {
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.removePayee(potId, stranger, Crumena.Auth(0, _validUntil(), ""));
    }

    // --------------------------------------------------------------- request

    function test_recipientAsksAndFunderApproves() public {
        Crumena.Auth memory r = _auth(
            recipient,
            crumena.requestPayeeStatement(potId, newShop, "Okafor Hardware", crumena.nonceOf(recipient), _validUntil())
        );
        crumena.requestPayee(potId, newShop, "Okafor Hardware", r);
        Crumena.Payee memory p = crumena.payeeInfo(potId, newShop);
        assertTrue(p.requested);
        assertFalse(p.approved, "asking is not approving");

        _addPayee(potId, newShop, "Okafor Hardware");
        p = crumena.payeeInfo(potId, newShop);
        assertTrue(p.approved);
        assertFalse(p.requested);
        (address[] memory addrs,) = crumena.payeesOf(potId);
        assertEq(addrs.length, 3, "listed once");
    }

    function test_onlyTheRecipientCanAsk() public {
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.requestPayeeStatement(potId, newShop, "Shop", nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.requestPayee(potId, newShop, "Shop", a);
    }

    function test_cantAskForAnAlreadyApprovedPayee() public {
        Crumena.Auth memory a = _auth(
            recipient, crumena.requestPayeeStatement(potId, supplierA, "A", crumena.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Crumena.AlreadyApproved.selector);
        crumena.requestPayee(potId, supplierA, "A", a);
    }

    function test_recipientCantAskToPayThemselves() public {
        Crumena.Auth memory a = _auth(
            recipient, crumena.requestPayeeStatement(potId, recipient, "Me", crumena.nonceOf(recipient), _validUntil())
        );
        vm.expectRevert(Crumena.BadAddress.selector);
        crumena.requestPayee(potId, recipient, "Me", a);
    }

    // --------------------------------------------------------------- confirm

    function test_aPayeeConfirmsWithItsOwnKey() public {
        vm.expectEmit(true, true, false, false, address(crumena));
        emit Crumena.PayeeConfirmed(potId, supplierA);
        _confirm(supplierA);
        assertTrue(crumena.payeeInfo(potId, supplierA).confirmed);
    }

    function test_nobodyElseCanConfirmForThePayee() public {
        uint256 nonce = crumena.nonceOf(supplierA);
        string memory st = crumena.confirmPayeeStatement(potId, supplierA, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(funder, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", supplierA));
        crumena.confirmPayee(potId, supplierA, a);
    }

    function test_aPayeeWithoutAPostQuantumKeyCantConfirm() public {
        address plain = makeAddr("no pq key");
        _addPayee(potId, plain, "Plain Shop");
        vm.expectRevert(abi.encodeWithSignature("NoPqcKey(address)", plain));
        crumena.confirmPayee(potId, plain, Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_onlyApprovedPayeesConfirm() public {
        vm.expectRevert(Crumena.NotApproved.selector);
        crumena.confirmPayee(potId, stranger, Crumena.Auth(0, _validUntil(), ""));
    }

    // ------------------------------------------------------------------ limits

    function test_atMostFiftyPayees() public {
        for (uint256 i; i < 48; ++i) _addPayee(potId, address(uint160(0x5000 + i)), "Shop");
        Crumena.Auth memory a =
            _auth(funder, crumena.addPayeeStatement(potId, stranger, "One more", crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.TooManyPayees.selector);
        crumena.addPayee(potId, stranger, "One more", a);
    }

    function _confirm(address payee) internal {
        Crumena.Auth memory a =
            _auth(payee, crumena.confirmPayeeStatement(potId, payee, crumena.nonceOf(payee), _validUntil()));
        crumena.confirmPayee(potId, payee, a);
    }
}
