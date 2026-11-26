// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Pqc
/// @notice Checks ML-DSA-87 signatures against the key an account registered on
///         QoreChain, using the chain's post-quantum precompiles:
///         - pqcKeyStatus (0x…0a02): the account's registered key;
///         - pqcVerify    (0x…0a01): checks a signature with that key.
/// @dev    Fail closed: an inactive precompile answers with empty data, which is
///         refused, as is any answer of the wrong shape.
library Pqc {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    uint8 internal constant ML_DSA_87 = 1;
    uint256 internal constant PUBKEY_LENGTH = 2592; // FIPS 204, ML-DSA-87
    uint256 internal constant SIGNATURE_LENGTH = 4627;

    error PqcUnavailable(address precompile);
    error NoPqcKey(address account);
    error NotMlDsa87(address account, uint256 algorithmId);
    error PossessionNotProven(address account);
    error BadSignatureLength(uint256 length);
    error BadPqcSignature(address account);

    /// @notice The account's registered ML-DSA-87 public key. Reverts unless the key is
    ///         registered, is ML-DSA-87 and, where the chain reports it, was registered
    ///         with a proof of possession.
    /// @dev    Two answer shapes are accepted: (bool registered, uint8 algorithm, bytes key,
    ///         bool possessionProven), and the older (bool, uint8, bytes) without the last field.
    function registeredKey(address account) internal view returns (bytes memory key) {
        (bool ok, bytes memory ret) = PQC_KEY_STATUS.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        if (!ok || ret.length < 0x60) revert PqcUnavailable(PQC_KEY_STATUS);

        uint256 registered;
        uint256 algorithm;
        uint256 offset;
        assembly ("memory-safe") {
            registered := mload(add(ret, 0x20))
            algorithm := mload(add(ret, 0x40))
            offset := mload(add(ret, 0x60))
        }
        if (registered > 1 || algorithm > type(uint8).max) revert PqcUnavailable(PQC_KEY_STATUS);

        bool proven = true;
        if (offset == 0x80) {
            if (ret.length < 0xa0) revert PqcUnavailable(PQC_KEY_STATUS);
            uint256 possession;
            assembly ("memory-safe") {
                possession := mload(add(ret, 0x80))
            }
            if (possession > 1) revert PqcUnavailable(PQC_KEY_STATUS);
            proven = possession == 1;
        } else if (offset != 0x60) {
            revert PqcUnavailable(PQC_KEY_STATUS);
        }

        if (ret.length < offset + 0x20) revert PqcUnavailable(PQC_KEY_STATUS);
        uint256 keyLength;
        assembly ("memory-safe") {
            keyLength := mload(add(add(ret, 0x20), offset))
        }
        if (ret.length < offset + 0x20 + keyLength) revert PqcUnavailable(PQC_KEY_STATUS);

        if (registered == 0) revert NoPqcKey(account);
        if (algorithm != ML_DSA_87) revert NotMlDsa87(account, algorithm);
        if (!proven) revert PossessionNotProven(account);
        if (keyLength != PUBKEY_LENGTH) revert NoPqcKey(account);

        key = new bytes(keyLength);
        for (uint256 i; i < keyLength; i += 0x20) {
            assembly ("memory-safe") {
                mstore(add(add(key, 0x20), i), mload(add(add(ret, 0x40), add(offset, i))))
            }
        }
    }

    /// @notice Reverts unless `signature` is `account`'s ML-DSA-87 signature over `message`.
    function requireSignedBy(address account, bytes memory message, bytes memory signature) internal view {
        if (signature.length != SIGNATURE_LENGTH) revert BadSignatureLength(signature.length);
        bytes memory key = registeredKey(account);
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", key, signature, message));
        if (!ok || ret.length != 0x20) revert PqcUnavailable(PQC_VERIFY);
        uint256 verdict = abi.decode(ret, (uint256));
        if (verdict > 1) revert PqcUnavailable(PQC_VERIFY);
        if (verdict != 1) revert BadPqcSignature(account);
    }
}
