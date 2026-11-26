// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pqc} from "./lib/Pqc.sol";
import {Text} from "./lib/Text.sol";
import {PotVault} from "./PotVault.sol";

/// @title Crumena
/// @notice Money with a purpose. A funder puts money in a pot for someone (the
///         recipient) and names who it may be paid to (the payees). The recipient
///         decides when and how much; the contract only ever pays an approved payee.
///         What is left goes back to the funder after the end date.
///
///         Every action is a short plain-text statement the person signs in QoreX with
///         their post-quantum key (ML-DSA-87). The contract rebuilds that text, reads
///         the signer's key from the chain (pqcKeyStatus) and checks the signature
///         (pqcVerify). Anyone can submit a signed action, so a relayer can pay the gas;
///         nobody can change it. A stolen classical (ECDSA) key signs nothing here.
///
///         The funder can also set spending rules (a cap per payment, a limit per
///         period, such as 200 a week), cap what each payee may receive in total, and
///         freeze the pot at once if something looks wrong; each of those is a signed
///         statement too.
///
///         Each pot's money sits in its own vault, an address anyone can pay into.
///         There is no owner, no admin key, no fee and no upgrade.
contract Crumena {
    // ------------------------------------------------------------------ types

    struct Pot {
        address funder; // puts the money in, approves payees, gets the rest back
        address recipient; // spends it, to approved payees only
        address token; // ERC-20 the pot holds (fUSD on QoreChain testnet)
        address vault; // where the money sits; anyone can pay into it
        uint64 createdAt;
        uint64 endsAt; // no payments after this; then the rest can go back to the funder
        uint8 decimals; // token decimals, read once at creation
        bool confirmedOnly; // pay only payees who confirmed their address with their own key
        bool closed;
        bool frozen; // the funder froze it: no payments until unfrozen
        uint32 periodDays; // length of a spending period in days (0: no period limit)
        uint64 periodIndex; // which period spentInPeriod counts (periods start at createdAt)
        uint256 paidOut; // total paid to payees
        uint256 maxPerPayment; // largest single payment (0: no cap)
        uint256 periodLimit; // most that can be paid in one period (0: no limit)
        uint256 spentInPeriod; // paid so far in period periodIndex
        string symbol; // token symbol, read once at creation
        string purpose; // what the money is for
    }

    struct Payee {
        bool approved; // the funder approved it: the pot can pay it
        bool confirmed; // the payee signed with its own post-quantum key that the address is theirs
        bool requested; // the recipient asked the funder to approve it
        string name;
        uint256 limit; // most the pot may pay this payee in total (0: no limit beyond the pot's rules)
        uint256 paid; // paid to this payee so far, by this pot
        uint256 asked; // the amount the recipient said it wants to pay, when it asked for approval
    }

    /// @notice Spending rules. Zero means no rule. A period limit needs a period length.
    struct Rules {
        uint256 maxPerPayment;
        uint256 periodLimit;
        uint32 periodDays;
    }

    /// @notice What the funder signs to create a pot.
    struct NewPot {
        address funder;
        address recipient;
        address token;
        uint64 endsAt;
        bool confirmedOnly;
        Rules rules;
        string purpose;
        address[] payees;
        string[] names;
        uint256[] limits; // per payee, most it may receive in total (0: no limit)
    }

    /// @notice The signature part of every action: the signer's next nonce, a deadline,
    ///         and the ML-DSA-87 signature QoreX made over the statement.
    struct Auth {
        uint256 nonce;
        uint64 validUntil;
        bytes signature;
    }

    // -------------------------------------------------------------- constants

    uint256 public constant MAX_PAYEES_AT_CREATION = 10;
    uint256 public constant MAX_PAYEES = 50;
    uint256 public constant MAX_PURPOSE = 80;
    uint256 public constant MAX_NAME = 48;
    uint256 public constant MAX_MEMO = 80;
    uint256 public constant MAX_SIGNATURE_LIFETIME = 7 days;
    uint256 public constant MAX_PERIOD_DAYS = 366;

    /// @notice The chain id string QoreX puts in front of every message it signs.
    string public chainName;
    /// @notice The EVM chain id this contract was deployed for (9800 on qorechain-diana).
    uint256 public immutable evmChainId;

    // ------------------------------------------------------------------ state

    uint256 public potCount;
    mapping(uint256 => Pot) private _pots;
    mapping(uint256 => mapping(address => Payee)) private _payees;
    mapping(uint256 => address[]) private _payeeList; // every address ever approved or requested, in order
    mapping(uint256 => mapping(address => bool)) private _listed;
    mapping(address => uint256) public nonceOf; // next nonce each signer must use
    mapping(address => uint256[]) private _potsOf; // pots an address funds or spends
    mapping(address => uint256) public potOfVault;
    /// @notice A pot's short link code: the first 8 bytes of its vault address. Not secret
    ///         (everything about a pot is public on chain), just not a counter. The first
    ///         pot to get a code keeps it; the app checks a code against the pot's vault.
    mapping(bytes8 => uint256) public potOfCode;

    // ----------------------------------------------------------------- events

    event PotCreated(
        uint256 indexed potId,
        address indexed funder,
        address indexed recipient,
        address vault,
        address token,
        uint64 endsAt,
        bool confirmedOnly,
        string purpose
    );
    event PayeeApproved(uint256 indexed potId, address indexed payee, string name, uint256 limit);
    event PayeeRemoved(uint256 indexed potId, address indexed payee);
    event PayeeRequested(uint256 indexed potId, address indexed payee, string name, uint256 amount);
    event PayeeLimitChanged(uint256 indexed potId, address indexed payee, uint256 limit);
    event PayeeConfirmed(uint256 indexed potId, address indexed payee);
    event Paid(uint256 indexed potId, address indexed payee, uint256 amount, string memo, address indexed by);
    event EndChanged(uint256 indexed potId, uint64 endsAt);
    event RulesChanged(uint256 indexed potId, uint256 maxPerPayment, uint256 periodLimit, uint32 periodDays);
    event FrozenChanged(uint256 indexed potId, bool frozen);
    event Released(uint256 indexed potId, address indexed recipient, uint256 amount);
    event Reclaimed(uint256 indexed potId, address indexed funder, uint256 amount);
    event Signed(address indexed signer, uint256 nonce);

    // ----------------------------------------------------------------- errors

    error WrongChain();
    error BadNonce(uint256 expected, uint256 given);
    error Expired();
    error ValidTooLong();
    error NotAllowed();
    error NoSuchPot();
    error PotClosed();
    error PotEnded();
    error PotNotEnded();
    error BadAddress();
    error BadEnd();
    error BadToken();
    error TooManyPayees();
    error DuplicatePayee();
    error NotApproved();
    error NotConfirmed();
    error AlreadyApproved();
    error ZeroAmount();
    error NotEnoughInPot(uint256 available, uint256 asked);
    error NothingToMove();
    error BadRules();
    error PotFrozen();
    error OverPaymentLimit(uint256 limit);
    error OverPeriodLimit(uint256 remaining);
    error NoChange();
    error OverPayeeLimit(uint256 remaining);

    constructor(string memory chainName_, uint256 evmChainId_) {
        if (block.chainid != evmChainId_) revert WrongChain();
        chainName = chainName_;
        evmChainId = evmChainId_;
    }

    // ================================================================ actions

    /// @notice Create a pot. Signed by the funder. Its vault address is known before this
    ///         runs (vaultFor), so the funder can pay in at any time.
    function createPot(NewPot calldata p, Auth calldata a) external returns (uint256 potId) {
        _checkNewPot(p);
        (uint8 decimals, string memory symbol) = _tokenInfo(p.token);
        _authorize(p.funder, createStatement(p, a.nonce, a.validUntil), a);

        potId = ++potCount;
        address vault = address(new PotVault{salt: _salt(p.funder, a.nonce)}());
        Pot storage pot = _pots[potId];
        pot.funder = p.funder;
        pot.recipient = p.recipient;
        pot.token = p.token;
        pot.vault = vault;
        pot.createdAt = uint64(block.timestamp);
        pot.endsAt = p.endsAt;
        pot.decimals = decimals;
        pot.confirmedOnly = p.confirmedOnly;
        pot.maxPerPayment = p.rules.maxPerPayment;
        pot.periodLimit = p.rules.periodLimit;
        pot.periodDays = p.rules.periodDays;
        pot.symbol = symbol;
        pot.purpose = p.purpose;
        potOfVault[vault] = potId;
        bytes8 code = bytes8(bytes20(vault));
        if (potOfCode[code] == 0) potOfCode[code] = potId;
        _potsOf[p.funder].push(potId);
        if (p.recipient != p.funder) _potsOf[p.recipient].push(potId);

        emit PotCreated(potId, p.funder, p.recipient, vault, p.token, p.endsAt, p.confirmedOnly, p.purpose);
        if (p.rules.maxPerPayment != 0 || p.rules.periodDays != 0) {
            emit RulesChanged(potId, p.rules.maxPerPayment, p.rules.periodLimit, p.rules.periodDays);
        }
        for (uint256 i; i < p.payees.length; ++i) _approve(potId, p.payees[i], p.names[i], p.limits[i]);
    }

    /// @notice Pay an approved payee from the pot. Signed by the recipient or the funder.
    function pay(uint256 potId, address payee, uint256 amount, string calldata memo, address signer, Auth calldata a)
        external
    {
        Pot storage pot = _openPot(potId);
        if (block.timestamp > pot.endsAt) revert PotEnded();
        if (signer != pot.recipient && signer != pot.funder) revert NotAllowed();
        Payee storage p = _payees[potId][payee];
        if (!p.approved) revert NotApproved();
        if (pot.confirmedOnly && !p.confirmed) revert NotConfirmed();
        if (amount == 0) revert ZeroAmount();
        if (pot.frozen) revert PotFrozen();
        if (pot.maxPerPayment != 0 && amount > pot.maxPerPayment) revert OverPaymentLimit(pot.maxPerPayment);
        if (p.limit != 0 && p.paid + amount > p.limit) revert OverPayeeLimit(p.limit > p.paid ? p.limit - p.paid : 0);
        (uint64 period, uint256 spent) = _periodSpent(pot);
        if (pot.periodDays != 0 && spent + amount > pot.periodLimit) revert OverPeriodLimit(pot.periodLimit - spent);
        Text.requirePrintableOrEmpty(memo, MAX_MEMO);
        uint256 available = balanceOf(potId);
        if (amount > available) revert NotEnoughInPot(available, amount);
        _authorize(signer, payStatement(potId, payee, amount, memo, signer, a.nonce, a.validUntil), a);

        if (pot.periodDays != 0) {
            pot.periodIndex = period;
            pot.spentInPeriod = spent + amount;
        }
        pot.paidOut += amount;
        p.paid += amount;
        emit Paid(potId, payee, amount, memo, signer);
        PotVault(pot.vault).send(pot.token, payee, amount);
    }

    /// @notice Approve a payee, up to `limit` in total (0: no limit beyond the pot's
    ///         rules). Signed by the funder.
    function addPayee(uint256 potId, address payee, string calldata name, uint256 limit, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        _authorize(pot.funder, addPayeeStatement(potId, payee, name, limit, a.nonce, a.validUntil), a);
        _approve(potId, payee, name, limit);
    }

    /// @notice Change the most an approved payee may receive in total (0: no limit beyond
    ///         the pot's rules). What it was already paid still counts. Signed by the funder.
    function setPayeeLimit(uint256 potId, address payee, uint256 limit, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        Payee storage p = _payees[potId][payee];
        if (!p.approved) revert NotApproved();
        if (p.limit == limit) revert NoChange();
        _authorize(pot.funder, payeeLimitStatement(potId, payee, limit, a.nonce, a.validUntil), a);
        p.limit = limit;
        p.asked = 0;
        emit PayeeLimitChanged(potId, payee, limit);
    }

    /// @notice Stop paying a payee. Signed by the funder.
    function removePayee(uint256 potId, address payee, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        Payee storage p = _payees[potId][payee];
        if (!p.approved) revert NotApproved();
        _authorize(pot.funder, removePayeeStatement(potId, payee, a.nonce, a.validUntil), a);
        p.approved = false;
        p.confirmed = false;
        emit PayeeRemoved(potId, payee);
    }

    /// @notice Ask the funder to approve a payee. Signed by the recipient. The funder
    ///         approves it with addPayee; until then the pot can't pay it.
    function requestPayee(uint256 potId, address payee, string calldata name, uint256 amount, Auth calldata a)
        external
    {
        Pot storage pot = _openPot(potId);
        _checkPayeeAddress(pot, payee);
        Text.requirePrintable(name, MAX_NAME);
        if (amount == 0) revert ZeroAmount();
        Payee storage p = _payees[potId][payee];
        if (p.approved) revert AlreadyApproved();
        _authorize(pot.recipient, requestPayeeStatement(potId, payee, name, amount, a.nonce, a.validUntil), a);
        _list(potId, payee);
        p.requested = true;
        p.name = name;
        p.asked = amount;
        emit PayeeRequested(potId, payee, name, amount);
    }

    /// @notice A payee confirms, with its own post-quantum key, that it controls the
    ///         address and accepts payments from this pot. Signed by the payee.
    function confirmPayee(uint256 potId, address payee, Auth calldata a) external {
        _openPot(potId);
        Payee storage p = _payees[potId][payee];
        if (!p.approved) revert NotApproved();
        _authorize(payee, confirmPayeeStatement(potId, payee, a.nonce, a.validUntil), a);
        p.confirmed = true;
        emit PayeeConfirmed(potId, payee);
    }

    /// @notice Move the end date later. Signed by the funder.
    function extend(uint256 potId, uint64 newEndsAt, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        if (newEndsAt <= pot.endsAt) revert BadEnd();
        _authorize(pot.funder, extendStatement(potId, newEndsAt, a.nonce, a.validUntil), a);
        pot.endsAt = newEndsAt;
        emit EndChanged(potId, newEndsAt);
    }

    /// @notice Change the spending rules. Signed by the funder. Changing the period length
    ///         starts counting afresh; otherwise what was spent this period still counts.
    function setRules(uint256 potId, Rules calldata r, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        _checkRules(r);
        _authorize(pot.funder, rulesStatement(potId, r, a.nonce, a.validUntil), a);
        if (r.periodDays != pot.periodDays) {
            pot.periodDays = r.periodDays;
            pot.spentInPeriod = 0;
            pot.periodIndex = r.periodDays == 0 ? 0 : _periodIndex(pot);
        }
        pot.maxPerPayment = r.maxPerPayment;
        pot.periodLimit = r.periodLimit;
        emit RulesChanged(potId, r.maxPerPayment, r.periodLimit, r.periodDays);
    }

    /// @notice Freeze the pot (no payments) or unfreeze it. Signed by the funder. Freezing
    ///         is for when something looks wrong, such as the spender's phone being lost.
    function setFrozen(uint256 potId, bool frozen, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        if (pot.frozen == frozen) revert NoChange();
        _authorize(pot.funder, frozenStatement(potId, frozen, a.nonce, a.validUntil), a);
        pot.frozen = frozen;
        emit FrozenChanged(potId, frozen);
    }

    /// @notice Give everything left to the recipient, with no more restrictions, and
    ///         close the pot. Signed by the funder.
    function release(uint256 potId, Auth calldata a) external {
        Pot storage pot = _openPot(potId);
        _authorize(pot.funder, releaseStatement(potId, a.nonce, a.validUntil), a);
        uint256 amount = balanceOf(potId);
        pot.closed = true;
        emit Released(potId, pot.recipient, amount);
        if (amount != 0) PotVault(pot.vault).send(pot.token, pot.recipient, amount);
    }

    /// @notice After the end date, send what is left back to the funder and close the pot.
    ///         Anyone can call it: the money can only go to the funder. It also returns
    ///         anything paid into a closed pot's vault later.
    function reclaim(uint256 potId) external {
        Pot storage pot = _pots[potId];
        if (pot.vault == address(0)) revert NoSuchPot();
        if (!pot.closed && block.timestamp <= pot.endsAt) revert PotNotEnded();
        uint256 amount = balanceOf(potId);
        if (amount == 0) revert NothingToMove();
        pot.closed = true;
        emit Reclaimed(potId, pot.funder, amount);
        PotVault(pot.vault).send(pot.token, pot.funder, amount);
    }

    // ============================================================= statements
    //
    // The exact text each signer sees in QoreX. The app reads it from these functions
    // (eth_call) and asks QoreX to sign it; the contract checks the signature over the
    // same text, with QoreX's prefix "qorechain-msg-v1|<chain id>|" in front.

    function createStatement(NewPot calldata p, uint256 nonce, uint64 validUntil) public view returns (string memory) {
        (uint8 decimals, string memory symbol) = _tokenInfo(p.token);
        string memory s = string.concat(
            "Crumena: create a pot\nPurpose: ",
            p.purpose,
            "\nSpent by: ",
            Text.qorAddress(p.recipient),
            "\nMoney: ",
            symbol,
            " (",
            Text.hexAddress(p.token),
            ")\nEnds: ",
            Text.utc(p.endsAt),
            "\nPay only payees who confirmed: ",
            p.confirmedOnly ? "yes" : "no",
            _rulesText(p.rules, decimals, symbol),
            "\nPayees:"
        );
        for (uint256 i; i < p.payees.length; ++i) {
            s = string.concat(
                s,
                "\n",
                Text.decimal(i + 1),
                ". ",
                p.names[i],
                ", ",
                Text.hexAddress(p.payees[i]),
                p.limits[i] == 0 ? ", no limit" : string.concat(", up to ", Text.units(p.limits[i], decimals), " ", symbol)
            );
        }
        return string.concat(s, "\nPot address: ", Text.hexAddress(vaultFor(p.funder, nonce)), _footer(p.funder, nonce, validUntil));
    }

    function payStatement(
        uint256 potId,
        address payee,
        uint256 amount,
        string calldata memo,
        address signer,
        uint256 nonce,
        uint64 validUntil
    ) public view returns (string memory) {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: pay from pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nAmount: ",
            Text.units(amount, pot.decimals),
            " ",
            pot.symbol,
            "\nTo: ",
            _payees[potId][payee].name,
            "\nAddress: ",
            Text.hexAddress(payee),
            "\nMemo: ",
            bytes(memo).length == 0 ? "-" : memo,
            _footer(signer, nonce, validUntil)
        );
    }

    function addPayeeStatement(
        uint256 potId,
        address payee,
        string calldata name,
        uint256 limit,
        uint256 nonce,
        uint64 validUntil
    ) public view returns (string memory) {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: approve a payee for pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nPayee: ",
            name,
            "\nAddress: ",
            Text.hexAddress(payee),
            _limitLines(pot, _payees[potId][payee].paid, limit),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function payeeLimitStatement(uint256 potId, address payee, uint256 limit, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        Payee storage p = _payees[potId][payee];
        return string.concat(
            "Crumena: change what pot #",
            Text.decimal(potId),
            " may pay a payee\nPot: ",
            pot.purpose,
            "\nPayee: ",
            p.name,
            "\nAddress: ",
            Text.hexAddress(payee),
            _limitLines(pot, p.paid, limit),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function removePayeeStatement(uint256 potId, address payee, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: stop paying a payee from pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nPayee: ",
            _payees[potId][payee].name,
            "\nAddress: ",
            Text.hexAddress(payee),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function requestPayeeStatement(
        uint256 potId,
        address payee,
        string calldata name,
        uint256 amount,
        uint256 nonce,
        uint64 validUntil
    ) public view returns (string memory) {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: ask the funder to approve a payee for pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nPayee: ",
            name,
            "\nAddress: ",
            Text.hexAddress(payee),
            "\nAmount: ",
            Text.units(amount, pot.decimals),
            " ",
            pot.symbol,
            _footer(pot.recipient, nonce, validUntil)
        );
    }

    function confirmPayeeStatement(uint256 potId, address payee, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: confirm this address is mine and can be paid from pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nPaid as: ",
            _payees[potId][payee].name,
            "\nAddress: ",
            Text.hexAddress(payee),
            _footer(payee, nonce, validUntil)
        );
    }

    function extendStatement(uint256 potId, uint64 newEndsAt, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: move the end of pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            "\nNew end: ",
            Text.utc(newEndsAt),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function rulesStatement(uint256 potId, Rules calldata r, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: change the spending rules of pot #",
            Text.decimal(potId),
            "\nPot: ",
            pot.purpose,
            _rulesText(r, pot.decimals, pot.symbol),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function frozenStatement(uint256 potId, bool frozen, uint256 nonce, uint64 validUntil)
        public
        view
        returns (string memory)
    {
        Pot storage pot = _existing(potId);
        return string.concat(
            frozen ? "Crumena: freeze pot #" : "Crumena: unfreeze pot #",
            Text.decimal(potId),
            frozen ? " (no payments until the funder unfreezes it)" : " (payments allowed again)",
            "\nPot: ",
            pot.purpose,
            _footer(pot.funder, nonce, validUntil)
        );
    }

    function releaseStatement(uint256 potId, uint256 nonce, uint64 validUntil) public view returns (string memory) {
        Pot storage pot = _existing(potId);
        return string.concat(
            "Crumena: give everything left in pot #",
            Text.decimal(potId),
            " to the person who spends it, with no restrictions, and close the pot\nPot: ",
            pot.purpose,
            "\nTo: ",
            Text.qorAddress(pot.recipient),
            _footer(pot.funder, nonce, validUntil)
        );
    }

    /// @notice The exact bytes QoreX signs for `statement`.
    function signedBytes(string memory statement) public view returns (bytes memory) {
        return abi.encodePacked("qorechain-msg-v1|", chainName, "|", statement);
    }

    // ================================================================== views

    function potInfo(uint256 potId) external view returns (Pot memory) {
        return _existing(potId);
    }

    /// @notice Money in the pot now.
    function balanceOf(uint256 potId) public view returns (uint256) {
        Pot storage pot_ = _existing(potId);
        (bool ok, bytes memory ret) = pot_.token.staticcall(abi.encodeWithSelector(0x70a08231, pot_.vault)); // balanceOf(address)
        if (!ok || ret.length != 32) revert BadToken();
        return abi.decode(ret, (uint256));
    }

    /// @notice Spending in the current period: paid so far, the limit, and when the next
    ///         period starts. All zero when the pot has no period limit.
    function periodSpending(uint256 potId) external view returns (uint256 spent, uint256 limit, uint64 resetsAt) {
        Pot storage pot_ = _existing(potId);
        if (pot_.periodDays == 0) return (0, 0, 0);
        (uint64 period, uint256 spent_) = _periodSpent(pot_);
        uint256 len = uint256(pot_.periodDays) * 1 days;
        return (spent_, pot_.periodLimit, uint64(pot_.createdAt + (uint256(period) + 1) * len));
    }

    /// @notice Every payee ever approved or requested for a pot, with its state.
    function payeesOf(uint256 potId) external view returns (address[] memory addrs, Payee[] memory info) {
        _existing(potId);
        addrs = _payeeList[potId];
        info = new Payee[](addrs.length);
        for (uint256 i; i < addrs.length; ++i) info[i] = _payees[potId][addrs[i]];
    }

    function payeeInfo(uint256 potId, address addr) external view returns (Payee memory) {
        return _payees[potId][addr];
    }

    /// @notice Pots an address funds or spends.
    function potsOf(address account) external view returns (uint256[] memory) {
        return _potsOf[account];
    }

    /// @notice The vault address a pot gets when `funder` creates it with `nonce`.
    function vaultFor(address funder, uint256 nonce) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _salt(funder, nonce), keccak256(type(PotVault).creationCode))
        );
        return address(uint160(uint256(h)));
    }

    // =============================================================== internal

    function _authorize(address signer, string memory statement, Auth calldata a) internal {
        if (block.chainid != evmChainId) revert WrongChain();
        if (a.nonce != nonceOf[signer]) revert BadNonce(nonceOf[signer], a.nonce);
        if (block.timestamp > a.validUntil) revert Expired();
        if (a.validUntil > block.timestamp + MAX_SIGNATURE_LIFETIME) revert ValidTooLong();
        Pqc.requireSignedBy(signer, signedBytes(statement), a.signature);
        nonceOf[signer] = a.nonce + 1;
        emit Signed(signer, a.nonce);
    }

    function _checkRules(Rules memory r) internal pure {
        if (r.periodDays > MAX_PERIOD_DAYS || (r.periodLimit == 0) != (r.periodDays == 0)) revert BadRules();
    }

    function _periodIndex(Pot storage pot_) internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast) a day count over 64 bits is unreachable
        return uint64((block.timestamp - pot_.createdAt) / (uint256(pot_.periodDays) * 1 days));
    }

    /// @dev The current period and what has been paid in it (0 once a new period starts).
    function _periodSpent(Pot storage pot_) internal view returns (uint64 period, uint256 spent) {
        if (pot_.periodDays == 0) return (0, 0);
        period = _periodIndex(pot_);
        spent = period == pot_.periodIndex ? pot_.spentInPeriod : 0;
    }

    function _rulesText(Rules memory r, uint8 decimals, string memory symbol) internal pure returns (string memory) {
        string memory perPayment =
            r.maxPerPayment == 0 ? "none" : string.concat(Text.units(r.maxPerPayment, decimals), " ", symbol);
        string memory perPeriod = r.periodLimit == 0
            ? "none"
            : string.concat(
                Text.units(r.periodLimit, decimals),
                " ",
                symbol,
                " every ",
                Text.decimal(r.periodDays),
                r.periodDays == 1 ? " day" : " days"
            );
        return string.concat("\nLimit per payment: ", perPayment, "\nLimit per period: ", perPeriod);
    }

    /// @dev "Up to: 30 fUSD in total" (or "no limit"), and what was already paid, if anything.
    function _limitLines(Pot storage pot_, uint256 paid, uint256 limit) internal view returns (string memory) {
        return string.concat(
            "\nUp to: ",
            limit == 0 ? "no limit" : string.concat(Text.units(limit, pot_.decimals), " ", pot_.symbol, " in total"),
            paid == 0 ? "" : string.concat("\nAlready paid: ", Text.units(paid, pot_.decimals), " ", pot_.symbol)
        );
    }

    function _footer(address signer, uint256 nonce, uint64 validUntil) internal view returns (string memory) {
        return string.concat(
            "\nSigned by: ",
            Text.qorAddress(signer),
            "\nNonce: ",
            Text.decimal(nonce),
            "\nValid until: ",
            Text.utc(validUntil),
            "\nContract: ",
            Text.hexAddress(address(this)),
            " on ",
            chainName
        );
    }

    function _approve(uint256 potId, address payee_, string memory name, uint256 limit) internal {
        Pot storage pot_ = _pots[potId];
        _checkPayeeAddress(pot_, payee_);
        Text.requirePrintable(name, MAX_NAME);
        Payee storage p = _payees[potId][payee_];
        if (p.approved) revert AlreadyApproved();
        _list(potId, payee_);
        p.approved = true;
        p.requested = false;
        p.name = name;
        p.limit = limit;
        p.asked = 0;
        emit PayeeApproved(potId, payee_, name, limit);
    }

    function _list(uint256 potId, address payee_) internal {
        if (_listed[potId][payee_]) return;
        if (_payeeList[potId].length >= MAX_PAYEES) revert TooManyPayees();
        _listed[potId][payee_] = true;
        _payeeList[potId].push(payee_);
    }

    function _checkPayeeAddress(Pot storage pot_, address payee_) internal view {
        if (
            payee_ == address(0) || payee_ == pot_.funder || payee_ == pot_.recipient || payee_ == pot_.vault
                || payee_ == address(this) || potOfVault[payee_] != 0
        ) revert BadAddress();
    }

    function _checkNewPot(NewPot calldata p) internal view {
        if (p.funder == address(0) || p.recipient == address(0)) revert BadAddress();
        if (p.endsAt <= block.timestamp) revert BadEnd();
        Text.requirePrintable(p.purpose, MAX_PURPOSE);
        _checkRules(p.rules);
        if (
            p.payees.length == 0 || p.payees.length > MAX_PAYEES_AT_CREATION || p.names.length != p.payees.length
                || p.limits.length != p.payees.length
        ) {
            revert TooManyPayees();
        }
        for (uint256 i; i < p.payees.length; ++i) {
            Text.requirePrintable(p.names[i], MAX_NAME);
            address a = p.payees[i];
            if (a == address(0) || a == p.funder || a == p.recipient || a == address(this) || potOfVault[a] != 0) {
                revert BadAddress();
            }
            for (uint256 j; j < i; ++j) {
                if (p.payees[j] == a) revert DuplicatePayee();
            }
        }
    }

    function _tokenInfo(address token) internal view returns (uint8 decimals, string memory symbol) {
        if (token.code.length == 0) revert BadToken();
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x313ce567)); // decimals()
        if (!ok || ret.length != 32) revert BadToken();
        uint256 d = abi.decode(ret, (uint256));
        if (d > 18) revert BadToken();
        // forge-lint: disable-next-line(unsafe-typecast) checked d <= 18 above
        decimals = uint8(d);
        (ok, ret) = token.staticcall(abi.encodeWithSelector(0x95d89b41)); // symbol()
        if (!ok) revert BadToken();
        symbol = abi.decode(ret, (string));
        Text.requirePrintable(symbol, 16);
    }

    function _salt(address funder, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(funder, nonce));
    }

    function _existing(uint256 potId) internal view returns (Pot storage pot_) {
        pot_ = _pots[potId];
        if (pot_.vault == address(0)) revert NoSuchPot();
    }

    function _openPot(uint256 potId) internal view returns (Pot storage pot_) {
        pot_ = _existing(potId);
        if (pot_.closed) revert PotClosed();
    }
}
