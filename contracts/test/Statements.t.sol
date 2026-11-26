// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {Earmark} from "../src/Earmark.sol";
import {Text} from "../src/lib/Text.sol";

contract TextHarness {
    function units(uint256 a, uint8 d) external pure returns (string memory) {
        return Text.units(a, d);
    }

    function utc(uint256 t) external pure returns (string memory) {
        return Text.utc(t);
    }

    function qor(address a) external pure returns (string memory) {
        return Text.qorAddress(a);
    }

    function hexAddress(address a) external pure returns (string memory) {
        return Text.hexAddress(a);
    }

    function decimal(uint256 v) external pure returns (string memory) {
        return Text.decimal(v);
    }

    function printable(string calldata s, uint256 max) external pure {
        Text.requirePrintable(s, max);
    }
}

/// @notice The building blocks of every statement, checked against known values.
contract TextTest is Test {
    TextHarness internal t = new TextHarness();

    function test_tokenAmounts() public view {
        assertEq(t.units(250_000_000, 6), "250");
        assertEq(t.units(12_500_000, 6), "12.5");
        assertEq(t.units(1, 6), "0.000001");
        assertEq(t.units(0, 6), "0");
        assertEq(t.units(2_967_000_000, 6), "2967");
        assertEq(t.units(1_000_010_000, 6), "1000.01");
        assertEq(t.units(5, 0), "5");
        assertEq(t.units(1e18 + 5e17, 18), "1.5");
    }

    function test_datesInUtc() public view {
        assertEq(t.utc(0), "1970-01-01 00:00 UTC");
        assertEq(t.utc(951_782_400), "2000-02-29 00:00 UTC");
        assertEq(t.utc(1_795_683_600), "2026-11-26 09:00 UTC");
        assertEq(t.utc(1_798_275_600), "2026-12-26 09:00 UTC");
        assertEq(t.utc(4_102_444_799), "2099-12-31 23:59 UTC");
    }

    /// Pairs read from the chain in Cista's team run (docs/team-run.md in that repo).
    function test_qorAddressesMatchTheChain() public view {
        assertEq(t.qor(0x7448BF4A7963E81AB4f93B118159A91b7caD9b22), "qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh");
        assertEq(t.qor(0xD1C8dE2EE56c6F6835B06D2A092DFa6150E2ba75), "qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h");
        assertEq(t.qor(0xd3caC5c7F01f746fa3d1843fdc389643a52d8DfC), "qor1609vt3lsra6xlg73sslacwykgwjjmr0ua0tccg");
    }

    function test_hexAndDecimal() public view {
        assertEq(t.hexAddress(0x7448BF4A7963E81AB4f93B118159A91b7caD9b22), "0x7448bf4a7963e81ab4f93b118159a91b7cad9b22");
        assertEq(t.hexAddress(address(0)), "0x0000000000000000000000000000000000000000");
        assertEq(t.decimal(0), "0");
        assertEq(t.decimal(9800), "9800");
        assertEq(t.decimal(type(uint256).max), vm.toString(type(uint256).max));
    }

    function test_printableText() public {
        t.printable("PO-1042 materials, ok!", 80);
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 2));
        t.printable("ab\tc", 80);
        vm.expectRevert(abi.encodeWithSelector(Text.TextNotPrintable.selector, 1));
        t.printable("a\x7fb", 80);
        vm.expectRevert(abi.encodeWithSelector(Text.TextTooLong.selector, 3, 2));
        t.printable("abc", 2);
    }

    function testFuzz_unitsRoundTrip(uint64 amount) public view {
        string memory s = t.units(amount, 6);
        // parse back: whole and fraction
        bytes memory b = bytes(s);
        uint256 whole;
        uint256 frac;
        uint256 fracDigits;
        bool seenDot;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ".") {
                seenDot = true;
                continue;
            }
            uint256 d = uint8(b[i]) - 48;
            if (seenDot) {
                frac = frac * 10 + d;
                ++fracDigits;
            } else {
                whole = whole * 10 + d;
            }
        }
        assertEq(whole * 1e6 + frac * 10 ** (6 - fracDigits), amount);
        if (seenDot) assertTrue(b[b.length - 1] != "0", "no trailing zeros");
    }

    function testFuzz_qorAddressShape(address a) public view {
        bytes memory q = bytes(t.qor(a));
        assertEq(q.length, 42);
        assertEq(q[0], "q");
        assertEq(q[3], "1");
    }
}

