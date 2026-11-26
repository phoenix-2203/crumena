// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {MockSig} from "./mocks/MockPqc.sol";

/// @notice Drives one pot through random funding, payments, payee changes, time and
///         attacks, keeping a ledger the invariants check against.
contract PotHandler is Test {
    Earmark internal earmark;
    MockToken internal token;
    uint256 internal potId;
    address internal funder;
    address internal recipient;
    address internal attacker;
    address[] internal shops;
    mapping(address => bytes) internal keyOf;

    uint256 public funded;
    uint256 public paidToShops;
    uint256 public returned; // released to the recipient or reclaimed by the funder
    uint256 public attackerSuccesses;

    constructor(
        Earmark e,
        MockToken t,
        uint256 id,
        address f,
        address r,
        address att,
        address[] memory s,
        bytes[] memory keys
    ) {
        earmark = e;
        token = t;
        potId = id;
        funder = f;
        recipient = r;
        attacker = att;
        shops = s;
        keyOf[f] = keys[0];
        keyOf[r] = keys[1];
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1, 1_000_000e6);
        token.mint(earmark.potInfo(potId).vault, amount);
        funded += amount;
    }

    function pay(uint256 shopIndex, uint256 amount, bool byFunder) external {
        Earmark.Pot memory pot = earmark.potInfo(potId);
        if (pot.closed || block.timestamp > pot.endsAt) return;
        uint256 bal = earmark.balanceOf(potId);
        if (bal == 0) return;
        address shop = shops[shopIndex % shops.length];
        if (!earmark.payeeInfo(potId, shop).approved) return;
        amount = bound(amount, 1, bal);
        address by = byFunder ? funder : recipient;
        _signedPay(by, shop, amount);
        paidToShops += amount;
    }

    /// The attacker holds the recipient's classical key but not its post-quantum key.
    function attack(uint256 amount) external {
        Earmark.Pot memory pot = earmark.potInfo(potId);
        if (pot.closed) return;
        amount = bound(amount, 1, 1e12);
        uint256 nonce = earmark.nonceOf(recipient);
        Earmark.Auth memory a = Earmark.Auth(nonce, uint64(block.timestamp + 1 hours), new bytes(4627));
        vm.prank(recipient);
        try earmark.pay(potId, attacker, amount, "", recipient, a) {
            attackerSuccesses++;
        } catch {}
        Earmark.Auth memory b = Earmark.Auth(earmark.nonceOf(funder), uint64(block.timestamp + 1 hours), new bytes(4627));
        vm.prank(funder);
        try earmark.addPayee(potId, attacker, "Attacker", b) {
            attackerSuccesses++;
        } catch {}
    }

    function toggleShop(uint256 shopIndex) external {
        Earmark.Pot memory pot = earmark.potInfo(potId);
        if (pot.closed) return;
        address shop = shops[shopIndex % shops.length];
        uint64 until = uint64(block.timestamp + 1 hours);
        uint256 nonce = earmark.nonceOf(funder);
        if (earmark.payeeInfo(potId, shop).approved) {
            string memory st = earmark.removePayeeStatement(potId, shop, nonce, until);
            earmark.removePayee(potId, shop, Earmark.Auth(nonce, until, _sign(funder, st)));
        } else {
            string memory st = earmark.addPayeeStatement(potId, shop, "Shop", nonce, until);
            earmark.addPayee(potId, shop, "Shop", Earmark.Auth(nonce, until, _sign(funder, st)));
        }
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }

    function reclaim() external {
        Earmark.Pot memory pot = earmark.potInfo(potId);
        if (!pot.closed && block.timestamp <= pot.endsAt) return;
        uint256 bal = earmark.balanceOf(potId);
        if (bal == 0) return;
        earmark.reclaim(potId);
        returned += bal;
    }

    function _signedPay(address by, address shop, uint256 amount) internal {
        uint64 until = uint64(block.timestamp + 1 hours);
        uint256 nonce = earmark.nonceOf(by);
        string memory st = earmark.payStatement(potId, shop, amount, "", by, nonce, until);
        earmark.pay(potId, shop, amount, "", by, Earmark.Auth(nonce, until, _sign(by, st)));
    }

    function _sign(address who, string memory st) internal view returns (bytes memory) {
        return MockSig.sign(keyOf[who], earmark.signedBytes(st));
    }

    function shopCount() external view returns (uint256) {
        return shops.length;
    }

    function shopAt(uint256 i) external view returns (address) {
        return shops[i];
    }
}

contract InvariantTest is Base {
    PotHandler internal handler;
    uint256 internal potId;
    address internal attacker = makeAddr("attacker");

    function setUp() public override {
        super.setUp();
        potId = _createSigned(_newPot());
        address[] memory shops = new address[](3);
        shops[0] = supplierA;
        shops[1] = supplierB;
        shops[2] = makeAddr("Okafor Hardware");
        bytes[] memory keys = new bytes[](2);
        keys[0] = keyOf[funder];
        keys[1] = keyOf[recipient];
        handler = new PotHandler(earmark, token, potId, funder, recipient, attacker, shops, keys);
        targetContract(address(handler));
    }

    /// Every unit paid in is either still in the pot, with an approved shop, or back
    /// with the funder or recipient: nothing is created, lost or diverted.
    function invariant_moneyIsAccountedFor() public view {
        assertEq(
            handler.funded(), earmark.balanceOf(potId) + handler.paidToShops() + handler.returned()
        );
        uint256 atShops;
        for (uint256 i; i < handler.shopCount(); ++i) atShops += token.balanceOf(handler.shopAt(i));
        assertEq(atShops, handler.paidToShops());
    }

    /// Someone with only classical keys never gets paid, whatever they try.
    function invariant_theAttackerGetsNothing() public view {
        assertEq(token.balanceOf(attacker), 0);
        assertEq(handler.attackerSuccesses(), 0);
        assertFalse(earmark.payeeInfo(potId, attacker).approved);
    }

    /// Earmark itself never holds money; pots do.
    function invariant_earmarkHoldsNothing() public view {
        assertEq(token.balanceOf(address(earmark)), 0);
    }

    /// The pot never pays out more than was paid in.
    function invariant_paidOutNeverExceedsFunding() public view {
        assertLe(earmark.potInfo(potId).paidOut, handler.funded());
    }
}
