// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";
import {PotVault} from "../src/PotVault.sol";
import {Text} from "../src/lib/Text.sol";

contract CreatePotTest is Base {
    function test_createsPotWithItsPayees() public {
        Earmark.NewPot memory p = _newPot();
        address predicted = earmark.vaultFor(funder, 0);
        uint256 potId = _createSigned(p);

        assertEq(potId, 1);
        Earmark.Pot memory pot = earmark.potInfo(potId);
        assertEq(pot.funder, funder);
        assertEq(pot.recipient, recipient);
        assertEq(pot.token, address(token));
        assertEq(pot.vault, predicted, "vault lands at the predicted address");
        assertEq(pot.endsAt, p.endsAt);
        assertEq(pot.decimals, 6);
        assertEq(pot.symbol, "fUSD");
        assertEq(pot.purpose, "Office fit-out, phase 1");
        assertFalse(pot.closed);
        assertEq(earmark.potOfVault(predicted), potId);
        assertEq(PotVault(predicted).earmark(), address(earmark));

        (address[] memory addrs, Earmark.Payee[] memory info) = earmark.payeesOf(potId);
        assertEq(addrs.length, 2);
        assertEq(addrs[0], supplierA);
        assertEq(info[0].name, "Halden Building Supplies");
        assertTrue(info[0].approved);
        assertFalse(info[0].confirmed);
        assertEq(addrs[1], supplierB);
        assertTrue(info[1].approved);

        assertEq(earmark.nonceOf(funder), 1, "the funder's nonce moves on");
        assertEq(earmark.potsOf(funder)[0], potId);
        assertEq(earmark.potsOf(recipient)[0], potId);
    }

    function test_moneyPaidInBeforeOrAfterCreationIsThePots() public {
        address vault = earmark.vaultFor(funder, 0);
        token.mint(vault, 100 * FUSD); // paid in before the pot exists
        uint256 potId = _createSigned(_newPot());
        token.mint(vault, 50 * FUSD); // topped up by anyone afterwards
        assertEq(earmark.balanceOf(potId), 150 * FUSD);
    }

    function test_emitsPotCreatedAndPayeeApproved() public {
        Earmark.NewPot memory p = _newPot();
        vm.expectEmit(true, true, true, true, address(earmark));
        emit Earmark.PotCreated(
            1, funder, recipient, earmark.vaultFor(funder, 0), address(token), p.endsAt, false, p.purpose
        );
        vm.expectEmit(true, true, false, true, address(earmark));
        emit Earmark.PayeeApproved(1, supplierA, "Halden Building Supplies");
        _createSigned(p);
    }

    function test_twoPotsFromOneFunderGetDifferentVaults() public {
        uint256 a = _createSigned(_newPot());
        uint256 b = _createSigned(_newPot());
        assertTrue(earmark.potInfo(a).vault != earmark.potInfo(b).vault);
        assertEq(earmark.potCount(), 2);
    }

    function test_recipientMayBeTheFunder() public {
        Earmark.NewPot memory p = _newPot();
        p.recipient = funder; // a budget you keep yourself to
        uint256 potId = _createSigned(p);
        assertEq(earmark.potsOf(funder).length, 1, "listed once");
        _fund(potId, 10 * FUSD);
        _pay(potId, funder, supplierA, FUSD, "");
        assertEq(token.balanceOf(supplierA), FUSD);
    }

    // ------------------------------------------------------------ who can create

    function test_rejectsASignatureFromAnyoneButTheFunder() public {
        Earmark.NewPot memory p = _newPot();
        string memory st = earmark.createStatement(p, 0, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(0, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.createPot(p, a);
    }

    function test_theFundersOwnClassicalKeyIsNotEnough() public {
        // msg.sender is the funder (a stolen ECDSA key could send this), but the
        // post-quantum signature is missing: refused.
        Earmark.NewPot memory p = _newPot();
        Earmark.Auth memory a = Earmark.Auth(0, _validUntil(), new bytes(4627));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.createPot(p, a);
    }

    function test_signatureCoversEveryField() public {
        Earmark.NewPot memory p = _newPot();
        string memory st = earmark.createStatement(p, 0, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(0, _validUntil(), _sig(funder, st));
        p.payees[1] = stranger; // swapped after signing
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        earmark.createPot(p, a);
    }

    // ------------------------------------------------------------------- checks

    function test_rejectsAnEndDateInThePast() public {
        Earmark.NewPot memory p = _newPot();
        p.endsAt = uint64(block.timestamp);
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.BadEnd.selector));
    }

    function test_rejectsNoPayeesOrTooMany() public {
        Earmark.NewPot memory p = _newPot();
        p.payees = new address[](0);
        p.names = new string[](0);
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.TooManyPayees.selector));

        p.payees = new address[](11);
        p.names = new string[](11);
        for (uint256 i; i < 11; ++i) {
            p.payees[i] = address(uint160(0x1000 + i));
            p.names[i] = "Shop";
        }
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.TooManyPayees.selector));
    }

    function test_rejectsMismatchedNames() public {
        Earmark.NewPot memory p = _newPot();
        p.names = new string[](1);
        p.names[0] = "Halden";
        vm.expectRevert(Earmark.TooManyPayees.selector);
        earmark.createPot(p, Earmark.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_theFunderAndRecipientCantBePayees() public {
        Earmark.NewPot memory p = _newPot();
        p.payees[0] = recipient;
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.BadAddress.selector));
        p.payees[0] = funder;
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.BadAddress.selector));
        p.payees[0] = address(0);
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.BadAddress.selector));
    }

    function test_anotherPotsVaultCantBeAPayee() public {
        uint256 first = _createSigned(_newPot());
        Earmark.NewPot memory p = _newPot();
        p.payees[0] = earmark.potInfo(first).vault;
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.BadAddress.selector));
    }

    function test_rejectsDuplicatePayees() public {
        Earmark.NewPot memory p = _newPot();
        p.payees[1] = supplierA;
        _expectCreateRevert(p, abi.encodeWithSelector(Earmark.DuplicatePayee.selector));
    }

    function test_rejectsEmptyOrLongOrControlCharacterText() public {
        Earmark.NewPot memory p = _newPot();
        p.purpose = "";
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextTooLong.selector, 0, 80));

        p.purpose = "Rent\nAmount: 1 fUSD"; // a second line would mislead the signer
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));

        p = _newPot();
        p.names[0] = unicode"Hálden"; // not ASCII: no look-alike letters
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextNotPrintable.selector, 1));
    }

    function test_rejectsATokenThatIsNotAContract() public {
        Earmark.NewPot memory p = _newPot();
        p.token = stranger;
        vm.expectRevert(Earmark.BadToken.selector);
        earmark.createPot(p, Earmark.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_rejectsATokenWithAStrangeSymbol() public {
        token.setSymbol("fUSD\nPay");
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));
        earmark.createPot(_newPot(), Earmark.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_onlyRunsOnTheChainItWasDeployedFor() public {
        vm.chainId(1);
        vm.expectRevert(Earmark.WrongChain.selector);
        new Earmark("qorechain-diana", DIANA);
    }
}
