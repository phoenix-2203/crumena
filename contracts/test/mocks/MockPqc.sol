// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test double for pqcKeyStatus (0x…0a02): a key registry the test fills in.
///         `shape` picks the answer layout: 4 values (current chain) or 3 values (older).
contract MockKeyStatus {
    struct Entry {
        bool registered;
        uint8 algorithm;
        bytes key;
        bool proven;
    }

    mapping(address => Entry) public entries;
    bool public threeValues;

    function set(address account, bool registered, uint8 algorithm, bytes calldata key, bool proven) external {
        entries[account] = Entry(registered, algorithm, key, proven);
    }

    function setThreeValues(bool on) external {
        threeValues = on;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        address account = abi.decode(input[4:], (address));
        Entry storage e = entries[account];
        if (threeValues) return abi.encode(e.registered, e.algorithm, e.key);
        return abi.encode(e.registered, e.algorithm, e.key, e.proven);
    }
}

/// @notice Test double for pqcVerify (0x…0a01). It can't run ML-DSA-87, so it uses a
///         stand-in scheme with the same sizes: a signature is valid when it equals
///         MockSig.sign(key, message). What it checks is everything around the
///         signature: which key, which bytes, which signer. Real ML-DSA-87 is checked
///         by the live testnet run (script/) against the chain's own precompile.
contract MockVerify {
    fallback(bytes calldata input) external returns (bytes memory) {
        (bytes memory key, bytes memory sig, bytes memory message) = abi.decode(input[4:], (bytes, bytes, bytes));
        return abi.encode(keccak256(sig) == keccak256(MockSig.sign(key, message)));
    }
}

library MockSig {
    uint256 internal constant SIGNATURE_LENGTH = 4627;

    function sign(bytes memory key, bytes memory message) internal pure returns (bytes memory sig) {
        bytes32 h = keccak256(abi.encodePacked(key, message));
        sig = new bytes(SIGNATURE_LENGTH);
        for (uint256 i; i < SIGNATURE_LENGTH; ++i) sig[i] = h[i % 32];
    }

    /// @notice A 2592-byte stand-in public key, distinct per seed.
    function key(uint256 seed) internal pure returns (bytes memory k) {
        k = new bytes(2592);
        bytes32 h = keccak256(abi.encode("mock ml-dsa-87 key", seed));
        for (uint256 i; i < 2592; ++i) {
            if (i % 32 == 0) h = keccak256(abi.encode(h, i));
            k[i] = h[i % 32];
        }
    }
}
