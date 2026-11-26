// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Earmark} from "../src/Earmark.sol";
import {MockKeyStatus, MockVerify, MockSig} from "./mocks/MockPqc.sol";
import {MockToken} from "./mocks/MockToken.sol";

/// @notice Shared set-up: the two precompiles at their real addresses, a 6-decimal
///         token, and people with post-quantum keys registered on the mock chain.
abstract contract Base is Test {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;
    uint256 internal constant DIANA = 9800;
    uint256 internal constant START = 1_795_683_600; // 2026-11-26 09:00 UTC
    uint256 internal constant FUSD = 1e6; // one fUSD in base units

    Earmark internal earmark;
    MockToken internal token;

    address internal funder = makeAddr("funder");
    address internal recipient = makeAddr("recipient");
    address internal supplierA = makeAddr("Halden Building Supplies");
    address internal supplierB = makeAddr("Brightline Electrical");
    address internal stranger = makeAddr("stranger");
    address internal relayer = makeAddr("relayer");

    mapping(address => bytes) internal keyOf;

    function setUp() public virtual {
        vm.chainId(DIANA);
        vm.warp(START);
        vm.etch(PQC_KEY_STATUS, address(new MockKeyStatus()).code);
        vm.etch(PQC_VERIFY, address(new MockVerify()).code);
        earmark = new Earmark("qorechain-diana", DIANA);
        token = new MockToken();
        _register(funder, 1);
        _register(recipient, 2);
        _register(supplierA, 3);
        _register(supplierB, 4);
        _register(stranger, 5);
    }

    // ------------------------------------------------------------ keys and signing

    function _register(address who, uint256 seed) internal {
        bytes memory k = MockSig.key(seed);
        keyOf[who] = k;
        MockKeyStatus(PQC_KEY_STATUS).set(who, true, 1, k, true);
    }

    function _sig(address signer, string memory statement) internal view returns (bytes memory) {
        return MockSig.sign(keyOf[signer], earmark.signedBytes(statement));
    }

    function _auth(address signer, string memory statement) internal view returns (Earmark.Auth memory) {
        return Earmark.Auth(earmark.nonceOf(signer), _validUntil(), _sig(signer, statement));
    }

    function _validUntil() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    // --------------------------------------------------------------------- pots

    function _newPot() internal view returns (Earmark.NewPot memory p) {
        p.funder = funder;
        p.recipient = recipient;
        p.token = address(token);
        p.endsAt = uint64(START + 30 days);
        p.purpose = "Office fit-out, phase 1";
        p.payees = new address[](2);
        p.payees[0] = supplierA;
        p.payees[1] = supplierB;
        p.names = new string[](2);
        p.names[0] = "Halden Building Supplies";
        p.names[1] = "Brightline Electrical";
    }

    function _createSigned(Earmark.NewPot memory p) internal returns (uint256 potId) {
        Earmark.Auth memory a = _createAuth(p);
        vm.prank(relayer);
        potId = earmark.createPot(p, a);
    }

    /// @notice The funder's signature for creating `p` (build it before vm.expectRevert).
    function _createAuth(Earmark.NewPot memory p) internal view returns (Earmark.Auth memory) {
        uint256 nonce = earmark.nonceOf(p.funder);
        string memory st = earmark.createStatement(p, nonce, _validUntil());
        return Earmark.Auth(nonce, _validUntil(), _sig(p.funder, st));
    }

    /// @notice Expect `createPot(p)`, properly signed, to revert with `reason`.
    function _expectCreateRevert(Earmark.NewPot memory p, bytes memory reason) internal {
        Earmark.Auth memory a = _createAuth(p);
        vm.expectRevert(reason);
        earmark.createPot(p, a);
    }

    /// @notice A pot with `amount` fUSD paid into its vault.
    function _fundedPot(uint256 amount) internal returns (uint256 potId) {
        potId = _createSigned(_newPot());
        _fund(potId, amount);
    }

    function _fund(uint256 potId, uint256 amount) internal {
        token.mint(earmark.potInfo(potId).vault, amount);
    }

    // ------------------------------------------------------------------ actions

    function _pay(uint256 potId, address by, address to, uint256 amount, string memory memo) internal {
        uint256 nonce = earmark.nonceOf(by);
        string memory st = earmark.payStatement(potId, to, amount, memo, by, nonce, _validUntil());
        Earmark.Auth memory a = Earmark.Auth(nonce, _validUntil(), _sig(by, st));
        vm.prank(relayer);
        earmark.pay(potId, to, amount, memo, by, a);
    }

    function _addPayee(uint256 potId, address payee, string memory name) internal {
        Earmark.Auth memory a =
            _auth(funder, earmark.addPayeeStatement(potId, payee, name, earmark.nonceOf(funder), _validUntil()));
        vm.prank(relayer);
        earmark.addPayee(potId, payee, name, a);
    }
}
