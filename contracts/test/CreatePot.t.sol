// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
import {PotVault} from "../src/PotVault.sol";
import {Text} from "../src/lib/Text.sol";

contract CreatePotTest is Base {
    function test_createsPotWithItsPayees() public {
        Crumena.NewPot memory p = _newPot();
        address predicted = crumena.vaultFor(funder, 0);
        uint256 potId = _createSigned(p);

        assertEq(potId, 1);
        Crumena.Pot memory pot = crumena.potInfo(potId);
        assertEq(pot.funder, funder);
        assertEq(pot.recipient, recipient);
        assertEq(pot.token, address(token));
        assertEq(pot.vault, predicted, "vault lands at the predicted address");
        assertEq(pot.endsAt, p.endsAt);
        assertEq(pot.decimals, 6);
        assertEq(pot.symbol, "fUSD");
        assertEq(pot.purpose, "Office fit-out, phase 1");
        assertFalse(pot.closed);
        assertEq(crumena.potOfVault(predicted), potId);
        assertEq(PotVault(predicted).crumena(), address(crumena));

        (address[] memory addrs, Crumena.Payee[] memory info) = crumena.payeesOf(potId, 0, 50);
        assertEq(addrs.length, 2);
        assertEq(addrs[0], supplierA);
        assertEq(info[0].name, "Halden Building Supplies");
        assertTrue(info[0].approved);
        assertFalse(info[0].confirmed);
        assertEq(addrs[1], supplierB);
        assertTrue(info[1].approved);

        assertEq(crumena.nonceOf(funder), 1, "the funder's nonce moves on");
        assertEq(crumena.potsOf(funder)[0], potId);
        assertEq(crumena.potsOf(recipient)[0], potId);
    }

    function test_moneyPaidInBeforeOrAfterCreationIsThePots() public {
        address vault = crumena.vaultFor(funder, 0);
        token.mint(vault, 100 * FUSD); // paid in before the pot exists
        uint256 potId = _createSigned(_newPot());
        token.mint(vault, 50 * FUSD); // topped up by anyone afterwards
        assertEq(crumena.potBalance(potId), 150 * FUSD);
    }

    function test_emitsPotCreatedAndPayeeApproved() public {
        Crumena.NewPot memory p = _newPot();
        vm.expectEmit(true, true, true, true, address(crumena));
        emit Crumena.PotCreated(
            1, funder, recipient, crumena.vaultFor(funder, 0), address(token), p.endsAt, false, p.purpose
        );
        vm.expectEmit(true, true, false, true, address(crumena));
        emit Crumena.PayeeApproved(1, supplierA, "Halden Building Supplies", 0);
        _createSigned(p);
    }

    function test_twoPotsFromOneFunderGetDifferentVaults() public {
        uint256 a = _createSigned(_newPot());
        uint256 b = _createSigned(_newPot());
        assertTrue(crumena.potInfo(a).vault != crumena.potInfo(b).vault);
        assertEq(crumena.potCount(), 2);
    }

    function test_recipientMayBeTheFunder() public {
        Crumena.NewPot memory p = _newPot();
        p.recipient = funder; // a budget you keep yourself to
        uint256 potId = _createSigned(p);
        assertEq(crumena.potsOf(funder).length, 1, "listed once");
        _fund(potId, 10 * FUSD);
        _pay(potId, funder, supplierA, FUSD, "");
        assertEq(token.balanceOf(supplierA), FUSD);
    }

    // ------------------------------------------------------------ who can create

    function test_rejectsASignatureFromAnyoneButTheFunder() public {
        Crumena.NewPot memory p = _newPot();
        string memory st = crumena.createStatement(p, 0, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(0, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.createPot(p, a);
    }

    function test_theFundersOwnClassicalKeyIsNotEnough() public {
        // msg.sender is the funder (a stolen ECDSA key could send this), but the
        // post-quantum signature is missing: refused.
        Crumena.NewPot memory p = _newPot();
        Crumena.Auth memory a = Crumena.Auth(0, _validUntil(), new bytes(4627));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.createPot(p, a);
    }

    function test_signatureCoversEveryField() public {
        Crumena.NewPot memory p = _newPot();
        string memory st = crumena.createStatement(p, 0, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(0, _validUntil(), _sig(funder, st));
        p.payees[1] = stranger; // swapped after signing
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.createPot(p, a);
    }

    // ------------------------------------------------------------------- checks

    function test_rejectsAnEndDateInThePast() public {
        Crumena.NewPot memory p = _newPot();
        p.endsAt = uint64(block.timestamp);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadEnd.selector));
    }

    function test_rejectsNoPayeesOrTooMany() public {
        Crumena.NewPot memory p = _newPot();
        p.payees = new address[](0);
        p.names = new string[](0);
        p.limits = new uint256[](0);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.TooManyPayees.selector));

        p.payees = new address[](11);
        p.names = new string[](11);
        p.limits = new uint256[](11);
        for (uint256 i; i < 11; ++i) {
            p.payees[i] = address(uint160(0x1000 + i));
            p.names[i] = "Shop";
        }
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.TooManyPayees.selector));
    }

    function test_rejectsMismatchedNames() public {
        Crumena.NewPot memory p = _newPot();
        p.names = new string[](1);
        p.limits = new uint256[](1);
        p.names[0] = "Halden";
        vm.expectRevert(Crumena.TooManyPayees.selector);
        crumena.createPot(p, Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_theFunderAndRecipientCantBePayees() public {
        Crumena.NewPot memory p = _newPot();
        p.payees[0] = recipient;
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadAddress.selector));
        p.payees[0] = funder;
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadAddress.selector));
        p.payees[0] = address(0);
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadAddress.selector));
    }

    function test_anotherPotsVaultCantBeAPayee() public {
        uint256 first = _createSigned(_newPot());
        Crumena.NewPot memory p = _newPot();
        p.payees[0] = crumena.potInfo(first).vault;
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadAddress.selector));
    }

    function test_rejectsDuplicatePayees() public {
        Crumena.NewPot memory p = _newPot();
        p.payees[1] = supplierA;
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.DuplicatePayee.selector));
    }

    function test_rejectsEmptyOrLongOrControlCharacterText() public {
        Crumena.NewPot memory p = _newPot();
        p.purpose = "";
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextTooLong.selector, 0, 80));

        p.purpose = "Rent\nAmount: 1 fUSD"; // a second line would mislead the signer
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));

        p = _newPot();
        p.names[0] = unicode"Hálden"; // not ASCII: no look-alike letters
        _expectCreateRevert(p, abi.encodeWithSelector(Text.TextNotPrintable.selector, 1));
    }

    function test_rejectsATokenThatIsNotAContract() public {
        Crumena.NewPot memory p = _newPot();
        p.token = stranger;
        vm.expectRevert(Crumena.BadToken.selector);
        crumena.createPot(p, Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_rejectsATokenWithAStrangeSymbol() public {
        token.setSymbol("fUSD\nPay");
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 4));
        crumena.createPot(_newPot(), Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_onlyRunsOnTheChainItWasDeployedFor() public {
        vm.chainId(1);
        vm.expectRevert(Crumena.WrongChain.selector);
        new Crumena("qorechain-diana", DIANA);
    }
}
