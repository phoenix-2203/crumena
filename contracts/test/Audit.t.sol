// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
import {PotVault} from "../src/PotVault.sol";
import {MockSig} from "./mocks/MockPqc.sol";

/// @notice A token whose transfer returns false instead of reverting.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @notice A token whose transfer reverts.
contract RevertingToken {
    function transfer(address, uint256) external pure returns (bool) {
        revert("no");
    }
}

/// @notice An older-style token whose transfer returns nothing.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function transfer(address to, uint256 v) external {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
    }
}

/// @notice One regression test (or more) for each finding of the QCAI audit, Stage 1 (docs/AUDIT.md).
contract AuditTest is Base {
    // ------------------------------------------------------------------ QCAI-1
    // "Potential privilege escalation via incorrect nonce management" (HIGH)

    function test_qcai1_aSignatureWorksOnceAndOnlyAtTheSignersNextNonce() public {
        uint256 potId = _fundedPot(100 * FUSD);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);

        // The same signature again: the nonce has moved on.
        vm.expectRevert(abi.encodeWithSelector(Crumena.BadNonce.selector, nonce + 1, nonce));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);

        // A signature for a later nonce can't be used early.
        string memory ahead = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce + 5, _validUntil());
        Crumena.Auth memory b = Crumena.Auth(nonce + 5, _validUntil(), _sig(recipient, ahead));
        vm.expectRevert(abi.encodeWithSelector(Crumena.BadNonce.selector, nonce + 1, nonce + 5));
        crumena.pay(potId, supplierA, FUSD, "", recipient, b);
    }

    function test_qcai1_noncesArePerSignerAndOnlyMoveForAValidSignature() public {
        uint256 potId = _fundedPot(100 * FUSD);
        uint256 funderBefore = crumena.nonceOf(funder);
        _pay(potId, recipient, supplierA, FUSD, "");
        assertEq(crumena.nonceOf(funder), funderBefore, "another signer's nonce is untouched");

        // A wrong signature at the right nonce is refused and doesn't use the nonce up.
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory forged = Crumena.Auth(nonce, _validUntil(), _sig(stranger, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, forged);
        assertEq(crumena.nonceOf(recipient), nonce);
    }

    function test_qcai1_aStatementNamesItsContractSoItCantBeReplayedOnAnother() public {
        uint256 potId = _fundedPot(100 * FUSD);
        Crumena other = new Crumena("qorechain-diana", DIANA);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce, _validUntil());
        assertTrue(keccak256(bytes(st)) != keccak256(bytes(_otherStatement(other, nonce))), "the contract address is in the text");
    }

    function _otherStatement(Crumena other, uint256 nonce) internal returns (string memory) {
        // the same pot on another Crumena: the funder creates it there too
        Crumena.NewPot memory p = _newPot();
        uint256 n = other.nonceOf(funder);
        string memory cs = other.createStatement(p, n, _validUntil());
        vm.prank(relayer);
        uint256 id = other.createPot(p, Crumena.Auth(n, _validUntil(), MockSig.sign(keyOf[funder], other.signedBytes(cs))));
        return other.payStatement(id, supplierA, FUSD, "", recipient, nonce, _validUntil());
    }

    // ------------------------------------------------------------------ QCAI-2
    // "Potential overflow in period calculation" (MEDIUM)

    function test_qcai2_periodLengthIsBoundedAtCreationAndWhenChanged() public {
        Crumena.NewPot memory p = _newPot();
        p.rules = Crumena.Rules({maxPerPayment: 0, periodLimit: FUSD, periodDays: 367});
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadRules.selector));
        p.rules.periodDays = type(uint32).max;
        _expectCreateRevert(p, abi.encodeWithSelector(Crumena.BadRules.selector));
    }

    function test_qcai2_periodsStayCorrectCenturiesAhead() public {
        Crumena.NewPot memory p = _newPot();
        p.endsAt = type(uint64).max;
        p.rules = Crumena.Rules({maxPerPayment: 0, periodLimit: 10 * FUSD, periodDays: 1});
        uint256 potId = _createSigned(p);
        _fund(potId, 100 * FUSD);
        uint256 later = START + 300 * 365 days + 12 hours; // 300 years on, mid-day
        vm.warp(later);
        _pay(potId, recipient, supplierA, 10 * FUSD, "");
        (uint256 spent, uint256 limit, uint64 resetsAt) = crumena.periodSpending(potId);
        assertEq(spent, 10 * FUSD);
        assertEq(limit, 10 * FUSD);
        assertEq(resetsAt, START + 300 * 365 days + 1 days);
    }

    function testFuzz_qcai2_periodSpendingNeverOverflows(uint32 periodDays, uint64 elapsed) public {
        periodDays = uint32(bound(periodDays, 1, 366));
        elapsed = uint64(bound(elapsed, 0, 10_000 * 365 days));
        Crumena.NewPot memory p = _newPot();
        p.endsAt = type(uint64).max;
        p.rules = Crumena.Rules({maxPerPayment: 0, periodLimit: FUSD, periodDays: periodDays});
        uint256 potId = _createSigned(p);
        vm.warp(START + elapsed);
        (, , uint64 resetsAt) = crumena.periodSpending(potId);
        assertGt(resetsAt, START + elapsed);
        assertLe(resetsAt, START + elapsed + uint256(periodDays) * 1 days);
    }

    // ------------------------------------------------------------------ QCAI-3
    // "Unchecked return values from external calls" (MEDIUM), PotVault.send

    function test_qcai3_aTransferThatReturnsFalseReverts() public {
        PotVault v = new PotVault();
        address t = address(new FalseToken());
        vm.expectRevert(PotVault.TransferFailed.selector);
        v.send(t, supplierA, 1);
    }

    function test_qcai3_aTransferThatRevertsReverts() public {
        PotVault v = new PotVault();
        address t = address(new RevertingToken());
        vm.expectRevert(PotVault.TransferFailed.selector);
        v.send(t, supplierA, 1);
    }

    function test_qcai3_aTokenThatReturnsNothingStillWorks() public {
        PotVault v = new PotVault();
        NoReturnToken t = new NoReturnToken();
        t.mint(address(v), 5);
        v.send(address(t), supplierA, 5);
        assertEq(t.balanceOf(supplierA), 5);
    }

    function test_qcai3_aPotsTokenAlwaysHasCode() public {
        // An address with no code would "succeed" silently, so it can never be a pot's token.
        Crumena.NewPot memory p = _newPot();
        p.token = makeAddr("not a contract");
        vm.expectRevert(Crumena.BadToken.selector); // there isn't even a statement to sign
        crumena.createStatement(p, 0, _validUntil());
        vm.expectRevert(Crumena.BadToken.selector);
        crumena.createPot(p, Crumena.Auth(0, _validUntil(), new bytes(4627)));
    }

    function test_qcai3_onlyCrumenaMovesAVaultsMoney() public {
        uint256 potId = _fundedPot(10 * FUSD);
        PotVault v = PotVault(crumena.potInfo(potId).vault);
        vm.prank(stranger);
        vm.expectRevert(PotVault.NotCrumena.selector);
        v.send(address(token), stranger, 10 * FUSD);
    }

    // ------------------------------------------------------------------ QCAI-4
    // "Unbounded loop in payee listing" (LOW)

    function test_qcai4_thePayeeListIsCappedAndNeverGrowsTwiceForOneAddress() public {
        uint256 potId = _fundedPot(10 * FUSD);
        // 2 at creation; add up to the cap of 50
        for (uint256 i; i < 48; ++i) _addPayee(potId, address(uint160(0xA000 + i)), "Shop");
        (address[] memory list,) = crumena.payeesOf(potId);
        assertEq(list.length, 50);

        address extra = address(uint160(0xB000));
        Crumena.Auth memory a = _auth(funder, crumena.addPayeeStatement(potId, extra, "Shop", crumena.nonceOf(funder), _validUntil()));
        vm.expectRevert(Crumena.TooManyPayees.selector);
        crumena.addPayee(potId, extra, "Shop", a);

        // Removing and approving the same address again doesn't add a second entry.
        address again = address(uint160(0xA000));
        Crumena.Auth memory r = _auth(funder, crumena.removePayeeStatement(potId, again, crumena.nonceOf(funder), _validUntil()));
        crumena.removePayee(potId, again, r);
        _addPayee(potId, again, "Shop");
        (list,) = crumena.payeesOf(potId);
        assertEq(list.length, 50);
    }

    // ------------------------------------------------------------------ QCAI-5
    // "Potential front-running in signature validation" (INFO)

    function test_qcai5_aFailedSignatureChangesNothing() public {
        uint256 potId = _fundedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(funder);
        string memory st = crumena.addPayeeStatement(potId, stranger, "Totally legit", nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        vm.expectRevert(abi.encodeWithSignature("BadPqcSignature(address)", funder));
        crumena.addPayee(potId, stranger, "Totally legit", a);
        assertFalse(crumena.payeeInfo(potId, stranger).approved);
        (address[] memory list,) = crumena.payeesOf(potId);
        assertEq(list.length, 2);
        assertEq(crumena.nonceOf(funder), nonce);
    }

    function test_qcai5_whoeverSubmitsASignedActionGetsTheSignersEffectAndNothingElse() public {
        uint256 potId = _fundedPot(10 * FUSD);
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, 4 * FUSD, "", recipient, nonce, _validUntil());
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
        // A front-runner submits it first: the payee the spender chose gets the money, the submitter gets nothing.
        vm.prank(stranger);
        crumena.pay(potId, supplierA, 4 * FUSD, "", recipient, a);
        assertEq(token.balanceOf(supplierA), 4 * FUSD);
        assertEq(token.balanceOf(stranger), 0);
        // The honest relayer's copy then fails harmlessly.
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Crumena.BadNonce.selector, nonce + 1, nonce));
        crumena.pay(potId, supplierA, 4 * FUSD, "", recipient, a);
    }
}
