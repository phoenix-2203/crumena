// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PotVault
/// @notice Holds one pot's money. Anyone can pay into it with an ordinary token
///         transfer (it is just an address), and only the Crumena contract that
///         created it can move money out, under the pot's rules.
contract PotVault {
    /// @notice The Crumena contract that created this vault.
    address public immutable crumena;

    error NotCrumena();
    error TransferFailed();

    constructor() {
        crumena = msg.sender;
    }

    /// @dev Access control: only the Crumena contract that deployed this vault.
    modifier onlyCrumena() {
        if (msg.sender != crumena) revert NotCrumena();
        _;
    }

    /// @notice Sends `amount` of `token` to `to`. Only Crumena can call it, after the
    ///         pot's checks and with its own state already updated.
    function send(address token, address to, uint256 amount) external onlyCrumena {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer(address,uint256)
        if (!ok || (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }
}