/// @notice What people actually read in QoreX, word for word.
contract StatementTest is Base {
    address internal constant ADA = 0xD1C8dE2EE56c6F6835B06D2A092DFa6150E2ba75;
    address internal constant FUNDER = 0x7448BF4A7963E81AB4f93B118159A91b7caD9b22;

    function test_whatTheRecipientSignsToPay() public {
        funder = FUNDER;
        recipient = ADA;
        _register(FUNDER, 11);
        _register(ADA, 12);
        uint256 potId = _fundedPot(1000 * FUSD);

        string memory st = earmark.payStatement(potId, supplierA, 250_500_000, "PO-1042 materials", ADA, 0, uint64(START + 3600));
        assertEq(
            st,
            string.concat(
                "Earmark: pay from pot #1\n",
                "Pot: Office fit-out, phase 1\n",
                "Amount: 250.5 fUSD\n",
                "To: Halden Building Supplies\n",
                "Address: ",
                Text.hexAddress(supplierA),
                "\nMemo: PO-1042 materials\n",
                "Signed by: qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h\n",
                "Nonce: 0\n",
                "Valid until: 2026-11-26 10:00 UTC\n",
                "Contract: ",
                Text.hexAddress(address(earmark)),
                " on qorechain-diana"
            )
        );
        // and what QoreX actually signs: its fixed prefix, the chain id, then the text
        assertEq(earmark.signedBytes(st), abi.encodePacked("qorechain-msg-v1|qorechain-diana|", st));
    }

    function test_whatTheFunderSignsToCreate() public {
        funder = FUNDER;
        recipient = ADA;
        _register(FUNDER, 11);
        Earmark.NewPot memory p = _newPot();
        string memory st = earmark.createStatement(p, 0, uint64(START + 3600));
        assertEq(
            st,
            string.concat(
                "Earmark: create a pot\n",
                "Purpose: Office fit-out, phase 1\n",
                "Spent by: qor168yduth9d3hksddsd54qjt06v9gw9wn40yeg4h\n",
                "Money: fUSD (",
                Text.hexAddress(address(token)),
                ")\nEnds: 2026-12-26 09:00 UTC\n",
                "Pay only payees who confirmed: no\n",
                "Payees:\n",
                "1. Halden Building Supplies, ",
                Text.hexAddress(supplierA),
                "\n2. Brightline Electrical, ",
                Text.hexAddress(supplierB),
                "\nPot address: ",
                Text.hexAddress(earmark.vaultFor(FUNDER, 0)),
                "\nSigned by: qor1w3yt7jnev05p4d8e8vgczkdfrd72mxezajpegh\n",
                "Nonce: 0\n",
                "Valid until: 2026-11-26 10:00 UTC\n",
                "Contract: ",
                Text.hexAddress(address(earmark)),
                " on qorechain-diana"
            )
        );
    }

    function test_anEmptyMemoReadsAsADash() public {
        uint256 potId = _fundedPot(10 * FUSD);
        string memory st = earmark.payStatement(potId, supplierA, FUSD, "", recipient, 0, uint64(START + 60));
        assertTrue(_contains(st, "\nMemo: -\n"));
    }

    function test_everyStatementFitsInAQoreXMessage() public {
        // QoreX signs 1 to 4096 bytes. The longest statement is a create with ten
        // payees and every text field at its maximum length.
        Earmark.NewPot memory p = _newPot();
        p.purpose = _repeat("P", 80);
        p.payees = new address[](10);
        p.names = new string[](10);
        for (uint256 i; i < 10; ++i) {
            p.payees[i] = address(uint160(0x9000 + i));
            p.names[i] = _repeat("N", 48);
        }
        bytes memory signed = earmark.signedBytes(earmark.createStatement(p, type(uint256).max, type(uint64).max));
        assertLt(signed.length, 4097);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length && ok; ++j) ok = h[i + j] == n[j];
            if (ok) return true;
        }
        return false;
    }

    function _repeat(string memory c, uint256 n) internal pure returns (string memory s) {
        for (uint256 i; i < n; ++i) s = string.concat(s, c);
    }
}
