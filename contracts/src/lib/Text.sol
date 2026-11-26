// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Text
/// @notice The small amount of formatting needed to rebuild, byte for byte, the
///         plain-text statements people sign in QoreX: numbers, token amounts,
///         addresses (0x and qor1), UTC dates, and a check that user text is
///         printable ASCII.
library Text {
    error TextTooLong(uint256 length, uint256 max);
    error TextNotPrintable(uint256 position);

    bytes16 private constant HEX = "0123456789abcdef";
    bytes32 private constant BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    /// @notice Reverts unless `s` is 1..max bytes of printable ASCII (0x20-0x7e).
    ///         No control characters, so a name or memo can't add lines to a statement,
    ///         and no Unicode, so it can't hide behind look-alike or right-to-left letters.
    function requirePrintable(string memory s, uint256 max) internal pure {
        bytes memory b = bytes(s);
        if (b.length == 0 || b.length > max) revert TextTooLong(b.length, max);
        for (uint256 i; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            if (c < 0x20 || c > 0x7e) revert TextNotPrintable(i);
        }
    }

    /// @notice Like requirePrintable, but an empty string is allowed.
    function requirePrintableOrEmpty(string memory s, uint256 max) internal pure {
        if (bytes(s).length != 0) requirePrintable(s, max);
    }

    /// @notice Base-10 representation of `v`.
    function decimal(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) ++len;
        bytes memory out = new bytes(len);
        // forge-lint: disable-next-line(unsafe-typecast) a digit, 48..57
        for (; v != 0; v /= 10) out[--len] = bytes1(uint8(48 + v % 10));
        return string(out);
    }

    /// @notice `amount` in whole units, with up to `decimals` fraction digits and no
    ///         trailing zeros: 250000000 with 6 decimals is "250", 12500000 is "12.5".
    function units(uint256 amount, uint8 decimals) internal pure returns (string memory) {
        uint256 scale = 10 ** decimals;
        string memory whole = decimal(amount / scale);
        uint256 frac = amount % scale;
        if (frac == 0) return whole;
        bytes memory f = new bytes(decimals);
        for (uint256 i = decimals; i > 0; --i) {
            // forge-lint: disable-next-line(unsafe-typecast) a digit, 48..57
            f[i - 1] = bytes1(uint8(48 + frac % 10));
            frac /= 10;
        }
        uint256 end = decimals;
        while (end > 0 && f[end - 1] == "0") --end;
        bytes memory trimmed = new bytes(end);
        for (uint256 i; i < end; ++i) trimmed[i] = f[i];
        return string.concat(whole, ".", string(trimmed));
    }

    /// @notice Lowercase 0x-prefixed hex of an address (42 characters).
    function hexAddress(address a) internal pure returns (string memory) {
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i = 41; i > 1; --i) {
            out[i] = HEX[v & 0xf];
            v >>= 4;
        }
        return string(out);
    }

    /// @notice The account's qor1 address (bech32, BIP-173), the form QoreX shows.
    function qorAddress(address a) internal pure returns (string memory) {
        // 20 bytes = 160 bits = 32 groups of 5 bits, then a 6-group checksum
        uint256 chk = 1;
        // hrp "qor": high bits, separator 0, low bits
        bytes3 hrp = "qor";
        for (uint256 i; i < 3; ++i) chk = _polymod(chk, uint8(hrp[i]) >> 5);
        chk = _polymod(chk, 0);
        for (uint256 i; i < 3; ++i) chk = _polymod(chk, uint8(hrp[i]) & 31);
        uint160 v = uint160(a);
        uint8[32] memory data;
        for (uint256 i = 32; i > 0; --i) {
            // forge-lint: disable-next-line(unsafe-typecast) masked to 5 bits
            data[i - 1] = uint8(v & 31);
            v >>= 5;
        }
        for (uint256 i; i < 32; ++i) chk = _polymod(chk, data[i]);
        for (uint256 i; i < 6; ++i) chk = _polymod(chk, 0);
        chk ^= 1;
        bytes memory out = new bytes(42); // "qor1" + 32 data + 6 checksum
        out[0] = "q";
        out[1] = "o";
        out[2] = "r";
        out[3] = "1";
        for (uint256 i; i < 32; ++i) out[4 + i] = BECH32[data[i]];
        for (uint256 i; i < 6; ++i) out[36 + i] = BECH32[(chk >> (5 * (5 - i))) & 31];
        return string(out);
    }

    /// @notice "YYYY-MM-DD HH:MM UTC" for a unix time.
    function utc(uint256 timestamp) internal pure returns (string memory) {
        (uint256 y, uint256 m, uint256 d) = _civil(timestamp / 86400);
        uint256 secs = timestamp % 86400;
        return string.concat(
            decimal(y), "-", _two(m), "-", _two(d), " ", _two(secs / 3600), ":", _two((secs % 3600) / 60), " UTC"
        );
    }

    function _two(uint256 v) private pure returns (string memory) {
        bytes memory out = new bytes(2);
        // forge-lint: disable-next-line(unsafe-typecast) a digit, 48..57
        out[0] = bytes1(uint8(48 + (v / 10) % 10));
        // forge-lint: disable-next-line(unsafe-typecast) a digit, 48..57
        out[1] = bytes1(uint8(48 + v % 10));
        return string(out);
    }

    /// @dev Days since 1970-01-01 to a civil date (H. Hinnant's days_from_civil, inverted).
    function _civil(uint256 days_) private pure returns (uint256 y, uint256 m, uint256 d) {
        uint256 z = days_ + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    function _polymod(uint256 chk, uint256 v) private pure returns (uint256) {
        uint256 top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        if (top & 1 != 0) chk ^= 0x3b6a57b2;
        if (top & 2 != 0) chk ^= 0x26508e6d;
        if (top & 4 != 0) chk ^= 0x1ea119fa;
        if (top & 8 != 0) chk ^= 0x3d4233dd;
        if (top & 16 != 0) chk ^= 0x2a1462b3;
        return chk;
    }
}
