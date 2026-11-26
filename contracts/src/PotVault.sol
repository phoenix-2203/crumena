// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PotVault
/// @notice Holds one pot's money. Anyone can pay into it with an ordinary token
///         transfer (it is just an address), and only the Earmark contract that
///         created it can move money out, under the pot's rules.
contract PotVault {
    /// @notice The Earmark contract that created this vault.
    address public immutable earmark;

    error NotEarmark();
    error TransferFailed();

    constructor() {
        earmark = msg.sender;
    }

    /// @notice Sends `amount` of `token` to `to`. Only Earmark can call it.
    function send(address token, address to, uint256 amount) external {
        if (msg.sender != earmark) revert NotEarmark();
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer(address,uint256)
        if (!ok || (ret.length != 0 && (ret.length != 32 || !abi.decode(ret, (bool))))) revert TransferFailed();
    }
}
