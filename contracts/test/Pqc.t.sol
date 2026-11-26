// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Crumena} from "../src/Crumena.sol";
import {Pqc} from "../src/lib/Pqc.sol";
import {MockKeyStatus, MockSig} from "./mocks/MockPqc.sol";

/// @notice pqcVerify answering 2: neither yes nor no.
contract VerifyAnswersTwo {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(2));
    }
}

/// @notice pqcVerify answering 64 bytes instead of 32.
contract VerifyAnswersTooMuch {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(1), uint256(1));
    }
}

/// @notice How Crumena reads keys and checks signatures through QoreChain's
///         precompiles, including when they answer oddly or not at all.
contract PqcTest is Base {
    uint256 internal potId;

    function setUp() public override {
        super.setUp();
        potId = _fundedPot(100 * FUSD);
    }

    function test_acceptsTheOlderThreeValueKeyAnswer() public {
        MockKeyStatus(PQC_KEY_STATUS).setThreeValues(true);
        _pay(potId, recipient, supplierA, FUSD, "");
        assertEq(token.balanceOf(supplierA), FUSD);
    }

    function test_refusesAnUnregisteredKey() public {
        MockKeyStatus(PQC_KEY_STATUS).set(recipient, false, 0, "", false);
        Crumena.Auth memory a = _payAuth();
        vm.expectRevert(abi.encodeWithSelector(Pqc.NoPqcKey.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_refusesAKeyThatIsNotMlDsa87() public {
        MockKeyStatus(PQC_KEY_STATUS).set(recipient, true, 2, keyOf[recipient], true);
        Crumena.Auth memory a = _payAuth();
        vm.expectRevert(abi.encodeWithSelector(Pqc.NotMlDsa87.selector, recipient, 2));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_refusesAKeyRegisteredWithoutProofOfPossession() public {
        MockKeyStatus(PQC_KEY_STATUS).set(recipient, true, 1, keyOf[recipient], false);
        Crumena.Auth memory a = _payAuth();
        vm.expectRevert(abi.encodeWithSelector(Pqc.PossessionNotProven.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_refusesAKeyOfTheWrongSize() public {
        MockKeyStatus(PQC_KEY_STATUS).set(recipient, true, 1, new bytes(1312), true);
        Crumena.Auth memory a = _payAuth();
        vm.expectRevert(abi.encodeWithSelector(Pqc.NoPqcKey.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_refusesASignatureOfTheWrongSize() public {
        Crumena.Auth memory a = _payAuth();
        a.signature = new bytes(4626);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignatureLength.selector, 4626));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_failsClosedWhenTheKeyPrecompileIsMissing() public {
        Crumena.Auth memory a = _payAuth();
        vm.etch(PQC_KEY_STATUS, ""); // an inactive precompile answers with nothing
        vm.expectRevert(abi.encodeWithSelector(Pqc.PqcUnavailable.selector, PQC_KEY_STATUS));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_failsClosedWhenTheVerifyPrecompileIsMissing() public {
        Crumena.Auth memory a = _payAuth();
        vm.etch(PQC_VERIFY, "");
        vm.expectRevert(abi.encodeWithSelector(Pqc.PqcUnavailable.selector, PQC_VERIFY));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_failsClosedOnAVerdictThatIsNotZeroOrOne() public {
        Crumena.Auth memory a = _payAuth();
        vm.etch(PQC_VERIFY, address(new VerifyAnswersTwo()).code);
        vm.expectRevert(abi.encodeWithSelector(Pqc.PqcUnavailable.selector, PQC_VERIFY));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_failsClosedOnAnAnswerOfTheWrongLength() public {
        Crumena.Auth memory a = _payAuth();
        vm.etch(PQC_VERIFY, address(new VerifyAnswersTooMuch()).code);
        vm.expectRevert(abi.encodeWithSelector(Pqc.PqcUnavailable.selector, PQC_VERIFY));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_aVerdictOfFalseIsABadSignature() public {
        Crumena.Auth memory a = _payAuth();
        a.signature[0] = a.signature[0] ^ 0x01;
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadPqcSignature.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_aKeyRotatedOnChainIsUsedAtOnce() public {
        // The contract never caches keys: after a rotation the old key's signatures stop working.
        Crumena.Auth memory a = _payAuth();
        MockKeyStatus(PQC_KEY_STATUS).set(recipient, true, 1, MockSig.key(99), true);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadPqcSignature.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function test_aSignatureFromAnotherChainIdIsRefused() public {
        // Signed for a contract that calls itself "qorechain-mainnet": different prefix bytes.
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce, _validUntil());
        bytes memory otherChain = abi.encodePacked("qorechain-msg-v1|qorechain-mainnet|", st);
        Crumena.Auth memory a = Crumena.Auth(nonce, _validUntil(), MockSig.sign(keyOf[recipient], otherChain));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadPqcSignature.selector, recipient));
        crumena.pay(potId, supplierA, FUSD, "", recipient, a);
    }

    function _payAuth() internal view returns (Crumena.Auth memory) {
        uint256 nonce = crumena.nonceOf(recipient);
        string memory st = crumena.payStatement(potId, supplierA, FUSD, "", recipient, nonce, _validUntil());
        return Crumena.Auth(nonce, _validUntil(), _sig(recipient, st));
    }
}
